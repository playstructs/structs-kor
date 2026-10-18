/* `pnpm playtest:ai [--target URL] [--profiles all|a,b] [--steps 120] [--effort medium] [--parallel 4]
 *                   [--mock] [--agent claude|scripted] [--no-context-editing] [--out dir]`
 *
 * Deep dive: every profile plays its feature slice (features.ts) and explores, as Claude Sonnet 5.5
 * (PLAYTEST_MODEL overrides). Specialists enlist a commander when the run uses --mock (the dev
 * server's mock Guild API); otherwise everyone plays guest/demo. A final synthesis merges every
 * persona's notes with the sim and browser findings into a triage list.
 *
 * --agent scripted runs the same enlist, account tour, feature slice and screen visits without the
 * Anthropic API (a dry run), and estimates what the Claude run would cost from measured sizes.
 * Writes <out>/ai.json. */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { pick } from '../profiles';
import { playAi, playScripted, synthesise, MODEL, accountBudget, type AiResult, type Effort } from './agent';
import { FEATURES } from '../features';
import { estimate, measuredCost } from './cost';
import { DEFAULT_TARGET } from '../browser/run';
import { args, reportDir, writeJson } from '../lib/util';

const a = args();
const out = reportDir(a);
const agent = a.agent === 'scripted' ? 'scripted' : 'claude';
const hasCreds = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || existsSync(`${process.env.HOME}/.config/anthropic`));
if (agent === 'claude' && !hasCreds) {
  console.log('playtest:ai · no Anthropic credentials (set ANTHROPIC_API_KEY or run `ant auth login`); skipping. `--agent scripted` runs the same path without the API.');
  writeJson(`${out}/ai.json`, { at: new Date().toISOString(), skipped: 'no credentials', results: [], triage: null });
  process.exit(0);
}
const target = a.target ?? process.env.PLAYTEST_TARGET ?? DEFAULT_TARGET;
const personas = pick(a.profiles ?? a.personas);
const steps = Number(a.steps ?? 120), par = Math.max(1, Number(a.parallel ?? 4));
const effort = (a.effort ?? 'medium') as Effort;
const opts = { steps, effort, allow: { mock: a.mock === 'true', signup: a.signup === 'true', chain: a['chain-actions'] === 'true' }, contextEditing: a['no-context-editing'] !== 'true' };
accountBudget.left = personas.length; // never more accounts than profiles
const client = agent === 'claude' ? new Anthropic() : null;
console.log(`playtest:ai · ${personas.length} ${agent === 'claude' ? `Claude playtesters (${MODEL}, effort ${effort}, ${steps} actions each)` : 'scripted stand-ins (no API)'} → ${target}${opts.allow.mock ? ' · mock Guild API, specialists enlist' : ' · guest/demo'}`);

const results: AiResult[] = [];
for (let i = 0; i < personas.length; i += par) {
  results.push(...(await Promise.all(personas.slice(i, i + par).map(async (p) => {
    const r = client ? await playAi(client, p, target, out, opts) : await playScripted(p, target, out, opts);
    const cov = Object.values(r.coverage);
    const n = (s: string) => cov.filter((c) => c.status === s).length;
    console.log(`  ${r.error ? '✗' : '✓'} ${p.id.padEnd(17)} ${r.account ? `${r.account.created ? 'enlisted' : 'reused'} ${r.account.callsign} (${r.account.playerId})` : 'guest/demo'} · features: ${n('passed')} passed, ${n('failed')} failed, ${n('blocked')} blocked, ${n('guarded')} guarded, ${n('touched')} touched · ${r.notes.length} notes${r.review ? ` · fun ${r.review.fun}/10` : ''}${r.error ? ` — ${r.error}` : ''}`);
    return r;
  }))));
}

// Coverage across the run: the best status any profile reached, and who reached it.
const rank = { touched: 0, guarded: 1, blocked: 2, passed: 3, failed: 4 } as const;
const coverage: Record<string, { status: string; by: string[]; notes: string[] }> = {};
for (const f of FEATURES) coverage[f.id] = { status: 'untouched', by: [], notes: [] };
for (const r of results) for (const [id, c] of Object.entries(r.coverage)) {
  const cur = coverage[id]; if (!cur) continue;
  if (cur.status === 'untouched' || rank[c.status as keyof typeof rank] > rank[cur.status as keyof typeof rank]) cur.status = c.status;
  cur.by.push(`${r.persona}:${c.status}`); cur.notes.push(c.note);
}
const counts = Object.values(coverage).reduce<Record<string, number>>((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {});
const accounts = results.map((r) => r.account).filter(Boolean);

let triage = null;
if (client) {
  const read = (f: string) => (existsSync(`${out}/${f}`) ? JSON.parse(readFileSync(`${out}/${f}`, 'utf8')) : null);
  const sim = read('sim.json'), browser = read('browser.json');
  try {
    triage = await synthesise(client, {
      ai: results.map((r) => ({ persona: r.persona, review: r.review, coverage: r.coverage, notes: r.notes.map(({ severity, title, detail, url }) => ({ severity, title, detail, url })) })),
      browser: browser?.results.map((r: { persona: string; findings: unknown[] }) => ({ persona: r.persona, findings: r.findings })),
      sim: sim && { global: sim.global, personas: sim.personas.map((s: Record<string, unknown>) => ({ id: s.id, worth: s.worth, raids: s.raids, rejectRate: s.rejectRate, spiralRate: s.spiralRate, gates: (s.gates as { ok: boolean }[]).filter((g) => !g.ok) })) },
    });
  } catch (e) { console.log(`  synthesis failed: ${(e as Error).message}`); }
}
const measured = client ? measuredCost(results) : null;
const est = estimate(results, 20, 120, opts.contextEditing);
const cost = { measured, estimate: est };
writeJson(`${out}/ai.json`, { at: new Date().toISOString(), model: client ? MODEL : 'scripted', agent, target, mock: opts.allow.mock, steps, effort, accounts, coverage, results, triage, cost });
console.log(`\ncoverage: ${FEATURES.length} features · ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
if (accounts.length) console.log(`accounts (${accounts.length}): ${accounts.map((x) => `${x!.callsign} ${x!.playerId}${x!.created ? '' : ' (reused)'}`).join(', ')}`);
if (measured) console.log(`cost: $${measured.usd.toFixed(2)} over ${measured.turns} turns`);
else { const e = est; console.log(`estimate for 20 ${MODEL} agents × 120 steps: ~$${e.totalUsd.toFixed(0)} ($${e.perAgentUsd.toFixed(2)} each; per turn ~${e.perTurn.imageTokens} image + ${e.perTurn.textTokens} text tokens in, ${e.perTurn.output} out; peak context ${e.peakContext.toLocaleString()} tokens; from ${e.observations} measured observations)`); }
console.log(`${out}/ai.json`);
