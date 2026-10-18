/* The headless playtest engine: plays the demo base (src/game/demo.ts, the same code the browser
 * runs) for N blocks under one persona's policy and records everything a designer would ask about:
 * the economy curve, every order and why it was refused, raids, milestones, crashes and broken
 * invariants. The demo is deterministic per block height, so a (persona, seed) pair always replays
 * the same game; seeds shift the starting height, which reseeds every random stream. */
import { demo, withAllies, TECH, type Rival } from '../../src/game/demo';
import { playOut } from '../../src/game/odds';
import { layout } from '../../src/sim/fleets';
import { mulberry, hash32 } from '../../src/core/util';
import { checkInvariants, type Violation } from './invariants';
import type { Milestone, Profile } from '../profiles';
import { POLICIES } from './policies';

/** Same as src/screens/galaxy.ts (not importable headless: that module touches the DOM). */
export const raidSeed = (r: Rival) => `RAID-${r.id}-${r.raided}-${r.fleet}`;
export const rivalFleet = (r: Rival) => {
  const all = layout(r.fleet <= 4 ? 'easy' : r.fleet <= 8 ? 'difficult' : 'hard', raidSeed(r)).filter((u) => u.side === 'computer');
  return [...all.filter((u) => u.type === 1), ...all.filter((u) => u.type !== 1).slice(0, Math.max(1, r.fleet))];
};

/** Career XP is earned in the browser (src/game/progress.ts); headless we model its main sources so
 * rank-gated research and abilities unlock on a believable schedule. Same thresholds as the game. */
const RANK_XP = (i: number) => (i <= 0 ? 0 : Math.round(60 * Math.pow(i, 1.75)));
export const rankOf = (xp: number) => { let i = 0; while (i < 17 && xp >= RANK_XP(i + 1)) i++; return i; };

export interface Sample {
  b: number; alpha: number; ore: number; worth: number; rivalMax: number; hegemony: number; rank: number;
  repelled: number; lost: number; engine: number; era: number; income: number; research: number; vassals: number;
}
export interface Crash { b: number; action: string; message: string; stack?: string }
export interface RunResult {
  persona: string; seed: number; blocks: number; ms: number;
  samples: Sample[];
  final: Sample;
  milestones: Partial<Record<Milestone, number>>;
  actions: Record<string, { ok: number; refused: number; reasons: Record<string, number> }>;
  events: Record<string, number>;
  raidsMade: number; raidsWon: number;
  crashes: Crash[];
  violations: Violation[];
  spiral: { at: number; blocks: number } | null;
  /** Blocks in which the persona had nothing it could afford or wanted to do. */
  idle: number;
  /** Notable things the policy saw (first time each), for the narrative report. */
  story: { b: number; text: string }[];
}

export interface Ctx {
  demo: typeof demo;
  b: number;
  /** Persona's own dice (decisions), seeded per run. */
  rng: () => number;
  rank: number;
  /** Issue an order; refused orders and exceptions are recorded, never thrown. */
  act: (name: string, f: () => unknown) => boolean;
  /** Counter-raid a rival with the demo fleet, fought out on the local chain. */
  strike: (rivalId: string) => boolean | null;
  note: (text: string) => void;
}

export interface RunOpts { blocks: number; seed: number; sampleEvery?: number; invariantsEvery?: number }

export function run(p: Profile, opts: RunOpts): RunResult {
  const t0 = performance.now();
  const policy = POLICIES[p.policy];
  demo.reset();
  const s = demo.state;
  s.height += opts.seed * 9973; // reseeds every per-block stream
  const res: RunResult = {
    persona: p.id, seed: opts.seed, blocks: opts.blocks, ms: 0, samples: [], final: null as unknown as Sample,
    milestones: {}, actions: {}, events: {}, raidsMade: 0, raidsWon: 0, crashes: [], violations: [], spiral: null, idle: 0, story: [],
  };
  const off = demo.onEvent((kind) => { res.events[kind] = (res.events[kind] ?? 0) + 1; });
  let xp = 0, lastRepelled = 0, b = 0, actedThisBlock = false, broke = 0;
  const seen = new Set<string>();
  const rng = mulberry(hash32(`${p.id}:${opts.seed}`));
  const ctx: Ctx = {
    demo, b: 0, rng, rank: 0,
    act(name, f) {
      const a = (res.actions[name] ??= { ok: 0, refused: 0, reasons: {} });
      try {
        const r = f();
        // Orders answer null when done, or the reason they were refused.
        if (typeof r === 'string') { a.refused++; const k = normalise(r); a.reasons[k] = (a.reasons[k] ?? 0) + 1; return false; }
        a.ok++; actedThisBlock = true; return true;
      } catch (e) {
        const err = e as Error;
        res.crashes.push({ b, action: name, message: err?.message ?? String(e), stack: err?.stack?.split('\n').slice(0, 6).join('\n') });
        return false;
      }
    },
    strike(rivalId) {
      const r = demo.rivals().find((x) => x.id === rivalId);
      if (!r || r.vassal != null || demo.ally?.id === r.id) return null;
      const mine = demo.fleetUnits().units;
      if (!mine.some((u) => u.type !== 1)) return null;
      const units = [...withAllies(mine), ...rivalFleet(r)];
      const diff = r.fleet <= 4 ? 'easy' : r.fleet <= 7 ? 'difficult' : 'hard';
      let won = false;
      try { won = playOut(units, diff, raidSeed(r)) === 'player'; } catch (e) { res.crashes.push({ b, action: 'strike.playOut', message: (e as Error).message }); return null; }
      const ok = ctx.act('strike', () => { demo.settleRaid(r.id, won, {}); });
      if (!ok) return null;
      res.raidsMade++;
      if (won) { res.raidsWon++; xp += 80 + r.fleet * 10; }
      return won;
    },
    note(text) { if (!seen.has(text)) { seen.add(text); res.story.push({ b, text }); } },
  };

  const mark = (m: Milestone, cond: boolean) => { if (cond && res.milestones[m] == null) res.milestones[m] = b; };
  let poorFor = 0;
  for (b = 1; b <= opts.blocks; b++) {
    ctx.b = b; ctx.rank = rankOf(xp); actedThisBlock = false;
    try { policy(ctx); } catch (e) { res.crashes.push({ b, action: 'policy', message: (e as Error).message, stack: (e as Error).stack?.split('\n').slice(0, 6).join('\n') }); }
    try { demo.step(); } catch (e) { res.crashes.push({ b, action: 'step', message: (e as Error).message, stack: (e as Error).stack?.split('\n').slice(0, 6).join('\n') }); if (++broke > 5) break; }
    if (!actedThisBlock) res.idle++;
    // XP sources the browser awards: repelled raids, hegemony titles, and steady objective/daily trickle.
    const st = demo.state;
    if (st.raidsRepelled > lastRepelled) { xp += 40 * (st.raidsRepelled - lastRepelled); lastRepelled = st.raidsRepelled; }
    if (b % 25 === 0) xp += 5;

    const rates = demo.rates();
    if (st.alpha < 1 && rates.alpha <= 1e-3 && rates.ore <= 1e-3) poorFor++; else poorFor = 0;
    if (poorFor >= 300 && !res.spiral) res.spiral = { at: b - 300, blocks: 300 };
    if (res.spiral && poorFor > 0 && res.spiral.at === b - poorFor) res.spiral.blocks = poorFor;

    mark('refineryOnline', st.structs.some((x) => x.type === 15 && x.online && x.building == null && x.hp > 0));
    mark('firstResearch', TECH.some((t) => demo.level(t.id) > 0));
    mark('firstRepel', st.raidsRepelled > 0);
    mark('firstRaidWon', res.raidsWon > 0);
    mark('firstVassal', demo.rivals().some((r) => r.vassal != null));
    mark('tier1', demo.hegemonyTier >= 1); mark('tier2', demo.hegemonyTier >= 2); mark('tier3', demo.hegemonyTier >= 3);
    mark('engine1', demo.engine.stage >= 1); mark('engine2', demo.engine.stage >= 2); mark('engine3', demo.engine.stage >= 3);
    mark('newEra', demo.era >= 1);
    mark('rank5', ctx.rank >= 5); mark('rank10', ctx.rank >= 10);

    if (b % (opts.invariantsEvery ?? 10) === 0 || b === opts.blocks) {
      for (const v of checkInvariants(demo, b)) if (!res.violations.some((x) => x.id === v.id)) res.violations.push(v);
    }
    if (b % (opts.sampleEvery ?? 50) === 0 || b === opts.blocks) res.samples.push(sample(b, rankOf(xp)));
  }
  off();
  res.final = sample(Math.min(b, opts.blocks), rankOf(xp));
  res.ms = Math.round(performance.now() - t0);
  return res;
}

function sample(b: number, rank: number): Sample {
  const s = demo.state;
  const rivals = demo.rivals();
  return {
    b, alpha: round(s.alpha), ore: Math.floor(s.ore), worth: Math.round(demo.netWorth()),
    rivalMax: Math.round(Math.max(0, ...rivals.map((r) => demo.rivalWorth(r)))), hegemony: round(demo.hegemony()), rank,
    repelled: s.raidsRepelled, lost: s.raidsLost, engine: demo.engine.stage, era: demo.era, income: round(demo.rates().alpha, 4),
    research: TECH.reduce((a, t) => a + demo.level(t.id), 0), vassals: rivals.filter((r) => r.vassal != null).length,
  };
}
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
/** Group refusal reasons: numbers vary, the sentence doesn't. */
const normalise = (r: string) => r.replace(/[\d.]+/g, '#').slice(0, 80);
