/* `pnpm playtest:browser [--target URL] [--personas all|a,b] [--steps a,b] [--parallel 3] [--headed] [--fresh] [--out dir]`
 * Walks each persona's journey through the real client in its own browser profile, then writes
 * <out>/browser.json plus screenshots under <out>/<persona>/. Exits 1 on any blocker finding. */
import { pick, type Profile } from '../profiles';
import { Harness, RateLimited, type Finding, type StepResult } from './harness';
import { STEPS } from './journeys';
import { args, reportDir, writeJson } from '../lib/util';

export const DEFAULT_TARGET = 'https://xn--2e0b952cv5c.com/';

export interface BrowserResult {
  persona: string; target: string; device: string; viewport: { width: number; height: number } | null;
  steps: StepResult[]; findings: Finding[];
  console: Harness['console']; requests: Harness['requests'];
  perf: Record<string, unknown> | null; ms: number; blocks: number;
}

export async function playBrowser(p: Profile, target: string, out: string, opts: { headed?: boolean; fresh?: boolean; steps?: string[] } = {}): Promise<BrowserResult> {
  const t0 = Date.now();
  const h = await Harness.open(p, target, out, opts);
  let perf: Record<string, unknown> | null = null;
  try {
    for (const name of opts.steps ?? p.journey) {
      const f = STEPS[name];
      h.step = name;
      const s0 = Date.now();
      let status: StepResult['status'] = 'ok', note = '';
      if (!f) { status = 'skip'; note = 'no such step'; }
      else try {
        note = await Promise.race([f(h), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('step timed out after 90 s')), 90_000))]);
        if (note.startsWith('skip:')) { status = 'skip'; note = note.slice(5).trim(); }
      } catch (e) { if (e instanceof RateLimited) throw e; status = 'fail'; note = (e as Error).message.split('\n')[0]; h.find('step', 'major', `${name}: ${note}`); }
      if (h.throttled > 5) throw new RateLimited(`${h.throttled} requests answered 429`);
      const r = await h.probe();
      if (r && !perf) perf = r.perf; // first full page: the cold-load numbers
      const shot = await h.screenshot(name);
      h.steps.push({ step: name, status, note, ms: Date.now() - s0, url: h.page.url(), screenshot: shot, blocks: h.blocks });
      console.log(`  ${status === 'ok' ? '✓' : status === 'skip' ? '·' : '✗'} ${p.id}/${name}: ${note}`);
    }
    const last = await h.probe();
    if (perf && last) perf = { ...perf, endHeapMB: last.perf.heapMB, endDomNodes: last.perf.domNodes, longTasks: last.perf.longTasks, longTaskMs: last.perf.longTaskMs };
    // Budgets for a game frame: cold load and smoothness.
    if (perf && typeof perf.lcp === 'number' && perf.lcp > (p.network === '3g' ? 8000 : 4000)) h.find('perf.lcp', 'major', `largest paint at ${perf.lcp} ms on ${p.network}`);
    if (perf && typeof perf.cls === 'number' && perf.cls > 0.1) h.find('perf.cls', 'minor', `layout shift score ${perf.cls} (budget 0.1)`);
    const errs = h.console.filter((c) => c.type === 'error' && !/status of 404/.test(c.text));
    if (errs.length) h.find('console', 'minor', `${errs.length} console error(s); first: ${errs[0].text}`);
    // Same-origin files that 404 are missing assets; API 404s are the planned-route fallbacks
    // (src/api/planned.ts) working as designed.
    const origin = new URL(target).origin;
    const missing = [...new Set(h.requests.failed.filter((r) => r.status === 404 && r.url.startsWith(origin)).map((r) => new URL(r.url).pathname))];
    for (const m of missing) h.find('asset.missing', 'major', `missing file: ${m}`);
    const planned = [...new Set(h.requests.failed.filter((r) => r.status === 404 && !r.url.startsWith(origin) && /\/api\//.test(r.url)).map((r) => new URL(r.url).pathname))];
    if (planned.length) h.find('api.planned', 'info', `${planned.length} planned Guild API route(s) answered 404 and fell back: ${planned.slice(0, 4).join(', ')}`);
    const bad = h.requests.failed.filter((r) => typeof r.status === 'string' || r.status >= 500);
    if (bad.length) h.find('network', 'minor', `${bad.length} failed request(s); first: ${bad[0].url} (${bad[0].status})`);
  } finally {
    await h.close();
  }
  return { persona: p.id, target, device: p.device, viewport: null, steps: h.steps, findings: h.findings, console: h.console.slice(0, 50), requests: { ...h.requests, failed: h.requests.failed.slice(0, 50) }, perf, ms: Date.now() - t0, blocks: h.blocks };
}

/** Replay a persona after the host throttles us: wait, then start its journey again. */
async function withBackoff(p: Profile, target: string, out: string, opts: Parameters<typeof playBrowser>[3], tries = 3): Promise<BrowserResult> {
  for (let i = 0; ; i++) {
    try { return await playBrowser(p, target, out, opts); } catch (e) {
      if (!(e instanceof RateLimited) || i + 1 >= tries) throw e;
      const wait = 60_000 * 2 ** i;
      console.log(`  … ${p.id}: ${e.message}; retrying in ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const target = a.target ?? process.env.PLAYTEST_TARGET ?? DEFAULT_TARGET;
  const out = reportDir(a);
  const personas = pick(a.personas);
  const results: BrowserResult[] = [];
  console.log(`playtest:browser · ${personas.length} personas → ${target}`);
  // Gentle on a live host: GitHub Pages throttles at roughly 10k requests in a burst.
  const par = Math.max(1, Number(a.parallel ?? (target.includes('localhost') || target.includes('127.0.0.1') ? 4 : 2)));
  for (let i = 0; i < personas.length; i += par) {
    const batch = await Promise.all(personas.slice(i, i + par).map((p) => withBackoff(p, target, out, { headed: a.headed === 'true', fresh: a.fresh === 'true', steps: a.steps?.split(',') }).catch((e) => ({ persona: p.id, target, device: p.device, viewport: null, steps: [], findings: [e instanceof RateLimited ? { kind: 'infra.rate-limit', severity: 'info' as const, step: 'boot', message: `not played: ${e.message}` } : { kind: 'harness', severity: 'blocker' as const, step: 'boot', message: (e as Error).message }], console: [], requests: { total: 0, failed: [], blocked: [] }, perf: null, ms: 0, blocks: 0 }))));
    results.push(...batch);
  }
  writeJson(`${out}/browser.json`, { at: new Date().toISOString(), target, results });
  const blockers = results.flatMap((r) => r.findings.filter((f) => f.severity === 'blocker').map((f) => `${r.persona}: ${f.message}`));
  const majors = results.reduce((a, r) => a + r.findings.filter((f) => f.severity === 'major').length, 0);
  console.log(`\n${blockers.length} blocker(s), ${majors} major finding(s) · ${out}/browser.json`);
  for (const b of blockers) console.log(`  ✗ ${b}`);
  if (blockers.length && a['no-gate'] !== 'true') process.exitCode = 1;
}
