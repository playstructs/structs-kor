/* Game-layer tests: `pnpm test`. Pure logic only (no DOM): the demo economy, the campaign fleets
 * and the attack-animation plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demo, TECH, EVENTS } from '../src/game/demo';
import { advise } from '../src/game/advisor';
import { MISSIONS, missionUnits } from '../src/game/campaign';
import { validate, chainSetup, YOU, CPU } from '../src/sim/fleets';
import { Chain, type AttackDetail } from '../src/sim/chain';
import { Ai } from '../src/sim/ai';
import { planAttack, type Known } from '../src/game/map/plan';

test('campaign fleets are legal battle layouts', () => {
  for (const m of MISSIONS) assert.equal(validate(missionUnits(m)), null, m.id);
});

test('campaign missions finish (no endless stalemate on autopilot)', () => {
  for (const m of MISSIONS) {
    const { setup } = chainSetup(missionUnits(m), 'T-' + m.id, { player: m.charge, computer: m.charge });
    const c = new Chain(setup);
    const a = new Ai(YOU.id, 'hard', 'a'), b = new Ai(CPU.id, m.difficulty, 'b');
    let shots = 0;
    for (let i = 0; i < 120 && c.fleetsAtBattle().length > 1; i++) {
      for (const [ai, id] of [[a, YOU.id], [b, CPU.id]] as const) { const x = ai.decide(c); if (x) c.submit(id, x); }
      shots += c.produceBlock().txs.filter((t) => t.ok && t.events.some((e) => e.category === 'struct_attack')).length;
    }
    assert.ok(shots > 0, `${m.id}: nobody fired`);
  }
});

test('demo economy: refining turns ore into alpha; research pays and gates on rank', () => {
  demo.reset();
  const s = demo.state;
  for (const x of s.structs) if (x.type === 15) x.online = true;
  s.ore = 20; s.nextRaid = 9999;
  const alpha0 = s.alpha;
  demo.step();
  assert.ok(s.alpha > alpha0, 'alpha grows while a refinery runs');
  s.alpha = 100;
  const deep = TECH.find((t) => t.rank > 0)!;
  assert.match(demo.research(deep.id, 0) ?? '', /계급/);
  assert.equal(demo.research('mine', 0), null);
  assert.equal(demo.level('mine'), 1);
  assert.equal(s.alpha, 100 - TECH.find((t) => t.id === 'mine')!.cost[0]);
});

test('demo market: bought power adds capacity but cannot be resold', () => {
  demo.reset();
  demo.state.alpha = 50;
  const cap = demo.capacityKw();
  assert.equal(demo.buy(1, 10), null);
  assert.equal(demo.capacityKw(), cap + 1);
  assert.ok(demo.sell(demo.capacityKw(), 10));
});

test('demo market: buying power never raises what you can sell', () => {
  demo.reset();
  demo.state.alpha = 80;
  const before = demo.sellableKw();
  assert.equal(demo.buy(3, 10), null);
  assert.ok(demo.sellableKw() <= before + 1e-9, `sellable rose from ${before} to ${demo.sellableKw()}`);
  assert.ok(demo.sell(before + 0.5, 10), 'cannot sell past own generation');
});

test('attack plan: counters play first, a blocked shot lands on the blocker, kills end in DESTROY', () => {
  const known: Record<string, Known> = { a: { health: 3, ambit: 'land', category: 'fleet' }, t: { health: 2, ambit: 'land', category: 'fleet' }, g: { health: 3, ambit: 'land', category: 'fleet' } };
  const d = {
    attackerStructId: 'a', attackerStructType: 'Tank', attackerStructOperatingAmbit: 'land', weaponSystem: 'primaryWeapon', attackerHealthBefore: 3,
    eventAttackShotDetail: [{ targetStructId: 't', targetStructOperatingAmbit: 'land', targetHealthBefore: 2, targetHealthAfter: 2, targetDestroyed: false,
      blocked: true, blockedByStructId: 'g', blockerHealthBefore: 3, blockerHealthAfter: 0, blockerDestroyed: true,
      eventAttackDefenderCounterDetail: [{ counterByStructId: 'g', counterDamage: 1, counterDestroyedAttacker: false, counterByStructType: 'Tank', counterByStructOperatingAmbit: 'land', counterByStructWeaponSystem: 'primaryWeapon' }] }],
  } as unknown as AttackDetail;
  const ev = planAttack(d, (id) => known[id]);
  assert.deepEqual(ev.map((e) => e.structId), ['g', 'a', 'a', 'g', 'g']);
  assert.equal(ev[1].healthAfter, 2, 'the counter costs the attacker 1');
  assert.deepEqual(ev[4].names, ['DESTROY_LAND']);
  assert.ok(ev[3].names[0].startsWith('IMPACT_'), 'the blocker takes the hit');
});

test('demo guilds: donations level the guild, levels lift mining, switching costs alpha', () => {
  demo.reset();
  demo.state.alpha = 100;
  const mine0 = demo.rates().mine;
  assert.match(demo.donate(5) ?? '', /가입/);
  assert.equal(demo.joinGuild('gold'), null);
  assert.equal(demo.guildAsk(), 1.02);
  assert.equal(demo.donate(25), null);
  assert.equal(demo.guild!.level, 2);
  assert.ok(demo.rates().mine > mine0, 'guild level adds to mining');
  const a = demo.state.alpha;
  assert.equal(demo.joinGuild('iron'), null);
  assert.equal(demo.state.alpha, a - 5);
  assert.equal(demo.guild!.level, 1, 'switching starts over');
});

test('demo soak: every event type happens, and the economy grows without running away', () => {
  demo.reset();
  const s = demo.state;
  for (const x of s.structs) if (x.type === 15) x.online = true;
  const seen = new Set<string>();
  for (let b = 0; b < 3000; b++) {
    const spare = demo.sellableKw();
    if (spare > 0.5 && demo.contracts.length < 3) demo.sell(Math.min(4, Math.floor(spare * 5) / 10), 40);
    if (demo.structsKw() + demo.soldKw() > demo.capacityKw() * 0.85 && s.alpha > 6) demo.infuse(2);
    demo.step();
    if (s.event) seen.add(s.event.id);
  }
  assert.equal(seen.size, Object.keys(EVENTS).length, `events seen: ${[...seen].join(',')}`);
  assert.ok(s.alpha < 4000, `alpha ran away: ${s.alpha.toFixed(0)}`);
  assert.ok(demo.soldKw() <= 10 + 1e-9, 'market depth holds');
});

test('world engine: stages complete at their cost and pay off', () => {
  demo.reset();
  demo.state.alpha = 5000;
  const cap = demo.capacityKw();
  assert.equal(demo.buildEngine(300), null);
  assert.equal(demo.engine.stage, 1);
  assert.equal(demo.capacityKw(), cap + 5, 'stage 1: +5 kW');
  assert.equal(demo.buildEngine(5000), null);
  assert.equal(demo.engine.stage, 2, 'overpaying fills only the current stage');
  assert.equal(demo.buildEngine(2400), null);
  assert.ok(demo.engine.done);
  assert.match(demo.buildEngine(1) ?? '', /가동/);
});

test('proof of work: the ported hasher matches sha256, and the bar falls with age', async () => {
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const { bytesToHex } = await import('@noble/hashes/utils.js');
  const { makeJob, setNonce, tryNonce, digestHex, nonceString, difficultyAt } = await import('../src/pow/sha');
  const { prefixOf, blocksUntil } = await import('../src/pow/work');
  const prefix = prefixOf({ category: 'BUILD', object_id: '5-12', target_id: '2-7', block_start: 3007073 });
  assert.equal(prefix, '5-12BUILD3007073NONCE');
  assert.equal(prefixOf({ category: 'RAID', object_id: '9-4', target_id: '2-7', block_start: 3001000 }), '9-4@2-7RAID3001000NONCE');
  for (const p of [prefix, 'x'.repeat(60) + 'NONCE', 'y'.repeat(130)]) {
    const job = makeJob(p);
    setNonce(job, 1234567);
    const out = new Int32Array(8);
    tryNonce(job, out);
    assert.equal(digestHex(out), bytesToHex(sha256(new TextEncoder().encode(p + nonceString(job)))), `prefix length ${p.length}`);
  }
  assert.equal(difficultyAt(1, 700), 64);
  assert.equal(difficultyAt(700, 700), 1);
  assert.ok(difficultyAt(100, 700) < difficultyAt(10, 700));
  assert.equal(blocksUntil({ range: 700, blockStart: 100 }, 1, 50), 100 + 700 - 51);
});

test('chain messages: build start and proof completions encode with the right fields', async () => {
  const { encodeAny, typeUrlOf } = await import('../src/wallet/encode');
  const { readFields } = await import('../src/wallet/proto');
  const anyBytes = encodeAny({ typeUrl: typeUrlOf('MsgStructBuildInitiate'), value: { creator: 'structs1x', playerId: '1-42', structTypeId: '15', operatingAmbit: 'land', slot: '1' } });
  const outer = readFields(anyBytes);
  const inner = readFields(outer.get(2)![0] as Uint8Array);
  assert.equal(new TextDecoder().decode(inner.get(2)![0] as Uint8Array), '1-42');
  assert.equal(inner.get(3)![0], 15n);
  assert.equal(inner.get(4)![0], 2n, 'land is ambit 2');
  assert.equal(inner.get(5)![0], 1n);
  const move = readFields(readFields(encodeAny({ typeUrl: typeUrlOf('MsgFleetMove'), value: { creator: 'c', fleetId: '9-42', destinationLocationId: '2-301' } })).get(2)![0] as Uint8Array);
  assert.equal(new TextDecoder().decode(move.get(2)![0] as Uint8Array), '9-42');
  assert.equal(new TextDecoder().decode(move.get(3)![0] as Uint8Array), '2-301');
  const guard = readFields(readFields(encodeAny({ typeUrl: typeUrlOf('MsgStructDefenseSet'), value: { creator: 'c', defenderStructId: '5-1013', protectedStructId: '5-1011' } })).get(2)![0] as Uint8Array);
  assert.equal(new TextDecoder().decode(guard.get(2)![0] as Uint8Array), '5-1013');
  assert.equal(new TextDecoder().decode(guard.get(3)![0] as Uint8Array), '5-1011');
  const shot = readFields(readFields(encodeAny({ typeUrl: typeUrlOf('MsgStructAttack'), value: { creator: 'c', operatingStructId: '5-1013', targetStructId: ['5-2003'], weaponSystem: 'primaryWeapon' } })).get(2)![0] as Uint8Array);
  assert.equal(new TextDecoder().decode(shot.get(3)![0] as Uint8Array), '5-2003');
  assert.equal(new TextDecoder().decode(shot.get(4)![0] as Uint8Array), 'primaryWeapon');
  for (const [name, idField] of [['MsgStructBuildComplete', 'structId'], ['MsgStructOreRefineryComplete', 'structId'], ['MsgPlanetRaidComplete', 'fleetId']] as const) {
    const f = readFields(readFields(encodeAny({ typeUrl: typeUrlOf(name), value: { creator: 'c', [idField]: '5-1', proof: '00ab', nonce: '0000000000042' } })).get(2)![0] as Uint8Array);
    assert.equal(new TextDecoder().decode(f.get(3)![0] as Uint8Array), '00ab', `${name} proof`);
    assert.equal(new TextDecoder().decode(f.get(4)![0] as Uint8Array), '0000000000042', `${name} nonce`);
  }
});

test('replays: recorded orders reproduce the battle exactly, through a share code', async () => {
  const { layout, encodeReplay, decodeReplay } = await import('../src/sim/fleets');
  const units = layout('difficult', 'REPLAY-T');
  const play = (txsIn: { height: number; signer: string; msg: unknown }[] | null) => {
    const c = new Chain(chainSetup(units, 'REPLAY-T', { player: 12, computer: 12 }).setup);
    const a = new Ai(YOU.id, 'hard', 'r1'), b = new Ai(CPU.id, 'difficult', 'r2');
    const log: { height: number; signer: string; msg: never }[] = [];
    for (let i = 0; i < 150 && c.fleetsAtBattle().length > 1; i++) {
      if (txsIn) { for (const t of txsIn.filter((x) => x.height === c.height + 1)) c.submit(t.signer, t.msg as never); }
      else for (const [ai, id] of [[a, YOU.id], [b, CPU.id]] as const) { const m = ai.decide(c); if (m) { log.push({ height: c.height + 1, signer: id, msg: m as never }); c.submit(id, m); } }
      c.produceBlock();
    }
    return { log, state: JSON.stringify(Object.values(c.structs).map((s) => [s.id, s.health, s.status])), height: c.height };
  };
  const live = play(null);
  assert.ok(live.log.length > 0);
  const code = encodeReplay({ units, seed: 'REPLAY-T', start: 1000, charge: 12, txs: live.log });
  const back = decodeReplay(code)!;
  assert.equal(back.charge, 12);
  const again = play(back.txs);
  assert.equal(again.state, live.state, 'same orders, same battle');
});

test('dominion: three raids earn a vassal that pays tribute, never raids, and rebels when rearmed', () => {
  demo.reset();
  demo.state.alpha = 100;
  const r = demo.rivals()[0];
  assert.match(demo.subjugate(r.id) ?? '', /약탈/, 'needs three raids first');
  for (let i = 0; i < 3; i++) demo.settleRaid(r.id, true, {});
  assert.equal(demo.subjugate(r.id), null);
  assert.ok(demo.rates().tribute > 0, 'tribute counts toward alpha per block');
  r.fleet = 4;
  assert.equal(demo.disarm(r.id), null);
  assert.equal(r.fleet, 3, 'disarming scraps a ship');
  // Over many blocks a disarmed vassal pays and sends no raids.
  for (let i = 0; i < 140; i++) { demo.step(); assert.notEqual(demo.raid?.owner, r.id, 'a vassal never raids'); }
  assert.ok(demo.tributeTotal > 1, `tribute flowed: ${demo.tributeTotal}`);
  // Rearmed past the line, it eventually rebels.
  r.fleet = 10;
  let rebelled = false;
  for (let i = 0; i < 2000 && !rebelled; i++) { demo.step(); rebelled = r.vassal == null; }
  assert.ok(rebelled, 'a rearmed vassal rebels');
});

test('decisions: a 결단 opens on schedule, prices each side, and expires if ignored', () => {
  demo.reset();
  demo.state.alpha = 50; demo.state.ore = 40;
  let guard = 0;
  while (!demo.decision && guard++ < 200) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.ok(demo.decision, 'a decision opened within two cycles');
  const before = { alpha: demo.state.alpha, ore: demo.state.ore };
  assert.equal(demo.decide(0), null);
  assert.equal(demo.decision, null, 'answering closes it');
  assert.ok(demo.state.alpha !== before.alpha || demo.state.ore !== before.ore || demo.state.shield === 100, 'the first choice changed the base');
  assert.match(demo.decide(0) ?? '', /없습니다/);
  // The next one, ignored, lapses.
  guard = 0;
  while (!demo.decision && guard++ < 200) { if (demo.raid) demo.state.raid = null; demo.step(); }
  for (let i = 0; i < 30; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.equal(demo.decision, null, 'an ignored decision expires');
});

test('hegemony: a fresh base starts below the first title, and vassals push it up', () => {
  demo.reset();
  const h0 = demo.hegemony();
  assert.ok(h0 > 0.05 && h0 < 0.25, `fresh base ${h0.toFixed(3)}`);
  demo.state.alpha = 100;
  const r = demo.rivals()[3];
  for (let i = 0; i < 3; i++) demo.settleRaid(r.id, true, {});
  assert.equal(demo.subjugate(r.id), null);
  assert.ok(demo.hegemony() > h0 + 0.1, `a vassal shifts the balance: ${demo.hegemony().toFixed(3)}`);
});

test('rival wars: rivals raid each other on schedule, and vassals are protected', () => {
  demo.reset();
  for (let i = 0; i < 400; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.ok(demo.news.length >= 5, `wars happened: ${demo.news.length}`);
  // Protect one: every strike at it now fails.
  demo.state.alpha = 100;
  const v = demo.rivals()[0];
  for (let i = 0; i < 3; i++) demo.settleRaid(v.id, true, {});
  assert.equal(demo.subjugate(v.id), null);
  const ore = v.ore;
  for (let i = 0; i < 400; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.ok(v.ore >= ore, 'a vassal is never looted by other rivals');
});

test('advisor: always has something to say, and puts an incoming raid on exposed ore first', () => {
  demo.reset();
  assert.ok(advise().length >= 1);
  demo.state.ore = 200;
  let g = 0;
  while (!(demo.raid && demo.raid.eta > 0) && g++ < 200) demo.step();
  assert.ok(demo.raid, 'a raid came');
  demo.state.ore = 200;
  const top = advise()[0];
  assert.equal(top.tone, 'jeok');
  assert.match(top.text, /도착/);
});

test('dominion exploits: raiding a vassal resets the count, raiding under a pact breaks it', () => {
  demo.reset();
  demo.state.alpha = 100;
  const v = demo.rivals()[0];
  for (let i = 0; i < 3; i++) demo.settleRaid(v.id, true, {});
  assert.equal(demo.subjugate(v.id), null);
  demo.settleRaid(v.id, true, {});
  assert.equal(v.vassal, null);
  assert.match(demo.subjugate(v.id) ?? '', /약탈/, 'no instant re-subjugation after looting your own vassal');
  const p = demo.rivals()[1];
  demo.state.pacts = { [p.id]: demo.state.height + 100 };
  demo.settleRaid(p.id, true, {});
  assert.equal(demo.pactLeft(p.id), 0, 'raiding breaks the pact');
  assert.equal(demo.state.rebel, p.id, 'and they answer');
});

test('overclock: more output for more power, and the machine wears', () => {
  demo.reset();
  demo.state.infusedKw = 20; // room to run hot
  const miner = demo.state.structs.find((x) => x.type === 14)!;
  const base = demo.rates().mine, kw = demo.structsKw();
  assert.equal(demo.overclock(miner.id), null);
  assert.ok(Math.abs(demo.rates().mine - base * 1.6) < 1e-9, 'output ×1.6');
  assert.ok(demo.structsKw() > kw, 'draws more power');
  const hp = miner.hp;
  for (let i = 0; i < 300 && miner.hp === hp; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.ok(miner.hp < hp, 'it wore');
  assert.match(demo.overclock(demo.state.structs.find((x) => x.type === 1)!.id) ?? '', /추출기/, 'only production machines');
});

test('bounties: posted on schedule, paid for a won raid on the target, not on a loss', () => {
  demo.reset();
  let g = 0;
  while (!demo.bounty && g++ < 300) { if (demo.raid) demo.state.raid = null; demo.step(); }
  const b = demo.bounty!;
  assert.ok(b && b.reward > 0, 'a bounty was posted');
  const a0 = demo.state.alpha;
  demo.settleRaid(b.target, false, {});
  assert.ok(demo.bounty, 'a lost raid leaves it open');
  demo.settleRaid(b.target, true, {});
  assert.equal(demo.bounty, null);
  assert.ok(demo.state.alpha >= a0 + b.reward - 1e-9, 'paid');
});

test('doctrines: first is free, switching costs alpha, and each changes the economy', () => {
  demo.reset();
  const base = demo.rates().mine;
  assert.equal(demo.adopt('industry'), null);
  assert.ok(Math.abs(demo.rates().mine - base * 1.2) < 1e-9, 'industry mines +20%');
  demo.state.alpha = 10;
  assert.match(demo.adopt('war') ?? '', /40/, 'switching costs 40 g');
  demo.state.alpha = 50;
  assert.equal(demo.adopt('war'), null);
  assert.ok(Math.abs(demo.state.alpha - 10) < 1e-9);
  assert.ok(Math.abs(demo.rates().mine - base) < 1e-9, 'the old perk is gone');
});

test('new era: only after the World Engine; resets the base, keeps research, lifts production', () => {
  demo.reset();
  assert.match(demo.newEra() ?? '', /월드 엔진/);
  demo.state.alpha = 5000;
  demo.state.tech = { mine: 2 };
  for (let i = 0; i < 3; i++) demo.buildEngine(3600);
  const before = demo.rates().mine;
  assert.equal(demo.newEra(), null);
  assert.equal(demo.era, 1);
  assert.equal(demo.engine.stage, 0, 'a fresh engine');
  assert.ok(demo.state.alpha < 100, 'alpha reset');
  assert.equal(demo.level('mine'), 2, 'research kept');
  assert.ok(demo.rates().mine > 0 && demo.rates().mine / (before / 1) > 1.1, 'production lifted');
});

test('review fixes: overclock drops when off, sale bonuses follow the doctrine you hold, no era mid-raid', () => {
  demo.reset();
  demo.state.infusedKw = 20;
  const m = demo.state.structs.find((x) => x.type === 14)!;
  assert.equal(demo.overclock(m.id), null);
  demo.toggle(m.id); demo.step();
  assert.equal(m.oc, false, 'switching off ends the overclock');
  // Trade doctrine pays its bonus only while held.
  assert.equal(demo.adopt('trade'), null);
  assert.equal(demo.sell(1, 40), null);
  const withTrade = demo.rates().alpha;
  demo.state.alpha = 100; assert.equal(demo.adopt('industry'), null);
  assert.ok(demo.rates().alpha < withTrade + demo.rates().mine, 'sale income fell with the switch');
  assert.ok(Math.abs(demo.sellBonus() - 1) < 1e-9);
  // No new era while a raid is on.
  demo.state.alpha = 5000;
  for (let i = 0; i < 3; i++) demo.buildEngine(3600);
  demo.state.nextRaid = 1; demo.step();
  assert.ok(demo.raid);
  assert.match(demo.newEra() ?? '', /습격/);
});

test('chronicle: milestones are written and survive a new era', () => {
  demo.reset();
  demo.state.alpha = 6000;
  assert.equal(demo.adopt('war'), null);
  for (let i = 0; i < 3; i++) demo.buildEngine(3600);
  const before = demo.chronicle.length;
  assert.ok(before >= 4, `doctrine + engine stages: ${before}`);
  assert.equal(demo.newEra(), null);
  assert.equal(demo.chronicle.length, before + 1, 'the era line is added, nothing lost');
  assert.match(demo.chronicle[demo.chronicle.length - 1].text, /제2시대/);
});

test('war room odds: a winnable fight wins most of its play-outs', async () => {
  const { playOut } = await import('../src/game/odds');
  const big = missionUnits(MISSIONS[0]);
  let w = 0;
  for (let i = 0; i < 6; i++) if (playOut(big, 'easy', 'o' + i) === 'player') w++;
  assert.ok(w >= 4, `mission 1 on easy wins most play-outs: ${w}/6`);
});

test('temperament: the aggressive rivals raid most, the merchant least', () => {
  demo.reset();
  const count: Record<string, number> = {};
  let last = '';
  for (let i = 0; i < 4000; i++) {
    demo.step();
    const r = demo.raid;
    if (r && r.owner !== last) { count[r.owner] = (count[r.owner] ?? 0) + 1; last = r.owner; }
    if (!r) last = '';
    if (r && r.eta === 0) demo.state.raid = null; // skip the fights; only who comes matters
  }
  assert.ok((count['1-666'] ?? 0) > (count['1-1004'] ?? 0), JSON.stringify(count));
  assert.ok((count['1-87'] ?? 0) > (count['1-1004'] ?? 0), JSON.stringify(count));
});

test('grant: outside winnings land in the treasury and the chronicle', () => {
  demo.reset();
  const a = demo.state.alpha;
  demo.grant(26, '작전 8 전리품');
  assert.equal(demo.state.alpha, a + 26);
  assert.match(demo.chronicle[demo.chronicle.length - 1].text, /전리품/);
});

test('void fleet: appears, pays when broken, and strikes someone when ignored', () => {
  demo.reset();
  let g = 0;
  while (!demo.boss && g++ < 400) { if (demo.raid) demo.state.raid = null; demo.step(); }
  const v = demo.boss!;
  assert.ok(v && v.fleet >= 9, 'it came');
  const a = demo.state.alpha;
  assert.equal(demo.settleRaid('void', true, {}).alpha, v.reward);
  assert.ok(demo.state.alpha >= a + v.reward - 1e-9 && !demo.boss, 'paid and gone');
  // The next one, ignored, falls on someone.
  g = 0;
  while (!demo.boss && g++ < 400) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.ok(demo.boss, 'it came back');
  const before = demo.rivals().map((r) => r.fleet).join(), ore = demo.state.ore;
  for (let i = 0; i < 70; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.equal(demo.boss, null);
  assert.ok(demo.rivals().map((r) => r.fleet).join() !== before || demo.state.ore < ore + 70, 'someone was hit');
});

test('guild race: seasons end, donations count, and the winner is paid', () => {
  demo.reset();
  demo.state.alpha = 500;
  assert.equal(demo.joinGuild('iron'), null);
  demo.step();
  assert.ok(demo.race, 'a season started');
  assert.equal(demo.donate(150), null); // 600 points: well clear of the field
  const a = demo.state.alpha;
  for (let i = 0; i < 610; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.equal(demo.race!.wins, 1, 'our guild won the season');
  assert.ok(demo.state.alpha > a, 'and was paid');
});

test('replicants: the warden restarts idle machines, the payroll is paid, an empty treasury ends it', () => {
  demo.reset();
  demo.state.alpha = 50;
  assert.equal(demo.hire('warden'), null);
  const ref = demo.state.structs.find((x) => x.type === 15)!;
  ref.online = false;
  demo.step();
  assert.ok(ref.online, 'the refinery came back on');
  // No income at all (production wrecked, no contracts), and next to nothing in the treasury.
  for (const x of demo.state.structs) if (x.type === 14 || x.type === 15) x.hp = 0;
  demo.state.ore = 0; demo.state.contracts = []; demo.state.alpha = 0.005;
  demo.step();
  assert.equal(demo.reps.find((r) => r.id === 'warden')!.on, false, 'unpaid, it left');
});

test('covert ops: cost alpha, succeed about as often as stated, and a caught one brings a raid', () => {
  demo.reset();
  let ok = 0, caught = 0;
  for (let i = 0; i < 200; i++) {
    demo.state.alpha = 100;
    const r = demo.rivals()[1];
    r.opUntil = 0; // measuring the odds, not the cooldown
    const res = demo.covert(r.id, 'heist');
    assert.notEqual(typeof res, 'string');
    if (typeof res !== 'string') { if (res.ok) ok++; else { caught++; assert.equal(demo.state.rebel, r.id); } }
  }
  assert.ok(ok > 85 && ok < 135, `about 55% succeed: ${ok}/200`);
  assert.ok(caught > 0);
  demo.state.alpha = 1;
  assert.match(demo.covert(demo.rivals()[3].id, 'sabotage') as string, /자금/);
});

test('loans: borrow now, repaid at term; default seizes ore and brings the lender', () => {
  demo.reset();
  const a = demo.state.alpha;
  assert.equal(demo.borrow(20), null);
  assert.equal(demo.state.alpha, a + 20);
  assert.match(demo.borrow(5) ?? '', /이미/);
  demo.state.alpha = 100;
  for (let i = 0; i < 201; i++) { if (demo.raid) demo.state.raid = null; demo.step(); }
  assert.equal(demo.loan, null, 'repaid at term');
  // Default.
  assert.equal(demo.borrow(50), null);
  demo.state.ore = 500;
  demo.state.loan!.due = demo.state.height + 1;
  demo.state.alpha = 0; demo.state.contracts = [];
  for (const x of demo.state.structs) if (x.type === 15) x.hp = 0;
  demo.step();
  assert.equal(demo.loan, null);
  assert.ok(demo.state.ore < 500, 'ore seized');
  assert.equal(demo.state.rebel, '1-1004', 'and the lender comes');
});

test('review fixes: no borrowing after a default, heists have a cooldown, no double sabotage', () => {
  demo.reset();
  assert.equal(demo.borrow(50), null);
  demo.state.loan!.due = demo.state.height + 1;
  demo.state.alpha = 0; demo.state.ore = 0; demo.state.contracts = [];
  for (const x of demo.state.structs) if (x.type === 15 || x.type === 14) x.hp = 0;
  demo.step();
  assert.match(demo.borrow(50) ?? '', /불이행/, 'cut off after a default');
  demo.state.alpha = 100;
  const r = demo.rivals()[1];
  assert.notEqual(typeof demo.covert(r.id, 'heist'), 'string');
  assert.match(demo.covert(r.id, 'heist') as string, /경계/, 'cooldown');
  const q = demo.rivals()[2];
  q.sabotaged = demo.state.height + 50;
  assert.match(demo.covert(q.id, 'sabotage') as string, /진행 중/);
});

test('guild support: a raid arriving gets the guild shield boost', () => {
  demo.reset();
  demo.state.alpha = 100;
  assert.equal(demo.joinGuild('blue'), null);
  demo.state.nextRaid = 1; demo.step();
  assert.ok(demo.raid && demo.raid.eta > 0);
  while (demo.raid && demo.raid.eta > 1) demo.step();
  demo.state.shield = 10;
  demo.step();
  assert.ok(demo.state.shield >= 18, `shield got support: ${demo.state.shield}`);
});

test('outposts: a strong fleet takes one, it pays its perk, and it can be fortified', () => {
  demo.reset();
  demo.state.alpha = 500;
  // A big fleet: odds near the cap.
  for (let i = 0; i < 12; i++) demo.state.structs.push({ id: `5-x${i}`, type: 3, ambit: 'space', slot: 0, cat: 'fleet', online: true, hp: 4, max: 4, building: null, buildBlocks: 0, protects: null });
  const base = demo.rates().mine;
  let won = false;
  for (let i = 0; i < 10 && !won; i++) { const r = demo.claimOutpost('asteroid'); won = typeof r !== 'string' && r.ok; }
  assert.ok(won, 'claimed');
  assert.ok(Math.abs(demo.rates().mine - base * 1.15) < 1e-9, 'mining +15%');
  assert.equal(demo.fortify('asteroid'), null);
  assert.match(demo.claimOutpost('asteroid') as string, /이미/);
});

test('dominion research: the arts of empire lift tribute, ops and outposts', () => {
  demo.reset();
  demo.state.alpha = 5000;
  const r = demo.rivals()[0];
  for (let i = 0; i < 3; i++) demo.settleRaid(r.id, true, {});
  assert.equal(demo.subjugate(r.id), null);
  const t0 = demo.tributeOf(r), odds0 = demo.outposts.find((o) => o.id === 'asteroid')!.odds;
  assert.equal(demo.research('diplo', 17), null);
  assert.equal(demo.research('fort', 17), null);
  assert.ok(demo.tributeOf(r) > t0 * 1.14, 'tribute +15%');
  assert.ok(demo.outposts.find((o) => o.id === 'asteroid')!.odds > odds0, 'outpost odds up');
  assert.match(demo.research('spy', 0) ?? '', /계급/, 'officers only');
});

test('outposts: left alone, a neutral site is eventually taken by a rival', () => {
  demo.reset();
  let taken = false;
  for (let i = 0; i < 3000 && !taken; i++) { if (demo.raid) demo.state.raid = null; demo.step(); taken = !!demo.outposts.find((o) => o.id === 'asteroid')!.owner; }
  assert.ok(taken);
});

test('alliances: an ally never raids you, adds ships to your raids, and spying ends it', async () => {
  const { withAllies } = await import('../src/game/demo');
  demo.reset();
  demo.state.alpha = 100;
  assert.match(demo.formAlliance('1-666') ?? '', /손잡지/);
  assert.equal(demo.formAlliance('1-1004'), null);
  const mine = demo.fleetUnits().units;
  assert.equal(withAllies(mine).length, mine.length + 2, 'two allied ships join');
  for (let i = 0; i < 199; i++) { demo.step(); assert.notEqual(demo.raid?.owner, '1-1004'); if (demo.raid?.eta === 0) demo.state.raid = null; }
  demo.state.alpha = 100;
  if (demo.ally) { demo.covert('1-1004', 'heist'); assert.equal(demo.ally, null, 'spying broke it'); }
});

test('chaos: 3000 blocks of random player actions never throw or produce NaN, and the save stays small', () => {
  demo.reset();
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const finite = (o: unknown): boolean => typeof o === 'number' ? Number.isFinite(o) : o && typeof o === 'object' ? Object.values(o).every(finite) : true;
  for (let b = 0; b < 3000; b++) {
    if (b % 7 === 0) {
      const riv = demo.rivals()[Math.floor(r() * 4)], k = Math.floor(r() * 9);
      if (k === 0) demo.borrow(r() < .5 ? 20 : 50);
      if (k === 1) demo.repay();
      if (k === 2) demo.covert(riv.id, r() < .5 ? 'heist' : 'sabotage');
      if (k === 3) demo.claimOutpost((['asteroid', 'relay', 'bastion'] as const)[Math.floor(r() * 3)]);
      if (k === 4) demo.formAlliance(riv.id);
      if (k === 5) demo.settleRaid(riv.id, r() < .5, {});
      if (k === 6) demo.subjugate(riv.id);
      if (k === 7 && demo.decision) demo.decide(Math.floor(r() * 2));
      if (k === 8) demo.hire((['warden', 'mechanic', 'trader'] as const)[Math.floor(r() * 3)]);
    }
    demo.step();
  }
  assert.ok(finite(demo.state), 'no NaN or Infinity anywhere in the base');
  assert.ok(JSON.stringify(demo.state).length < 60_000, 'the save stays small');
});

test('veterancy: kills credited from raids raise a ship to ★, ★★, ★★★', async () => {
  const { vetRank } = await import('../src/game/demo');
  demo.reset();
  const ship = demo.state.structs.find((x) => x.cat === 'fleet' && x.type !== 1)!;
  assert.deepEqual(demo.creditKills({ [ship.id]: 3 }).map((v) => v.rank), [1]);
  assert.deepEqual(demo.creditKills({ [ship.id]: 5 }).map((v) => v.rank), [2]);
  assert.equal(vetRank(ship.kills), 2);
  assert.deepEqual(demo.creditKills({ [ship.id]: 1 }), [], 'no promotion between ranks');
});

test('ship names: only veterans can be named, and names are trimmed to 12', () => {
  demo.reset();
  const ship = demo.state.structs.find((x) => x.cat === 'fleet' && x.type !== 1)!;
  assert.match(demo.nameShip(ship.id, '번개') ?? '', /베테랑/);
  demo.creditKills({ [ship.id]: 3 });
  assert.equal(demo.nameShip(ship.id, '  천둥의 칼날 그리고 더 긴 이름  '), null);
  assert.equal(ship.name, '천둥의 칼날 그리고 더 긴'.slice(0, 12));
  assert.equal(demo.nameShip(ship.id, ''), null);
  assert.equal(ship.name, undefined);
});

test('veterancy: a raid credits kills as it settles, and rebuilding a fallen veteran keeps its record', () => {
  demo.reset();
  demo.state.infusedKw = 20;
  const ship = demo.state.structs.find((x) => x.cat === 'fleet' && x.type !== 1)!;
  const r = demo.rivals()[0];
  const res = demo.settleRaid(r.id, true, { [ship.id]: 0 }, { [ship.id]: 3 });
  assert.equal(res.promoted?.[0]?.rank, 1, 'promoted as it settled');
  assert.equal(ship.hp, 0, 'went down in the raid');
  demo.nameShip(ship.id, '불사조');
  assert.equal(demo.build(ship.type, ship.ambit, ship.slot, 'fleet'), null);
  const rebuilt = demo.state.structs.find((x) => x.cat === 'fleet' && x.type !== 1 && x.ambit === ship.ambit && x.slot === ship.slot)!;
  assert.equal(rebuilt.kills, 3);
  assert.equal(rebuilt.name, '불사조');
});

test('commander abilities: rank-gated, effective, then on cooldown', () => {
  demo.reset();
  for (const x of demo.state.structs) if (x.type === 15) x.online = true;
  demo.state.ore = 50;
  assert.match(demo.useAbility('surge', 0) ?? '', /계급/);
  const a = demo.state.alpha, cap = demo.surgeCap();
  assert.equal(demo.useAbility('surge', 17), null);
  assert.ok(Math.abs(demo.state.alpha - a - Math.min(50, cap)) < 1e-9 && cap > 5, `refined ${Math.min(50, cap).toFixed(1)} at once`);
  assert.match(demo.useAbility('surge', 17) ?? '', /재사용/);
  demo.state.shield = 10;
  assert.match(demo.useAbility('overshield', 17) ?? '', /습격/, 'only with a raid coming');
  demo.state.nextRaid = 1; demo.step();
  demo.state.shield = 10;
  assert.equal(demo.useAbility('overshield', 17), null);
  assert.equal(demo.state.shield, 50);
  assert.equal(demo.useAbility('rally', 17), null);
  assert.equal(demo.rallying, 20);
});
