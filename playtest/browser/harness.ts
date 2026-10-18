/* The browser harness: one persistent Chrome profile per persona (its own localStorage, so the
 * demo base and career carry across runs like a real returning player), emulating that person's
 * device, network and motion settings, with the game clock under our control so hours of play take
 * seconds. Every step is screenshotted and probed for errors, performance and layout problems.
 *
 * Safety: guest/demo mode only. The harness never signs in or enlists, refuses any non-GET request
 * that leaves the site's origin, and keeps the monkey away from login, enlistment and wallet screens. */
import { chromium, devices, type BrowserContext, type Page, type CDPSession } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Profile, Network } from '../profiles';

export const BLOCK_MS = 4000; // src/game/demo.ts
export const DEMO_KEY = 'structs-kor.demo';
/** Screens a harness must never drive: real accounts, keys and chain transactions. */
export const FORBIDDEN = /\/(login|start|profile|enlist)(\b|\/|\?|$)/;

const NETWORKS: Record<Network, { latency: number; down: number; up: number } | null> = {
  fiber: null,
  cable: { latency: 20, down: 50e6 / 8, up: 10e6 / 8 },
  '4g': { latency: 70, down: 9e6 / 8, up: 3e6 / 8 },
  '3g': { latency: 300, down: 1.6e6 / 8, up: 0.75e6 / 8 },
};

/** The host throttled us (GitHub Pages answers 429 with a "Rate limit exceeded" page). Not a game
 * bug: the runner backs off and replays the persona. */
export class RateLimited extends Error {}

export interface StepResult {
  step: string; status: 'ok' | 'skip' | 'fail'; note: string; ms: number; url: string;
  screenshot?: string; blocks?: number;
}
/** What this run lets an agent do (the testnet owner opts in per run; see playtest/README.md). */
export interface Allow {
  /** Answer the Guild API from src/api/mock.ts (?mock=1; dev server only) and enlist against it. */
  mock: boolean;
  /** Enlist account profiles as real commanders on the target's guild (testnet), via /start. */
  signup?: boolean;
  /** Accept confirmations that sign chain transactions (fleet launch, struct attack, contracts). */
  chain?: boolean;
}
export const GUEST: Allow = { mock: false };
/** May this profile hold an account in this run? */
export const canEnlist = (a: Allow, p: { account?: boolean }) => !!p.account && (a.mock || !!a.signup);
/** A commander a profile enlisted against the mock (or reused). Public facts only, never the phrase. */
export interface Account { persona: string; playerId: string | null; address: string | null; callsign: string | null; created: boolean; at: string }
export interface DialogSeen { step: string; type: string; message: string; answer: 'accepted' | 'dismissed'; why: string }

export interface Finding { kind: string; severity: 'blocker' | 'major' | 'minor' | 'info'; step: string; message: string; detail?: unknown }
export interface Perf { lcp?: number; cls?: number; longTasks?: number; longTaskMs?: number; heapMB?: number; domNodes?: number; ttfb?: number; load?: number }

/** Injected before any page script: collects what the probes read back. */
/** Guard rails injected into every page: the recovery phrase is never revealed, imported or typed,
 * and the account is never wiped, locked or signed out by an agent. Blocked attempts are counted. */
const GUARD = `(() => {
  const blockedActs = ['reveal', 'doImport', 'doUnlock', 'forget', 'signout', 'lock'];
  const stop = (e, what) => { e.preventDefault(); e.stopImmediatePropagation(); (window.__ptBlocked = window.__ptBlocked || []).push(what); };
  document.addEventListener('submit', (e) => { const f = e.target.closest && e.target.closest('[data-act]'); if (f && blockedActs.includes(f.dataset.act)) stop(e, f.dataset.act); }, true);
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act], button');
    if (!el) return;
    const act = el.dataset.act || (el.form && el.form.dataset.act);
    if (act && blockedActs.includes(act)) stop(e, act);
  }, true);
})();`;

const PROBE = `(() => {
  // tsx/esbuild wraps named functions in __name(); functions sent to page.evaluate need it defined.
  window.__name = window.__name || ((f) => f);
  const P = (window.__pt = { errors: [], lcp: 0, cls: 0, long: 0, longMs: 0 });
  addEventListener('error', (e) => P.errors.push(String(e.message || e.error)));
  addEventListener('unhandledrejection', (e) => P.errors.push('unhandled rejection: ' + String(e.reason && e.reason.message || e.reason)));
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) P.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.long++; P.longMs += e.duration; } }).observe({ type: 'longtask', buffered: true });
  } catch {}
})();`;

export class Harness {
  readonly findings: Finding[] = [];
  readonly dialogs: DialogSeen[] = [];
  account: Account | null = null;
  private signupBody: { callsign: string | null } | null = null;
  /** Feature id → what this profile found (see features.ts). */
  readonly coverage = new Map<string, { status: 'touched' | 'passed' | 'failed' | 'blocked' | 'guarded'; note: string; by: string }>();
  readonly steps: StepResult[] = [];
  readonly console: { type: string; text: string; step: string }[] = [];
  readonly requests = { total: 0, failed: [] as { url: string; status: number | string; step: string }[], blocked: [] as string[] };
  blocks = 0;
  step = 'boot';
  private shot = 0;
  private cdp?: CDPSession;
  private constructor(readonly p: Profile, readonly ctx: BrowserContext, public page: Page, readonly target: URL, readonly dir: string, readonly allow: Allow) {}

  static async open(p: Profile, target: string, outDir: string, opts: { headed?: boolean; fresh?: boolean; allow?: Allow } = {}) {
    const dir = resolve(outDir, p.id);
    mkdirSync(dir, { recursive: true });
    const userDataDir = resolve('playtest/.profiles', p.id);
    if (opts.fresh) { const { rmSync } = await import('node:fs'); rmSync(userDataDir, { recursive: true, force: true }); }
    const base = p.device === 'mobile' ? devices['Pixel 7'] : p.device === 'tablet' ? devices['Galaxy Tab S9'] ?? devices['iPad (gen 7)'] : null;
    const size = p.device === 'laptop' ? { width: 1366, height: 768 } : p.device === 'desktop' ? { width: 1600, height: 900 } : base!.viewport;
    // 200% zoom is the same layout as a viewport half as wide at twice the pixel density.
    const viewport = { width: Math.round(size.width / p.zoom), height: Math.round(size.height / p.zoom) };
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      channel: process.env.PLAYTEST_BROWSER === 'bundled' ? undefined : 'chrome',
      headless: !opts.headed,
      viewport,
      deviceScaleFactor: (base?.deviceScaleFactor ?? 1) * p.zoom,
      isMobile: base?.isMobile ?? false,
      hasTouch: p.input === 'touch',
      userAgent: base?.userAgent,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      reducedMotion: p.motion === 'reduced' ? 'reduce' : 'no-preference',
      colorScheme: 'dark',
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const t = new URL(target);
    const allow = opts.allow ?? GUEST;
    if (allow.mock && !['localhost', '127.0.0.1', '[::1]'].includes(t.hostname)) throw new Error('--mock needs the local dev server (the mock is never in a production build)');
    const h = new Harness(p, ctx, page, t, dir, allow);
    await ctx.addInitScript(PROBE);
    await ctx.addInitScript(GUARD);
    // The mock signs the browser in, which hides the demo base: only account profiles get it.
    await ctx.addInitScript(`try { localStorage.setItem('structs-kor.mock', '${allow.mock && p.account ? 1 : 0}'); } catch {}`);
    await ctx.route('**/*', (route) => {
      const r = route.request();
      if (r.method() !== 'GET' && r.method() !== 'HEAD' && r.method() !== 'OPTIONS' && new URL(r.url()).origin !== t.origin) { h.requests.blocked.push(`${r.method()} ${r.url()}`); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    // The game clock: fake timers and Date, advanced on purpose.
    await page.clock.install();
    h.wire(page);
    const net = NETWORKS[p.network];
    if (net) {
      h.cdp = await ctx.newCDPSession(page);
      await h.cdp.send('Network.enable');
      await h.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up });
    }
    return h;
  }

  wire(page: Page) {
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') this.console.push({ type: m.type(), text: m.text().slice(0, 400), step: this.step }); });
    page.on('pageerror', (e) => this.find('pageerror', 'blocker', e.message, e.stack?.split('\n').slice(0, 5).join('\n')));
    page.on('dialog', (d) => {
      const msg = d.message();
      if (msg.includes('pt-xss')) { this.find('security.xss', 'blocker', `typed markup ran as script on ${new URL(page.url()).pathname}`); void d.dismiss().catch(() => {}); return; }
      // Chain transactions and contract changes go through only with --chain-actions; the wallet is never wiped.
      const chain = /체인에 서명|계약을 해지/.test(msg), wipe = /지갑을 지울|지갑을 삭제/.test(msg);
      const accept = d.type() === 'confirm' && !wipe && (!chain || !!this.allow.chain);
      this.dialogs.push({ step: this.step, type: d.type(), message: msg.slice(0, 160), answer: accept ? 'accepted' : 'dismissed', why: wipe ? 'wallet wipe: never' : chain ? (this.allow.chain ? 'chain action (--chain-actions)' : 'chain action: declined without --chain-actions') : 'game confirmation' });
      if (d.type() === 'alert') this.find('ui.native-dialog', 'minor', `a native browser alert interrupted play: "${msg.slice(0, 80)}"`);
      void (accept ? d.accept() : d.dismiss()).catch(() => {});
    });
    page.on('request', (r) => {
      this.requests.total++;
      // The callsign the guild was asked for. Only the username is read from the body.
      if (r.method() === 'POST' && /\/auth\/signup\b/.test(r.url())) { try { this.signupBody = { callsign: JSON.parse(r.postData() || '{}').username ?? null }; } catch { /* not JSON */ } }
    });
    page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? 'failed'; if (f !== 'net::ERR_BLOCKED_BY_CLIENT' && f !== 'net::ERR_ABORTED') this.requests.failed.push({ url: r.url(), status: f, step: this.step }); });
    page.on('response', (r) => { if (r.status() >= 400) this.requests.failed.push({ url: r.url(), status: r.status(), step: this.step }); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame() && FORBIDDEN.test(new URL(f.url()).pathname)) this.find('safety', 'info', `navigated to a guarded screen (${new URL(f.url()).pathname}); leaving it`); });
  }

  find(kind: string, severity: Finding['severity'], message: string, detail?: unknown) {
    if (this.findings.some((f) => f.kind === kind && f.message === message)) return;
    this.findings.push({ kind, severity, step: this.step, message, detail });
  }

  url(path = '/') { return new URL(path.replace(/^\//, ''), this.target.href.endsWith('/') ? this.target.href : this.target.href + '/').href; }
  async go(path: string) {
    const r = await this.page.goto(this.url(path), { waitUntil: 'domcontentloaded' });
    if (r?.status() === 429 || /rate limit/i.test(await this.page.title().catch(() => ''))) throw new RateLimited(`${new URL(this.page.url()).host} rate-limited the harness (HTTP 429)`);
    // On slow networks the app shell paints before its scripts arrive: wait for them, as a player would.
    await this.page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
    await this.settle();
  }
  /** Requests the host refused with 429 since the run began. */
  get throttled() { return this.requests.failed.filter((r) => r.status === 429).length; }
  /** Let the page breathe: real time for network and paint, a little game time for timers. */
  async settle(ms = 400) { await this.page.waitForLoadState('domcontentloaded').catch(() => {}); await this.page.clock.runFor(ms).catch(() => {}); await this.page.waitForTimeout(150); }
  /** Play `n` demo blocks (timers fire, animations run). */
  async play(n: number) { for (let i = 0; i < n; i += 5) { await this.page.clock.runFor(BLOCK_MS * Math.min(5, n - i)); await this.page.waitForTimeout(20); } this.blocks += n; }
  /** Jump the wall clock without firing timers in between: the player was away. */
  async away(ms: number) { await this.page.clock.fastForward(ms); }
  async key(k: string) { await this.page.keyboard.press(k); await this.settle(200); }
  async pause() { await this.page.waitForTimeout(Math.max(30, 60000 / this.p.apm / 20)); }

  /** Click the first visible element matching role/name, CSS or text; false when there is none. */
  async click(sel: string | { role: 'button' | 'link'; name: RegExp | string }, opts: { force?: boolean } = {}) {
    await this.tours();
    const loc = typeof sel === 'string' ? this.page.locator(sel) : this.page.getByRole(sel.role, { name: sel.name });
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false)) || (await el.isDisabled().catch(() => false))) continue;
      const href = await el.getAttribute('href').catch(() => null);
      if (href && (FORBIDDEN.test(href) || /^https?:/.test(href) && !href.startsWith(this.target.origin))) continue;
      try {
        if (this.p.input === 'touch') await el.tap({ timeout: 2500, force: opts.force });
        else await el.click({ timeout: 2500, force: opts.force });
      } catch (e) {
        // Something sits on top of the control. A player would see that too: record what, then press through.
        const line = (e as Error).message.split('\n').find((l) => l.includes('intercepts pointer events')) ?? '';
        const m = /<(\w[^>]{0,110})>/.exec(line);
        const what = await el.innerText().catch(() => '') || (typeof sel === 'string' ? sel : String(sel.name));
        this.find('ui.obstructed', 'minor', `"${what.trim().slice(0, 40)}" was covered${m ? ` by <${m[1].slice(0, 80)}>` : ''} when ${this.p.id} tried to press it`);
        await el.click({ timeout: 2500, force: true }).catch(() => el.dispatchEvent('click'));
      }
      await this.settle(250);
      return true;
    }
    return false;
  }
  /** Screens open a first-visit tour over the controls. Personas who read tours read it; the rest skip. */
  async tours() {
    const reads = this.p.journey.includes('tour');
    for (let n = 0; n < 12 && (await this.page.locator('.tour-card').isVisible().catch(() => false)); n++) {
      await this.page.locator(`.tour-card [data-t="${reads ? 'next' : 'skip'}"]`).click({ timeout: 2000 }).catch(() => this.page.keyboard.press('Escape'));
      await this.page.waitForTimeout(reads ? 300 : 50);
    }
  }
  async has(sel: string) { return (await this.page.locator(sel).count()) > 0 && this.page.locator(sel).first().isVisible().catch(() => false); }

  /** The demo base as saved in this profile's localStorage. */
  async demoState(): Promise<Record<string, unknown> | null> {
    return this.page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k + '.state') || 'null'); } catch { return { __corrupt: true }; } }, DEMO_KEY).catch(() => null);
  }

  async screenshot(label: string) {
    const file = `${String(++this.shot).padStart(2, '0')}-${label.replace(/[^a-z0-9-]+/gi, '_')}.png`;
    await this.page.screenshot({ path: resolve(this.dir, file), timeout: 8000 }).catch(() => {});
    return file;
  }

  /** Layout, text and state checks run after every step. */
  async probe() {
    const r = await this.page.evaluate(() => {
      const de = document.documentElement;
      const vis = (el: Element) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const unnamed = [...document.querySelectorAll('button, a[href], [role="button"], input, select, textarea')].filter(vis).filter((el) => {
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
        return !name;
      }).map((el) => el.outerHTML.slice(0, 120));
      // Small tap targets (WCAG 2.5.8: 24×24 CSS px minimum).
      const tiny = [...document.querySelectorAll('button, a[href], [role="button"]')].filter(vis).filter((el) => { const b = el.getBoundingClientRect(); return b.width < 24 || b.height < 24; }).map((el) => `${((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.className).toString().slice(0, 40)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
      // Text cut off by its own box.
      const clipped = [...document.querySelectorAll('button, .btn, .sb, h1, h2, h3, .label, .chip, span, b')].filter(vis).filter((el) => {
        const cs = getComputedStyle(el); const t = (el as HTMLElement).innerText?.trim();
        return t && t.length > 1 && el.children.length === 0 && (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden') && (el.scrollWidth > el.clientWidth + 2);
      }).map((el) => (el as HTMLElement).innerText.trim().slice(0, 40));
      // English left in a Korean client: three or more lowercase English words in a row.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const english = new Set<string>();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent || ''; const p = n.parentElement;
        if (!p || !vis(p) || /^(SCRIPT|STYLE|CODE|KBD|PRE)$/.test(p.tagName) || p.closest('.mono, code, kbd')) continue;
        const m = t.match(/\b[a-z]{3,}(?:[\s,'-]+[a-z]{2,}){2,}\b/g);
        if (m) for (const x of m) english.add(x.slice(0, 60));
      }
      const P = (window as unknown as { __pt: { errors: string[]; lcp: number; cls: number; long: number; longMs: number } }).__pt;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        overflowX: de.scrollWidth > innerWidth + 1 ? de.scrollWidth - innerWidth : 0,
        unnamed, tiny, clipped: [...new Set(clipped)], english: [...english],
        perf: { lcp: Math.round(P?.lcp ?? 0), cls: Math.round((P?.cls ?? 0) * 1000) / 1000, longTasks: P?.long ?? 0, longTaskMs: Math.round(P?.longMs ?? 0), heapMB: mem ? Math.round(mem.usedJSHeapSize / 1e5) / 10 : undefined, domNodes: document.getElementsByTagName('*').length, ttfb: nav ? Math.round(nav.responseStart) : undefined, load: nav ? Math.round(nav.loadEventEnd) : undefined },
        errors: P?.errors.splice(0) ?? [],
      };
    }).catch(() => null);
    if (!r) return null;
    if (r.overflowX) this.find('layout.overflow', this.p.device === 'mobile' ? 'major' : 'minor', `page scrolls sideways by ${r.overflowX}px at ${this.page.viewportSize()?.width}px wide`, { url: this.page.url() });
    if (r.unnamed.length) this.find('a11y.unnamed', 'major', `${r.unnamed.length} control(s) with no accessible name`, r.unnamed.slice(0, 8));
    if (r.tiny.length && this.p.input === 'touch') this.find('a11y.target-size', 'minor', `${r.tiny.length} tap target(s) under 24×24 px`, r.tiny.slice(0, 10));
    if (r.clipped.length) this.find('layout.clipped', this.p.zoom > 1 ? 'major' : 'minor', `${r.clipped.length} label(s) cut off by their box`, r.clipped.slice(0, 10));
    if (r.english.length) this.find('i18n.english', 'minor', `English text in the Korean UI: ${r.english.slice(0, 3).join(' · ')}`, r.english.slice(0, 15));
    for (const e of r.errors) this.find('js.error', 'blocker', e);
    return r;
  }

  /** The commander this browser profile holds, from the vault's public part (address, player id). */
  async vaultCommander(): Promise<{ address: string; playerId: string | null } | null> {
    return this.page.evaluate(() => {
      try { const v = JSON.parse(localStorage.getItem('structs.vault.v1') || 'null'); const a = v?.accounts?.find((x: { index: number }) => x.index === 0); return a ? { address: a.address, playerId: a.playerId ?? null } : null; } catch { return null; }
    }).catch(() => null);
  }
  /** Is the page signed in (the HUD offers no 로그인 control)? */
  async signedIn() { return (await this.page.getByRole('link', { name: /^로그인$/ }).count().catch(() => 1)) === 0 && (await this.page.getByRole('button', { name: /^로그인$/ }).count().catch(() => 1)) === 0; }
  /** Enlist through the app's own /start flow against the mock Guild API, or sign back in with the
   * commander this profile already holds. One account per profile directory, so reruns reuse it. */
  async enlist(budget: { left: number }): Promise<Account> {
    if (!canEnlist(this.allow, this.p)) throw new Error('enlisting needs an account profile and --mock (dev server) or --signup (testnet)');
    await this.go('/');
    const had = await this.vaultCommander();
    let created = false;
    if (had?.playerId) {
      if (!(await this.signedIn())) { await this.go('/login'); await this.click('[data-act="resume"]'); await this.waitFor(async () => this.signedIn(), 30_000); }
    } else {
      if (budget.left <= 0) throw new Error('account cap reached for this run (one per profile)');
      budget.left--;
      created = true;
      await this.go('/start');
      const ok = await this.waitFor(async () => {
        if (await this.page.getByText('입대가 멈췄습니다').count()) throw new Error(`enlist stopped: ${(await this.page.locator('.notice.err').first().innerText().catch(() => '')).slice(0, 160)}`);
        const c = await this.vaultCommander();
        return !!c?.playerId && !new URL(this.page.url()).pathname.endsWith('/start');
      }, this.allow.mock ? 60_000 : 240_000); // a real guild waits for the chain to record the join
      if (!ok) throw new Error('enlist did not finish in time');
    }
    const c = await this.vaultCommander();
    const callsign = await this.page.evaluate((a) => { try { return (JSON.parse(localStorage.getItem('structs-kor.mock.accounts') || '{}') as Record<string, { name: string }>)[a ?? '']?.name ?? null; } catch { return null; } }, c?.address ?? null);
    this.account = { persona: this.p.id, playerId: c?.playerId ?? null, address: c?.address ?? null, callsign: callsign ?? this.signupBody?.callsign ?? null, created, at: new Date().toISOString() };
    return this.account;
  }
  /** Poll `cond` while game and wall time pass (enlist polls the guild every 3 s). */
  async waitFor(cond: () => Promise<boolean>, ms: number) {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (await cond()) return true; await this.page.clock.runFor(1000).catch(() => {}); await this.page.waitForTimeout(250); }
    return cond();
  }
  /** Attempts the guard rails stopped on this page. */
  async blocked(): Promise<string[]> { return this.page.evaluate(() => (window as unknown as { __ptBlocked?: string[] }).__ptBlocked ?? []).catch(() => []); }
  mark(id: string, status: 'touched' | 'passed' | 'failed' | 'blocked' | 'guarded', note: string) {
    const rank = { touched: 0, guarded: 1, blocked: 2, passed: 3, failed: 4 } as const;
    const cur = this.coverage.get(id);
    if (!cur || rank[status] >= rank[cur.status]) this.coverage.set(id, { status, note, by: this.p.id });
  }

  async close() { await this.ctx.close().catch(() => {}); }
}
