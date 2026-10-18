/* `pnpm playtest:ai [--target URL] [--personas all|a,b] [--steps 30] [--parallel 2] [--out dir]`
 * Claude playtests the live client as each persona, then one synthesis pass merges every persona's
 * notes with the sim and browser findings already in <out> into a ranked triage list.
 * Writes <out>/ai.json. Without Anthropic credentials it says so and exits cleanly.
 * Model: PLAYTEST_MODEL (default claude-opus-5-5). */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { pick } from '../profiles';
import { playAi, synthesise, MODEL, type AiResult } from './agent';
import { DEFAULT_TARGET } from '../browser/run';
import { args, reportDir, writeJson } from '../lib/util';

const a = args();
const out = reportDir(a);
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_PROFILE && !existsSync(`${process.env.HOME}/.config/anthropic`)) {
  console.log('playtest:ai · no Anthropic credentials (set ANTHROPIC_API_KEY or run `ant auth login`); skipping the AI playtesters.');
  writeJson(`${out}/ai.json`, { at: new Date().toISOString(), skipped: 'no credentials', results: [], triage: null });
  process.exit(0);
}
const client = new Anthropic();
const target = a.target ?? process.env.PLAYTEST_TARGET ?? DEFAULT_TARGET;
const personas = pick(a.personas);
const steps = Number(a.steps ?? 30), par = Math.max(1, Number(a.parallel ?? 2));
console.log(`playtest:ai · ${personas.length} Claude playtesters (${MODEL}, ${steps} actions each) → ${target}`);
const results: AiResult[] = [];
for (let i = 0; i < personas.length; i += par) {
  results.push(...(await Promise.all(personas.slice(i, i + par).map(async (p) => {
    const r = await playAi(client, p, target, out, steps);
    console.log(`  ${r.error ? '✗' : '✓'} ${p.id}: ${r.steps} turns, ${r.notes.length} notes${r.review ? `, fun ${r.review.fun}/10, clarity ${r.review.clarity}/10, ${r.review.would_return ? 'would return' : 'would not return'}` : ''}${r.error ? ` — ${r.error}` : ''}`);
    return r;
  }))));
}
const read = (f: string) => (existsSync(`${out}/${f}`) ? JSON.parse(readFileSync(`${out}/${f}`, 'utf8')) : null);
const sim = read('sim.json'), browser = read('browser.json');
let triage = null;
try {
  triage = await synthesise(client, {
    ai: results.map((r) => ({ persona: r.persona, review: r.review, notes: r.notes.map(({ severity, title, detail, url }) => ({ severity, title, detail, url })) })),
    browser: browser?.results.map((r: { persona: string; findings: unknown[]; steps: { step: string; status: string; note: string }[] }) => ({ persona: r.persona, findings: r.findings, failedSteps: r.steps.filter((s) => s.status === 'fail') })),
    sim: sim && { global: sim.global, personas: sim.personas.map((s: Record<string, unknown>) => ({ id: s.id, worth: s.worth, rivalMax: s.rivalMax, hegemony: s.hegemony, raids: s.raids, rejectRate: s.rejectRate, topRefusals: s.topRefusals, spiralRate: s.spiralRate, engine: s.engine, gates: (s.gates as { ok: boolean }[]).filter((g) => !g.ok), violations: s.violations, crashes: (s.crashes as unknown[]).slice(0, 5) })) },
  });
} catch (e) { console.log(`  synthesis failed: ${(e as Error).message}`); }
writeJson(`${out}/ai.json`, { at: new Date().toISOString(), model: MODEL, target, results, triage });
const usage = results.reduce((t, r) => ({ input: t.input + r.usage.input, output: t.output + r.usage.output, cacheRead: t.cacheRead + r.usage.cacheRead }), { input: 0, output: 0, cacheRead: 0 });
console.log(`\n${triage ? `${triage.issues.length} triaged issue(s): ${triage.headline}` : 'no triage'} · tokens in ${usage.input} (cache read ${usage.cacheRead}) out ${usage.output} · ${out}/ai.json`);
