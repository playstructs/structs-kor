/* Dev only (`?mock=1`): a pretend Matrix homeserver in this tab, so 통신 can be driven without a guild.
 * Rooms are seeded with guild talk that names real fixture objects (so cards unfurl), guildmates type
 * and answer, react, and one of them invites you to a room. Never in a production build: matrix.ts
 * imports it only behind MOCK, which Vite folds to false outside dev.
 *
 * Tabs of this origin share one homeserver: what a tab's commander sends (messages, rooms, live match
 * frames) is relayed to the others over a BroadcastChannel. Sign a second tab in as another fixture
 * commander with `?mock=1&as=1-7` and the two can DM each other and play a live duel; a guildmate who
 * is really another tab no longer answers for itself. */
import type { MatrixEvent, SyncBody } from './matrix';

const HS = 'mock.structs';
const uid = (p: string) => `@${p}:${HS}`;
const NAMES: Record<string, string> = { '1-7': '은하수', '1-9': '철갑상어', '1-13': 'nova', '1-21': '흑룡', '1-42': '테스트 사령관' };
interface MRoom { id: string; name: string; alias?: string; topic: string; members: string[]; direct?: boolean; pinned: string[]; history: MatrixEvent[] }

let seq = 0;
const log: { pos: number; room: string; ev: MatrixEvent; ephemeral?: boolean }[] = [];
const rooms = new Map<string, MRoom>();
const invites = new Map<string, { room: MRoom; from: string }>();
const direct: Record<string, string[]> = {};
let me = uid('1-42');
let waiters: (() => void)[] = [];
let seeded = false;
let typing = new Map<string, Set<string>>();
/** Commanders signed in on other tabs: real people here, so no scripted answers for them. */
const peers = new Set<string>();
const relay = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('structs-kor.mock-matrix') : null;
type RelayMsg = { kind: 'hello'; me: string; reply?: boolean } | { kind: 'event'; room: Omit<MRoom, 'history'>; ev: MatrixEvent };
/** Everything that went through the relay, either way: a tab that loads later (each page load starts
 * a fresh homeserver) is caught up from it when it says hello. */
const relayed: Extract<RelayMsg, { kind: 'event' }>[] = [];
const keep = (m: Extract<RelayMsg, { kind: 'event' }>) => { relayed.push(m); if (relayed.length > 3000) relayed.splice(0, relayed.length - 3000); };

const evId = () => `$m${++seq}${Math.random().toString(36).slice(2, 8)}`;
/** `share`: this tab's commander did it, so the other tabs hear it too. */
function push(room: string, ev: Partial<MatrixEvent> & { type: string; sender: string; content: Record<string, unknown> }, ephemeral = false, share = false) {
  const full = { event_id: evId(), origin_server_ts: Date.now(), ...ev } as MatrixEvent;
  if (!ephemeral) rooms.get(room)?.history.push(full);
  log.push({ pos: log.length + 1, room, ev: full, ephemeral });
  const w = waiters; waiters = []; for (const f of w) f();
  const r = rooms.get(room);
  if (share && relay && r && !ephemeral) { const { history: _h, ...meta } = r; const m: RelayMsg = { kind: 'event', room: { ...meta, members: [...meta.members] }, ev: full }; keep(m); relay.postMessage(m); }
  return full;
}
/* Another tab's event: into the same room here (made if this tab never had it), never relayed back. */
relay?.addEventListener('message', (e: MessageEvent<RelayMsg>) => {
  const m = e.data;
  if (!m || !seeded) return;
  if (m.kind === 'hello') {
    if (m.me !== me) peers.add(m.me);
    if (!m.reply) { relay.postMessage({ kind: 'hello', me, reply: true } satisfies RelayMsg); for (const x of relayed) relay.postMessage(x); }
    return;
  }
  if (m.kind !== 'event') return;
  // Already here (my own, or heard before)? Event ids are unique across tabs.
  if (rooms.get(m.room.id)?.history.some((x) => x.event_id === m.ev.event_id)) return;
  if (m.ev.sender !== me) peers.add(m.ev.sender);
  let r = rooms.get(m.room.id);
  if (!r) {
    if (!m.room.members.includes(me)) return;
    r = addRoom({ id: m.room.id, name: m.room.name, alias: m.room.alias, topic: m.room.topic, members: m.room.members, direct: m.room.direct });
    if (m.room.direct) direct[m.ev.sender] = [...new Set([...(direct[m.ev.sender] ?? []), r.id])];
    for (const st of stateOf(r)) push(r.id, st, false);
  }
  keep(m);
  for (const u of m.room.members) if (!r.members.includes(u)) r.members.push(u);
  if (m.ev.type === 'm.room.pinned_events') r.pinned = (m.ev.content.pinned as string[]) ?? [];
  r.history.push(m.ev);
  log.push({ pos: log.length + 1, room: r.id, ev: m.ev });
  const w = waiters; waiters = []; for (const f of w) f();
});
const say = (room: string, who: string, body: string, ago = 0) => {
  const ev = push(room, { type: 'm.room.message', sender: uid(who), content: { msgtype: 'm.text', body } });
  ev.origin_server_ts = Date.now() - ago;
  return ev;
};
function addRoom(r: Omit<MRoom, 'history' | 'pinned'>) {
  const room: MRoom = { ...r, pinned: [], history: [] };
  rooms.set(r.id, room);
  return room;
}
function stateOf(r: MRoom): MatrixEvent[] {
  const s = (type: string, content: Record<string, unknown>, state_key = ''): MatrixEvent => ({ type, content, state_key, sender: uid('1-7'), event_id: evId(), origin_server_ts: 0 });
  return [
    s('m.room.name', { name: r.name }), s('m.room.topic', { topic: r.topic }), ...(r.alias ? [s('m.room.canonical_alias', { alias: r.alias })] : []),
    s('m.room.pinned_events', { pinned: r.pinned }),
    ...r.members.map((m) => s('m.room.member', { membership: 'join', displayname: NAMES[m.replace(/^@/, '').split(':')[0]] ?? m }, m)),
  ];
}

function seed(user: string) {
  if (seeded) return;
  seeded = true;
  me = user;
  const self = user.replace(/^@/, '').split(':')[0];
  NAMES[self] ??= '테스트 사령관';
  // Whoever this tab is, the fixture commanders (1-42 among them) are all in the guild.
  const all = [...new Set([user, uid('1-42'), uid('1-7'), uid('1-9'), uid('1-13'), uid('1-21')])];
  const H = 3_600_000;
  const corp = addRoom({ id: `!sncorp:${HS}`, name: 'sn-corp', alias: `#sn-corp:${HS}`, topic: 'SN Corp 길드 본부 · 공지와 작전', members: all });
  say(corp.id, '1-7', '좋은 아침, 사령관들. 오늘 채굴 할당량 확인해 주세요.', 26 * H);
  const p = say(corp.id, '1-21', '공지: 2-14 근처에 정체불명 함대 9-9 포착. 방어막 점검하세요.', 5 * H);
  corp.pinned = [p.event_id];
  say(corp.id, '1-13', '전력 남는 분? 10-3 공급자가 싸게 팔고 있어요.', 3 * H);
  say(corp.id, '1-9', '1-7 님 정제소 5-1011 아직 돌아가나요?', 2 * H);
  say(corp.id, '1-7', '네, 정제 중이에요. 0-5 길드 은행 교환 비율도 1.05로 안정적입니다.', 2 * H - 60000);
  say(corp.id, '1-21', '오늘 밤 합동 습격 갑니다. 참여할 분 함대 준비!', 40 * 60000);
  say(corp.id, '1-13', `오늘 일일 교전 해보셨어요? ${location.origin}/daily/${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)}`, 20 * 60000);
  const help = addRoom({ id: `!help:${HS}`, name: 'help', alias: `#help:${HS}`, topic: '처음이세요? 무엇이든 물어보세요.', members: all });
  say(help.id, '1-13', '구조체를 지으려면 함교에서 빈 칸을 누르고 건설을 고르세요.', 30 * H);
  say(help.id, '1-7', '전력이 모자라면 시장에서 임대하거나 리액터에 알파를 주입하세요.', 20 * H);
  const infra = addRoom({ id: `!infra:${HS}`, name: 'infrastructure', alias: `#infrastructure:${HS}`, topic: '변전소 · 리액터 운영', members: [user, uid('1-7'), uid('1-13')] });
  say(infra.id, '1-7', '변전소 4-7 연결 12개, 여유 있습니다.', 8 * H);
  const raid = addRoom({ id: `!raid:${HS}`, name: 'raid', alias: `#raid:${HS}`, topic: '습격 작전실', members: [user, uid('1-9'), uid('1-21')] });
  say(raid.id, '1-9', '목표 후보: 2-77, 2-512. 방어가 약해요.', 6 * H);
  const desk = addRoom({ id: `!desk:other.net`, name: 'help-desk', alias: '#help-desk:other.net', topic: '갤럭시 넷 공용 안내소', members: [user, uid('1-13')] });
  say(desk.id, '1-13', 'Welcome to the galaxy net. 한국어도 환영!', 50 * H);
  // The DM between 1-42 and 1-7, whichever of them this tab is: two tabs share it.
  const buddy = self === '1-7' ? '1-42' : '1-7';
  const dm = addRoom({ id: `!dm7:${HS}`, name: '', topic: '', members: [user, uid(buddy)], direct: true });
  say(dm.id, '1-7', '어서 와요! 모르는 거 있으면 언제든 물어봐요. 알파가 필요하면 말해요.', 4 * H);
  direct[uid(buddy)] = [dm.id];
  const op = addRoom({ id: `!op21:${HS}`, name: '흑룡 작전', topic: '흑룡의 비밀 작전방', members: [uid('1-21'), uid('1-9')] });
  say(op.id, '1-21', '작전 개시는 자정입니다.', H);
  invites.set(op.id, { room: op, from: uid('1-21') });
  relay?.postMessage({ kind: 'hello', me } satisfies RelayMsg);
}

/* Guildmates answer: someone types, then replies; sometimes a reaction. */
const REPLIES = ['좋아요, 저도 갈게요!', '확인했습니다 👍', '그 행성 방어가 꽤 단단해요. 시뮬부터 돌려보세요.', 'ㅋㅋ 사령관님 화이팅', '지금 정제 중이라 잠깐만요.', '알파 좀 보내드릴까요?', '길드 은행에 기부하면 다들 좋아해요.', '2-77 쪽이 요즘 조용하네요.'];
function answer(roomId: string, text: string) {
  const r = rooms.get(roomId);
  if (!r) return;
  const others = r.members.filter((m) => m !== me && !peers.has(m));
  if (!others.length) return;
  const who = others[Math.floor(Math.random() * others.length)];
  const set = typing.get(roomId) ?? new Set(); set.add(who); typing.set(roomId, set);
  push(roomId, { type: 'm.typing', sender: who, content: { user_ids: [...set] } }, true);
  setTimeout(() => {
    set.delete(who);
    push(roomId, { type: 'm.typing', sender: who, content: { user_ids: [...set] } }, true);
    const named = text.match(/\b\d{1,2}-\d{1,9}\b/)?.[0];
    const body = named ? `${named} 말씀이시죠? 카드 봤어요. ${REPLIES[Math.floor(Math.random() * REPLIES.length)]}` : REPLIES[Math.floor(Math.random() * REPLIES.length)];
    push(roomId, { type: 'm.room.message', sender: who, content: { msgtype: 'm.text', body } });
  }, 1400 + Math.random() * 1600);
}

function syncBody(since: number): SyncBody {
  const join: NonNullable<NonNullable<SyncBody['rooms']>['join']> = {};
  const fresh = since === 0;
  for (const r of rooms.values()) {
    if (!r.members.includes(me)) continue;
    if (fresh) join[r.id] = { state: { events: stateOf(r) }, timeline: { events: r.history.slice(-40), limited: r.history.length > 40, prev_batch: r.history.length > 40 ? `p${r.history.length - 40}` : undefined }, ephemeral: { events: [] }, unread_notifications: { notification_count: 0, highlight_count: 0 }, summary: { 'm.joined_member_count': r.members.length } };
  }
  if (!fresh) {
    for (const e of log.filter((x) => x.pos > since)) {
      const r = rooms.get(e.room);
      if (!r || !r.members.includes(me)) continue;
      const j = (join[e.room] ??= { state: { events: [] }, timeline: { events: [] }, ephemeral: { events: [] }, summary: { 'm.joined_member_count': r.members.length } });
      if (e.ephemeral) j.ephemeral!.events.push(e.ev);
      else if (e.ev.state_key != null) j.state!.events.push(e.ev);
      else j.timeline!.events.push(e.ev);
      if (!e.ephemeral && e.ev.sender !== me && e.ev.type === 'm.room.message') {
        j.unread_notifications = { notification_count: (j.unread_notifications?.notification_count ?? 0) + 1, highlight_count: (j.unread_notifications?.highlight_count ?? 0) + (String(e.ev.content.body).includes(me.split(':')[0].slice(1)) ? 1 : 0) };
      }
    }
  }
  const invite: NonNullable<NonNullable<SyncBody['rooms']>['invite']> = {};
  for (const [id, i] of invites) invite[id] = { invite_state: { events: [{ type: 'm.room.name', content: { name: i.room.name }, state_key: '', sender: i.from, event_id: evId(), origin_server_ts: 0 }, { type: 'm.room.member', content: { membership: 'invite' }, state_key: me, sender: i.from, event_id: evId(), origin_server_ts: 0 }] } };
  return { next_batch: String(log.length), account_data: { events: [{ type: 'm.direct', content: direct, sender: me, event_id: evId(), origin_server_ts: 0 }] }, rooms: { join, invite } };
}

const ok = <T>(v: unknown) => Promise.resolve(v as T);
export async function mockMatrix<T>(path: string, init: RequestInit, user: string): Promise<T> {
  seed(user);
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs ?? '');
  const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  const seg = p.split('/').map(decodeURIComponent);
  // seg: ['', 'v3', ...]
  if (p === '/v3/sync') {
    const since = Number(q.get('since') ?? 0);
    const timeout = Number(q.get('timeout') ?? 0);
    if (since && log.length <= since && timeout) {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, Math.min(timeout, 20000));
        waiters.push(() => { clearTimeout(t); res(); });
        init.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
    }
    return ok(syncBody(since));
  }
  if (seg[2] === 'rooms') {
    const roomId = seg[3], r = rooms.get(roomId);
    if (!r) throw new Error('M_NOT_FOUND');
    switch (seg[4]) {
      case 'send': {
        const ev = push(roomId, { type: seg[5], sender: me, content: body, unsigned: { transaction_id: seg[6] } }, false, true);
        // A guildmate answers what people say (not a live match's offer, not what nobody reads).
        if (seg[5] === 'm.room.message' && body.msgtype !== 'm.image' && !(body['m.relates_to'] as { rel_type?: string } | undefined)?.rel_type && !Object.keys(body).some((k) => k.startsWith('structs.'))) answer(roomId, String(body.body ?? ''));
        return ok({ event_id: ev.event_id });
      }
      case 'redact': { const ev = push(roomId, { type: 'm.room.redaction', sender: me, content: {}, redacts: seg[5] }, false, true); return ok({ event_id: ev.event_id }); }
      case 'state': { r.pinned = (body.pinned as string[]) ?? []; push(roomId, { type: seg[5], sender: me, content: body, state_key: '' }, false, true); return ok({}); }
      case 'typing': return ok({});
      case 'receipt': return ok({});
      case 'leave': r.members = r.members.filter((m) => m !== me); invites.delete(roomId); return ok({});
      case 'members': return ok({ chunk: stateOf(r).filter((e) => e.type === 'm.room.member') });
      case 'event': { const ev = r.history.find((e) => e.event_id === seg[5]); if (!ev) throw new Error('M_NOT_FOUND'); return ok(ev); }
      case 'messages': {
        const from = Number((q.get('from') ?? 'p0').slice(1)), limit = Number(q.get('limit') ?? 30);
        const start = Math.max(0, from - limit);
        return ok({ chunk: r.history.slice(start, from).reverse(), end: start > 0 ? `p${start}` : undefined });
      }
    }
  }
  if (seg[2] === 'join') {
    const key = seg[3];
    const r = [...rooms.values()].find((x) => x.id === key || x.alias === key) ?? addRoom({ id: `!${key.replace(/[^a-z0-9]/gi, '')}:${HS}`, name: key.replace(/^#/, '').split(':')[0], alias: key, topic: '', members: [uid('1-13')] });
    if (!r.members.includes(me)) r.members.push(me);
    invites.delete(r.id);
    push(r.id, { type: 'm.room.member', sender: me, state_key: me, content: { membership: 'join', displayname: NAMES[me.slice(1).split(':')[0]] } });
    return ok({ room_id: r.id });
  }
  if (p === '/v3/createRoom') {
    const inv = (body.invite as string[]) ?? [];
    const r = addRoom({ id: `!new${seq}${Math.random().toString(36).slice(2, 7)}:${HS}`, name: String(body.name ?? ''), topic: '', members: [me, ...inv], direct: !!body.is_direct });
    push(r.id, { type: 'm.room.create', sender: me, content: {}, state_key: '' }, false, true);
    return ok({ room_id: r.id });
  }
  if (seg[2] === 'user' && seg[4] === 'account_data') {
    if (init.method === 'PUT') { Object.assign(direct, body); return ok({}); }
    return ok(direct);
  }
  if (p === '/v3/search') {
    const term = String(((body.search_categories as Record<string, Record<string, unknown>>).room_events.search_term) ?? '').toLowerCase();
    const results = [...rooms.values()].filter((r) => r.members.includes(me)).flatMap((r) => r.history.filter((e) => e.type === 'm.room.message' && String(e.content.body).toLowerCase().includes(term)).map((e) => ({ result: { ...e, room_id: r.id } })));
    return ok({ search_categories: { room_events: { results: results.slice(-30).reverse() } } });
  }
  if (seg[2] === 'directory') {
    const r = [...rooms.values()].find((x) => x.alias === seg[4]);
    if (!r) throw new Error('M_NOT_FOUND');
    return ok({ room_id: r.id });
  }
  throw new Error('M_UNRECOGNIZED ' + p);
}
