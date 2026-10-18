/* Journey steps: the moves a persona makes in the real client, named in profiles.ts `journey`.
 * Each returns a short note; throwing or returning `skip:` marks the step. Steps play the game the
 * way a person would — buttons and hotkeys, never the demo API — and check what they see. */
import { createRequire } from 'node:module';
import { BLOCK_MS, DEMO_KEY, FORBIDDEN, canEnlist, type Harness } from './harness';
import { feature, type Feature } from '../features';

/** Accounts this run may still enlist (the runner sets it to the profile count: one each). */
export const accountBudget = { left: 0 };

const require = createRequire(import.meta.url);
type Step = (h: Harness) => Promise<string>;
const NAV = [['c', '/console'], ['p', '/galaxy'], ['g', '/energy'], ['t', '/market'], ['u', '/research'], ['b', '/sim'], ['o', '/campaign'], ['y', '/guild'], ['n', '/replicants'], ['k', '/chat'], ['h', '/tutorial'], ['x', '/codex']] as const;

const path = (h: Harness) => new URL(h.page.url()).pathname.replace(/\/$/, '') || '/';
async function toBridge(h: Harness) { if (!path(h).endsWith('/console')) await h.go('/console'); await skipTour(h); }
async function skipTour(h: Harness) { let n = 0; while (n < 12 && (await h.has('.tour-card'))) { await h.click('.tour-card [data-t="skip"]') || (await h.key('Escape')); n++; } return n; }
/** Play until `cond` holds, up to `max` blocks; returns blocks played or -1. */
async function until(h: Harness, max: number, cond: () => Promise<boolean>) { for (let b = 0; b < max; b += 2) { if (await cond()) return b; await h.play(2); } return (await cond()) ? max : -1; }
const num = (x: unknown) => (typeof x === 'number' ? x : NaN);

/** Visit a feature's screen, check it is there, press its control once if that is safe. */
export async function exercise(h: Harness, f: Feature): Promise<string> {
  if (f.mode === 'account' && !h.account) { h.mark(f.id, 'blocked', 'needs a signed-in account (run with --mock against the dev server)'); return `${f.id}: blocked (no account)`; }
  if (f.mode === 'demo' && h.account) { h.mark(f.id, 'blocked', 'demo-only system; this profile plays a signed-in account'); return `${f.id}: blocked (demo only)`; }
  await h.go(f.path); // fresh each time: a feature before may have moved the screen on
  await skipTour(h);
  if (f.open && !(await h.has(f.open.replace(/\]$/, '][aria-pressed="true"]')))) await h.click(f.open, { force: true });
  const re = /^\/(.*)\/$/.exec(f.expect);
  // Screens load lazily (and slowly on 4G): give it up to 10 s.
  const present = await h.waitFor(async () => (re ? (await h.page.getByText(new RegExp(re[1])).count()) > 0 : await h.has(f.expect)), 10_000);
  if (!present) { h.mark(f.id, 'failed', `not found on ${f.path}: ${f.expect}`); h.find('feature.missing', 'major', `${f.name}: expected ${f.expect} on ${f.path}`); return `${f.id}: missing`; }
  if (f.guarded) { h.mark(f.id, 'guarded', 'present; completing it is blocked by the harness'); return `${f.id}: present (guarded)`; }
  if (f.chain && !h.allow.chain) { h.mark(f.id, 'guarded', 'present; chain transactions need --chain-actions'); return `${f.id}: present (chain, not sent)`; }
  if (f.act) {
    const errs = h.findings.length;
    const pressed = await h.click(f.act, { force: true });
    await h.play(2);
    const broke = h.findings.slice(errs).some((x) => x.kind === 'pageerror' || x.kind === 'js.error');
    h.mark(f.id, broke ? 'failed' : 'passed', broke ? 'pressing it threw an error' : pressed ? `pressed ${f.act}` : 'present (control disabled right now)');
    return `${f.id}: ${broke ? 'error' : pressed ? 'exercised' : 'present'}`;
  }
  h.mark(f.id, 'passed', 'present');
  return `${f.id}: present`;
}

export const STEPS: Record<string, Step> = {
  async enlist(h) {
    if (!canEnlist(h.allow, h.p)) return 'skip: no account for this profile in this run (needs --mock or --signup); playing guest';
    const a = await h.enlist(accountBudget);
    h.mark('enlist', a.playerId ? 'passed' : 'failed', a.created ? `enlisted ${a.playerId}` : `reused ${a.playerId}`);
    return `${a.created ? 'enlisted' : 'signed back in as'} ${a.callsign ?? '?'} (${a.playerId})`;
  },
  async 'account-tour'(h) {
    if (!h.account) return 'skip: no account';
    const seen: string[] = [];
    for (const p of ['/console', '/profile', '/guild']) {
      await h.go(p); await skipTour(h);
      if (p === '/profile' && h.account.playerId && !(await h.page.getByText(h.account.playerId).count())) h.find('account.profile', 'minor', `내 정보 does not show the player id ${h.account.playerId}`);
      seen.push(`${p} ${(await h.signedIn()) ? 'signed in' : 'SIGNED OUT'}`);
    }
    if (seen.some((x) => x.includes('SIGNED OUT'))) h.find('account.session', 'major', 'the session dropped while touring the account screens');
    return seen.join('; ');
  },
  async 'feature-slice'(h) {
    const out: string[] = [];
    for (const id of h.p.slice) { const f = feature(id); if (!f) { out.push(`${id}: unknown feature`); continue; } h.step = `feature:${id}`; out.push(await exercise(h, f)); await h.probe(); }
    h.step = 'feature-slice';
    const blocked = await h.blocked();
    if (blocked.length) h.find('guard', 'info', `guard rails stopped: ${[...new Set(blocked)].join(', ')}`);
    return out.join(' · ');
  },

  async title(h) {
    const t0 = Date.now();
    await h.go('/');
    const title = await h.page.title();
    // Time to playable: until 바로 플레이 can be pressed (the app renders it after its JS loads).
    const play = h.page.locator('.title-menu a', { hasText: '바로 플레이' }).first();
    const ready = await play.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
    const ms = Date.now() - t0;
    if (!ready) h.find('onboarding', 'blocker', `title screen showed no 바로 플레이 within 30 s on ${h.p.network}`);
    else {
      if (ms > (h.p.network === '3g' ? 10_000 : 4_000)) h.find('perf.playable', 'major', `바로 플레이 took ${ms} ms to appear on ${h.p.network}`);
      const to = new URL((await play.getAttribute('href')) ?? '/', h.page.url()).pathname;
      if (!/\/(start|console)$/.test(to)) h.find('onboarding', 'blocker', `바로 플레이 leads to ${to}, not the enlist flow`);
    }
    if (await h.page.locator('.title-menu', { hasText: '데모' }).count()) h.find('onboarding', 'major', 'the title menu still offers the retired demo');
    return `"${title}"; playable in ${ms} ms on ${h.p.network}`;
  },

  /** Old journeys said 'demo': the demo is retired, so this is enlisting. */
  async demo(h) { return STEPS.enlist(h); },

  async 'keyboard-play'(h) {
    await h.go('/');
    for (let i = 0; i < 25; i++) {
      await h.page.keyboard.press('Tab');
      const name = await h.page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '');
      if (/바로 플레이/.test(name)) return `reached 바로 플레이 in ${i + 1} Tab presses`;
    }
    h.find('a11y.keyboard', 'blocker', '바로 플레이 cannot be reached with Tab from the title screen');
    throw new Error('바로 플레이 not reachable by keyboard');
  },

  /** A browser that still holds a demo save from before the retirement. */
  async 'retired-demo'(h) {
    await h.go('/');
    await h.page.evaluate(() => {
      localStorage.setItem('structs-kor.demo', '1');
      localStorage.setItem('structs-kor.demo.state', JSON.stringify({ height: 1482300, alpha: 30, ore: 1, infusedKw: 0, vein: 100, shield: 50, structs: [], raid: null, nextRaid: 10, contracts: [], log: [], seq: 5, raidsRepelled: 2, raidsLost: 0, earned: 0, chronicle: [], priceHist: [0.04] }));
      localStorage.setItem('structs-kor.career.demo', JSON.stringify({ xp: 400, claimed: [], stats: { simWins: 3, simStars: 2, simBattles: 5, dailyPlays: 1, shotsHit: 20, kills: 12, contracts: 0, research: 0, gauntlets: 0, perfect: 1 } }));
    });
    await h.go('/');
    const left = await h.page.evaluate(() => ['structs-kor.demo', 'structs-kor.demo.state'].filter((k) => localStorage.getItem(k) != null));
    if (left.length) h.find('retire.save', 'blocker', `the old demo save was not cleared: ${left.join(', ')} still stored`);
    const note = h.page.locator('.retired-note');
    if (!(await note.count())) h.find('retire.note', 'major', 'no "the demo has ended" note on the title screen for a returning demo player');
    else if (!/상병/.test(await note.innerText())) h.find('retire.note', 'minor', 'the note does not name the rank that will carry over (상병)');
    await h.screenshot('retired-note');
    await h.go('/research');
    if (!(await h.page.getByText('좌표 없음').count())) h.find('retire.research', 'major', '/research still opens a retired screen');
    for (const p of ['/console', '/market', '/galaxy', '/guild']) {
      await h.go(p);
      if (await h.page.getByText(/데모 함교|데모 종료/).count()) h.find('retire.screen', 'major', `${p} still shows demo controls to a signed-out visitor`);
    }
    return `old save ${left.length ? 'kept' : 'cleared'}; note ${(await note.count()) ? 'shown' : 'missing'}`;
  },
  /** After enlisting: the rank from the demo came along, once. */
  async 'carried-rank'(h) {
    if (!h.account?.playerId) return 'skip: no account';
    await h.go('/record');
    const xp = await h.page.evaluate((id) => { try { return JSON.parse(localStorage.getItem(`structs-kor.career.${id}`) || 'null')?.xp ?? 0; } catch { return 0; } }, h.account.playerId);
    const gone = await h.page.evaluate(() => localStorage.getItem('structs-kor.career.demo') == null);
    if (xp < 400) h.find('retire.rank', 'major', `the demo rank did not carry over: the new commander has ${xp} XP, the demo career had 400`);
    if (!gone) h.find('retire.rank', 'minor', 'the demo career is still stored after carrying over');
    return `commander ${h.account.playerId} at ${xp} XP; demo career ${gone ? 'removed' : 'still stored'}`;
  },

  async tour(h) {
    let n = 0;
    while (n < 15 && (await h.has('.tour-card'))) { await h.screenshot(`tour-${n}`); await h.click('.tour-card [data-t="next"]'); n++; await h.pause(); }
    return n ? `read ${n} tour cards` : 'skip: no tour shown (already seen in this profile)';
  },
  async 'skip-tour'(h) { const n = await skipTour(h); return n ? `skipped tour in ${n} press(es)` : 'skip: no tour'; },

  async 'bridge-idle'(h) {
    await toBridge(h);
    const before = await h.demoState();
    await h.play(60);
    const after = await h.demoState();
    const dh = num(after?.height) - num(before?.height);
    if (!(dh > 0)) h.find('clock', 'blocker', `60 blocks of game time passed but the base did not advance (height ${before?.height} → ${after?.height})`);
    return `+${dh} blocks; α ${num(before?.alpha).toFixed(1)} → ${num(after?.alpha).toFixed(1)}`;
  },

  async 'tap-glowing'(h) {
    await toBridge(h);
    let n = 0;
    for (const sel of ['.sb.gold', '.btn.gold', '.btn.primary', '[class*="pulse"]', '[class*="glow"]']) {
      if (n >= 5) break;
      if (await h.click(sel)) { n++; await h.pause(); if (!path(h).endsWith('/console')) await toBridge(h); }
    }
    return `tapped ${n} highlighted controls`;
  },

  async 'away-1h'(h) { return awayFor(h, 3600_000); },
  async 'away-8h'(h) { return awayFor(h, 8 * 3600_000); },
  async 'return-report'(h) {
    const has = await h.page.getByText(/귀환 보고|자리를 비운/).count();
    if (!has) return 'skip: no away report on screen';
    await h.screenshot('away-report');
    await h.click({ role: 'button', name: /확인|닫기|계속/ });
    return 'read and dismissed the away report';
  },

  async tutorial(h) {
    await h.go('/tutorial');
    let n = 0;
    for (; n < 40; n++) {
      if (await h.click('[data-act="next"]')) continue;
      if (await h.click('[data-act="hit"]')) continue;
      if (await h.click('[data-id="btnWeapon"], [data-id="btnDeploy"], [data-id="btnDefend"], [data-id="deployCard"]')) continue;
      await h.play(1);
      if (!(await h.has('[data-act="next"], [data-act="hit"]'))) break;
    }
    return `advanced the tutorial ${n} times`;
  },

  async 'bridge-build'(h) {
    await toBridge(h);
    await h.key('e');
    await h.screenshot('build-card');
    const opts = await h.page.locator('.ab-bar.player button').count();
    await h.key('1');
    await h.play(3);
    return `build card offered ${opts} buttons; picked option 1`;
  },

  async energy(h) {
    await h.key('g');
    if (!path(h).endsWith('/energy')) await h.go('/energy');
    const ok = await h.click('[data-act="infuse"]');
    return ok ? 'infused alpha into the grid' : 'skip: infuse unavailable';
  },

  async overclock(h) {
    await toBridge(h);
    const cells = h.page.locator('.bd-cell[data-key] .bd-mount:not(:empty)');
    const n = await cells.count();
    for (let i = 0; i < n; i++) {
      await cells.nth(i).click({ force: true }).catch(() => {});
      await h.settle(150);
      if (await h.has('[data-act="overclock"]')) { await h.key('v'); await h.play(2); return `overclocked struct #${i}`; }
    }
    return 'skip: no struct offered overclock';
  },

  async research(h) {
    await h.key('u');
    if (!path(h).endsWith('/research')) await h.go('/research');
    return (await h.click('[data-act="buy"]')) ? 'bought a research step' : 'skip: nothing affordable';
  },
  async 'research-shield'(h) { await h.go('/research'); return (await h.click('[data-act="buy"][data-id="shield"]')) || (await h.click('[data-act="buy"]')) ? 'researched defence' : 'skip: nothing affordable'; },
  async 'doctrine-industry'(h) { return doctrine(h, 'industry'); },
  async 'doctrine-war'(h) { return doctrine(h, 'war'); },
  async 'doctrine-trade'(h) { return doctrine(h, 'trade'); },

  async 'market-sell'(h) { await h.go('/market'); await h.click('[data-act="side"][data-v="sell"]'); return (await h.click('[data-act="sell"]')) ? 'placed a power sale' : 'skip: sale refused (no spare power)'; },
  async 'market-buy'(h) { await h.go('/market'); await h.click('[data-act="side"][data-v="buy"]'); return (await h.click('[data-act="buy"]')) ? 'bought power' : 'skip: purchase refused'; },
  async jobs(h) { await h.go('/market'); return (await h.click('[data-act="job"]')) ? 'took a contract' : 'skip: no contract offered or affordable'; },
  async loan(h) { await h.go('/market'); if (await h.click('[data-act="repay"]')) return 'repaid the loan'; return (await h.click('[data-act="borrow"]')) ? 'took a loan' : 'skip: no loan offered'; },
  async 'black-market'(h) { await h.go('/market'); return (await h.click('[data-act="black"]')) ? 'bought from the smuggler' : 'skip: no smuggler docked'; },

  async galaxy(h) {
    await h.key('p');
    if (!path(h).endsWith('/galaxy')) await h.go('/galaxy');
    await skipTour(h);
    const nodes = await h.page.locator('.gx-node').count();
    if (!nodes) h.find('galaxy', 'major', 'galaxy map shows no planets');
    return `${nodes} planets on the map`;
  },
  async scout(h) {
    if (!path(h).endsWith('/galaxy')) await h.go('/galaxy');
    if (!(await pickRival(h))) return 'skip: no rival on the map';
    return (await h.click('[data-act="scout"]')) ? 'scouted a rival' : 'skip: scouting unavailable';
  },
  async raid(h) {
    if (!path(h).endsWith('/galaxy')) await h.go('/galaxy');
    if (!(await pickRival(h))) return 'skip: no rival on the map';
    if (!(await h.click('a[href*="raid="]')) && !(await clickText(h, /습격|출격/))) return 'skip: no strike button';
    await h.page.waitForURL(/\/sim/, { timeout: 5000 }).catch(() => {});
    return battle(h, 'raid');
  },
  async 'sim-battle'(h) { await h.go('/sim'); return battle(h, 'sim'); },
  async campaign(h) { await h.key('o'); if (!path(h).endsWith('/campaign')) await h.go('/campaign'); const ok = await h.click('a[href*="mission="]'); return ok ? battle(h, 'mission') : 'skip: no mission link'; },

  async 'stance-intercept'(h) { return stance(h, 'a', 'intercept'); },
  async 'stance-entrench'(h) { return stance(h, 's', 'entrench'); },
  async engine(h) { await toBridge(h); return (await h.click('[data-act="engine"]')) ? 'paid into the World Engine' : 'skip: World Engine not affordable yet'; },
  async overshield(h) { await toBridge(h); await h.key('8'); return 'pressed 8 (overshield)'; },

  async 'guild-join'(h) { await h.key('y'); if (!path(h).endsWith('/guild')) await h.go('/guild'); return (await h.click('[data-act="join"]')) ? 'joined a guild' : 'skip: already in a guild'; },
  async donate(h) { await h.go('/guild'); return (await clickText(h, /기부/)) ? 'donated' : 'skip: no donate control'; },
  async chat(h) {
    await h.key('k');
    if (!path(h).endsWith('/chat')) await h.go('/chat');
    const box = h.page.locator('[data-act="type"], textarea').first();
    if (!(await box.count())) return 'skip: no message box';
    await box.fill('안녕하세요, 함께 싸웁시다!');
    await h.click('[data-act="send"]') || (await h.key('Enter'));
    await h.play(5);
    return 'sent a guild message';
  },
  async decision(h) {
    await toBridge(h);
    const b = await until(h, 120, async () => (await h.page.getByText(/결단/).count()) > 0);
    if (b < 0) return 'skip: no decision within 120 blocks';
    await h.screenshot('decision');
    await h.key('1');
    return `answered a decision after ${b} blocks`;
  },
  async alliance(h) { await h.go('/galaxy'); await pickRival(h); return (await h.click('[data-act="ally"]')) ? 'offered an alliance' : 'skip: alliance unavailable (cost or temper)'; },
  async invest(h) { await h.go('/galaxy'); await pickRival(h); return (await h.click('[data-act="invest"]')) ? 'invested' : 'skip: invest unavailable'; },
  async outposts(h) {
    await h.go('/galaxy');
    if (!(await h.click('.gx-node.site', { force: true }))) return 'skip: no outposts on the map';
    if (await h.click('[data-act="fortify"]')) return 'fortified an outpost';
    return (await h.click('[data-act="claim"]')) ? 'sortied against an outpost' : 'skip: outpost actions unaffordable';
  },
  async refit(h) {
    await toBridge(h);
    const fleet = h.page.locator('.bd-cell[data-key][data-side="defender"] .bd-mount:not(:empty)');
    for (let i = 0, n = await fleet.count(); i < n; i++) {
      await fleet.nth(i).click({ force: true }).catch(() => {}); await h.settle(150);
      if (await clickText(h, /장갑|포 개량|회피|개장/)) return `refitted fleet struct #${i}`;
    }
    return 'skip: no refit offered';
  },
  async record(h) { await h.go('/record'); return `service record: ${(await h.page.locator('h1, h2').count())} headings`; },
  async daily(h) { await h.go('/record'); return (await h.page.getByText(/일일/).count()) ? 'daily orders listed' : 'skip: no daily orders'; },
  async codex(h) { await h.key('x'); if (!path(h).endsWith('/codex')) await h.go('/codex'); return `codex: ${await h.page.locator('section, article').count()} sections`; },

  async 'every-screen'(h) {
    const out: string[] = [];
    for (const [k, p] of NAV) {
      await toBridge(h);
      await h.key(k);
      const at = path(h);
      if (!at.endsWith(p)) h.find('hotkey', 'major', `hotkey ${k.toUpperCase()} should open ${p} but the page is ${at}`);
      await skipTour(h);
      await h.probe();
      await h.screenshot(`screen-${p.slice(1)}`);
      out.push(`${k}→${at}`);
    }
    return out.join(' ');
  },
  async hotkeys(h) {
    let ok = 0;
    for (const [k, p] of NAV) { await toBridge(h); await h.page.keyboard.press(k); await h.settle(150); if (path(h).endsWith(p)) ok++; else h.find('hotkey', 'major', `hotkey ${k.toUpperCase()} did not open ${p} (at ${path(h)})`); }
    return `${ok}/${NAV.length} navigation hotkeys work`;
  },
  async 'keys-help'(h) {
    await toBridge(h);
    await h.page.keyboard.press('Shift+Slash');
    await h.settle(150);
    const open = await h.has('#keys-help');
    if (!open) h.find('hotkey', 'major', '? did not open the shortcut list');
    const focusIn = await h.page.evaluate(() => !!document.activeElement?.closest('#keys-help'));
    if (open && !focusIn) h.find('a11y.focus', 'major', 'shortcut dialog opened without moving focus into it');
    const focused = await h.page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100));
    await h.key('Escape');
    if (await h.has('#keys-help')) h.find('a11y.focus', 'major', 'Esc did not close the shortcut dialog', { focused, dialogs: await h.page.locator('#keys-help').count() });
    return `help ${open ? 'opened' : 'missing'}, focus ${focusIn ? 'moved in' : 'stayed out'}`;
  },
  async 'keyboard-bridge'(h) {
    await toBridge(h);
    const stops: string[] = []; let invisible = 0, noRing = 0;
    for (let i = 0; i < 40; i++) {
      await h.page.keyboard.press('Tab');
      const f = await h.page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none';
        return { name: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 30), visible: b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight, ring };
      });
      if (!f) continue;
      stops.push(f.name); if (!f.visible) invisible++; if (!f.ring) noRing++;
    }
    const uniq = new Set(stops).size;
    if (invisible) h.find('a11y.focus', 'major', `${invisible} of 40 Tab stops on the bridge are off-screen or invisible`);
    if (noRing > stops.length / 2) h.find('a11y.focus', 'major', `${noRing} of ${stops.length} Tab stops show no focus ring`);
    if (uniq < 5) h.find('a11y.keyboard', 'blocker', `only ${uniq} distinct controls reachable by Tab on the bridge`);
    // Play the loop by keyboard alone: refine all, build next, infuse.
    const before = await h.demoState();
    for (const k of ['q', 'e', '1', 'i']) await h.key(k);
    await h.play(10);
    const after = await h.demoState();
    return `${uniq} distinct Tab stops; keyboard loop height ${before?.height}→${after?.height}`;
  },
  async 'keyboard-menu'(h) {
    await toBridge(h);
    await h.key('F10');
    const menu = await h.page.locator('[role="dialog"], [role="menu"], .menu').count();
    await h.key('Escape');
    if (!menu) h.find('hotkey', 'minor', 'F10 opened no menu');
    return menu ? 'F10 menu opened and closed' : 'skip: no F10 menu';
  },
  async 'a11y-audit'(h) {
    const out: string[] = [];
    for (const p of ['/', '/console', '/market', '/galaxy', '/research']) {
      await h.go(p); await skipTour(h);
      await h.page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const r = await h.page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[]; html: string }[] }[] }> } }).axe;
        const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
        return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, nodes: v.nodes.slice(0, 4).map((x) => ({ target: x.target.join(' '), html: x.html.slice(0, 160) })) }));
      });
      for (const v of r) h.find(`axe.${v.id}`, v.impact === 'critical' ? 'blocker' : v.impact === 'serious' ? 'major' : 'minor', `${v.help} (${v.n} on ${p})`, v.nodes);
      out.push(`${p}: ${r.length}`);
    }
    return `axe WCAG 2.2 AA violations by screen — ${out.join(', ')}`;
  },
  async 'zoom-audit'(h) {
    const out: string[] = [];
    for (const p of ['/console', '/market', '/research', '/galaxy']) { await h.go(p); await skipTour(h); const r = await h.probe(); out.push(`${p}: overflow ${r?.overflowX ?? 0}px, ${r?.clipped.length ?? 0} clipped`); await h.screenshot(`zoom-${p.slice(1)}`); }
    return out.join('; ');
  },

  async monkey(h) {
    const start = h.page.url();
    let clicks = 0;
    for (let i = 0; i < 60; i++) {
      const els = h.page.locator('button:visible, a[href]:visible, [role="button"]:visible, .bd-cell[data-key]');
      const n = await els.count();
      if (!n) { await h.go('/console'); continue; }
      const el = els.nth(Math.floor(Math.random() * n));
      const href = await el.getAttribute('href').catch(() => null);
      const text = (await el.innerText().catch(() => '')).trim();
      if ((href && (FORBIDDEN.test(href) || /^https?:/.test(href) && !href.startsWith(h.target.origin))) || /입대|로그인|지갑|서명|데모 종료/.test(text)) continue; // ending the demo would leave the rest of the run with no base
      await el.click({ timeout: 1500, force: true, clickCount: Math.random() < 0.2 ? 2 : 1 }).catch(() => {});
      clicks++;
      if (Math.random() < 0.3) await h.page.keyboard.press(['Escape', 'e', '1', '2', 'v', 'r', 'z', 'q', 'a', 's'][Math.floor(Math.random() * 10)]);
      if (Math.random() < 0.3) await h.play(2); else await h.settle(60);
      if (new URL(h.page.url()).origin !== h.target.origin || FORBIDDEN.test(new URL(h.page.url()).pathname)) await h.go('/console');
    }
    const s = await h.demoState();
    checkState(h, s);
    void start;
    return `${clicks} random clicks; base α ${num(s?.alpha).toFixed?.(1)}`;
  },
  async 'bad-input'(h) {
    // The XSS probe's alert carries a marker the harness's dialog handler recognises (harness.ts).
    const junk = ['-1', 'NaN', '1e309', '', '<img src=x onerror=alert("pt-xss")>', '99999999999', '0.0000001', '١٢'];
    let tried = 0;
    for (const p of ['/market#sell', '/market#buy', '/energy', '/galaxy', '/chat']) {
      const [where, side] = p.split('#');
      await h.go(where); await skipTour(h);
      if (side) await h.click(`[data-act="side"][data-v="${side}"]`); // the exchange shows its amount fields per side
      const inputs = h.page.locator('input:visible:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea:visible');
      const n = await inputs.count();
      for (let i = 0; i < n; i++) for (const v of junk) {
        await inputs.nth(i).fill(v).catch(() => {});
        await inputs.nth(i).press('Enter').catch(() => {});
        tried++;
        // Press the nearest action button too.
        await inputs.nth(i).locator('xpath=ancestor::*[self::form or contains(@class,"card")][1]//button[not(@disabled)]').first().click({ timeout: 800 }).catch(() => {});
        await h.settle(60);
      }
    }
    await h.play(3);
    checkState(h, await h.demoState());
    return `${tried} junk entries typed`;
  },
  async 'corrupt-storage'(h) {
    const cases: [string, string][] = [['truncated JSON', '{"height":148'], ['alpha as text', JSON.stringify({ ...(await h.demoState()), alpha: 'lots' })], ['empty object', '{}'], ['null structs', JSON.stringify({ ...(await h.demoState()), structs: null })]];
    const out: string[] = [];
    for (const [label, val] of cases) {
      await h.page.evaluate(([k, v]) => localStorage.setItem(k + '.state', v), [DEMO_KEY, val] as const);
      const errs = h.findings.length;
      await h.go('/console');
      await h.play(3);
      const body = await h.page.evaluate(() => document.body.innerText.trim().length);
      const broke = h.findings.slice(errs).some((f) => f.kind === 'pageerror' || f.kind === 'js.error');
      if (broke || body < 20) h.find('save.corrupt', 'major', `a corrupted save (${label}) breaks the client instead of falling back`, { body });
      out.push(`${label}: ${broke || body < 20 ? 'BROKE' : 'survived'}`);
    }
    // Leave the profile with a working base.
    await h.page.evaluate((k) => { localStorage.removeItem(k + '.state'); }, DEMO_KEY);
    await h.go('/console');
    return out.join('; ');
  },
  async offline(h) {
    await toBridge(h);
    await h.ctx.setOffline(true);
    for (const [k] of NAV.slice(0, 6)) { await h.page.keyboard.press(k); await h.settle(200); }
    await h.play(5);
    const body = await h.page.evaluate(() => document.body.innerText.trim().length);
    await h.ctx.setOffline(false);
    if (body < 20) h.find('offline', 'major', 'the client goes blank when the network drops');
    return `offline navigation ${body < 20 ? 'went blank' : 'kept working'}`;
  },
  async resize(h) {
    await toBridge(h);
    const orig = h.page.viewportSize()!;
    for (const [w, ht] of [[320, 568], [1920, 1080], [768, 1024], [360, 740], [orig.width, orig.height]]) { await h.page.setViewportSize({ width: w, height: ht }); await h.play(1); if (w <= 400) await h.probe(); }
    return 'resized through phone, desktop and tablet mid-play';
  },
  async 'multi-tab'(h) {
    await toBridge(h);
    const second = await h.ctx.newPage();
    h.wire(second);
    await second.clock.install();
    await second.goto(h.url('/console'), { waitUntil: 'domcontentloaded' });
    const a0 = await h.demoState();
    for (let i = 0; i < 10; i++) { await h.page.clock.runFor(BLOCK_MS); await second.clock.runFor(BLOCK_MS); await second.keyboard.press(i % 2 ? 'q' : 'e').catch(() => {}); }
    const a1 = await h.demoState();
    await second.close();
    if (a1?.__corrupt) h.find('save.multitab', 'blocker', 'two open tabs corrupted the save');
    if (num(a1?.height) < num(a0?.height)) h.find('save.multitab', 'major', `two tabs rolled the base back (height ${a0?.height} → ${a1?.height})`);
    return `two tabs: height ${a0?.height} → ${a1?.height}`;
  },
};

async function awayFor(h: Harness, ms: number) {
  await toBridge(h);
  const before = await h.demoState();
  if (before?.raid) h.find('away.raid', 'major', `left with a raid in progress; on return the ${ms / 3600_000} h away were not replayed at all (demo catchUp() skips when s.raid is set), so the base produced nothing while closed`);
  // Close the game, wind the save and the clock-holder's heartbeat back as if the player left
  // `ms` ago, and open it again: exactly what a returning player's browser holds.
  await h.page.goto(h.url('/robots.txt')); // same origin, no game script running
  await h.page.evaluate(([k, ms]) => {
    const st = JSON.parse(localStorage.getItem(k + '.state') || 'null');
    if (st) { st.savedAt = (st.savedAt ?? Date.now()) - ms; localStorage.setItem(k + '.state', JSON.stringify(st)); }
    localStorage.removeItem(k + '.leader');
  }, [DEMO_KEY, ms] as const);
  await h.go('/console');
  await h.settle(800);
  const after = await h.demoState();
  const report = await h.page.getByText(/귀환 보고|자리를 비운|없는 동안/).count();
  if (!report) h.find('away', 'minor', `came back after ${ms / 3600_000} h and saw no away report`);
  return `away ${ms / 3600_000} h: height ${before?.height} → ${after?.height}, α ${num(before?.alpha).toFixed(1)} → ${num(after?.alpha).toFixed(1)}; report ${report ? 'shown' : 'missing'}`;
}
async function doctrine(h: Harness, id: string) { await h.go('/research'); return (await h.click(`[data-act="adopt"][data-id="${id}"]`)) ? `adopted ${id}` : `skip: ${id} doctrine not available`; }
async function clickText(h: Harness, re: RegExp) { return h.click({ role: 'button', name: re }); }
async function stance(h: Harness, key: string, which: string) {
  await toBridge(h);
  const b = await until(h, 60, () => h.has('[data-act="stance"]'));
  if (b < 0) return 'skip: no raid approached within 60 blocks';
  await h.key(key);
  const pressed = await h.page.locator(`[data-act="stance"][data-v="${which}"][aria-pressed="true"]`).count();
  if (!pressed) h.find('stance', 'major', `pressing ${key.toUpperCase()} did not set ${which}`);
  await h.play(20);
  return `raid after ${b} blocks; ${which} ${pressed ? 'set' : 'NOT set'}`;
}
async function pickRival(h: Harness) { return h.click('.gx-node.rival', { force: true }); }
async function battle(h: Harness, label: string) {
  await h.click('[data-act="toDeploy"]');
  await h.click('[data-act="start"]');
  await h.click('[data-act="autopilot"]');
  const t0 = Date.now();
  let b = 0;
  for (; b < 200; b += 4) { await h.page.clock.runFor(2000 * 4); await h.page.waitForTimeout(30); if (await h.has('[data-act="again"], [data-act="replay"]')) break; }
  await h.screenshot(`${label}-debrief`);
  const done = await h.has('[data-act="again"], [data-act="replay"]');
  if (!done) h.find('battle', 'major', `${label} battle did not reach a debrief within 200 blocks of autopilot`);
  return `${label} battle ${done ? 'finished' : 'still running'} after ~${b} blocks (${Date.now() - t0} ms real)`;
}
function checkState(h: Harness, s: Record<string, unknown> | null) {
  if (!s) return;
  if (s.__corrupt) { h.find('save.corrupt', 'blocker', 'the demo save is no longer valid JSON'); return; }
  for (const k of ['alpha', 'ore', 'shield', 'height']) if (!Number.isFinite(num(s[k]))) h.find('state.nonfinite', 'blocker', `demo save: ${k} is ${String(s[k])} after ${h.step}`);
  if (num(s.alpha) < 0) h.find('state.negative', 'major', `demo save: alpha is negative (${s.alpha})`);
}
