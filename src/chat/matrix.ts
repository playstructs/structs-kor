/* A small Matrix client for 통신. Sign-in is the guild's: the wallet signs the same
 * LOGIN_GUILD… message, POST /api/auth/matrix returns Matrix tokens (the guild runs MAS), and the
 * page then talks to the homeserver directly (through /relay/matrix in dev). Long-poll /sync. */
import { endpoints, GUILD_ID } from '../config';
import { wallet } from '../wallet/wallet';
import { guildApi } from '../api/guild';

export interface Room { id: string; name: string; alias: string | null; direct: boolean; local: boolean; unread: number; members: number; events: Message[] }
export interface Message { id: string; sender: string; body: string; ts: number; mine: boolean }

const TOKEN_KEY = 'structs-kor.matrix';
interface Grant { access_token: string; user_id: string; device_id: string }

const deviceId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 36]).join('');

export class Matrix {
  grant: Grant | null = null;
  rooms = new Map<string, Room>();
  private since: string | null = null;
  private running = false;
  private ctl: AbortController | null = null;
  private fns = new Set<() => void>();
  private directIds = new Set<string>();

  onChange(f: () => void) { this.fns.add(f); return () => this.fns.delete(f); }
  private emit() { for (const f of this.fns) f(); }
  get server() { return this.grant?.user_id.split(':').slice(1).join(':') ?? ''; }

  async signIn() {
    try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); if (t?.access_token) { this.grant = t; return; } } catch { /* fresh */ }
    const k = wallet.key(0);
    const ts = (await guildApi.timestamp()).unix_timestamp;
    const s = wallet.signMessage(0, `LOGIN_GUILD${GUILD_ID}ADDRESS${k.address}DATETIME${ts}`);
    const g = await guildApi.matrixLogin({ address: k.address, pubkey: s.pubkey, signature: s.signature, guild_id: GUILD_ID, unix_timestamp: ts, device_id: deviceId() });
    this.grant = { access_token: g.access_token, user_id: g.user_id, device_id: g.device_id };
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.grant)); } catch { /* fine */ }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(endpoints.matrix + '/_matrix/client' + path, { ...init, headers: { authorization: 'Bearer ' + this.grant!.access_token, 'content-type': 'application/json', ...(init.headers || {}) } });
    if (r.status === 401) { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* fine */ } throw new Error('채팅 세션이 만료되었습니다.'); }
    if (!r.ok) throw new Error(`Matrix ${r.status}`);
    return r.json() as Promise<T>;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }
  stop() { this.running = false; this.ctl?.abort(); }

  private async loop() {
    const filter = encodeURIComponent(JSON.stringify({ room: { timeline: { limit: 30 }, state: { types: ['m.room.name', 'm.room.canonical_alias', 'm.room.member'], lazy_load_members: true } } }));
    while (this.running) {
      try {
        this.ctl = new AbortController();
        const q = `/v3/sync?filter=${filter}&timeout=${this.since ? 30000 : 0}${this.since ? '&since=' + encodeURIComponent(this.since) : ''}`;
        const body = await this.req<SyncBody>(q, { signal: this.ctl.signal });
        this.since = body.next_batch;
        this.ingest(body);
        this.emit();
      } catch (e) {
        if ((e as Error).name === 'AbortError' || !this.running) return;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private ingest(b: SyncBody) {
    for (const ev of b.account_data?.events ?? []) if (ev.type === 'm.direct') for (const ids of Object.values(ev.content as Record<string, string[]>)) for (const id of ids) this.directIds.add(id);
    for (const [id, r] of Object.entries(b.rooms?.join ?? {})) {
      const room = this.rooms.get(id) ?? { id, name: id, alias: null, direct: false, local: id.endsWith(':' + this.server), unread: 0, members: 0, events: [] };
      for (const ev of [...(r.state?.events ?? []), ...(r.timeline?.events ?? [])]) {
        if (ev.type === 'm.room.name' && ev.content.name) room.name = String(ev.content.name);
        if (ev.type === 'm.room.canonical_alias' && ev.content.alias) { room.alias = String(ev.content.alias); if (room.name === id) room.name = room.alias; }
        if (ev.type === 'm.room.message' && typeof ev.content.body === 'string') {
          if (!room.events.some((m) => m.id === ev.event_id)) room.events.push({ id: ev.event_id, sender: ev.sender, body: ev.content.body, ts: ev.origin_server_ts, mine: ev.sender === this.grant?.user_id });
        }
      }
      room.events = room.events.slice(-200);
      room.unread = r.unread_notifications?.notification_count ?? room.unread;
      room.members = r.summary?.['m.joined_member_count'] ?? room.members;
      room.direct = this.directIds.has(id);
      room.local = (room.alias ?? id).endsWith(':' + this.server);
      if (room.name === id && room.direct) room.name = '다이렉트 메시지';
      this.rooms.set(id, room);
    }
  }

  send(roomId: string, body: string) {
    const txn = 'kor' + Date.now() + Math.random().toString(36).slice(2, 6);
    return this.req(`/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, { method: 'PUT', body: JSON.stringify({ msgtype: 'm.text', body }) });
  }
  join(aliasOrId: string) { return this.req<{ room_id: string }>(`/v3/join/${encodeURIComponent(aliasOrId)}`, { method: 'POST', body: '{}' }); }
  read(roomId: string, eventId: string) { return this.req(`/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`, { method: 'POST', body: '{}' }).catch(() => null); }
}

interface Ev { type: string; event_id: string; sender: string; origin_server_ts: number; content: Record<string, unknown> }
interface SyncBody {
  next_batch: string;
  account_data?: { events: Ev[] };
  rooms?: { join?: Record<string, { state?: { events: Ev[] }; timeline?: { events: Ev[] }; unread_notifications?: { notification_count?: number }; summary?: Record<string, number> }> };
}

export const matrix = new Matrix();
