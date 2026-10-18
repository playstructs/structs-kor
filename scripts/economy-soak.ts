/* Economy soak: a scripted, sensible player runs the demo base for N blocks; prints the curve of
 * alpha, net worth against the strongest rival, raids won and lost, and events seen. Looks for
 * runaway growth or death spirals. `pnpm soak [blocks]`. */
import { demo, TECH } from '../src/game/demo';

const N = Number(process.argv[2] || 6000);
demo.reset();
const s = demo.state;
demo.joinGuild('blue');
demo.adopt((process.argv[3] as 'industry' | 'war' | 'trade') || 'trade');
// Hire the whole staff once it's affordable.
const hireAll = () => { for (const r of demo.reps) if (!r.on && s.alpha > r.hire * 3) demo.hire(r.id); };
let bounties = 0, raidsMade = 0, decisions = 0;
const won = (b: number) => (b * 2654435761) % 100 < 60; // a 60% raider, deterministic
const events: Record<string, number> = {};
let lastEvent = '';
const rows: string[] = [];
const best = () => Math.max(...demo.rivals().map((r) => demo.rivalWorth(r)));

for (let b = 1; b <= N; b++) {
  // Keep refineries and extractors running.
  for (const x of s.structs) if ((x.type === 15 || x.type === 14) && !x.online && x.building == null && x.hp > 0) demo.toggle(x.id);
  // Repair what raids broke, if we can.
  for (const x of s.structs) if (x.hp < x.max && demo.repairCost(x.id) < s.alpha * 0.3) demo.repair(x.id);
  // Research the cheapest available step when rich.
  const next = TECH.filter((t) => demo.level(t.id) < t.max && t.rank <= 6).sort((a, z) => a.cost[demo.level(a.id)] - z.cost[demo.level(z.id)])[0];
  if (next && s.alpha > next.cost[demo.level(next.id)] * 2) demo.research(next.id, 6);
  // Sell half of what's spare; donate a little.
  const spare = demo.sellableKw();
  if (spare > 0.5 && demo.contracts.length < 3) demo.sell(Math.min(4, Math.round(spare * 5) / 10), 40);
  if (s.alpha > 30 && b % 50 === 0) demo.donate(5);
  // Past research, the World Engine is where alpha goes.
  if (!next && s.alpha > 60) demo.buildEngine(s.alpha - 40);
  // Grow capacity when the grid is tight.
  if (demo.structsKw() + demo.soldKw() > demo.capacityKw() * 0.85 && s.alpha > 6) demo.infuse(2);
  // Answer decisions with the first choice when we can afford it.
  if (demo.decision && demo.decision.choices[0].ok !== false && !demo.decide(0)) decisions++;
  // Strike back every 120 blocks: the bounty target if there is one, else the weakest free rival.
  if (b % 120 === 0) {
    const free = demo.rivals().filter((r) => r.vassal == null && demo.pactLeft(r.id) === 0);
    const t = demo.bounty ? demo.rivals().find((r) => r.id === demo.bounty!.target) : free.sort((a, z) => a.fleet - z.fleet)[0];
    if (t && t.vassal == null) { const had = !!demo.bounty; demo.settleRaid(t.id, won(b), {}); raidsMade++; if (had && !demo.bounty) bounties++; }
  }
  // Make vassals of the thrice-raided; keep them disarmed.
  for (const r of demo.rivals()) { if (r.vassal == null && r.raided >= 3) demo.subjugate(r.id); if (r.vassal != null && demo.loyalty(r) < 0.3 && s.alpha > 20) demo.disarm(r.id); }
  hireAll();
  demo.step();
  const e = s.event?.id ?? '';
  if (e && e !== lastEvent) events[e] = (events[e] ?? 0) + 1;
  lastEvent = e;
  if (b % (N / 12) === 0) rows.push(`${String(b).padStart(6)} | α ${s.alpha.toFixed(1).padStart(8)} | ore ${Math.floor(s.ore).toString().padStart(5)} | 세력 ${demo.netWorth().toFixed(0).padStart(6)} vs 최강 ${best().toFixed(0).padStart(6)} | 격퇴 ${s.raidsRepelled} · 약탈 ${s.raidsLost} | 연구 ${TECH.reduce((a, t) => a + demo.level(t.id), 0)} | 길드 Lv ${demo.guild?.level ?? 0} | 판매 ${s.earned.toFixed(1)} | 엔진 ${demo.engine.stage}/3 | 패권 ${(demo.hegemony() * 100).toFixed(0)}% | 속국 ${demo.rivals().filter((r) => r.vassal != null).length} | 공물 ${demo.tributeTotal.toFixed(0)}`);
}
console.log(rows.join('\n'));
console.log('events', JSON.stringify(events), '| raids made', raidsMade, '| bounties', bounties, '| decisions', decisions, '| hegemony tier', demo.hegemonyTier, '| race wins', demo.race?.wins, '| void kills', s.voidKills ?? 0, '| reps', demo.reps.filter((r) => r.on).length);
