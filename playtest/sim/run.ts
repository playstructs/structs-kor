/* `pnpm playtest:sim [--personas all|a,b] [--seeds 8] [--blocks 6000] [--out dir] [--no-gate]`
 * Plays every persona over every seed headless, aggregates, checks the gates and writes
 * <out>/sim.json. Exits 1 when a gate fails (CI). */
import { PROFILES, pick, type Profile, type Milestone } from '../profiles';
import { BUDGETS } from '../budgets';
import BASELINE from '../baseline.json' with { type: 'json' };
import { run, type RunResult } from './engine';
import { args, reportDir, writeJson, median, quantile, mean } from '../lib/util';

export interface PersonaSummary {
  id: string; name: string; seeds: number; blocks: number;
  worth: { p10: number; p50: number; p90: number };
  alpha: { p50: number };
  rivalMax: { p50: number };
  hegemony: { p50: number };
  rank: { p50: number };
  engine: { p50: number; max: number };
  raids: { faced: number; lost: number; lossShare: number; made: number; won: number };
  milestones: Record<string, { rate: number; medianBlock: number | null }>;
  rejectRate: number;
  topRefusals: { action: string; reason: string; n: number }[];
  actions: Record<string, { ok: number; refused: number }>;
  idleShare: number;
  spiralRate: number;
  crashes: RunResult['crashes'];
  violations: RunResult['violations'];
  /** Median curve (per sample block) of worth, alpha and the strongest rival. */
  curve: { b: number; worth: number; alpha: number; rivalMax: number; hegemony: number }[];
  events: Record<string, number>;
  story: RunResult['story'];
  blocksPerSecond: number;
  gates: Gate[];
}
/** hard: a bug (crash, broken invariant, perf) — fails CI. design: a balance or UX target the
 * persona should meet — reported, fails only with --strict. known: in playtest/baseline.json. */
export interface Gate { id: string; ok: boolean; detail: string; tier: 'hard' | 'design'; known?: boolean }

const MILESTONES: Milestone[] = ['refineryOnline', 'firstResearch', 'firstRepel', 'firstRaidWon', 'firstVassal', 'tier1', 'tier2', 'tier3', 'engine1', 'engine2', 'engine3', 'newEra', 'rank5', 'rank10'];

export function summarise(p: Profile, runs: RunResult[]): PersonaSummary {
  const fin = runs.map((r) => r.final);
  const actions: PersonaSummary['actions'] = {};
  const refusals: Record<string, number> = {};
  for (const r of runs) for (const [k, a] of Object.entries(r.actions)) {
    const t = (actions[k] ??= { ok: 0, refused: 0 }); t.ok += a.ok; t.refused += a.refused;
    for (const [why, n] of Object.entries(a.reasons)) refusals[`${k}\u0000${why}`] = (refusals[`${k}\u0000${why}`] ?? 0) + n;
  }
  const ok = Object.values(actions).reduce((a, x) => a + x.ok, 0), refused = Object.values(actions).reduce((a, x) => a + x.refused, 0);
  const faced = mean(fin.map((f) => f.repelled + f.lost)), lost = mean(fin.map((f) => f.lost));
  const milestones: PersonaSummary['milestones'] = {};
  for (const m of MILESTONES) {
    const at = runs.map((r) => r.milestones[m]).filter((x): x is number => x != null);
    milestones[m] = { rate: at.length / runs.length, medianBlock: at.length ? Math.round(median(at)) : null };
  }
  const nS = Math.min(...runs.map((r) => r.samples.length));
  const curve = Array.from({ length: nS }, (_, i) => ({
    b: runs[0].samples[i].b,
    worth: Math.round(median(runs.map((r) => r.samples[i].worth))),
    alpha: Math.round(median(runs.map((r) => r.samples[i].alpha))),
    rivalMax: Math.round(median(runs.map((r) => r.samples[i].rivalMax))),
    hegemony: Math.round(median(runs.map((r) => r.samples[i].hegemony)) * 1000) / 1000,
  }));
  const events: Record<string, number> = {};
  for (const r of runs) for (const [k, n] of Object.entries(r.events)) events[k] = (events[k] ?? 0) + n;
  const crashes = runs.flatMap((r) => r.crashes.map((c) => ({ ...c, message: `[seed ${r.seed}] ${c.message}` })));
  const violations: RunResult['violations'] = [];
  for (const r of runs) for (const v of r.violations) if (!violations.some((x) => x.id === v.id)) violations.push({ ...v, message: `[seed ${r.seed}] ${v.message}` });
  const totalBlocks = runs.reduce((a, r) => a + r.blocks, 0), totalMs = runs.reduce((a, r) => a + r.ms, 0);
  const s: PersonaSummary = {
    id: p.id, name: p.name, seeds: runs.length, blocks: runs[0].blocks,
    worth: { p10: Math.round(quantile(fin.map((f) => f.worth), 0.1)), p50: Math.round(median(fin.map((f) => f.worth))), p90: Math.round(quantile(fin.map((f) => f.worth), 0.9)) },
    alpha: { p50: Math.round(median(fin.map((f) => f.alpha))) },
    rivalMax: { p50: Math.round(median(fin.map((f) => f.rivalMax))) },
    hegemony: { p50: Math.round(median(fin.map((f) => f.hegemony)) * 1000) / 1000 },
    rank: { p50: median(fin.map((f) => f.rank)) },
    engine: { p50: median(fin.map((f) => f.engine)), max: Math.max(...fin.map((f) => f.engine)) },
    raids: { faced: round1(faced), lost: round1(lost), lossShare: faced ? round3(lost / faced) : 0, made: round1(mean(runs.map((r) => r.raidsMade))), won: round1(mean(runs.map((r) => r.raidsWon))) },
    milestones,
    rejectRate: ok + refused ? round3(refused / (ok + refused)) : 0,
    topRefusals: Object.entries(refusals).sort((a, z) => z[1] - a[1]).slice(0, 8).map(([k, n]) => { const [action, reason] = k.split('\u0000'); return { action, reason, n }; }),
    actions, idleShare: round3(runs.reduce((a, r) => a + r.idle, 0) / totalBlocks),
    spiralRate: round3(runs.filter((r) => r.spiral).length / runs.length),
    crashes, violations, curve, events,
    story: runs[0].story.slice(0, 30),
    blocksPerSecond: Math.round(totalBlocks / Math.max(1, totalMs) * 1000),
    gates: [],
  };
  s.gates = personaGates(p, s);
  return s;
}

/** Typed here: with every entry fixed the lists are empty, and JSON alone would type them never[]. */
const KNOWN = BASELINE as { violations: { id: string }[]; crashes: { action: string; message: string }[] };
const knownViolation = (id: string) => KNOWN.violations.some((k) => id === k.id || (k.id.endsWith('*') && id.startsWith(k.id.slice(0, -1))));
const knownCrash = (action: string, message: string) => KNOWN.crashes.some((k) => action === k.action && message.includes(k.message));

function personaGates(p: Profile, s: PersonaSummary): Gate[] {
  const g = [] as Gate[];
  const e = p.expect;
  g.push({ id: 'spiral', tier: 'design', ok: s.spiralRate <= e.maxSpiralRate, detail: `death spirals in ${pct(s.spiralRate)} of seeds (allowed ${pct(e.maxSpiralRate)})` });
  if (e.minMedianWorth != null) g.push({ id: 'worth', tier: 'design', ok: s.worth.p50 >= e.minMedianWorth, detail: `median worth ${s.worth.p50} (need ${e.minMedianWorth})` });
  if (e.maxLossShare != null) g.push({ id: 'losses', tier: 'design', ok: s.raids.lossShare <= e.maxLossShare, detail: `lost ${pct(s.raids.lossShare)} of raids faced (allowed ${pct(e.maxLossShare)})` });
  if (e.maxRejectRate != null) g.push({ id: 'friction', tier: 'design', ok: s.rejectRate <= e.maxRejectRate, detail: `${pct(s.rejectRate)} of orders refused (allowed ${pct(e.maxRejectRate)})` });
  for (const m of e.milestones ?? []) {
    const runsAt = s.milestones[m.id];
    // rate by `by`: approximate with median block when reached (exact per-run check is in the raw runs).
    const ok = runsAt.rate >= m.rate && (runsAt.medianBlock ?? Infinity) <= m.by;
    g.push({ id: `milestone.${m.id}`, tier: 'design', ok, detail: `${m.id}: reached in ${pct(runsAt.rate)} of seeds, median block ${runsAt.medianBlock ?? '—'} (need ${pct(m.rate)} by ${m.by})` });
  }
  // The newcomer and the diplomat are away most of the time on purpose; chaos is never idle by choice.
  if (!['chaos', 'newcomer', 'diplomat'].includes(p.id)) g.push({ id: 'idle', tier: 'design', ok: s.idleShare <= BUDGETS.maxIdleShare, detail: `idle in ${pct(s.idleShare)} of blocks (allowed ${pct(BUDGETS.maxIdleShare)})` });
  const newCrashes = s.crashes.filter((c) => !knownCrash(c.action, c.message)), newViolations = s.violations.filter((v) => !knownViolation(v.id));
  g.push({ id: 'crashes', tier: 'hard', ok: newCrashes.length <= BUDGETS.maxCrashes, known: !!s.crashes.length && !newCrashes.length, detail: `${newCrashes.length} new exceptions${s.crashes.length - newCrashes.length ? ` (+${s.crashes.length - newCrashes.length} known)` : ''}${newCrashes[0] ? ` · first: ${newCrashes[0].action}: ${newCrashes[0].message}` : ''}` });
  g.push({ id: 'invariants', tier: 'hard', ok: newViolations.length <= BUDGETS.maxViolations, known: !!s.violations.length && !newViolations.length, detail: `${newViolations.length} new invariant violations${s.violations.length - newViolations.length ? ` (+${s.violations.length - newViolations.length} known)` : ''}${newViolations[0] ? ` · first: ${newViolations[0].message}` : ''}` });
  g.push({ id: 'perf', tier: 'hard', ok: s.blocksPerSecond >= BUDGETS.minBlocksPerSecond, detail: `${s.blocksPerSecond} blocks/s (need ${BUDGETS.minBlocksPerSecond})` });
  return g;
}

export function globalGates(all: PersonaSummary[]): Gate[] {
  const real = all.filter((s) => s.id !== 'chaos');
  const worths = real.map((s) => Math.max(1, s.worth.p50));
  const top = real[worths.indexOf(Math.max(...worths))], low = real[worths.indexOf(Math.min(...worths))];
  const ratio = Math.max(...worths) / Math.min(...worths);
  return [{ id: 'dominance', tier: 'design', ok: ratio <= BUDGETS.maxDominance, detail: `best/worst median worth ${ratio.toFixed(1)}× (${top?.id} ${top?.worth.p50} vs ${low?.id} ${low?.worth.p50}; allowed ${BUDGETS.maxDominance}×)` }];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const round1 = (x: number) => Math.round(x * 10) / 10, round3 = (x: number) => Math.round(x * 1000) / 1000;

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  // Feature specialists reuse an existing policy, so the simulation plays only the ten player types.
  const personas = pick(a.personas).filter((p) => p.sim !== false);
  const seeds = Number(a.seeds ?? 8), blocks = Number(a.blocks ?? 6000);
  const out = reportDir(a);
  const all: PersonaSummary[] = [];
  console.log(`playtest:sim · ${personas.length} personas × ${seeds} seeds × ${blocks} blocks → ${out}`);
  for (const p of personas) {
    const runs: RunResult[] = [];
    for (let seed = 0; seed < seeds; seed++) runs.push(run(p, { blocks, seed }));
    const s = summarise(p, runs);
    all.push(s);
    const bad = s.gates.filter((g) => !g.ok);
    console.log(`${bad.some((g) => g.tier === 'hard') ? '✗' : bad.length ? '△' : '✓'} ${p.id.padEnd(14)} worth p50 ${String(s.worth.p50).padStart(6)} · rival ${String(s.rivalMax.p50).padStart(6)} · heg ${pct(s.hegemony.p50).padStart(4)} · engine ${s.engine.p50}/3 · raids lost ${pct(s.raids.lossShare).padStart(4)} · refused ${pct(s.rejectRate).padStart(4)} · idle ${pct(s.idleShare).padStart(4)} · ${s.blocksPerSecond} b/s`);
    for (const g of bad) console.log(`    ${g.tier === 'hard' ? '✗' : '△'} ${g.id}: ${g.detail}`);
  }
  const global = globalGates(all);
  for (const g of global) console.log(`${g.ok ? '✓' : '△'} ${g.id}: ${g.detail}`);
  writeJson(`${out}/sim.json`, { at: new Date().toISOString(), seeds, blocks, personas: all, global, profiles: PROFILES.filter((p) => personas.includes(p)) });
  const failed = [...all.flatMap((s) => s.gates), ...global].filter((g) => !g.ok);
  const hard = failed.filter((g) => g.tier === 'hard'), strict = a.strict === 'true';
  console.log(`\n${hard.length} hard gate(s) failed · ${failed.length - hard.length} design target(s) missed · ${out}/sim.json`);
  if ((hard.length || (strict && failed.length)) && a['no-gate'] !== 'true') process.exitCode = 1;
}
