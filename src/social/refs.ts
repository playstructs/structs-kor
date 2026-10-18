/* 객체 카드: every noun in Structs is a `<type>-<index>` id, and players already talk in them. This
 * finds those ids in text and draws each one as a small live card — who owns it, what it is doing,
 * and the verbs that make sense for it (pay a player, rent from a provider, watch a planet). The
 * same card shows in chat, on the object's own page (/o/2-14), in share sheets and on the bridge.
 *
 * After structs-universe chat-refs.js + src-tauri matrix/refs.rs, read through the Guild API. The
 * id boundary is strict on both sides: 1-194 and 1-1945 are different objects. */
import { guildApi, type PlayerRow, type ProviderRow, type GuildRow } from '../api/guild';
import { cached } from '../api/http';
import { esc, n, micro, watts } from '../ui/dom';
import { portraitHtml, seededPfp } from '../game/portrait';
import { STRUCT_TYPE, AMBIT, entityOf } from '../i18n/ko';
import { KW, BLOCKS_PER_DAY, perKwDay } from '../api/rates';

export const ID_RE = /(^|[^0-9A-Za-z_-])(\d{1,2}-\d{1,9})(?![0-9-])/g;
/** Kinds worth a card. Allocations and infusions are plumbing; a card that says nothing is worse than text. */
export const REF_KINDS: Record<string, RefKind> = { '0': 'guild', '1': 'player', '2': 'planet', '3': 'reactor', '4': 'substation', '5': 'struct', '9': 'fleet', '10': 'provider' };
export type RefKind = 'guild' | 'player' | 'planet' | 'reactor' | 'substation' | 'struct' | 'fleet' | 'provider';
export type RefAction = 'pay' | 'message' | 'planet' | 'fleet' | 'rent' | 'guild' | 'sim' | 'raid' | 'join';
export interface RefCard {
  id: string; kind: RefKind; title: string; subtitle: string; pfp?: string | null; glyph: string;
  badge?: { text: string; tone: 'cheong' | 'hwang' | 'jeok' };
  rows: [string, string][];
  actions: RefAction[];
  owner?: string; planetId?: string; fleetId?: string; guildId?: string;
  provider?: ProviderRow; meter?: { label: string; pct: number; tone?: string };
}

/** Ids a text names, in order, once each, only kinds worth a card. */
export function idsIn(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ID_RE)) {
    const id = m[2];
    if (REF_KINDS[id.split('-')[0]] && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
export const isRefId = (s: string) => /^\d{1,2}-\d{1,9}$/.test(s) && !!REF_KINDS[s.split('-')[0]];

/** Escaped text with every id turned into a chip (a link to the object's page). */
export function linkIds(escaped: string, base: string): string {
  return escaped.replace(ID_RE, (_m, pre: string, id: string) => {
    const k = REF_KINDS[id.split('-')[0]];
    return k ? `${pre}<a class="ref-chip ${k}" href="${base}/o/${id}" data-ref-id="${id}" title="${esc(entityOf(id))} ${id}">${id}</a>` : `${pre}<span class="mono">${id}</span>`;
  });
}

/* ── Resolution ── */
const pick = (o: Record<string, unknown> | null | undefined, ...keys: string[]): unknown => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
};
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

const playerRow = (id: string) => cached(`ref:p:${id}`, 120_000, () => guildApi.player(id));
/** "흑룡 [SNC]" for an owner line; the bare id while the name is unknown. */
export async function playerLabel(id: string): Promise<string> {
  if (!id) return '—';
  const p = await playerRow(id).catch(() => null);
  return p?.username ? `${p.username}${p.tag ? ` [${p.tag}]` : ''}` : id;
}
const objectRow = (id: string) => cached(`ref:o:${id}`, 60_000, () => guildApi.objects([id]).then((r) => (r.find((x) => x.id === id)?.object as Record<string, unknown>) ?? null));

async function playerCard(id: string): Promise<RefCard | null> {
  const p: PlayerRow | null = await playerRow(id).catch(() => null);
  if (!p) return null;
  const load = num(p.load) + num(p.structs_load), cap = num(p.capacity) + num(p.connection_capacity);
  const actions: RefAction[] = ['message', 'pay'];
  if (p.planet_id) actions.unshift('planet');
  if (p.fleet_id) actions.splice(1, 0, 'fleet');
  return {
    id, kind: 'player', glyph: 'icon-member', title: p.username || id, subtitle: `${p.tag ? `[${p.tag}] ` : ''}PID #${id}`,
    pfp: p.pfp || seededPfp(id), rows: [['알파', `${micro(p.alpha, 2)} g`], ['광석', n(p.ore)], ['전력', `${watts(load)} / ${watts(cap)}`]],
    meter: cap > 0 ? { label: '전력 사용', pct: Math.min(100, (load / cap) * 100), tone: load > cap ? 'var(--jeok)' : undefined } : undefined,
    actions, planetId: p.planet_id || undefined, fleetId: p.fleet_id || undefined, guildId: p.guild_id || undefined, owner: id,
  };
}

async function planetCard(id: string): Promise<RefCard | null> {
  const p = await guildApi.planet(id).catch(() => null);
  if (!p) return null;
  const [owner, shield, raid] = await Promise.all([playerLabel(p.owner), guildApi.shieldHealth(id).then((s) => s?.health ?? null).catch(() => null), guildApi.activeRaid(id).catch(() => null)]);
  const slots = num(p.space_slots) + num(p.air_slots) + num(p.land_slots) + num(p.water_slots);
  return {
    id, kind: 'planet', glyph: 'icon-planet', title: p.name || `행성 ${id}`, subtitle: `소유 ${owner}`,
    badge: raid ? { text: '습격 중', tone: 'jeok' } : shield != null && shield > 0 ? { text: '방어막', tone: 'cheong' } : undefined,
    rows: [['방어막', shield == null ? '—' : n(shield)], ['미발견 광석', n(p.undiscovered_ore)], ['슬롯', `${n(slots)}`], ...(raid ? [['습격 함대', str(raid.fleet_id)] as [string, string]] : [])],
    actions: raid ? ['raid', 'sim'] : ['sim'], owner: p.owner, planetId: id,
  };
}

async function structCard(id: string): Promise<RefCard | null> {
  const o = await objectRow(id).catch(() => null);
  if (!o) return null;
  const type = num(pick(o, 'type', 'struct_type', 'structType'));
  const ownerId = str(pick(o, 'owner'));
  const destroyed = !!pick(o, 'is_destroyed', 'isDestroyed');
  const health = pick(o, 'health');
  const status = num(pick(o, 'status'));
  const ambit = str(pick(o, 'operating_ambit', 'operatingAmbit'));
  const loc = str(pick(o, 'location_id', 'locationId'));
  const online = (status & 4) !== 0 || status === 5, built = (status & 1) !== 0 || status >= 1;
  const work = destroyed ? '파괴됨' : !built ? '건설 중' : online ? '가동' : '정지';
  return {
    id, kind: 'struct', glyph: destroyed ? 'icon-wreckage' : 'icon-cmd-post', title: STRUCT_TYPE[type] ?? `구조체 유형 ${type}`, subtitle: `${id} · ${await playerLabel(ownerId)}`,
    badge: destroyed ? { text: '파괴', tone: 'jeok' } : online ? { text: '가동', tone: 'cheong' } : { text: work, tone: 'hwang' },
    rows: [['상태', work], ['내구도', health == null ? '—' : n(health)], ['전장', AMBIT[ambit] ?? (ambit || '—')], ['위치', loc || '—']],
    actions: loc.startsWith('2-') ? ['planet'] : loc.startsWith('9-') ? ['fleet'] : [], owner: ownerId, planetId: loc.startsWith('2-') ? loc : undefined, fleetId: loc.startsWith('9-') ? loc : undefined,
  };
}

async function fleetCard(id: string): Promise<RefCard | null> {
  const o = await objectRow(id).catch(() => null);
  if (!o) return null;
  const ownerId = str(pick(o, 'owner')), status = str(pick(o, 'status')), loc = str(pick(o, 'location_id', 'locationId'));
  const away = status === 'away';
  return {
    id, kind: 'fleet', glyph: 'icon-fleet-tile', title: `함대 ${id}`, subtitle: `지휘 ${await playerLabel(ownerId)}`,
    badge: away ? { text: '원정 중', tone: 'hwang' } : { text: '주둔', tone: 'cheong' },
    rows: [['상태', away ? '원정' : status === 'onStation' ? '주둔' : status || '—'], ['위치', loc || '—'], ['기함', str(pick(o, 'command_struct', 'commandStruct')) || '—']],
    actions: loc.startsWith('2-') ? ['planet'] : [], owner: ownerId, planetId: loc.startsWith('2-') ? loc : undefined, fleetId: id,
  };
}

async function substationCard(id: string): Promise<RefCard | null> {
  const [o, grid] = await Promise.all([objectRow(id).catch(() => null), guildApi.grid(id).catch(() => [])]);
  const g = (k: string) => num(grid.find((x) => x.attribute_type === k)?.val);
  if (!o && !grid.length) return null;
  const cap = g('connectionCapacity') || g('capacity'), load = g('load'), conns = g('connectionCount');
  return {
    id, kind: 'substation', glyph: 'icon-beacon', title: str(pick(o ?? {}, 'name')) || `변전소 ${id}`, subtitle: `운영 ${await playerLabel(str(pick(o ?? {}, 'owner')))}`,
    rows: [['연결당 용량', watts(cap)], ['부하', watts(load)], ['연결', n(conns)]], actions: [], owner: str(pick(o ?? {}, 'owner')) || undefined,
    meter: cap > 0 ? { label: '부하', pct: Math.min(100, (load / Math.max(1, cap * Math.max(1, conns))) * 100) } : undefined,
  };
}

async function reactorCard(id: string): Promise<RefCard | null> {
  const o = await objectRow(id).catch(() => null);
  if (!o) return null;
  return {
    id, kind: 'reactor', glyph: 'icon-computer', title: `리액터 ${id}`, subtitle: `길드 ${str(pick(o, 'guild_id', 'guildId')) || '—'}`,
    rows: [['검증인', str(pick(o, 'validator')).slice(0, 18) || '—'], ['수수료', pick(o, 'default_commission', 'defaultCommission') != null ? n(num(pick(o, 'default_commission', 'defaultCommission')) * 100, 1) + '%' : '—']],
    actions: [], guildId: str(pick(o, 'guild_id', 'guildId')) || undefined,
  };
}

async function guildCard(id: string): Promise<RefCard | null> {
  const g: GuildRow | null = await guildApi.guild(id).catch(() => null);
  if (!g) return null;
  const [count, bank] = await Promise.all([guildApi.memberCount(id).then((c) => c.count).catch(() => null), guildApi.bank().then((b) => b.find((x) => x.guild_id === id) ?? null).catch(() => null)]);
  return {
    id, kind: 'guild', glyph: 'icon-guild', title: g.name || `길드 ${id}`, subtitle: `${g.tag ? `[${g.tag}] ` : ''}${id}`,
    rows: [['길드원', count == null ? '—' : n(count)], ['주 리액터', g.primary_reactor_id || '—'], ['담보율', bank ? n(bank.ratio, 3) : '—'], ['길드장', await playerLabel(g.owner)]],
    actions: ['guild', 'join'], owner: g.owner, guildId: id,
  };
}

async function providerCard(id: string): Promise<RefCard | null> {
  const list = await guildApi.providerMarket().catch(() => [] as ProviderRow[]);
  let p = list.find((x) => x.id === id) ?? null;
  if (!p) {
    const o = await objectRow(id).catch(() => null);
    if (!o) return null;
    const rate = (pick(o, 'rate') ?? {}) as Record<string, unknown>;
    p = { id, owner: str(pick(o, 'owner')), substation_id: str(pick(o, 'substation_id', 'substationId')), rate_amount: str(pick(o, 'rate_amount') ?? rate.amount), rate_denom: str(pick(o, 'rate_denom') ?? rate.denom), access_policy: str(pick(o, 'access_policy', 'accessPolicy')), capacity_minimum: num(pick(o, 'capacity_minimum', 'capacityMinimum')), capacity_maximum: num(pick(o, 'capacity_maximum', 'capacityMaximum')), duration_minimum: num(pick(o, 'duration_minimum', 'durationMinimum')), duration_maximum: num(pick(o, 'duration_maximum', 'durationMaximum')) };
  }
  const open = /^open/i.test(p.access_policy);
  return {
    id, kind: 'provider', glyph: 'icon-transfers', title: `전력 공급자 ${id}`, subtitle: `판매 ${await playerLabel(p.owner)}`,
    badge: open ? { text: '공개', tone: 'cheong' } : /^guild/i.test(p.access_policy) ? { text: '길드 전용', tone: 'hwang' } : { text: '비공개', tone: 'jeok' },
    rows: [['요율', `${micro(perKwDay(p.rate_amount), 4)} ${p.rate_denom === 'ualpha' ? 'α' : p.rate_denom} / kW·일`], ['용량', `${n(num(p.capacity_minimum) / KW, 1)}–${n(num(p.capacity_maximum) / KW, 1)} kW`], ['기간', `${n(num(p.duration_minimum) / BLOCKS_PER_DAY, 1)}–${n(num(p.duration_maximum) / BLOCKS_PER_DAY, 1)}일`], ['변전소', p.substation_id || '—']],
    actions: open ? ['rent'] : [], owner: p.owner, provider: p,
  };
}

const RESOLVE: Record<RefKind, (id: string) => Promise<RefCard | null>> = {
  player: playerCard, planet: planetCard, struct: structCard, fleet: fleetCard, substation: substationCard, guild: guildCard, provider: providerCard, reactor: reactorCard,
};

/* Cache: id → card, null (nothing there) or a pending promise. Bounded, oldest out. */
const cards = new Map<string, RefCard | null>();
const pending = new Map<string, Promise<RefCard | null>>();
const MAX = 400;
export const cardFor = (id: string): RefCard | null | undefined => cards.get(id);

export function resolveRef(id: string, fresh = false): Promise<RefCard | null> {
  if (!fresh && cards.has(id)) return Promise.resolve(cards.get(id)!);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const kind = REF_KINDS[id.split('-')[0]];
  if (!kind) return Promise.resolve(null);
  const p = RESOLVE[kind](id).catch(() => null).then((c) => {
    pending.delete(id);
    cards.set(id, c);
    if (cards.size > MAX) cards.delete(cards.keys().next().value!);
    fill(id);
    return c;
  });
  pending.set(id, p);
  return p;
}

/* ── Drawing ── */
const ACTION_LABEL: Record<RefAction, [string, string]> = {
  pay: ['알파 보내기', 'icon-send-alpha'], message: ['메시지', 'icon-phone'], planet: ['행성', 'icon-planet'], fleet: ['함대', 'icon-fleet-tile'],
  rent: ['전력 임대', 'icon-transfers'], guild: ['길드 보기', 'icon-guild'], sim: ['전투 예측', 'icon-combat-log'], raid: ['습격 현황', 'icon-raid'], join: ['가입 신청', 'icon-member'],
};

export interface CardOpts { compact?: boolean; base: string; noShare?: boolean; me?: string | null }
export function refCardHtml(c: RefCard, o: CardOpts): string {
  const face = c.kind === 'player' ? portraitHtml(c.pfp, o.compact ? 36 : 48) : `<span class="ref-glyph ${c.kind}"><i class="si ${c.glyph}"></i></span>`;
  const acts = c.actions.filter((a) => !(o.me && c.owner === o.me && (a === 'pay' || a === 'message' || a === 'join')));
  return `<article class="ref-card ${c.kind} ${o.compact ? 'compact' : ''}" data-ref-card="${esc(c.id)}">
    <a class="ref-top" href="${o.base}/o/${esc(c.id)}">${face}<span class="ref-name"><b>${esc(c.title)}</b><small class="mono">${esc(c.subtitle)}</small></span>${c.badge ? `<span class="chip ${c.badge.tone}">${esc(c.badge.text)}</span>` : ''}</a>
    <dl class="ref-rows">${c.rows.slice(0, o.compact ? 3 : 6).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join('')}</dl>
    ${c.meter ? `<div class="meter ref-meter" title="${esc(c.meter.label)} ${Math.round(c.meter.pct)}%"><i style="width:${c.meter.pct.toFixed(1)}%${c.meter.tone ? `;background:${c.meter.tone}` : ''}"></i></div>` : ''}
    <div class="ref-acts">${acts.map((a) => `<button type="button" class="ref-act" data-ref="${a}" data-id="${esc(c.id)}"><i class="si ${ACTION_LABEL[a][1]}"></i>${ACTION_LABEL[a][0]}</button>`).join('')}${o.noShare ? '' : `<button type="button" class="ref-act ghost" data-ref="share" data-id="${esc(c.id)}" title="공유"><i class="si icon-link-out"></i>공유</button>`}</div>
  </article>`;
}

/** A card where it is wanted: drawn now if known, else a placeholder that fills when it arrives. */
export function refSlot(id: string, o: CardOpts): string {
  const c = cards.get(id);
  if (c) return refCardHtml(c, o);
  if (c === null) return '';
  void resolveRef(id);
  return `<div class="ref-slot" data-ref-slot="${esc(id)}" data-compact="${o.compact ? 1 : 0}" data-base="${esc(o.base)}" data-me="${esc(o.me ?? '')}"><span class="skeleton" style="height:58px"></span><small class="mono faint">${esc(entityOf(id))} ${esc(id)} 불러오는 중…</small></div>`;
}
function fill(id: string) {
  if (typeof document === 'undefined') return;
  const c = cards.get(id);
  for (const el of document.querySelectorAll<HTMLElement>(`[data-ref-slot="${CSS.escape(id)}"]`)) {
    if (!c) { el.remove(); continue; }
    el.outerHTML = refCardHtml(c, { compact: el.dataset.compact === '1', base: el.dataset.base ?? '', me: el.dataset.me || null });
  }
}
