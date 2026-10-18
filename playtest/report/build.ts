/* `pnpm playtest:report [--out dir]` — one self-contained HTML page (report.html) from whatever
 * layers ran into the run directory: sim.json, browser.json, ai.json. Screenshots are linked by
 * relative path, so the folder can be zipped, uploaded as a CI artifact or opened locally. */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { args } from '../lib/util';
import { PROFILES } from '../profiles';
import { FEATURES } from '../features';
import type { PersonaSummary, Gate } from '../sim/run';
import type { BrowserResult } from '../browser/run';
import type { AiResult, Triage } from '../ai/agent';

const a = args();
const dir = resolve(a.out ?? latest());
const read = <T>(f: string): T | null => (existsSync(join(dir, f)) ? (JSON.parse(readFileSync(join(dir, f), 'utf8')) as T) : null);
const sim = read<{ at: string; seeds: number; blocks: number; personas: PersonaSummary[]; global: Gate[] }>('sim.json');
const browser = read<{ at: string; target: string; results: BrowserResult[] }>('browser.json');
const ai = read<{ at: string; model?: string; agent?: string; skipped?: string; results: AiResult[]; triage: Triage | null; coverage?: Record<string, { status: string; by: string[]; notes: string[] }>; accounts?: { persona: string; callsign: string | null; playerId: string | null; created: boolean }[]; cost?: { measured: { usd: number; turns: number } | null; estimate: { totalUsd: number; perAgentUsd: number } } }>('ai.json');

function latest() {
  const root = resolve('playtest/reports');
  const runs = existsSync(root) ? readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort((x, y) => statSync(join(root, y)).mtimeMs - statSync(join(root, x)).mtimeMs) : [];
  if (!runs.length) throw new Error('no runs in playtest/reports; pass --out');
  return join(root, runs[0]);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (x: number | null) => (x == null || Number.isNaN(x) ? '—' : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x == null || Number.isNaN(x) ? '—' : x.toLocaleString());
const SEV = ['blocker', 'major', 'minor', 'info', 'praise'];

/** Median worth against the strongest rival, as a small line chart. */
function spark(s: PersonaSummary) {
  const W = 220, H = 56, c = s.curve;
  if (c.length < 2) return '';
  const max = Math.max(1, ...c.map((x) => Math.max(x.worth, x.rivalMax)));
  const X = (i: number) => (i / (c.length - 1)) * W, Y = (v: number) => H - 2 - (Math.max(0, v) / max) * (H - 6);
  const line = (k: 'worth' | 'rivalMax') => c.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(s.id)}: worth ${c.at(-1)!.worth} against strongest rival ${c.at(-1)!.rivalMax}"><path d="${line('rivalMax')}" class="l-rival"/><path d="${line('worth')}" class="l-you"/></svg>`;
}

const gateList = (gs: Gate[]) => gs.filter((g) => !g.ok).map((g) => `<li class="${g.tier}"><b>${g.tier === 'hard' ? 'BUG' : 'target'}</b> ${esc(g.detail)}</li>`).join('') || '<li class="ok">all targets met</li>';

const simHtml = !sim ? '<p class="muted">The simulation layer did not run (pnpm playtest:sim).</p>' : `
  <p class="muted">${sim.personas.length} personas × ${sim.seeds} seeds × ${sim.blocks.toLocaleString()} blocks each, headless, on the same demo code the browser runs. Lines: <span class="k-you">median worth</span> against <span class="k-rival">the strongest rival</span>.</p>
  <ul class="gates">${gateList(sim.global)}</ul>
  <div class="grid">${sim.personas.map((s) => {
    const p = PROFILES.find((x) => x.id === s.id);
    const hard = s.gates.some((g) => !g.ok && g.tier === 'hard'), soft = s.gates.some((g) => !g.ok);
    return `<article class="card ${hard ? 'bad' : soft ? 'warn' : 'good'}">
      <header><h3>${esc(p?.ko ?? s.id)}</h3><span class="muted">${esc(p?.archetype ?? '')}</span></header>
      ${spark(s)}
      <dl class="stats">
        <div><dt>Worth p50</dt><dd>${num(s.worth.p50)}</dd></div>
        <div><dt>Hegemony</dt><dd>${pct(s.hegemony.p50)}</dd></div>
        <div><dt>Raids lost</dt><dd>${pct(s.raids.lossShare)}</dd></div>
        <div><dt>Engine</dt><dd>${s.engine.p50}/3</dd></div>
        <div><dt>Refused</dt><dd>${pct(s.rejectRate)}</dd></div>
        <div><dt>Spirals</dt><dd>${pct(s.spiralRate)}</dd></div>
      </dl>
      <ul class="gates">${gateList(s.gates)}</ul>
      ${s.topRefusals.length ? `<details><summary>Most refused orders</summary><ul class="small">${s.topRefusals.slice(0, 5).map((r) => `<li><code>${esc(r.action)}</code> ×${r.n} — ${esc(r.reason)}</li>`).join('')}</ul></details>` : ''}
      ${s.violations.length ? `<details><summary>${s.violations.length} invariant violation(s)</summary><ul class="small">${s.violations.slice(0, 8).map((v) => `<li><code>${esc(v.id)}</code> ${esc(v.message)}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }).join('')}</div>`;

const allFindings = (browser?.results ?? []).flatMap((r) => r.findings.map((f) => ({ ...f, persona: r.persona })));
const merged = new Map<string, (typeof allFindings)[number] & { personas: string[] }>();
for (const f of allFindings) { const k = `${f.kind}|${f.message}`; const m = merged.get(k); if (m) m.personas.push(f.persona); else merged.set(k, { ...f, personas: [f.persona] }); }
const findings = [...merged.values()].sort((x, y) => SEV.indexOf(x.severity) - SEV.indexOf(y.severity) || y.personas.length - x.personas.length);

const browserHtml = !browser ? '<p class="muted">The browser layer did not run (pnpm playtest:browser).</p>' : `
  <p class="muted">Each persona in its own Chrome profile against <code>${esc(browser.target)}</code>, emulating its device, network and motion settings, with game time fast-forwarded.</p>
  <table><thead><tr><th>Severity</th><th>Finding</th><th>Seen by</th><th>Step</th></tr></thead><tbody>
  ${findings.map((f) => `<tr class="sev-${f.severity}"><td><span class="pill">${f.severity}</span></td><td><code class="kind">${esc(f.kind)}</code> ${esc(f.message)}${f.detail ? `<details><summary>detail</summary><pre>${esc(JSON.stringify(f.detail, null, 1)).slice(0, 1200)}</pre></details>` : ''}</td><td>${f.personas.map(esc).join(', ')}</td><td>${esc(f.step)}</td></tr>`).join('')}
  </tbody></table>
  ${browser.results.map((r) => `<details class="journey"><summary><b>${esc(PROFILES.find((p) => p.id === r.persona)?.ko ?? r.persona)}</b> · ${r.steps.filter((s) => s.status === 'ok').length}/${r.steps.length} steps · ${r.blocks} blocks played · ${(r.ms / 1000).toFixed(0)} s${r.perf ? ` · LCP ${r.perf.lcp} ms · CLS ${r.perf.cls}` : ''}</summary>
    <ol class="steps">${r.steps.map((s) => `<li class="st-${s.status}"><a href="${esc(`${r.persona}/${s.screenshot}`)}"><img loading="lazy" src="${esc(`${r.persona}/${s.screenshot}`)}" alt="${esc(s.step)} screenshot"></a><div><b>${esc(s.step)}</b> <span class="pill">${s.status}</span><p>${esc(s.note)}</p></div></li>`).join('')}</ol></details>`).join('')}`;

const aiHtml = !ai ? '<p class="muted">The AI playtesters did not run (pnpm playtest:ai).</p>' : ai.skipped ? `<p class="muted">AI playtesters skipped: ${esc(ai.skipped)}.</p>` : `
  ${ai.triage ? `<p class="lead">${esc(ai.triage.headline)}</p>
  <table><thead><tr><th>Severity</th><th>Issue</th><th>Personas</th><th>Repro and fix</th></tr></thead><tbody>${ai.triage.issues.map((i) => `<tr class="sev-${i.severity}"><td><span class="pill">${i.severity}</span></td><td><b>${esc(i.title)}</b><p class="small">${esc(i.evidence)}</p></td><td>${i.personas.map(esc).join(', ')}</td><td class="small"><p><b>Repro</b> ${esc(i.repro)}</p><p><b>Fix</b> ${esc(i.fix)}</p></td></tr>`).join('')}</tbody></table>
  ${ai.triage.balance.length ? `<h3>Balance</h3><ul>${ai.triage.balance.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  ${ai.triage.praise.length ? `<h3>What testers liked</h3><ul>${ai.triage.praise.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}` : ''}
  <div class="grid">${ai.results.map((r) => `<article class="card"><header><h3>${esc(PROFILES.find((p) => p.id === r.persona)?.ko ?? r.persona)}</h3>${r.review ? `<span class="muted">fun ${r.review.fun}/10 · clarity ${r.review.clarity}/10 · ${r.review.would_return ? 'would return' : 'would not return'}</span>` : `<span class="muted">${esc(r.error ?? 'no review')}</span>`}</header>
    ${r.review ? `<p>${esc(r.review.summary)}</p>` : ''}
    <ul class="small">${r.notes.map((n) => `<li class="sev-${n.severity}"><span class="pill">${n.severity}</span> <b>${esc(n.title)}</b> — ${esc(n.detail)}${n.screenshot ? ` <a href="${esc(n.screenshot)}">screenshot</a>` : ''}</li>`).join('')}</ul></article>`).join('')}</div>`;

const covHtml = !ai?.coverage ? '' : (() => {
  const by = (st: string) => FEATURES.filter((f) => ai.coverage![f.id]?.status === st).length;
  const areas = [...new Set(FEATURES.map((f) => f.area))];
  return `<p class="muted">${FEATURES.length} features from the README's screen and game-layer tables (playtest/features.ts). ${['passed', 'failed', 'blocked', 'guarded', 'touched', 'untouched'].map((st) => `<b>${by(st)}</b> ${st}`).join(' · ')}.${ai.cost ? ` ${ai.cost.measured ? `Measured cost $${ai.cost.measured.usd.toFixed(2)} over ${ai.cost.measured.turns} turns.` : `Estimated cost for 20 agents × 120 steps: ~$${ai.cost.estimate.totalUsd.toFixed(0)}.`}` : ''}</p>
  ${ai.accounts?.length ? `<p class="small">Accounts: ${ai.accounts.map((x) => `${esc(x.persona)} → <code>${esc(x.callsign)}</code> ${esc(x.playerId)}${x.created ? '' : ' (reused)'}`).join(' · ')}</p>` : ''}
  <table><thead><tr><th>Area</th><th>Feature</th><th>Status</th><th>By</th></tr></thead><tbody>
  ${areas.map((ar) => FEATURES.filter((f) => f.area === ar).map((f) => { const c = ai.coverage![f.id] ?? { status: 'untouched', by: [], notes: [] }; return `<tr class="cov-${c.status}"><td>${esc(ar)}</td><td>${esc(f.name)}${f.chain ? ' <span class="pill">chain</span>' : ''}${f.guarded ? ' <span class="pill">guarded</span>' : ''}<div class="small muted">${esc([...new Set(c.notes)].slice(0, 2).join(' · '))}</div></td><td><span class="pill">${c.status}</span></td><td class="small">${esc(c.by.join(', '))}</td></tr>`; }).join('')).join('')}
  </tbody></table>`;
})();
const counts = SEV.slice(0, 3).map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`).join(' · ');
const hardFails = sim ? [...sim.personas.flatMap((s) => s.gates), ...sim.global].filter((g) => !g.ok && g.tier === 'hard').length : 0;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Playtest Report</title>
<style>
:root{--bg:#f6f5f2;--panel:#fff;--ink:#1d1f24;--muted:#626873;--line:#e2e0da;--you:#0f8a7e;--rival:#c2553e;--bad:#b3261e;--warn:#9a6700;--good:#1f7a3d;--info:#3f5f9a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121418;--panel:#1b1e24;--ink:#e8e6e1;--muted:#9aa0aa;--line:#2c3038;--you:#3cc6b6;--rival:#ef8a72;--bad:#f2b8b5;--warn:#e7c06a;--good:#7dd69a;--info:#9fb7e8}}
:root[data-theme="dark"]{--bg:#121418;--panel:#1b1e24;--ink:#e8e6e1;--muted:#9aa0aa;--line:#2c3038;--you:#3cc6b6;--rival:#ef8a72;--bad:#f2b8b5;--warn:#e7c06a;--good:#7dd69a;--info:#9fb7e8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 8px;padding-top:16px;border-top:1px solid var(--line)}h3{font-size:16px;margin:0}
.muted{color:var(--muted)}.small{font-size:13px}.lead{font-size:17px}code{font:12.5px ui-monospace,Menlo,monospace}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.summary div{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px}.summary b{display:block;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;padding:12px 14px}.card.bad{border-left-color:var(--bad)}.card.warn{border-left-color:var(--warn)}.card.good{border-left-color:var(--good)}
.card header{display:flex;flex-direction:column;margin-bottom:6px}.card svg{width:100%;height:auto}
.l-you,.l-rival{fill:none;stroke-width:2}.l-you{stroke:var(--you)}.l-rival{stroke:var(--rival);stroke-dasharray:4 3}.k-you{color:var(--you);font-weight:600}.k-rival{color:var(--rival);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 8px;margin:8px 0}.stats dt{font-size:11px;color:var(--muted)}.stats dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.gates{list-style:none;padding:0;margin:6px 0;font-size:13px}.gates li{padding:2px 0}.gates .hard b{color:var(--bad)}.gates .design b{color:var(--warn)}.gates .ok{color:var(--good)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:14px;display:block;overflow-x:auto}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}th{font-size:12px;color:var(--muted);font-weight:600}
.pill{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;border:1px solid currentColor}
.sev-blocker .pill{color:var(--bad)}.sev-major .pill{color:var(--warn)}.sev-minor .pill{color:var(--muted)}.sev-info .pill{color:var(--info)}.sev-praise .pill{color:var(--good)}
.kind{color:var(--muted)}pre{white-space:pre-wrap;font-size:12px;max-height:240px;overflow:auto}
.journey{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0}.journey summary{cursor:pointer}
.steps{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}.steps li{border:1px solid var(--line);border-radius:6px;overflow:hidden}.steps img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover;object-position:top}.steps div{padding:6px 8px;font-size:13px}.steps p{margin:2px 0 0;color:var(--muted)}
.st-fail{border-color:var(--bad)!important}
.cov-passed .pill{color:var(--good)}.cov-failed .pill{color:var(--bad)}.cov-blocked .pill{color:var(--warn)}.cov-guarded .pill,.cov-touched .pill{color:var(--info)}.cov-untouched .pill{color:var(--muted)}.st-skip{opacity:.75}
</style></head><body><main>
<h1>Playtest Report</h1>
<p class="muted">${esc(dir.split('/').slice(-1)[0])} · ${PROFILES.length} profiles · ${[sim && 'simulation', browser && 'browser', ai && !ai.skipped && `AI (${ai.model})`].filter(Boolean).join(' + ')}</p>
<div class="summary"><div><b>${hardFails}</b>hard gate failures</div><div><b>${findings.filter((f) => f.severity === 'blocker' || f.severity === 'major').length}</b>blocker + major findings</div><div><b>${counts}</b>browser findings</div>${ai?.triage ? `<div><b>${ai.triage.issues.length}</b>AI-triaged issues</div>` : ''}</div>
${covHtml ? `<h2>Feature coverage</h2>${covHtml}` : ''}
<h2>AI playtesters</h2>${aiHtml}
<h2>Browser playtests</h2>${browserHtml}
<h2>Simulation: balance and stability</h2>${simHtml}
</main></body></html>`;
writeFileSync(join(dir, 'report.html'), html);
console.log(`playtest:report · ${join(dir, 'report.html')}`);
