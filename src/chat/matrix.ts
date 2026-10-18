/* A small Matrix client for 통신. Sign-in is the guild's: the wallet signs the same
 * LOGIN_GUILD… message, POST /api/auth/matrix returns Matrix tokens (the guild runs MAS), and the
 * page then talks to the homeserver directly (through /relay/matrix in dev). Long-poll /sync.
 *
 * What a room holds: messages (text, emote), replies, edits, reactions, redactions, the pinned list,
 * topic, members with display names, who is typing, and read receipts. Invites are their own list.
 * Under `?mock=1` the homeserver is src/chat/mockserver.ts, in this tab. */
import { endpoints, GUILD_ID } from '../config';
import { wallet } from '../wallet/wallet';
import { guildApi } from '../api/guild';
import { MOCK } from '../api/http';

export interface Member { id: string; name: string; avatar?: string; membership: string }
export interface Reaction { key: string; senders: string[]; mine?: string }
export interface Message {
  id: string; sender: string; body: string; ts: number; mine: boolean;
  emote?: boolean; replyTo?: string; edited?: boolean; redacted?: boolean; notice?: boolean;
  reactions: Reaction[];
  /** The original's id for a local echo still in flight; 'failed' when the send did not go. */
  pending?: 'sending' | 'failed'; txn?: string;
}
export interface Room {
  id: string; name: string; alias: string | null; topic: string; direct: boolean; local: boolean; unread: number; highlight: number;
  members: number; memberList: Map<string, Member>; events: Message[]; pinned: string[]; typing: string[];
  readUpTo: Record<string, string>; prevBatch: string | null; noMoreHistory?: boolean;
}
export interface Invite { id: string; name: string; inviter: string; direct: boolean }

const TOKEN_KEY = 'structs-kor.matrix';
interface Grant { access_token: string; user_id: string; device_id: string }

const deviceId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 36]).join('');
/** "@1-42:matrix.server" → "1-42". */
export const localpart = (uid: string) => uid.replace(/^@/, '').split(':')[0];

export class Matrix {
  grant: Grant | null = null;
  rooms = new Map<string, Room>();
  invites = new Map<string, Invite>();
  state: 'idle' | 'connecting' | 'live' | 'stalled' | 'expired' = 'idle';
  private since: string | null = null;
  private running = false;
  private ctl: AbortController | null = null;
  private fns = new Set<() => void>();
  private directIds = new Set<string>();
  private relations = new Map<string, { reactions: Map<string, { key: string; sender: string; target: string }> }>();

  onChange(f: () => void) { this.fns.add(f); return () => this.fns.delete(f); }
  private emit() { for (const f of this.fns) f(); }
  get server() { return this.grant?.user_id.split(':').slice(1).join(':') ?? ''; }
  get me() { return this.grant?.user_id ?? ''; }
  /** Rooms muted on this device: no badge, no notices. */
  muted = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('structs-kor.chat.muted') || '[]') as string[]; } catch { return []; } })());
  toggleMute(id: string) { if (this.muted.has(id)) this.muted.delete(id); else this.muted.add(id); try { localStorage.setItem('structs-kor.chat.muted', JSON.stringify([...this.muted])); } catch { /* fine */ } this.emit(); return this.muted.has(id); }
  /** Unread across rooms (muted ones aside), and whether any of it names me. */
  get unread() { let n = 0, hi = 0; for (const r of this.rooms.values()) { if (this.muted.has(r.id)) continue; n += r.unread; hi += r.highlight; } return { n: n + this.invites.size, hi }; }

  async signIn() {
    if (this.grant) return;
    if (MOCK) { this.grant = { access_token: 'mock', user_id: `@${(await import('../api/session')).session.playerId ?? '1-42'}:mock.structs`, device_id: 'MOCK' }; return; }
    try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); if (t?.access_token) { this.grant = t; return; } } catch { /* fresh */ }
    const k = wallet.key(0);
    const ts = (await guildApi.timestamp()).unix_timestamp;
    const s = wallet.signMessage(0, `LOGIN_GUILD${GUILD_ID}ADDRESS${k.address}DATETIME${ts}`);
    const g = await guildApi.matrixLogin({ address: k.address, pubkey: s.pubkey, signature: s.signature, guild_id: GUILD_ID, unix_timestamp: ts, device_id: deviceId() });
    // The guild answers "nothing" as 200 + null: that is a refusal, not a session.
    if (!g?.access_token || !g.user_id) throw new Error('채팅 서버가 로그인 정보를 보내지 않았습니다.');
    this.grant = { access_token: g.access_token, user_id: g.user_id, device_id: g.device_id };
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.grant)); } catch { /* fine */ }
  }
  /** Whether this browser could chat at all (a wallet to sign the login, or the mock). */
  get possible() { return MOCK || wallet.state === 'unlocked'; }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.grant) throw new Error('채팅에 로그인하지 않았습니다.');
    if (import.meta.env.DEV && MOCK) return (await import('./mockserver')).mockMatrix<T>(path, init, this.grant.user_id);
    const r = await fetch(endpoints.matrix + '/_matrix/client' + path, { ...init, headers: { authorization: 'Bearer ' + this.grant.access_token, 'content-type': 'application/json', ...(init.headers || {}) } });
    if (r.status === 401) { this.grant = null; this.state = 'expired'; try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* fine */ } throw new Error('채팅 세션이 만료되었습니다.'); }
    if (!r.ok) { const b = await r.json().catch(() => null) as { error?: string } | null; throw new Error(b?.error || `Matrix ${r.status}`); }
    return r.json() as Promise<T>;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.state = 'connecting';
    void this.loop();
  }
  stop() { this.running = false; this.ctl?.abort(); if (this.state !== 'expired') this.state = 'idle'; }
  /** Signed in with the room list filled, without starting the long-poll (share sheets, the bridge). */
  async ensure() {
    await this.signIn();
    if (this.rooms.size || this.running) return;
    const body = await this.req<SyncBody>(`/v3/sync?filter=${this.filter(1)}&timeout=0`);
    this.ingest(body);
    this.emit();
  }

  private filter(limit: number) {
    return encodeURIComponent(JSON.stringify({ room: { timeline: { limit }, state: { lazy_load_members: true }, ephemeral: { types: ['m.typing', 'm.receipt'] } } }));
  }
  private async loop() {
    let fails = 0;
    while (this.running) {
      try {
        this.ctl = new AbortController();
        const q = `/v3/sync?filter=${this.filter(40)}&timeout=${this.since ? 30000 : 0}${this.since ? '&since=' + encodeURIComponent(this.since) : ''}`;
        const body = await this.req<SyncBody>(q, { signal: this.ctl.signal });
        this.since = body.next_batch;
        this.ingest(body);
        fails = 0;
        this.state = 'live';
        this.emit();
      } catch (e) {
        if ((e as Error).name === 'AbortError' || !this.running) return;
        if (this.state === 'expired') { this.running = false; this.emit(); return; }
        fails++; this.state = 'stalled'; this.emit();
        await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** Math.min(fails, 4))));
      }
    }
  }

  private room(id: string): Room {
    let r = this.rooms.get(id);
    if (!r) {
      r = { id, name: id, alias: null, topic: '', direct: false, local: id.endsWith(':' + this.server), unread: 0, highlight: 0, members: 0, memberList: new Map(), events: [], pinned: [], typing: [], readUpTo: {}, prevBatch: null };
      this.rooms.set(id, r);
    }
    return r;
  }

  /** One event into a room: state, messages, relations. `older` means it came from history. */
  private apply(room: Room, ev: Ev, older = false) {
    const c = ev.content ?? {};
    switch (ev.type) {
      case 'm.room.name': if (c.name) room.name = String(c.name); break;
      case 'm.room.topic': room.topic = String(c.topic ?? ''); break;
      case 'm.room.canonical_alias': if (c.alias) { room.alias = String(c.alias); if (room.name === room.id) room.name = room.alias; } break;
      case 'm.room.pinned_events': room.pinned = Array.isArray(c.pinned) ? (c.pinned as string[]) : []; break;
      case 'm.room.member': {
        const id = ev.state_key ?? ev.sender;
        room.memberList.set(id, { id, name: String(c.displayname ?? localpart(id)), avatar: c.avatar_url ? String(c.avatar_url) : undefined, membership: String(c.membership ?? 'join') });
        break;
      }
      case 'm.reaction': {
        const rel = c['m.relates_to'] as { event_id?: string; key?: string; rel_type?: string } | undefined;
        if (rel?.rel_type !== 'm.annotation' || !rel.event_id || !rel.key) break;
        const target = room.events.find((m) => m.id === rel.event_id);
        if (!this.relations.has(room.id)) this.relations.set(room.id, { reactions: new Map() });
        this.relations.get(room.id)!.reactions.set(ev.event_id, { key: rel.key, sender: ev.sender, target: rel.event_id });
        if (target) addReaction(target, rel.key, ev.sender, ev.sender === this.me ? ev.event_id : undefined);
        break;
      }
      case 'm.room.redaction': {
        const id = ev.redacts ?? (c.redacts as string | undefined);
        if (!id) break;
        const msg = room.events.find((m) => m.id === id);
        if (msg) { msg.redacted = true; msg.body = ''; msg.reactions = []; }
        const rx = this.relations.get(room.id)?.reactions.get(id);
        if (rx) { const t = room.events.find((m) => m.id === rx.target); if (t) removeReaction(t, rx.key, rx.sender); this.relations.get(room.id)!.reactions.delete(id); }
        break;
      }
      case 'm.room.message': {
        const rel = c['m.relates_to'] as { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id: string } } | undefined;
        if (rel?.rel_type === 'm.replace' && rel.event_id) {
          const t = room.events.find((m) => m.id === rel.event_id);
          const nc = (c['m.new_content'] ?? {}) as { body?: string };
          if (t && t.sender === ev.sender && typeof nc.body === 'string') { t.body = nc.body; t.edited = true; }
          break;
        }
        if (typeof c.body !== 'string' || room.events.some((m) => m.id === ev.event_id)) break;
        // A local echo is replaced by the real event once the server hands it back.
        const txn = ev.unsigned?.transaction_id;
        const echo = txn ? room.events.findIndex((m) => m.txn === txn) : -1;
        const msg: Message = {
          id: ev.event_id, sender: ev.sender, body: stripFallback(c.body), ts: ev.origin_server_ts, mine: ev.sender === this.me,
          emote: c.msgtype === 'm.emote', notice: c.msgtype === 'm.notice', replyTo: rel?.['m.in_reply_to']?.event_id, reactions: [],
        };
        if (echo >= 0) room.events.splice(echo, 1, msg);
        else if (older) room.events.unshift(msg); else room.events.push(msg);
        // Reactions that arrived before their target (history order).
        for (const [rid, rx] of this.relations.get(room.id)?.reactions ?? []) if (rx.target === msg.id) addReaction(msg, rx.key, rx.sender, rx.sender === this.me ? rid : undefined);
        break;
      }
    }
  }

  private ingest(b: SyncBody) {
    for (const ev of b.account_data?.events ?? []) if (ev.type === 'm.direct') for (const ids of Object.values(ev.content as Record<string, string[]>)) for (const id of ids) this.directIds.add(id);
    for (const [id, r] of Object.entries(b.rooms?.join ?? {})) {
      this.invites.delete(id);
      const room = this.room(id);
      for (const ev of r.state?.events ?? []) this.apply(room, ev);
      if (r.timeline?.limited) room.events = room.events.filter((m) => m.pending);
      if (r.timeline?.prev_batch && !room.prevBatch) room.prevBatch = r.timeline.prev_batch;
      for (const ev of r.timeline?.events ?? []) this.apply(room, ev);
      for (const ev of r.ephemeral?.events ?? []) {
        if (ev.type === 'm.typing') room.typing = ((ev.content.user_ids as string[]) ?? []).filter((u) => u !== this.me);
        if (ev.type === 'm.receipt') for (const [eid, rc] of Object.entries(ev.content as Record<string, { 'm.read'?: Record<string, unknown> }>)) for (const u of Object.keys(rc['m.read'] ?? {})) room.readUpTo[u] = eid;
      }
      room.events = room.events.slice(-400);
      room.unread = r.unread_notifications?.notification_count ?? room.unread;
      room.highlight = r.unread_notifications?.highlight_count ?? room.highlight;
      room.members = r.summary?.['m.joined_member_count'] ?? room.members ?? room.memberList.size;
      if (!room.members) room.members = [...room.memberList.values()].filter((m) => m.membership === 'join').length;
      room.direct = this.directIds.has(id);
      room.local = (room.alias ?? id).endsWith(':' + this.server);
      if ((room.name === id || !room.name) && room.direct) {
        const other = [...room.memberList.values()].find((m) => m.id !== this.me);
        room.name = other?.name ?? '다이렉트 메시지';
      }
    }
    for (const [id, r] of Object.entries(b.rooms?.invite ?? {})) {
      let name = id, inviter = '', direct = false;
      for (const ev of r.invite_state?.events ?? []) {
        if (ev.type === 'm.room.name') name = String(ev.content.name ?? name);
        if (ev.type === 'm.room.canonical_alias' && name === id) name = String(ev.content.alias ?? name);
        if (ev.type === 'm.room.member' && ev.state_key === this.me) { inviter = ev.sender; direct = !!ev.content.is_direct; }
      }
      this.invites.set(id, { id, name: direct && name === id ? localpart(inviter) : name, inviter, direct });
    }
    for (const id of Object.keys(b.rooms?.leave ?? {})) { this.rooms.delete(id); this.invites.delete(id); }
  }

  /* ── Writes ── */
  private txn() { return 'kor' + Date.now() + Math.random().toString(36).slice(2, 6); }
  private put(roomId: string, type: string, content: unknown, txn = this.txn()) {
    return this.req<{ event_id: string }>(`/v3/rooms/${encodeURIComponent(roomId)}/send/${type}/${txn}`, { method: 'PUT', body: JSON.stringify(content) });
  }
  /** Send a message with a local echo (shown at once, marked failed if it does not go). */
  async send(roomId: string, body: string, o: { emote?: boolean; replyTo?: string } = {}) {
    const txn = this.txn();
    const room = this.rooms.get(roomId);
    const content: Record<string, unknown> = { msgtype: o.emote ? 'm.emote' : 'm.text', body };
    if (o.replyTo) content['m.relates_to'] = { 'm.in_reply_to': { event_id: o.replyTo } };
    // Who is named: @1-42 mentions become real mentions (pings).
    const named = [...body.matchAll(/@(1-\d{1,9})\b/g)].map((m) => `@${m[1]}:${this.server}`);
    if (named.length) content['m.mentions'] = { user_ids: named };
    const echo: Message = { id: '~' + txn, txn, sender: this.me, body, ts: Date.now(), mine: true, emote: o.emote, replyTo: o.replyTo, reactions: [], pending: 'sending' };
    if (room) { room.events.push(echo); this.emit(); }
    try {
      const r = await this.put(roomId, 'm.room.message', content, txn);
      if (room) {
        const i = room.events.indexOf(echo);
        if (i >= 0 && !room.events.some((m) => m.id === r.event_id)) { echo.id = r.event_id; delete echo.pending; }
        else if (i >= 0) room.events.splice(i, 1);
      }
      this.emit();
      return r;
    } catch (e) { echo.pending = 'failed'; this.emit(); throw e; }
  }
  retry(roomId: string, msg: Message) {
    const room = this.rooms.get(roomId);
    if (room) room.events = room.events.filter((m) => m !== msg);
    return this.send(roomId, msg.body, { emote: msg.emote, replyTo: msg.replyTo });
  }
  edit(roomId: string, eventId: string, body: string) {
    return this.put(roomId, 'm.room.message', { msgtype: 'm.text', body: '* ' + body, 'm.new_content': { msgtype: 'm.text', body }, 'm.relates_to': { rel_type: 'm.replace', event_id: eventId } });
  }
  redact(roomId: string, eventId: string) {
    return this.req(`/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${this.txn()}`, { method: 'PUT', body: '{}' });
  }
  /** Toggle my reaction `key` on a message. */
  async react(roomId: string, msg: Message, key: string) {
    const mine = msg.reactions.find((r) => r.key === key)?.mine;
    if (mine) { removeReaction(msg, key, this.me); this.emit(); await this.redact(roomId, mine); return; }
    addReaction(msg, key, this.me, '~pending'); this.emit();
    const r = await this.put(roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: msg.id, key } });
    const rx = msg.reactions.find((x) => x.key === key);
    if (rx) rx.mine = r.event_id;
  }
  async pin(roomId: string, eventId: string, on: boolean) {
    const room = this.rooms.get(roomId);
    const list = (room?.pinned ?? []).filter((x) => x !== eventId);
    if (on) list.unshift(eventId);
    await this.req(`/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events/`, { method: 'PUT', body: JSON.stringify({ pinned: list }) });
    if (room) { room.pinned = list; this.emit(); }
  }
  private lastTyping = 0;
  typing(roomId: string, on: boolean) {
    // Throttled: one "typing" notice per 8 s, and a stop when the draft empties.
    const now = Date.now();
    if (on && now - this.lastTyping < 8000) return;
    this.lastTyping = on ? now : 0;
    void this.req(`/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.me)}`, { method: 'PUT', body: JSON.stringify(on ? { typing: true, timeout: 10000 } : { typing: false }) }).catch(() => null);
  }
  join(aliasOrId: string) { return this.req<{ room_id: string }>(`/v3/join/${encodeURIComponent(aliasOrId)}`, { method: 'POST', body: '{}' }); }
  async leave(roomId: string) { await this.req(`/v3/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST', body: '{}' }); this.rooms.delete(roomId); this.emit(); }
  async decline(roomId: string) { await this.req(`/v3/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST', body: '{}' }); this.invites.delete(roomId); this.emit(); }
  read(roomId: string, eventId: string) { if (eventId.startsWith('~')) return Promise.resolve(null); return this.req(`/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`, { method: 'POST', body: '{}' }).catch(() => null); }
  /** A direct room with a player (an existing one if we have it). */
  async dm(playerId: string): Promise<string> {
    const uid = `@${playerId}:${this.server}`;
    for (const r of this.rooms.values()) if (r.direct && r.memberList.has(uid)) return r.id;
    const r = await this.req<{ room_id: string }>('/v3/createRoom', { method: 'POST', body: JSON.stringify({ preset: 'trusted_private_chat', is_direct: true, invite: [uid] }) });
    const mine = (await this.req<Record<string, string[]>>(`/v3/user/${encodeURIComponent(this.me)}/account_data/m.direct`).catch(() => ({}))) as Record<string, string[]>;
    mine[uid] = [...new Set([...(mine[uid] ?? []), r.room_id])];
    await this.req(`/v3/user/${encodeURIComponent(this.me)}/account_data/m.direct`, { method: 'PUT', body: JSON.stringify(mine) }).catch(() => null);
    this.directIds.add(r.room_id);
    return r.room_id;
  }
  /** A group room with several players. */
  async group(name: string, playerIds: string[]) {
    return (await this.req<{ room_id: string }>('/v3/createRoom', { method: 'POST', body: JSON.stringify({ preset: 'private_chat', name, invite: playerIds.map((p) => `@${p}:${this.server}`) }) })).room_id;
  }
  /** Older messages for a room (scrolling up). */
  async backfill(roomId: string, limit = 30) {
    const room = this.rooms.get(roomId);
    if (!room || room.noMoreHistory || !room.prevBatch) { if (room) room.noMoreHistory = true; return; }
    const r = await this.req<{ chunk: Ev[]; end?: string; state?: Ev[] }>(`/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${limit}&from=${encodeURIComponent(room.prevBatch)}`);
    for (const ev of r.state ?? []) this.apply(room, ev);
    for (const ev of r.chunk) this.apply(room, ev, true);
    room.prevBatch = r.end ?? null;
    if (!r.end || !r.chunk.length) room.noMoreHistory = true;
    this.emit();
  }
  async members(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const r = await this.req<{ chunk: Ev[] }>(`/v3/rooms/${encodeURIComponent(roomId)}/members?membership=join`).catch(() => ({ chunk: [] as Ev[] }));
    for (const ev of r.chunk) this.apply(room, ev);
    this.emit();
    return [...room.memberList.values()].filter((m) => m.membership === 'join');
  }
  /** Server-side search, in one room or everywhere. */
  async search(term: string, roomId?: string) {
    const body = { search_categories: { room_events: { search_term: term, order_by: 'recent', filter: roomId ? { rooms: [roomId], limit: 30 } : { limit: 30 } } } };
    const r = await this.req<{ search_categories: { room_events: { results: { result: Ev & { room_id: string } }[] } } }>('/v3/search', { method: 'POST', body: JSON.stringify(body) });
    return r.search_categories.room_events.results.map((x) => ({ roomId: x.result.room_id, id: x.result.event_id, sender: x.result.sender, body: String(x.result.content?.body ?? ''), ts: x.result.origin_server_ts }));
  }
  /** Does an alias exist? (Directory lookups: /publicRooms is empty on these servers.) */
  async probe(alias: string) { return this.req<{ room_id: string }>(`/v3/directory/room/${encodeURIComponent(alias)}`).then((r) => r.room_id).catch(() => null); }
  displayName(roomId: string | null, uid: string) {
    const m = roomId ? this.rooms.get(roomId)?.memberList.get(uid) : undefined;
    return m?.name || localpart(uid);
  }
}

function addReaction(m: Message, key: string, sender: string, mineId?: string) {
  let r = m.reactions.find((x) => x.key === key);
  if (!r) { r = { key, senders: [] }; m.reactions.push(r); }
  if (!r.senders.includes(sender)) r.senders.push(sender);
  if (mineId) r.mine = mineId;
}
function removeReaction(m: Message, key: string, sender: string) {
  const r = m.reactions.find((x) => x.key === key);
  if (!r) return;
  r.senders = r.senders.filter((s) => s !== sender);
  if (sender) delete r.mine;
  if (!r.senders.length) m.reactions = m.reactions.filter((x) => x !== r);
}
/** Replies carry a "> <@a> quoted" fallback; the client shows the real quote instead. */
const stripFallback = (b: string) => (b.startsWith('> ') ? b.replace(/^(> .*\n)+\n?/, '') : b);

interface Ev { type: string; event_id: string; sender: string; origin_server_ts: number; content: Record<string, unknown>; state_key?: string; redacts?: string; unsigned?: { transaction_id?: string } }
export interface SyncBody {
  next_batch: string;
  account_data?: { events: Ev[] };
  rooms?: {
    join?: Record<string, { state?: { events: Ev[] }; timeline?: { events: Ev[]; limited?: boolean; prev_batch?: string }; ephemeral?: { events: Ev[] }; unread_notifications?: { notification_count?: number; highlight_count?: number }; summary?: Record<string, number> }>;
    invite?: Record<string, { invite_state?: { events: Ev[] } }>;
    leave?: Record<string, unknown>;
  };
}
export type { Ev as MatrixEvent };

export const matrix = new Matrix();
