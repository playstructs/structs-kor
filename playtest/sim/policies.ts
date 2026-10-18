/* Persona policies: how each playtest profile plays the demo base, one call per block. They use
 * only the orders the browser offers (src/game/demo.ts's public API), and they play the way that
 * person would — including the mistakes. Orders go through ctx.act so refusals are counted. */
import { TECH, ABILITIES, REFITS, OUTPOSTS, type TechId, type AbilityId, type RefitId, type BlackId, type Stance, type DoctrineId } from '../../src/game/demo';
import { TYPES_BY_ID } from '../../src/data/catalogue';
import type { PolicyId } from '../profiles';
import type { Ctx } from './engine';

type Policy = (c: Ctx) => void;
const AMBITS = ['space', 'air', 'land', 'water'] as const;
const BIT = { space: 16, air: 8, land: 4, water: 2 } as const;

/* ── Shared habits ── */

const st = (c: Ctx) => c.demo.state;
const live = (_c: Ctx, x: { hp: number; building: number | null }) => x.hp > 0 && x.building == null;

/** Turn machines back on, the way the power switch does, when there is room on the grid. */
function keepRunning(c: Ctx, types = [20, 14, 15], careful = true) {
  for (const x of st(c).structs) {
    if (!types.includes(x.type) || x.online || !live(c, x)) continue;
    if (careful && x.type !== 20 && c.demo.structsKw() + c.demo.soldKw() + 0.7 > c.demo.capacityKw()) continue;
    c.act('toggle', () => c.demo.toggle(x.id));
  }
}
function repair(c: Ctx, budget: number) {
  for (const x of st(c).structs) if (x.hp < x.max && c.demo.repairCost(x.id) <= st(c).alpha * budget) c.act('repair', () => c.demo.repair(x.id));
}
function research(c: Ctx, order: TechId[] | null, reserve = 2) {
  const pool = TECH.filter((t) => c.demo.level(t.id) < t.max && t.rank <= c.rank && (!order || order.includes(t.id)));
  const sorted = order ? pool.sort((a, z) => order.indexOf(a.id) - order.indexOf(z.id)) : pool.sort((a, z) => a.cost[c.demo.level(a.id)] - z.cost[c.demo.level(z.id)]);
  const t = sorted[0];
  if (t && st(c).alpha >= t.cost[c.demo.level(t.id)] * reserve) c.act('research', () => c.demo.research(t.id, c.rank));
}
function sellSpare(c: Ctx, share = 1, blocks = 40) {
  const spare = c.demo.sellableKw();
  if (spare > 0.3 && c.demo.contracts.filter((x) => x.dir !== 'buy').length < 3) c.act('sell', () => c.demo.sell(Math.min(4, Math.floor(spare * share * 10) / 10), blocks));
}
function stance(c: Ctx, want: Stance) {
  const r = st(c).raid;
  if (r && r.eta > 0 && !r.stance) c.act('stance', () => c.demo.setStance(want));
}
function ability(c: Ctx, id: AbilityId) {
  const a = ABILITIES.find((x) => x.id === id)!;
  if (c.rank >= a.rank && c.demo.abilityLeft(id) === 0) c.act(`ability.${id}`, () => c.demo.useAbility(id, c.rank));
}
/** Build `type` in the first legal free slot, if the grid has room. */
function buildOne(c: Ctx, type: number, cat: 'planet' | 'fleet' = 'planet') {
  const t = TYPES_BY_ID[type];
  for (const a of AMBITS) {
    if (((t.possibleAmbit ?? 30) & BIT[a]) === 0) continue;
    for (let slot = 0; slot < 4; slot++) {
      if (st(c).structs.some((x) => x.cat === cat && x.ambit === a && x.slot === slot && x.hp > 0 && x.type !== 1)) continue;
      return c.act(`build.${type}`, () => c.demo.build(type, a, slot, cat));
    }
  }
  return false;
}
function vassals(c: Ctx, disarmAt = 0.3) {
  for (const r of c.demo.rivals()) {
    if (r.vassal == null && r.raided >= 3) c.act('subjugate', () => c.demo.subjugate(r.id));
    if (r.vassal != null && c.demo.loyalty(r) < disarmAt && st(c).alpha > 15) c.act('disarm', () => c.demo.disarm(r.id));
  }
}
function engine(c: Ctx, keep: number) {
  const left = st(c).alpha - keep;
  if (!c.demo.engine.done && left > 10) c.act('engine', () => c.demo.buildEngine(Math.floor(left)));
  if (c.demo.engine.done && !st(c).raid && !c.demo.loan) c.act('newEra', () => c.demo.newEra());
}
const freeRivals = (c: Ctx) => c.demo.rivals().filter((r) => r.vassal == null && c.demo.pactLeft(r.id) === 0 && c.demo.ally?.id !== r.id);
const hasWarships = (c: Ctx) => st(c).structs.some((x) => x.cat === 'fleet' && x.type !== 1 && x.hp > 0);
const researchLeft = (c: Ctx) => TECH.some((t) => c.demo.level(t.id) < t.max && t.rank <= c.rank);

/* ── The ten ── */

export const POLICIES: Record<PolicyId, Policy> = {
  /** Plays in short bursts with long gaps; finds the refinery switch eventually; never reads research. */
  newcomer(c) {
    const session = Math.floor(c.b / 600), inSession = c.b % 600 < 90; // ~90 blocks (6 min) a session, then away
    if (!inSession) return;
    if (c.rng() > 0.15) return; // taps something every few blocks
    if (session >= 0 && c.b % 600 > 30) keepRunning(c, [15], false); // the glowing refinery, without checking power
    if (c.rng() < 0.3) research(c, ['mine', 'refine'], 1.2);
    if (c.rng() < 0.2) sellSpare(c, 0.5);
    if (c.demo.decision && c.rng() < 0.5) c.act('decide', () => c.demo.decide(c.rng() < 0.5 ? 0 : 1));
    if (st(c).raid && st(c).raid!.eta > 0 && c.rng() < 0.3) stance(c, c.rng() < 0.5 ? 'intercept' : 'entrench');
    if (c.demo.report && c.rng() < 0.5) c.act('dismissReport', () => c.demo.dismissReport());
  },

  /** Everything running, overclocked, researched in ROI order; builds out the planet; then the engine. */
  industrialist(c) {
    if (c.b === 1) c.act('adopt', () => c.demo.adopt('industry'));
    keepRunning(c);
    for (const x of st(c).structs) if ([14, 15, 20].includes(x.type) && x.online && !x.oc && live(c, x) && x.hp === x.max && c.demo.structsKw() + c.demo.soldKw() + 0.5 < c.demo.capacityKw()) c.act('overclock', () => c.demo.overclock(x.id));
    repair(c, 0.4);
    research(c, ['refine', 'mine', 'grid', 'trade', 'bunker', 'shield', 'guns'], 1.5);
    if (c.b % 20 === 0 && st(c).alpha > 12) {
      const counts = (t: number) => st(c).structs.filter((x) => x.type === t && x.hp > 0).length;
      const want = counts(20) <= counts(14) + counts(15) - 2 ? 20 : counts(15) < counts(14) ? 15 : 14;
      buildOne(c, want);
    }
    if (c.demo.structsKw() + c.demo.soldKw() > c.demo.capacityKw() * 0.85 && st(c).alpha > 8) c.act('infuse', () => c.demo.infuse(2));
    if (c.b % 10 === 0) sellSpare(c, 0.5);
    stance(c, 'entrench');
    ability(c, 'surge');
    for (const r of c.demo.reps) if (!r.on && r.id !== 'trader' && st(c).alpha > r.hire * 4) c.act('hire', () => c.demo.hire(r.id));
    if (!researchLeft(c)) engine(c, 30);
  },

  /** Fleet first, raids constantly, intercepts, makes vassals, sabotages the strongest. */
  warlord(c) {
    if (c.b === 1) c.act('adopt', () => c.demo.adopt('war'));
    keepRunning(c);
    repair(c, 0.6);
    research(c, ['guns', 'refine', 'mine', 'shield', 'spy', 'fort', 'diplo'], 1.3);
    stance(c, 'intercept');
    if (st(c).raid && st(c).raid!.eta === 0) { ability(c, 'rally'); ability(c, 'strike'); }
    if (c.b % 30 === 0 && st(c).alpha > 10) { for (const [t] of [[3], [5], [9], [12]] as const) if (buildOne(c, t, 'fleet')) break; }
    if (c.b % 50 === 0 && hasWarships(c) && !st(c).raid) {
      const rev = c.demo.revenge, bounty = c.demo.bounty;
      const target = (rev && freeRivals(c).find((r) => r.id === rev.rival)) || (bounty && freeRivals(c).find((r) => r.id === bounty.target)) || freeRivals(c).sort((a, z) => a.fleet - z.fleet)[0];
      if (target) { const won = c.strike(target.id); if (won) c.note(`raided ${target.name} and won`); else if (won === false) c.note(`raid on ${target.name} failed`); }
    }
    vassals(c, 0.4);
    if (c.b % 100 === 50) { const strong = freeRivals(c).sort((a, z) => z.fleet - a.fleet)[0]; if (strong && st(c).alpha > 20) c.act('covert.sabotage', () => c.demo.covert(strong.id, 'sabotage')); }
    for (const x of st(c).structs) if (x.cat === 'fleet' && x.type !== 1 && x.hp > 0 && !x.mod && st(c).alpha > 25) { c.act('refit', () => c.demo.refit(x.id, 'guns')); break; }
    if (c.b % 10 === 0) sellSpare(c, 0.3);
    if (c.demo.decision) c.act('decide', () => c.demo.decide(0));
    if (!researchLeft(c)) engine(c, 40);
  },

  /** Sells every spare watt, buys in a crash, delivers contracts, borrows when it pays, invests. */
  trader(c) {
    if (c.b === 1) c.act('adopt', () => c.demo.adopt('trade'));
    keepRunning(c);
    repair(c, 0.3);
    research(c, ['refine', 'trade', 'mine', 'grid', 'bunker'], 1.5);
    sellSpare(c, 1, 30);
    const hist = c.demo.priceHist, avg = hist.reduce((a, x) => a + x, 0) / hist.length;
    if (c.demo.price < avg * 0.8 && st(c).alpha > 10 && c.b % 15 === 0) c.act('buy', () => c.demo.buy(1, 30));
    const jobs = c.demo.jobs;
    if (jobs && !jobs.active) for (const j of jobs.offers) if (j.kind === 'deliver' && st(c).ore >= j.need) { c.act('takeJob', () => c.demo.takeJob(j.id)); break; }
    if (!c.demo.loan && st(c).alpha < 15 && st(c).alpha > 3 && c.b > 100 && c.b % 200 === 0) c.act('borrow', () => c.demo.borrow(20));
    if (c.demo.loan && st(c).alpha > c.demo.loan.owed * 1.5) c.act('repay', () => c.demo.repay());
    if (c.b % 150 === 0 && st(c).alpha > 60) { const r = c.demo.rivals().filter((x) => x.vassal == null).sort((a, z) => z.growth - a.growth)[0]; if (r) c.act('invest', () => c.demo.invest(r.id, 20)); }
    const bm = c.demo.black;
    for (const o of bm.offers) if (o.id === 'scrap' && st(c).ore > 30 && st(c).alpha > o.price) c.act('black.scrap', () => c.demo.buyBlack(o.id));
    stance(c, 'entrench');
    if (c.demo.decision) c.act('decide', () => c.demo.decide(c.demo.decision!.id === 'orebuyer' || c.demo.decision!.id === 'smuggler' ? 0 : 1));
    for (const r of c.demo.reps) if (r.id === 'trader' && !r.on && st(c).alpha > r.hire * 3) c.act('hire', () => c.demo.hire(r.id));
    if (!researchLeft(c)) engine(c, 50);
  },

  /** Shields, entrench, overcharge, fortify outposts, refit for evasion; never attacks. */
  turtle(c) {
    if (c.b === 1) c.act('adopt', () => c.demo.adopt('industry'));
    keepRunning(c);
    repair(c, 0.8);
    research(c, ['shield', 'refine', 'mine', 'bunker', 'grid', 'guns', 'fort'], 1.2);
    stance(c, 'entrench');
    if (st(c).raid && st(c).raid!.eta > 0 && st(c).shield < 70) ability(c, 'overshield');
    if (st(c).raid && st(c).raid!.eta === 0) ability(c, 'rally');
    if (c.b % 40 === 0 && !st(c).structs.some((x) => x.type === 16 && x.hp > 0) && st(c).alpha > 15) buildOne(c, 16);
    for (const x of st(c).structs) if (x.cat === 'fleet' && x.type !== 1 && x.hp > 0 && !x.mod && st(c).alpha > 20) { c.act('refit', () => c.demo.refit(x.id, 'evade')); break; }
    if (c.b % 100 === 0) for (const o of c.demo.outposts) {
      if (!o.mine && o.id === 'bastion' && o.odds > 0.6 && st(c).alpha > 25) c.act('outpost.claim', () => c.demo.claimOutpost(o.id));
      if (o.mine && st(c).alpha > 30) c.act('outpost.fortify', () => c.demo.fortify(o.id));
    }
    for (const o of c.demo.black.offers) if ((o.id === 'shield' && st(c).shield < 40) || (o.id === 'patch' && st(c).structs.some((x) => x.hp > 0 && x.hp < x.max))) if (st(c).alpha > o.price * 2) c.act(`black.${o.id}`, () => c.demo.buyBlack(o.id));
    if (c.b % 10 === 0) sellSpare(c, 0.4);
    if (c.demo.decision) c.act('decide', () => c.demo.decide(1));
    if (!researchLeft(c)) engine(c, 40);
  },

  /** Guild on day one, donations, alliances, every decision answered, defence contracts. */
  diplomat(c) {
    if (c.b === 1) { c.act('joinGuild', () => c.demo.joinGuild('blue')); c.act('adopt', () => c.demo.adopt('trade')); }
    // Long absences: away for 500 blocks after every 300 played (catch-up is the browser's job; here the base just runs).
    if (c.b % 800 >= 300) return;
    keepRunning(c);
    repair(c, 0.4);
    research(c, ['refine', 'mine', 'diplo', 'trade', 'shield'], 1.5);
    if (c.b % 50 === 0 && st(c).alpha > 15) c.act('donate', () => c.demo.donate(3));
    if (!c.demo.ally && c.b % 60 === 0 && st(c).alpha > 25) { const r = freeRivals(c).filter((x) => x.name !== '붉은 연합').sort((a, z) => z.fleet - a.fleet)[0]; if (r) c.act('alliance', () => c.demo.formAlliance(r.id)); }
    if (c.demo.decision) c.act('decide', () => c.demo.decide(c.demo.decision!.id === 'pact' ? 0 : c.rng() < 0.5 ? 0 : 1));
    const jobs = c.demo.jobs;
    if (jobs && !jobs.active) for (const j of jobs.offers) if (j.kind === 'defend') { c.act('takeJob', () => c.demo.takeJob(j.id)); break; }
    stance(c, c.rng() < 0.5 ? 'entrench' : 'intercept');
    if (c.b % 10 === 0) sellSpare(c, 0.6);
    for (const r of c.demo.reps) if (!r.on && st(c).alpha > r.hire * 3) c.act('hire', () => c.demo.hire(r.id));
    vassals(c);
    if (!researchLeft(c)) engine(c, 40);
  },

  /** Tries every system in rotation, then the engine and a new era. */
  completionist(c) {
    keepRunning(c);
    repair(c, 0.5);
    research(c, null, 1.3);
    if (c.b % 10 === 0) sellSpare(c, 0.5);
    stance(c, c.b % 2 ? 'entrench' : 'intercept');
    for (const a of ABILITIES) if ((a.id === 'surge') || (st(c).raid && (a.id !== 'strike' || st(c).raid!.eta === 0))) ability(c, a.id);
    if (c.demo.decision) c.act('decide', () => c.demo.decide(c.b % 2));
    vassals(c);
    const step = Math.floor(c.b / 37) % 14, a = st(c).alpha;
    if (c.b % 37 !== 0) return;
    switch (step) {
      case 0: if (!c.demo.doctrine) c.act('adopt', () => c.demo.adopt((['industry', 'war', 'trade'] as DoctrineId[])[c.b % 3])); break;
      case 1: if (!c.demo.guild) c.act('joinGuild', () => c.demo.joinGuild('gold')); else if (a > 10) c.act('donate', () => c.demo.donate(2)); break;
      case 2: if (hasWarships(c)) { const r = freeRivals(c).sort((x, z) => x.fleet - z.fleet)[0]; if (r) c.strike(r.id); } break;
      case 3: if (a > 15) buildOne(c, [14, 15, 20, 16][c.b % 4]); break;
      case 4: { const r = freeRivals(c)[0]; if (r && a > 10) c.act('covert.heist', () => c.demo.covert(r.id, 'heist')); break; }
      case 5: { const o = OUTPOSTS[c.b % 3]; if (a > 20) c.act('outpost.claim', () => c.demo.claimOutpost(o.id)); break; }
      case 6: if (!c.demo.ally && a > 20) { const r = freeRivals(c).find((x) => x.name !== '붉은 연합'); if (r) c.act('alliance', () => c.demo.formAlliance(r.id)); } break;
      case 7: { const j = c.demo.jobs; if (j && !j.active && j.offers[0]) c.act('takeJob', () => c.demo.takeJob(j.offers[0].id)); break; }
      case 8: { const o = c.demo.black.offers[0]; if (o && a > o.price * 2) c.act(`black.${o.id}`, () => c.demo.buyBlack(o.id)); break; }
      case 9: if (!c.demo.loan && a > 5) c.act('borrow', () => c.demo.borrow(20)); else if (c.demo.loan) c.act('repay', () => c.demo.repay()); break;
      case 10: { const r = c.demo.rivals()[1]; if (r && a > 40) c.act('invest', () => c.demo.invest(r.id, 10)); break; }
      case 11: { const x = st(c).structs.find((y) => y.cat === 'fleet' && y.type !== 1 && y.hp > 0 && !y.mod); const m = (Object.keys(REFITS) as RefitId[])[c.b % 3]; if (x && a > 15) c.act('refit', () => c.demo.refit(x.id, m)); break; }
      case 12: for (const r of c.demo.reps) if (!r.on && a > r.hire * 2) { c.act('hire', () => c.demo.hire(r.id)); break; } break;
      case 13: if (!researchLeft(c)) engine(c, 30); break;
    }
  },

  /** Shortest route to the World Engine: economy research only, overclock, sell, pour alpha in. */
  speedrunner(c) {
    if (c.b === 1) c.act('adopt', () => c.demo.adopt('industry'));
    keepRunning(c);
    for (const x of st(c).structs) if ([14, 15].includes(x.type) && x.online && !x.oc && live(c, x) && c.demo.structsKw() + c.demo.soldKw() + 0.5 < c.demo.capacityKw()) c.act('overclock', () => c.demo.overclock(x.id));
    repair(c, 0.2);
    const econ = TECH.filter((t) => ['mine', 'refine', 'grid'].includes(t.id) && c.demo.level(t.id) < t.max && t.rank <= c.rank);
    if (econ.length) research(c, ['refine', 'mine', 'grid'], 1);
    else engine(c, 5);
    ability(c, 'surge');
    sellSpare(c, 1, 20);
    if (c.demo.structsKw() > c.demo.capacityKw() * 0.9 && st(c).alpha > 4) c.act('infuse', () => c.demo.infuse(2));
    stance(c, 'entrench');
    if (c.demo.decision) c.act('decide', () => c.demo.decide(0));
    for (const o of c.demo.black.offers) if (o.id === 'scrap' && st(c).ore > 10) c.act('black.scrap', () => c.demo.buyBlack(o.id));
  },

  /** Plays only what the keyboard reaches on the bridge: power (F), overclock (V), repair (R),
   * infuse (I), stance (A/S), abilities (7–0), decisions (1/2). Menus by hotkey: research (U). */
  accessibility(c) {
    if (c.rng() > 0.35) return; // slower: one action every few blocks
    keepRunning(c, [20, 14, 15], true);
    repair(c, 0.5);
    if (c.b % 30 === 0) research(c, ['refine', 'mine', 'shield', 'grid'], 1.5);
    if (c.demo.structsKw() > c.demo.capacityKw() * 0.9 && st(c).alpha > 6) c.act('infuse', () => c.demo.infuse(2));
    stance(c, 'entrench');
    if (st(c).raid) ability(c, 'overshield');
    ability(c, 'surge');
    if (c.demo.decision) c.act('decide', () => c.demo.decide(0));
    if (!researchLeft(c) && c.b % 50 === 0) engine(c, 40);
  },

  /** Fuzzer: random orders with hostile arguments. Refusals are expected; crashes and broken
   * invariants are the findings. */
  chaos(c) {
    const r = c.rng, s = st(c);
    const junkNum = () => [-1, 0, NaN, Infinity, -Infinity, 1e12, 0.0001, -0.5, 3.7, 2 ** 31][Math.floor(r() * 10)];
    const anyId = () => (r() < 0.6 && s.structs.length ? s.structs[Math.floor(r() * s.structs.length)].id : ['', 'x', '5-999999', '__proto__', '1-0', null as unknown as string][Math.floor(r() * 6)]);
    const anyRival = () => (r() < 0.6 ? c.demo.rivals()[Math.floor(r() * c.demo.rivals().length)]?.id ?? '' : ['', 'void', 'nope', '1-0'][Math.floor(r() * 4)]);
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const pickAction = Math.floor(r() * 26);
      switch (pickAction) {
        case 0: c.act('chaos.toggle', () => c.demo.toggle(anyId())); break;
        case 1: c.act('chaos.overclock', () => c.demo.overclock(anyId())); break;
        case 2: c.act('chaos.repair', () => c.demo.repair(anyId())); break;
        case 3: c.act('chaos.infuse', () => c.demo.infuse(junkNum())); break;
        case 4: c.act('chaos.sell', () => c.demo.sell(junkNum(), junkNum())); break;
        case 5: c.act('chaos.buy', () => c.demo.buy(junkNum(), junkNum())); break;
        case 6: c.act('chaos.build', () => c.demo.build([1, 2, 3, 14, 15, 16, 20, 22, 99][Math.floor(r() * 9)], AMBITS[Math.floor(r() * 4)], Math.floor(r() * 6) - 1, r() < 0.5 ? 'planet' : 'fleet')); break;
        case 7: c.act('chaos.research', () => c.demo.research(TECH[Math.floor(r() * TECH.length)].id, Math.floor(r() * 20))); break;
        case 8: c.act('chaos.ability', () => c.demo.useAbility(ABILITIES[Math.floor(r() * 4)].id, 17)); break;
        case 9: c.act('chaos.stance', () => c.demo.setStance(r() < 0.5 ? 'intercept' : 'entrench')); break;
        case 10: c.act('chaos.invest', () => c.demo.invest(anyRival(), junkNum())); break;
        case 11: c.act('chaos.divest', () => c.demo.divest(anyRival())); break;
        case 12: c.act('chaos.covert', () => c.demo.covert(anyRival(), r() < 0.5 ? 'sabotage' : 'heist')); break;
        case 13: c.act('chaos.alliance', () => c.demo.formAlliance(anyRival())); break;
        case 14: c.act('chaos.claim', () => c.demo.claimOutpost((['asteroid', 'relay', 'bastion', 'moon'] as const)[Math.floor(r() * 4)] as 'relay')); break;
        case 15: c.act('chaos.fortify', () => c.demo.fortify(OUTPOSTS[Math.floor(r() * 3)].id)); break;
        case 16: c.act('chaos.borrow', () => c.demo.borrow(junkNum())); break;
        case 17: c.act('chaos.repay', () => c.demo.repay()); break;
        case 18: c.act('chaos.donate', () => c.demo.donate(junkNum())); break;
        case 19: c.act('chaos.engine', () => c.demo.buildEngine(junkNum())); break;
        case 20: c.act('chaos.decide', () => c.demo.decide(Math.floor(r() * 5) - 1)); break;
        case 21: c.act('chaos.subjugate', () => c.demo.subjugate(anyRival())); break;
        case 22: c.act('chaos.black', () => c.demo.buyBlack((['shield', 'bribe', 'scrap', 'cool', 'patch', 'gold'] as BlackId[])[Math.floor(r() * 6)])); break;
        case 23: c.act('chaos.refit', () => c.demo.refit(anyId(), (['armor', 'guns', 'evade', 'laser'] as RefitId[])[Math.floor(r() * 4)])); break;
        case 24: c.act('chaos.name', () => c.demo.nameShip(anyId(), ['', 'A'.repeat(500), '<img src=x onerror=alert(1)>', '사령관', '\u0000'][Math.floor(r() * 5)])); break;
        case 25: c.act('chaos.adopt', () => c.demo.adopt((['industry', 'war', 'trade', 'zen'] as DoctrineId[])[Math.floor(r() * 4)])); break;
      }
    }
    if (r() < 0.02) c.act('chaos.strike', () => { c.strike(anyRival()); return null; });
    if (r() < 0.005) c.act('chaos.newEra', () => c.demo.newEra());
  },
};
