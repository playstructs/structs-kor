/* 실시간 대전: the frames, the host/guest block exchange, the lobby and the forfeit timer. `pnpm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ai } from '../src/sim/ai';
import { layout } from '../src/sim/fleets';
import type { Msg } from '../src/sim/chain';
import {
  GUEST, HOST, GuestLink, HostLink, Watchdog, battleOf, bothReady, chainFor, guestLobby, hostLobby, lobbyFrame, lobbyStep, mergeTicks, openBattle,
  parseFrame, stateSum, toLocal, toWinner, type Frame, type FrameOf,
} from '../src/sim/live';

const SEED = 'LIVE-TEST';
const battle = battleOf(layout('difficult', SEED), SEED, 10, 2000, '테스트 대전');
/** Over the wire and back, as the other side reads it. */
const wire = <T extends Frame>(f: T) => parseFrame(JSON.parse(JSON.stringify(f))) as T;
const M = 'abcdefgh2345';

test('a battle survives its code, and only live block times play', () => {
  const o = openBattle(battle)!;
  assert.equal(o.seed, SEED);
  assert.equal(o.units.length, layout('difficult', SEED).length);
  assert.equal(o.title, '테스트 대전');
  assert.equal(openBattle({ ...battle, blockMs: 1234 }), null);
  assert.equal(openBattle({ code: 'Rnot-a-code', blockMs: 2000 }), null);
  assert.equal(stateSum(chainFor(battle)!), stateSum(chainFor(battle)!));
});

test('frames are read strictly: role, kind, ids, orders and size', () => {
  const attack: Msg = { '@type': '/structs.structs.MsgStructAttack', operatingStructId: '5-101', targetStructId: ['5-120'], weaponSystem: 'primaryWeapon' };
  assert.deepEqual(wire({ v: 1, match: M, role: 'guest', kind: 'move', n: 1, msg: attack }).msg, attack);
  const offer = wire({ v: 1, match: M, role: 'host', kind: 'offer', host: { id: '1-42', name: '테스트 사령관' }, to: '1-7', battle, at: 1 });
  assert.equal(offer.kind, 'offer');
  assert.equal(offer.host.name, '테스트 사령관');
  const bad: unknown[] = [
    { v: 2, match: M, role: 'host', kind: 'ping' },
    { v: 1, match: 'short', role: 'host', kind: 'ping' },
    { v: 1, match: M, role: 'watcher', kind: 'ping' },
    // A guest can't tick, a host can't move: who may send what is part of the shape.
    { v: 1, match: M, role: 'guest', kind: 'tick', blocks: [{ height: 1001, txs: [], took: 0, sum: '00000000' }] },
    { v: 1, match: M, role: 'host', kind: 'move', n: 1, msg: attack },
    { v: 1, match: M, role: 'guest', kind: 'move', n: 1, msg: { ...attack, operatingStructId: '<script>' } },
    { v: 1, match: M, role: 'guest', kind: 'move', n: 1, msg: { ...attack, targetStructId: ['5-101'] } },
    { v: 1, match: M, role: 'guest', kind: 'move', n: 0, msg: attack },
    { v: 1, match: M, role: 'host', kind: 'offer', host: { id: 'nobody', name: 'x' }, to: null, battle, at: 1 },
    { v: 1, match: M, role: 'host', kind: 'offer', host: { id: '1-42', name: 'x' }, to: null, battle: { code: battle.code, blockMs: 50 }, at: 1 },
    { v: 1, match: M, role: 'host', kind: 'tick', blocks: [{ height: 1001, txs: [], took: 0, sum: '0' }] },
    { v: 1, match: M, role: 'host', kind: 'tick', blocks: [{ height: 1001, txs: [], took: 0, sum: '00000000' }, { height: 1003, txs: [], took: 0, sum: '00000000' }] },
    { v: 1, match: M, role: 'host', kind: 'end', winner: 'computer', why: 'fleet', height: 1 },
    { v: 1, match: M, role: 'guest', kind: 'accept', guest: { id: '1-7', name: 'x' }, pad: 'x'.repeat(70_000) },
    'ping', null, [],
  ];
  for (const b of bad) assert.equal(parseFrame(b), null, JSON.stringify(b).slice(0, 120));
});

/** A whole duel through the frames: the host's computer plays the host, another plays the guest from its own copy. */
function duel(o: { latency?: number; drop?: number; battle?: typeof battle; guest?: 'easy' | 'difficult' | 'hard' } = {}) {
  const b = o.battle ?? battle;
  const host = new HostLink(M, chainFor(b)!), guest = new GuestLink(M, chainFor(b)!);
  const hostAi = new Ai(HOST, 'hard', SEED + ':h'), guestAi = new Ai(GUEST, o.guest ?? 'hard', SEED + ':g');
  const inFlight: { at: number; f: FrameOf<'move'> }[] = [];
  let guestMoves = 0, taken = 0, step = 0, dropped: FrameOf<'tick'> | null = null;
  for (; step < 400; step++) {
    // The guest's move reaches the host after `latency` blocks.
    while (inFlight.length && inFlight[0].at <= step) { const m = wire(inFlight.shift()!.f); host.move(m); }
    const { block, frame } = host.step(hostAi.decide(host.chain));
    taken += block.txs.filter((t) => t.signer === GUEST).length;
    if (o.drop === step) { dropped = frame; continue; }
    guest.receive(wire(frame));
    if (dropped && guest.gap() != null) {
      for (const r of host.resend(guest.gap()!)) guest.receive(wire(r));
      dropped = null;
    }
    for (let next = guest.next(); next; next = guest.next()) assert.ok(next.ok, `block ${next.block.height} agrees`);
    assert.equal(guest.chain.height, host.chain.height);
    const mine = guestAi.decide(guest.chain);
    if (mine) { guestMoves++; inFlight.push({ at: step + 1 + (o.latency ?? 0), f: guest.move(mine) }); }
    if (host.chain.fleetsAtBattle().length < 2) break;
  }
  return { host, guest, guestMoves, taken, step };
}

test('the guest plays the computer side: its moves land in the host\'s blocks and both chains agree to the end', () => {
  const r = duel();
  assert.ok(r.guestMoves > 3, 'the guest moved');
  assert.ok(r.taken > 3, 'the host played the guest\'s moves');
  assert.equal(r.guest.desync, null);
  assert.equal(stateSum(r.guest.chain), stateSum(r.host.chain));
  assert.deepEqual(r.guest.chain.fleetsAtBattle(), r.host.chain.fleetsAtBattle());
  // Destroyed hulls are swept off the chain: fewer structs (or less hull) than the battle began with.
  const hull = (c: typeof r.host.chain) => Object.values(c.structs).reduce((a, s) => a + (c.isDestroyed(s) ? 0 : s.health), 0);
  assert.ok(hull(r.guest.chain) < hull(chainFor(battle)!), 'shots landed');
});

test('a duel to the end: the fleet the host saw destroyed is the one the guest saw destroyed', () => {
  // A lopsided fight that ends: the host's hard computer against an easy one in the guest's seat.
  const b = battleOf(layout('hard', 'END'), 'END', 10, 2000);
  const r = duel({ battle: b, guest: 'easy' });
  const left = r.host.chain.fleetsAtBattle();
  assert.equal(left.length, 1, 'one fleet left');
  assert.deepEqual(r.guest.chain.fleetsAtBattle(), left);
  assert.equal(r.guest.desync, null);
  assert.equal(stateSum(r.guest.chain), stateSum(r.host.chain));
});

test('a slow guest still gets its moves in, a block or two late', () => {
  const r = duel({ latency: 2 });
  assert.ok(r.taken > 3);
  assert.equal(r.guest.desync, null);
});

test('a lost tick is noticed and resent', () => {
  const r = duel({ drop: 3 });
  assert.equal(r.guest.desync, null);
  assert.equal(r.guest.chain.height, r.host.chain.height);
});

test('the latest move before a block wins, and none is played twice', () => {
  const host = new HostLink(M, chainFor(battle)!), guest = new GuestLink(M, chainFor(battle)!);
  const ids = Object.values(host.chain.structs);
  const mine = ids.find((s) => s.owner === GUEST && !host.chain.isCommand(s))!;
  const a = guest.move({ '@type': '/structs.structs.MsgStructStealthActivate', structId: mine.id });
  const b = guest.move({ '@type': '/structs.structs.MsgStructDefenseClear', defenderStructId: mine.id });
  host.move(wire(b)); host.move(wire(a));
  assert.ok(guest.pending);
  const s1 = host.step(null);
  assert.equal(s1.subs.length, 1);
  assert.equal(s1.subs[0].msg['@type'], '/structs.structs.MsgStructDefenseClear');
  guest.receive(wire(s1.frame));
  assert.ok(guest.next()!.ok);
  assert.equal(guest.pending, false);
  host.move(wire(b));
  assert.equal(host.step(null).subs.length, 0, 'a replayed move is not played again');
});

test('a tampered tick is caught by its checksum', () => {
  const host = new HostLink(M, chainFor(battle)!), guest = new GuestLink(M, chainFor(battle)!);
  // Play on until the guest's computer has a move, keeping the guest in step.
  const ai = new Ai(GUEST, 'hard', 'tamper');
  let m: Msg | null = null;
  for (let i = 0; i < 30 && !m; i++) {
    m = ai.decide(host.chain);
    if (!m) { guest.receive(wire(host.step(null).frame)); assert.ok(guest.next()!.ok); }
  }
  assert.ok(m, 'the guest found a move');
  host.move(guest.move(m!));
  const { block, frame } = host.step(null);
  assert.ok(block.txs[0]?.ok, 'the move went through on the host');
  // The same block without the guest's move: the checksum says the chains no longer agree.
  guest.receive(wire({ ...frame, blocks: [{ ...frame.blocks[0], txs: [] }] }));
  const n = guest.next()!;
  assert.equal(n.ok, false);
  assert.equal(guest.desync, n.block.height);
});

test('ticks waiting on a slow homeserver go out together', () => {
  const host = new HostLink(M, chainFor(battle)!);
  const frames = [host.step(null).frame, host.step(null).frame, host.step(null).frame];
  const merged = mergeTicks(frames);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].blocks.map((b) => b.height), [1001, 1002, 1003]);
  assert.ok(wire(merged[0]));
});

test('the lobby: offer, the right guest joins, both ready, start, and the ways it closes', () => {
  const me = { id: '1-42', name: '호스트' }, them = { id: '1-7', name: '은하수' };
  let h = hostLobby(M, me, battle, them.id);
  let g = guestLobby(M, them);
  const send = (from: 'host' | 'guest', f: Frame) => { if (from === 'host') g = lobbyStep(g, wire(f)); else h = lobbyStep(h, wire(f)); };
  send('host', { v: 1, match: M, role: 'host', kind: 'offer', host: me, to: them.id, battle, at: 1 });
  assert.equal(g.host?.id, me.id);
  // Someone the offer wasn't for can't take the seat.
  h = lobbyStep(h, { v: 1, match: M, role: 'guest', kind: 'accept', guest: { id: '1-9', name: '철갑상어' } });
  assert.equal(h.state, 'offered');
  send('guest', { v: 1, match: M, role: 'guest', kind: 'accept', guest: them });
  assert.equal(h.state, 'joined');
  send('host', lobbyFrame(h));
  assert.equal(g.state, 'joined');
  assert.ok(!bothReady(h));
  send('guest', { v: 1, match: M, role: 'guest', kind: 'ready', on: true });
  h = { ...h, ready: { ...h.ready, host: true } };
  assert.ok(bothReady(h));
  send('host', lobbyFrame(h));
  assert.deepEqual(g.ready, { host: true, guest: true });
  send('host', { v: 1, match: M, role: 'host', kind: 'start', battle });
  assert.equal(g.state, 'live');
  send('host', { v: 1, match: M, role: 'host', kind: 'end', winner: 'guest', why: 'fleet', height: 1100 });
  assert.equal(g.state, 'ended');
  // My own frames echo back from the room: they change nothing.
  assert.equal(lobbyStep(h, { v: 1, match: M, role: 'host', kind: 'leave' }), h);
  // Someone else got the seat; a host who walks out of the lobby.
  assert.equal(lobbyStep(guestLobby(M, them), { ...lobbyFrame(h), guest: { id: '1-9', name: '철갑상어' } }).why, 'taken');
  assert.equal(lobbyStep(guestLobby(M, them), { v: 1, match: M, role: 'host', kind: 'leave' }).state, 'cancelled');
  const joined = lobbyStep(hostLobby(M, me, battle, null), { v: 1, match: M, role: 'guest', kind: 'accept', guest: them });
  assert.equal(lobbyStep(joined, { v: 1, match: M, role: 'guest', kind: 'leave' }).why, 'left');
});

test('who won, from each side', () => {
  assert.equal(toWinner('player', 'host'), 'host');
  assert.equal(toWinner('player', 'guest'), 'guest');
  assert.equal(toWinner('computer', 'guest'), 'host');
  assert.equal(toLocal('guest', 'guest'), 'player');
  assert.equal(toLocal('guest', 'host'), 'computer');
  assert.equal(toLocal('draw', 'host'), 'draw');
});

test('silence counts down to a forfeit', () => {
  const w = new Watchdog(0, 30_000);
  assert.equal(w.countdown(10_000), null);
  assert.equal(w.countdown(20_000), 10);
  assert.ok(!w.gone(29_999));
  w.heard(25_000);
  assert.ok(!w.gone(50_000));
  assert.ok(w.gone(55_000));
});
