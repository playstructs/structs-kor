/* Situations worth sharing, built from the live game: my base at a glance, a raid on a planet, a
 * battle forecast, an energy offer, a guild's standing. Each returns a Situation for share(). */
import { guildApi, type ProviderRow, type StructRow } from '../api/guild';
import { n, micro, watts } from '../ui/dom';
import { STRUCT_TYPE } from '../i18n/ko';
import { KW, BLOCKS_PER_DAY, perKwDay } from '../api/rates';
import type { Situation } from './share';

const alive = (s: StructRow[]) => s.filter((x) => !x.is_destroyed);

export async function baseSituation(pid: string): Promise<Situation | null> {
  const p = await guildApi.player(pid).catch(() => null);
  if (!p) return null;
  const [structs, shield, raid] = await Promise.all([
    guildApi.structsOf(pid).catch(() => [] as StructRow[]),
    p.planet_id ? guildApi.shieldHealth(p.planet_id).then((s) => s?.health ?? null).catch(() => null) : Promise.resolve(null),
    p.planet_id ? guildApi.activeRaid(p.planet_id).catch(() => null) : Promise.resolve(null),
  ]);
  const a = alive(structs), load = Number(p.load) + Number(p.structs_load), cap = Number(p.capacity) + Number(p.connection_capacity);
  const top = Object.entries(a.reduce<Record<string, number>>((m, s) => { const k = STRUCT_TYPE[s.type] ?? String(s.type); m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`).join(' ');
  return {
    t: raid ? 'raid' : 'base', title: raid ? `${p.username || pid}의 기지가 습격받고 있습니다!` : `${p.username || pid}의 기지 현황`, sub: top || undefined,
    lines: [['알파', `${micro(p.alpha, 2)} g`], ['광석', n(p.ore)], ['전력', `${watts(load)} / ${watts(cap)}`], ['구조체', `${n(a.length)}기`], ['방어막', shield == null ? '—' : n(shield)], ['행성', p.planet_id || '—'], ...(raid ? [['습격 함대', String(raid.fleet_id)] as [string, string]] : [])],
    ids: [pid, ...(p.planet_id ? [p.planet_id] : []), ...(raid?.fleet_id ? [String(raid.fleet_id)] : [])].slice(0, 3),
    go: p.planet_id ? `/o/${p.planet_id}` : '/console', tone: raid ? 'jeok' : 'cheong', by: p.username || pid, at: Date.now(),
  };
}

export function raidSituation(o: { planetId: string; planetName?: string; attacker?: string; fleetId?: string; shield?: number | null; defenders: number; raiders: number; by?: string }): Situation {
  return {
    t: 'raid', title: `${o.planetName || o.planetId} 습격 중 — 지원 요청`, sub: o.attacker ? `습격자 ${o.attacker}` : undefined,
    lines: [['행성', o.planetId], ['방어막', o.shield == null ? '—' : n(o.shield)], ['아군 구조체', n(o.defenders)], ['적 구조체', n(o.raiders)], ...(o.fleetId ? [['함대', o.fleetId] as [string, string]] : [])],
    ids: [o.planetId, ...(o.attacker ? [o.attacker] : []), ...(o.fleetId ? [o.fleetId] : [])].slice(0, 3), go: `/o/${o.planetId}`, tone: 'jeok', by: o.by, at: Date.now(),
  };
}

export function battleSituation(o: { title: string; win: number; mine: string; theirs: string; replay?: string; vs?: string; by?: string }): Situation {
  return {
    t: 'battle', title: o.title, sub: o.vs ? `상대 ${o.vs}` : undefined,
    lines: [['승률 예측', `${n(o.win * 100, 0)}%`], ['아군 편성', o.mine], ['적 편성', o.theirs]],
    ids: o.vs ? [o.vs] : [], go: o.replay ? `/sim/${o.replay}` : '/sim', tone: o.win >= 0.5 ? 'cheong' : 'jeok', by: o.by, at: Date.now(),
  };
}

export function offerSituation(p: ProviderRow, by?: string): Situation {
  const den = p.rate_denom === 'ualpha' ? 'α' : p.rate_denom;
  return {
    t: 'market', title: `전력 판매 — ${micro(perKwDay(p.rate_amount), 3)} ${den}/kW·일`, sub: `공급자 ${p.id} · 변전소 ${p.substation_id}`,
    lines: [['용량', `${n(Number(p.capacity_minimum) / KW, 1)}–${n(Number(p.capacity_maximum) / KW, 1)} kW`], ['기간', `${n(Number(p.duration_minimum) / BLOCKS_PER_DAY, 1)}–${n(Number(p.duration_maximum) / BLOCKS_PER_DAY, 1)}일`], ['접근', /^open/i.test(p.access_policy) ? '공개' : /^guild/i.test(p.access_policy) ? '길드 전용' : '비공개']],
    ids: [p.id, p.owner].filter(Boolean), go: '/market', tone: 'hwang', by, at: Date.now(),
  };
}

export function guildSituation(o: { id: string; name: string; tag?: string; members: number; ratio?: number | null; note?: string; by?: string }): Situation {
  return {
    t: 'guild', title: `${o.name}${o.tag ? ` [${o.tag}]` : ''} — 함께할 사령관 모집`, sub: o.note,
    lines: [['길드원', `${n(o.members)}명`], ['담보율', o.ratio == null ? '—' : n(o.ratio, 3)], ['길드', o.id]],
    ids: [o.id], go: `/guild?id=${o.id}`, tone: 'hwang', by: o.by, at: Date.now(),
  };
}
