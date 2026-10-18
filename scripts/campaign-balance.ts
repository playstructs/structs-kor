/* Campaign balance: play every mission N times with the hard AI flying your side and print win
 * rates (stalls decided on hull, as the simulator does). `pnpm balance [N]`. */
import { MISSIONS, missionUnits } from '../src/game/campaign';
import { chainSetup, YOU, CPU } from '../src/sim/fleets';
import { Chain } from '../src/sim/chain';
import { Ai } from '../src/sim/ai';

const N = Number(process.argv[2] || 30);
for (const m of MISSIONS) {
  let win = 0, loss = 0, draw = 0, blocks = 0;
  for (let k = 0; k < N; k++) {
    const seed = `BAL-${m.id}-${k}`;
    const c = new Chain(chainSetup(missionUnits(m), seed, { player: m.charge, computer: m.charge }).setup);
    const me = new Ai(YOU.id, 'hard', seed + ':me'), them = new Ai(CPU.id, m.difficulty, seed);
    let quiet = 0, b = 0, res: 'win' | 'loss' | 'draw' = 'draw', decided = false;
    for (; b < 400 && quiet <= 40; b++) {
      for (const [ai, id] of [[me, YOU.id], [them, CPU.id]] as const) { const x = ai.decide(c); if (x) c.submit(id, x); }
      const blk = c.produceBlock();
      quiet = blk.txs.some((t) => t.ok && t.events.some((e) => e.category === 'struct_attack')) ? 0 : quiet + 1;
      const f = c.fleetsAtBattle();
      if (f.length < 2) { res = f.includes(YOU.fleetId) ? 'win' : f.includes(CPU.fleetId) ? 'loss' : 'draw'; decided = true; break; }
    }
    if (!decided) {
      const hull = (o: string) => { const xs = Object.values(c.structs).filter((x) => x.owner === o); return xs.reduce((t, x) => t + (c.isDestroyed(x) ? 0 : x.health), 0) / Math.max(1, xs.reduce((t, x) => t + c.typeOf(x).maxHealth, 0)); };
      const a = hull(YOU.id), z = hull(CPU.id);
      res = Math.abs(a - z) < 0.02 ? 'draw' : a > z ? 'win' : 'loss';
    }
    blocks += b;
    if (res === 'win') win++; else if (res === 'loss') loss++; else draw++;
  }
  console.log(`${m.id} ${m.title}: 승 ${win} · 패 ${loss} · 무 ${draw} · 평균 ${Math.round(blocks / N)}블록`);
}
