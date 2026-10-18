/* 실시간 대전 over Matrix: the transport for src/sim/live.ts. A match lives in the two players' DM as
 * `structs.sim.match` events; the offer also rides on a readable m.room.message, so it is a card in
 * 통신 (src/social/challenge.ts) and a line in any other client.
 *
 *   offers / statusOf()   every match seen in any room, history included: chat cards and a guest's join
 *   DuelLink              one side of one match: frames in (from the peer only), frames out in order
 *                         (ticks merge while a send waits out the homeserver's rate limit), pings,
 *                         and the watchdog that turns silence into a forfeit
 *   offerDuel / joinDuel  open one
 *   h2h()                 this browser's record against each commander */
import { matrix, localpart, type MatrixEvent } from './matrix';
import { EVENT, PING_MS, Watchdog, mergeTicks, newMatchId, openBattle, parseFrame, type Battle, type Frame, type FrameOf, type Peer, type Role } from '../sim/live';
import { webRoot } from '../core/desktop';

export type MatchStatus = 'open' | 'live' | 'ended' | 'cancelled';
export interface OfferSeen { frame: FrameOf<'offer'>; room: string; sender: string; ts: number }
/** Every offer seen, by match. */
export const offers = new Map<string, OfferSeen>();
const status = new Map<string, MatchStatus>();
const fns = new Set<() => void>();
/** A match's state as the room shows it (for a challenge card). */
export const statusOf = (match: string): MatchStatus | null => status.get(match) ?? (offers.has(match) ? 'open' : null);
export const onDuels = (f: () => void) => { fns.add(f); return () => { fns.delete(f); }; };

const frameOf = (ev: MatrixEvent): Frame | null => {
  if (ev.type === EVENT) return parseFrame(ev.content);
  if (ev.type === 'm.room.message' && ev.content?.[EVENT]) {
    const f = parseFrame(ev.content[EVENT]);
    // Only an offer travels on a message: anything else there is somebody's idea of a joke.
    return f?.kind === 'offer' ? f : null;
  }
  return null;
};

const links = new Set<DuelLink>();
function seen(roomId: string, ev: MatrixEvent, initial: boolean) {
  const f = frameOf(ev);
  if (!f) return;
  if (f.kind === 'offer' && f.role === 'host' && !offers.has(f.match)) offers.set(f.match, { frame: f, room: roomId, sender: ev.sender, ts: ev.origin_server_ts });
  const s = f.kind === 'start' || f.kind === 'tick' ? 'live' : f.kind === 'end' ? 'ended' : f.kind === 'leave' ? (status.get(f.match) === 'live' ? 'ended' : 'cancelled') : null;
  if (s && status.get(f.match) !== 'ended') status.set(f.match, s);
  if (!initial) for (const l of links) l.receive(roomId, ev.sender, f, ev.origin_server_ts);
  if (f.kind === 'offer' || s) for (const g of fns) g();
}
// Whatever arrived before this module loaded, then everything after.
for (const c of matrix.custom) seen(c.roomId, c.ev, true);
matrix.onTimeline(seen);

/** Signed in, syncing, and past the first sync (so history is in `offers`). */
export async function ready(timeoutMs = 12_000) {
  await matrix.signIn();
  matrix.start();
  if (matrix.state === 'live') return;
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => { off(); rej(new Error('채팅 서버에 연결하지 못했습니다.')); }, timeoutMs);
    const off = matrix.onChange(() => { if (matrix.state === 'live') { clearTimeout(t); off(); res(); } });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One side of one match. */
export class DuelLink {
  /** The other player's Matrix id: frames from anyone else are dropped. */
  peer: string | null;
  readonly dog = new Watchdog(Date.now());
  private queue: Frame[] = [];
  private busy = false;
  private closed = false;
  private lastSent = 0;
  private pinger: ReturnType<typeof setInterval>;
  private fns = new Set<(f: Frame, sender: string) => void>();
  /** Sends that keep failing: the screen says so. */
  failing = false;

  constructor(readonly role: Role, readonly match: string, readonly room: string, peer: string | null) {
    this.peer = peer;
    links.add(this);
    this.pinger = setInterval(() => { if (Date.now() - this.lastSent >= PING_MS / 2) this.send({ kind: 'ping' }); }, PING_MS / 2);
  }
  onFrame(f: (frame: Frame, sender: string) => void) { this.fns.add(f); return () => { this.fns.delete(f); }; }

  receive(roomId: string, sender: string, f: Frame, _ts: number) {
    if (this.closed || roomId !== this.room || f.match !== this.match || f.role === this.role) return;
    if (this.peer && sender !== this.peer) return;
    this.dog.heard(Date.now());
    for (const g of this.fns) { try { g(f, sender); } catch (e) { console.error(e); } }
    // Spoken to and quiet a while: answer. A background tab's timers can be slowed to a crawl, but
    // frames still arrive, so the heartbeat never rests on the timer alone.
    if (!this.closed && f.kind !== 'ping' && Date.now() - this.lastSent >= PING_MS / 2) this.send({ kind: 'ping' });
  }

  /** A frame to the other side, after every one before it. */
  send(f: DistributiveOmit<Frame, 'v' | 'match' | 'role'>) {
    if (this.closed) return;
    this.queue.push({ ...f, v: 1, match: this.match, role: this.role } as Frame);
    void this.flush();
  }
  private async flush() {
    if (this.busy) return;
    this.busy = true;
    let fails = 0;
    while (this.queue.length) {
      // Blocks that passed while a send waited go out as one tick.
      let n = 0;
      while (n < this.queue.length && this.queue[n].kind === 'tick') n++;
      if (n > 1) this.queue.splice(0, n, ...mergeTicks(this.queue.slice(0, n) as FrameOf<'tick'>[]));
      try {
        await matrix.sendEvent(this.room, EVENT, this.queue[0]);
        this.queue.shift();
        this.lastSent = Date.now();
        fails = 0; this.failing = false;
      } catch {
        fails++;
        this.failing = fails >= 3;
        // Pings are only worth their moment; the rest waits out the rate limit.
        if (this.queue[0].kind === 'ping') this.queue.shift();
        if (fails > 8) { this.queue = this.queue.filter((q) => q.kind !== 'ping'); }
        await sleep(Math.min(8000, 750 * 2 ** Math.min(fails, 4)));
      }
    }
    this.busy = false;
  }
  /** Stop listening and pinging; whatever is queued (a last `end` or `leave`) still goes. */
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    links.delete(this);
    this.fns.clear();
  }
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export const joinUrl = (match: string, room: string) => `${webRoot()}/sim?join=${match}&room=${encodeURIComponent(room)}`;

/** Challenge a commander: the offer goes into our DM, as a card and as a frame. */
export async function offerDuel(me: Peer, to: Peer, battle: Battle): Promise<DuelLink> {
  await ready();
  const room = await matrix.dm(to.id);
  const match = newMatchId();
  const o = openBattle(battle)!;
  const frame: FrameOf<'offer'> = { v: 1, match, role: 'host', kind: 'offer', host: me, to: to.id, battle, at: Date.now() };
  const n = (side: string) => o.units.filter((u) => u.side === side).length;
  const body = `[실시간 대전 신청] ${o.title || '모의전'} · ${n('player')} 대 ${n('computer')} · 블록 ${battle.blockMs / 1000}초\n${joinUrl(match, room)}`;
  const link = new DuelLink('host', match, room, null);
  await matrix.sendEvent(room, 'm.room.message', { msgtype: 'm.text', body, [EVENT]: frame });
  return link;
}

/** Answer an offer: the link, and the offer if this browser has seen it. */
export async function joinDuel(match: string, room: string): Promise<{ link: DuelLink; offer: OfferSeen | null }> {
  await ready();
  const offer = offers.get(match) ?? null;
  if (offer && offer.room !== room) throw new Error('대전 신청의 대화방이 맞지 않습니다.');
  return { link: new DuelLink('guest', match, room, offer?.sender ?? null), offer };
}

export const myPeer = (name?: string): Peer => ({ id: localpart(matrix.me), name: name || matrix.displayName(null, matrix.me) });

/* ── Head to head: this browser's record against each commander ──────────── */
const H2H = 'structs-kor.sim.h2h';
export type H2H = { w: number; l: number; d: number };
export function h2h(peerId: string): H2H {
  try { return (JSON.parse(localStorage.getItem(H2H) || '{}') as Record<string, H2H>)[peerId] ?? { w: 0, l: 0, d: 0 }; } catch { return { w: 0, l: 0, d: 0 }; }
}
export function recordH2H(peerId: string, result: 'w' | 'l' | 'd'): H2H {
  let all: Record<string, H2H> = {};
  try { all = JSON.parse(localStorage.getItem(H2H) || '{}'); } catch { /* fresh */ }
  const r = all[peerId] ?? { w: 0, l: 0, d: 0 };
  r[result]++;
  all[peerId] = r;
  try { localStorage.setItem(H2H, JSON.stringify(all)); } catch { /* fine */ }
  return r;
}
