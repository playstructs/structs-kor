/* 승률 예측: before a strike, play the fight out a number of times on the local chain (both sides on
 * the AI, yours on hard, as autopilot would fly it) and report how often it's won. Runs a battle per
 * tick so the page never stalls. */
import { Chain } from '../sim/chain';
import { Ai, type Difficulty } from '../sim/ai';
import { CPU, YOU, chainSetup, type Unit } from '../sim/fleets';

/** One fight to the end (or a hull decision when it stalls, as the simulator decides it). */
export function playOut(units: Unit[], diff: Difficulty, seed: string, charge = 10): 'player' | 'computer' | 'draw' {
  const c = new Chain(chainSetup(units, seed, { player: charge, computer: charge }).setup);
  const me = new Ai(YOU.id, 'hard', seed + ':you'), them = new Ai(CPU.id, diff, seed);
  let quiet = 0;
  for (let i = 0; i < 400; i++) {
    const a = me.decide(c); if (a) c.submit(YOU.id, a);
    const b = them.decide(c); if (b) c.submit(CPU.id, b);
    const blk = c.produceBlock();
    quiet = blk.txs.some((t) => t.events.some((e) => e.category === 'struct_attack')) ? 0 : quiet + 1;
    const fleets = c.fleetsAtBattle();
    if (fleets.length < 2) return fleets.includes(YOU.fleetId) ? 'player' : fleets.includes(CPU.fleetId) ? 'computer' : 'draw';
    if (quiet > 40) break;
  }
  const hull = (owner: string) => { const m = Object.values(c.structs).filter((s) => s.owner === owner); return m.reduce((t, s) => t + (c.isDestroyed(s) ? 0 : s.health), 0) / Math.max(1, m.reduce((t, s) => t + c.typeOf(s).maxHealth, 0)); };
  const p = hull(YOU.id), q = hull(CPU.id);
  return Math.abs(p - q) < 0.02 ? 'draw' : p > q ? 'player' : 'computer';
}

/** Estimate the win rate over `n` seeds; `onUpdate` gets the running figure. Returns a cancel. */
export function estimateOdds(units: Unit[], diff: Difficulty, n: number, onUpdate: (won: number, played: number) => void): () => void {
  let played = 0, won = 0, stop = false;
  const next = () => {
    if (stop || played >= n) return;
    if (playOut(units, diff, `odds:${played}`) === 'player') won++;
    played++;
    onUpdate(won, played);
    setTimeout(next, 0);
  };
  setTimeout(next, 0);
  return () => { stop = true; };
}
