/* 실시간 대전: two commanders, one battle, over Matrix. After structs-universe's simulator-live.js and
 * matrix/sim.rs, but replicated instead of streamed: both sides run the same deterministic Chain
 * (src/sim/chain.ts), so what travels is each block's transactions, not what the board was shown.
 *
 * The HOST owns the clock. Each block it submits its own order and the guest's latest move (in place
 * of the computer), produces the block and sends a `tick` with the block's submits in order. The
 * GUEST applies the same submits to its own copy and draws from its own blocks; a state checksum in
 * every tick says whether the two chains still agree. The host's fleet is the simulator's `player`
 * side (signer 1-1), the guest's is `computer` (1-2).
 *
 * Frames are `structs.sim.match` events in the two players' DM. The offer also rides on an
 * m.room.message (its key beside a readable body), so it is a card in 통신 and a line in any other
 * client. Everything here is pure: the transport is src/chat/duel.ts, the screen src/screens/sim.ts.
 *
 *   offer (host) → accept (guest) → lobby (host, after every change) ⇄ ready (either)
 *   → start (host) → tick… (host) / move… (guest) → end (host) · leave (either) · ping (either)
 *   resend (guest): the ticks from a height, when one went missing. */
import { Chain, type Block, type Msg } from './chain';
import { CPU, YOU, chainSetup, decodeReplay, encodeReplay, parseMsg, type Unit } from './fleets';
import { hash32 } from '../core/util';

export const EVENT = 'structs.sim.match';
export const LIVE_BLOCK_MS = [2000, 4000, 6000];
/** A side heard nothing from for this long has left: the other wins (simulator-social.js GUEST_GONE_MS). */
export const GONE_MS = 30_000;
/** Each side says it is still there at least this often. */
export const PING_MS = 10_000;
/** An offer nobody took is stale after this. */
export const OFFER_TTL_MS = 15 * 60_000;
/** Under the homeserver's 65,536-byte event cap, with room for the envelope (matrix/sim.rs). */
export const MAX_BYTES = 60_000;
export const HOST = YOU.id, GUEST = CPU.id;

export type Role = 'host' | 'guest';
export interface Peer { id: string; name: string }
/** The battle both sides play: a replay code without orders (fleets, seed, charge, title) and the block time. */
export interface Battle { code: string; blockMs: number }
export interface Tx { s: 'h' | 'g'; msg: Msg }
export interface TickBlock { height: number; txs: Tx[]; /** The guest move this block took, by its number. */ took: number; sum: string }
export type Winner = 'host' | 'guest' | 'draw';
export type EndWhy = 'fleet' | 'stall' | 'forfeit' | 'gone';

interface Base { v: 1; match: string; role: Role }
export type Frame = Base & (
  | { kind: 'offer'; host: Peer; to: string | null; battle: Battle; at: number }
  | { kind: 'accept'; guest: Peer }
  | { kind: 'lobby'; host: Peer; guest: Peer | null; battle: Battle; ready: { host: boolean; guest: boolean } }
  | { kind: 'ready'; on: boolean }
  | { kind: 'start'; battle: Battle }
  | { kind: 'move'; n: number; msg: Msg }
  | { kind: 'tick'; blocks: TickBlock[] }
  | { kind: 'resend'; from: number }
  | { kind: 'end'; winner: Winner; why: EndWhy; height: number }
  | { kind: 'leave' }
  | { kind: 'ping' }
);
export type FrameOf<K extends Frame['kind']> = Extract<Frame, { kind: K }>;

const HOST_KINDS = ['offer', 'lobby', 'start', 'tick', 'end'];
const GUEST_KINDS = ['accept', 'move', 'resend'];
const BOTH_KINDS = ['ready', 'leave', 'ping'];
const MATCH = /^[A-Za-z0-9]{8,32}$/;
const PLAYER = /^1-\d{1,9}$/;
const SUM = /^[0-9a-f]{8}$/;

export const newMatchId = (rand: () => number = Math.random) => Array.from({ length: 12 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rand() * 32)]).join('');

/* ── Battles ─────────────────────────────────────────────────────────────── */

export function battleOf(units: Unit[], seed: string, charge: number, blockMs: number, title?: string): Battle {
  return { code: encodeReplay({ units, seed, start: 1000, charge, txs: [], title }), blockMs };
}
/** The fleets, seed and charge a battle stands for, or null if it is not one we'd play. */
export function openBattle(b: Battle) {
  const r = decodeReplay(b.code);
  if (!r || r.txs.length || !LIVE_BLOCK_MS.includes(b.blockMs)) return null;
  return { units: r.units, seed: r.seed, charge: r.charge ?? 10, title: r.title, blockMs: b.blockMs };
}
/** The chain both sides start from. */
export function chainFor(b: Battle): Chain | null {
  const o = openBattle(b);
  return o ? new Chain(chainSetup(o.units, o.seed, { player: o.charge, computer: o.charge }).setup) : null;
}

/** Everything the two chains must agree on after a block. */
export function stateSum(c: Chain): string {
  const parts: string[] = [String(c.height)];
  for (const id of Object.keys(c.structs).sort()) {
    const s = c.structs[id];
    parts.push(`${id}:${s.health}:${s.status}:${s.ambit}:${s.slot}:${s.protectedStructId ?? ''}:${s.destroyedAt ?? ''}`);
  }
  for (const id of Object.keys(c.players).sort()) parts.push(`${id}@${c.players[id].lastAction}`);
  for (const id of Object.keys(c.fleets).sort()) parts.push(`${id}${c.fleets[id].atBattle ? '+' : '-'}`);
  return hash32(parts.join('|')).toString(16).padStart(8, '0');
}

/* ── Frames, strictly: this is other people's JSON ───────────────────────── */

const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o);
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
function peer(o: unknown): Peer | null {
  if (!isObj(o) || typeof o.id !== 'string' || !PLAYER.test(o.id) || typeof o.name !== 'string') return null;
  return { id: o.id, name: o.name.slice(0, 40) };
}
function battle(o: unknown): Battle | null {
  if (!isObj(o) || typeof o.code !== 'string' || o.code.length > 20_000 || typeof o.blockMs !== 'number') return null;
  const b = { code: o.code, blockMs: o.blockMs };
  return openBattle(b) ? b : null;
}
function tickBlock(o: unknown): TickBlock | null {
  if (!isObj(o) || !int(o.height, 1, 1e7) || !int(o.took, 0, 1e7) || typeof o.sum !== 'string' || !SUM.test(o.sum) || !Array.isArray(o.txs) || o.txs.length > 4) return null;
  const txs: Tx[] = [];
  for (const t of o.txs) {
    if (!isObj(t) || (t.s !== 'h' && t.s !== 'g')) return null;
    const msg = parseMsg(t.msg);
    if (!msg) return null;
    txs.push({ s: t.s, msg });
  }
  return { height: o.height as number, txs, took: o.took as number, sum: o.sum };
}

/** One frame, checked for shape, size and who may send it; anything else is null. */
export function parseFrame(o: unknown): Frame | null {
  if (!isObj(o) || o.v !== 1 || typeof o.match !== 'string' || !MATCH.test(o.match) || (o.role !== 'host' && o.role !== 'guest') || typeof o.kind !== 'string') return null;
  const kind = o.kind as Frame['kind'], role = o.role as Role;
  if (!(BOTH_KINDS.includes(kind) || (role === 'host' ? HOST_KINDS : GUEST_KINDS).includes(kind))) return null;
  try { if (JSON.stringify(o).length > MAX_BYTES) return null; } catch { return null; }
  const base = { v: 1 as const, match: o.match, role };
  switch (kind) {
    case 'offer': {
      const h = peer(o.host), b = battle(o.battle);
      const to = o.to == null ? null : typeof o.to === 'string' && PLAYER.test(o.to) ? o.to : undefined;
      if (!h || !b || to === undefined || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
      return { ...base, kind, host: h, to, battle: b, at: o.at };
    }
    case 'accept': { const g = peer(o.guest); return g ? { ...base, kind, guest: g } : null; }
    case 'lobby': {
      const h = peer(o.host), g = o.guest == null ? null : peer(o.guest), b = battle(o.battle), r = o.ready;
      if (!h || (o.guest != null && !g) || !b || !isObj(r) || typeof r.host !== 'boolean' || typeof r.guest !== 'boolean') return null;
      return { ...base, kind, host: h, guest: g, battle: b, ready: { host: r.host, guest: r.guest } };
    }
    case 'ready': return typeof o.on === 'boolean' ? { ...base, kind, on: o.on } : null;
    case 'start': { const b = battle(o.battle); return b ? { ...base, kind, battle: b } : null; }
    case 'move': { const msg = parseMsg(o.msg); return msg && int(o.n, 1, 1e7) ? { ...base, kind, n: o.n as number, msg } : null; }
    case 'tick': {
      if (!Array.isArray(o.blocks) || !o.blocks.length || o.blocks.length > 64) return null;
      const blocks = o.blocks.map(tickBlock);
      if (blocks.some((b) => !b) || blocks.some((b, i) => i && b!.height !== blocks[i - 1]!.height + 1)) return null;
      return { ...base, kind, blocks: blocks as TickBlock[] };
    }
    case 'resend': return int(o.from, 1, 1e7) ? { ...base, kind, from: o.from as number } : null;
    case 'end': {
      const w = o.winner, why = o.why;
      if ((w !== 'host' && w !== 'guest' && w !== 'draw') || !['fleet', 'stall', 'forfeit', 'gone'].includes(String(why)) || !int(o.height, 0, 1e7)) return null;
      return { ...base, kind, winner: w, why: why as EndWhy, height: o.height as number };
    }
    case 'leave': return { ...base, kind };
    case 'ping': return { ...base, kind };
  }
  return null;
}

/** Ticks waiting to go out together (a slow homeserver): one frame, as long as it fits. */
export function mergeTicks(frames: FrameOf<'tick'>[]): FrameOf<'tick'>[] {
  const out: FrameOf<'tick'>[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    const joined = last && last.match === f.match && last.blocks[last.blocks.length - 1].height + 1 === f.blocks[0].height && last.blocks.length + f.blocks.length <= 64 ? { ...last, blocks: [...last.blocks, ...f.blocks] } : null;
    if (joined && JSON.stringify(joined).length <= MAX_BYTES) out[out.length - 1] = joined;
    else out.push(f);
  }
  return out;
}

/* ── Who won, in each side's terms ───────────────────────────────────────── */

export type Local = 'player' | 'computer' | 'draw';
/** The screen's winner (`player` is whoever looks at it) as the match's. */
export const toWinner = (w: Local, role: Role): Winner => (w === 'draw' ? 'draw' : (w === 'player') === (role === 'host') ? 'host' : 'guest');
/** The match's winner as the screen's. */
export const toLocal = (w: Winner, role: Role): Local => (w === 'draw' ? 'draw' : w === role ? 'player' : 'computer');

/* ── The host: the chain, the clock, and the guest's moves in place of the computer ───── */

export class HostLink {
  private waiting: { n: number; msg: Msg } | null = null;
  private took = 0;
  /** Every block sent, for a guest that missed one. */
  readonly sent: TickBlock[] = [];
  constructor(readonly match: string, readonly chain: Chain) {}

  /** A guest's move: the latest one before the block wins, and none is played twice. */
  move(f: { n: number; msg: Msg }) {
    if (f.n <= this.took || (this.waiting && f.n <= this.waiting.n)) return;
    this.waiting = { n: f.n, msg: f.msg };
  }
  /** Is a guest move waiting for the next block? */
  get pending() { return !!this.waiting; }

  /** The next block: my order, then the guest's latest, exactly as the guest will submit them. */
  step(mine: Msg | null): { block: Block; subs: { signer: string; msg: Msg }[]; frame: FrameOf<'tick'> } {
    const txs: Tx[] = [], subs: { signer: string; msg: Msg }[] = [];
    if (mine) { this.chain.submit(HOST, mine); txs.push({ s: 'h', msg: mine }); subs.push({ signer: HOST, msg: mine }); }
    const g = this.waiting;
    this.waiting = null;
    if (g) { this.chain.submit(GUEST, g.msg); txs.push({ s: 'g', msg: g.msg }); subs.push({ signer: GUEST, msg: g.msg }); this.took = g.n; }
    const block = this.chain.produceBlock();
    const tb: TickBlock = { height: block.height, txs, took: this.took, sum: stateSum(this.chain) };
    this.sent.push(tb);
    return { block, subs, frame: { v: 1, match: this.match, role: 'host', kind: 'tick', blocks: [tb] } };
  }
  /** The blocks from `from` on, for a resend (at most 64 a frame). */
  resend(from: number): FrameOf<'tick'>[] {
    const list = this.sent.filter((b) => b.height >= from);
    const out: FrameOf<'tick'>[] = [];
    for (let i = 0; i < list.length; i += 64) out.push({ v: 1, match: this.match, role: 'host', kind: 'tick', blocks: list.slice(i, i + 64) });
    return out;
  }
}

/* ── The guest: its own copy of the chain, moved by the host's ticks ─────── */

export class GuestLink {
  private inbox = new Map<number, TickBlock>();
  private n = 0;
  private took = 0;
  /** The first block whose checksum disagreed with the host's, if any did. */
  desync: number | null = null;
  constructor(readonly match: string, readonly chain: Chain) {}

  /** My order for the next block, as the frame that carries it. */
  move(msg: Msg): FrameOf<'move'> { return { v: 1, match: this.match, role: 'guest', kind: 'move', n: ++this.n, msg }; }
  /** Sent, and not yet in a block the host produced. */
  get pending() { return this.n > this.took; }

  receive(f: FrameOf<'tick'>) { for (const b of f.blocks) if (b.height > this.chain.height) this.inbox.set(b.height, b); }
  /** The next block, once its tick is here. */
  next(): { block: Block; subs: { signer: string; msg: Msg }[]; ok: boolean } | null {
    const tb = this.inbox.get(this.chain.height + 1);
    if (!tb) return null;
    this.inbox.delete(tb.height);
    const subs = tb.txs.map((t) => ({ signer: t.s === 'h' ? HOST : GUEST, msg: t.msg }));
    for (const s of subs) this.chain.submit(s.signer, s.msg);
    const block = this.chain.produceBlock();
    this.took = Math.max(this.took, tb.took);
    const ok = stateSum(this.chain) === tb.sum;
    if (!ok && this.desync == null) this.desync = block.height;
    return { block, subs, ok };
  }
  /** The first missing height when a later block came first, else null. */
  gap(): number | null {
    if (!this.inbox.size || this.inbox.has(this.chain.height + 1)) return null;
    return this.chain.height + 1;
  }
}

/* ── The lobby: offer → joined → live → ended | cancelled ────────────────── */

export type LobbyState = 'offered' | 'joined' | 'live' | 'ended' | 'cancelled';
export interface Lobby {
  match: string; role: Role; state: LobbyState; me: Peer;
  host: Peer | null; guest: Peer | null; to: string | null; battle: Battle | null;
  ready: { host: boolean; guest: boolean };
  /** Why it closed, for the screen. */
  why?: 'declined' | 'taken' | 'left' | 'cancelled';
}

export function hostLobby(match: string, me: Peer, battle: Battle, to: string | null): Lobby {
  return { match, role: 'host', state: 'offered', me, host: me, guest: null, to, battle, ready: { host: false, guest: false } };
}
export function guestLobby(match: string, me: Peer): Lobby {
  return { match, role: 'guest', state: 'offered', me, host: null, guest: null, to: me.id, battle: null, ready: { host: false, guest: false } };
}
export const bothReady = (l: Lobby) => l.state === 'joined' && !!l.guest && l.ready.host && l.ready.guest;
export const lobbyFrame = (l: Lobby): FrameOf<'lobby'> => ({ v: 1, match: l.match, role: 'host', kind: 'lobby', host: l.host!, guest: l.guest, battle: l.battle!, ready: { ...l.ready } });

/** A frame from the other side, applied to the lobby. Frames of my own role, or for another match, change nothing. */
export function lobbyStep(l: Lobby, f: Frame): Lobby {
  if (f.match !== l.match || f.role === l.role || l.state === 'ended' || l.state === 'cancelled') return l;
  if (l.role === 'host') {
    switch (f.kind) {
      case 'accept':
        if (l.state !== 'offered' && !(l.state === 'joined' && l.guest?.id === f.guest.id)) return l;
        if (l.to && f.guest.id !== l.to) return l;
        return { ...l, state: 'joined', guest: f.guest, ready: { host: l.ready.host, guest: l.guest?.id === f.guest.id ? l.ready.guest : false } };
      case 'ready': return l.state === 'joined' ? { ...l, ready: { ...l.ready, guest: f.on } } : l;
      case 'leave': return l.state === 'live' ? { ...l, state: 'ended' } : { ...l, state: 'cancelled', why: l.state === 'joined' ? 'left' : 'declined' };
    }
    return l;
  }
  switch (f.kind) {
    case 'offer': return l.state === 'offered' ? { ...l, host: f.host, battle: f.battle, to: f.to } : l;
    case 'lobby':
      if (l.state === 'live') return l;
      if (f.guest && f.guest.id !== l.me.id) return { ...l, state: 'cancelled', why: 'taken', host: f.host };
      return { ...l, state: f.guest ? 'joined' : 'offered', host: f.host, guest: f.guest, battle: f.battle, ready: { ...f.ready } };
    case 'start': return l.state === 'joined' || l.state === 'offered' ? { ...l, state: 'live', battle: f.battle } : l;
    case 'end': return { ...l, state: 'ended' };
    case 'leave': return l.state === 'live' ? { ...l, state: 'ended' } : { ...l, state: 'cancelled', why: 'cancelled' };
  }
  return l;
}

/* ── Silence: the forfeit timer ──────────────────────────────────────────── */

export class Watchdog {
  private last: number;
  constructor(now: number, readonly goneMs = GONE_MS) { this.last = now; }
  heard(now: number) { this.last = Math.max(this.last, now); }
  quiet(now: number) { return Math.max(0, now - this.last); }
  /** Seconds left before the other side forfeits, or null while it is talking. */
  countdown(now: number) { const q = this.quiet(now); return q > this.goneMs / 2 ? Math.max(0, Math.ceil((this.goneMs - q) / 1000)) : null; }
  gone(now: number) { return this.quiet(now) >= this.goneMs; }
}
