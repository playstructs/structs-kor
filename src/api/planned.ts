/* Reads built against Guild API endpoints that don't exist yet (docs/guild-api-requirements.md).
 * Each tries the planned route first and, when the guild doesn't serve it, assembles the same shape
 * from today's routes. Screens only ever see the planned shape, so when the guild ships an
 * endpoint the site gets faster with no code change. */
import { ApiError, get } from './http';
import { fellBack, isMissing, markMissing } from './requirements';
import { session } from './session';
import {
  guildApi as g, type ActivityRow, type AllocationRow, type DirectoryRow, type FleetRow, type InfusionRow, type LeaderPlayer, type Num,
  type PlanetRow, type PlayerRow, type PowerRow, type ProviderRow, type RaidRow, type StructRow, type WorkRow,
} from './guild';

async function planned<T>(req: string, path: string, fallback: () => Promise<T>, q?: Record<string, string | number | undefined>): Promise<T> {
  if (!isMissing(req)) {
    try {
      const v = await get<T>(path, q);
      // A route that answers with no data is some other route matching the path (e.g.
      // `player-address/:address` taking "resolve" as an address): treat it as not built yet.
      if (v != null) return v;
      markMissing(req);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'missing') throw e;
      markMissing(req);
    }
  }
  fellBack(req);
  return fallback();
}
const soft = <T>(p: Promise<T>, dflt: T): Promise<T> => p.catch(() => dflt);

/* ── REQ-PUB-*: the landing page, before anyone signs in ────────────────── */

export interface PublicSummary { guild_name: string; players: number | null; active_players: number | null; planets: number | null; structs: number | null; guilds: number | null; height: number | null }

/** Members-only fallbacks are pointless before sign-in: they would only collect 401s. */
const signedIn = () => session.status.state === 'in';

export function publicSummary(): Promise<PublicSummary> {
  return planned('REQ-PUB-1', 'public/summary', async () => {
    if (!signedIn()) return { guild_name: await soft(g.thisGuild().then((x) => x.name), 'SN Corp'), players: null, active_players: null, planets: null, structs: null, guilds: null, height: null };
    const [guild, players, active, planets, structs, block] = await Promise.all([
      soft(g.thisGuild().then((x) => x.name), 'SN Corp'),
      soft(g.playerCount().then((x) => x.count), null),
      soft(g.activeCount().then((x) => x.count), null),
      soft(g.planetCount().then((x) => x.count), null),
      soft(g.structCount().then((x) => x.count), null),
      soft(g.block().then((x) => x.height), null),
    ]);
    const guilds = await soft(g.directory().then((d) => d.length), null);
    return { guild_name: guild, players, active_players: active, planets, structs, guilds, height: block };
  });
}

export const publicLeaderboard = (limit = 5) => planned<LeaderPlayer[]>('REQ-PUB-2', 'public/leaderboard/player', async () => (signedIn() ? g.leaderboard<LeaderPlayer>('player', limit) : []), { limit });
export const publicDirectory = () => planned<DirectoryRow[]>('REQ-PUB-3', 'public/guild/directory', async () => (signedIn() ? g.directory() : []));

/* ── REQ-AGG-1: everything the command console shows, in one read ───────── */

export interface Dashboard {
  player: PlayerRow; power: PowerRow | null; planet: PlanetRow | null; shield_health: number | null; active_raid: RaidRow | null;
  fleet: FleetRow | null; structs: StructRow[]; /** null when the read failed (not "nothing owed"). */ work: WorkRow[] | null; activity: ActivityRow[]; height: number | null;
}

export function dashboard(playerId: string): Promise<Dashboard> {
  return planned('REQ-AGG-1', `player/${encodeURIComponent(playerId)}/dashboard`, async () => {
    const player = await g.player(playerId);
    const pid = player.planet_id;
    const [power, planet, shield, raid, fleet, structs, work, activity, block] = await Promise.all([
      soft(g.playerPower(playerId), null),
      pid ? soft(g.planet(pid), null) : null,
      pid ? soft(g.shieldHealth(pid).then((x) => x.health), null) : null,
      pid ? soft(g.activeRaid(pid), null) : null,
      soft(g.fleetOf(playerId), null),
      soft(g.structsOf(playerId), []),
      soft<WorkRow[] | null>(g.workOf(playerId), null),
      soft(g.playerActivity(playerId, 1, 20), []),
      soft(g.block().then((b) => b.height), null),
    ]);
    return { player, power, planet, shield_health: shield, active_raid: raid, fleet, structs, work, activity, height: block };
  });
}

/* ── REQ-EN-1: the energy screen ───────────────────────────────────────── */

export interface AllocationOut extends AllocationRow { power: Num | null; cascade_rank: number }
export interface Energy {
  power: PowerRow | null;
  infusions: InfusionRow[];
  allocations_out: AllocationOut[];
  allocations_in: (AllocationRow & { power: Num | null })[];
  substation: { id: string; name: string | null; connection_count: number | null; connection_capacity: Num | null } | null;
}

/** An allocation's power, from its raw object (field names vary by indexer version). */
const powerOf = (o: Record<string, unknown> | undefined): Num | null => {
  if (!o) return null;
  for (const k of ['power', 'capacity', 'power_p']) if (o[k] != null) return o[k] as Num;
  return null;
};

export function energy(player: PlayerRow): Promise<Energy> {
  return planned('REQ-EN-1', `player/${encodeURIComponent(player.id)}/energy`, async () => {
    const [power, infusions, out, inn] = await Promise.all([
      soft(g.playerPower(player.id), null),
      soft(g.infusionsOf(player.id), []),
      soft(g.allocationsFrom(player.id), []),
      soft(g.allocationsTo(player.id), []),
    ]);
    const objs = await soft(g.objects([...out, ...inn].map((a) => a.id)), []);
    const byId = new Map(objs.map((o) => [o.id, o.object]));
    // The chain cuts outgoing allocations oldest-first when load exceeds capacity (GridCascade).
    const ordered = [...out].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.index - b.index);
    let substation: Energy['substation'] = null;
    if (player.substation_id) {
      const [grid, conns] = await Promise.all([soft(g.grid(player.substation_id), []), soft(g.playersOnSubstation(player.substation_id), [])]);
      substation = {
        id: player.substation_id, name: null,
        connection_count: (grid.find((x) => x.attribute_type === 'connectionCount')?.val as number | undefined) ?? (conns.length || null),
        connection_capacity: grid.find((x) => x.attribute_type === 'connectionCapacity')?.val ?? null,
      };
    }
    return {
      power, infusions,
      allocations_out: ordered.map((a, i) => ({ ...a, power: powerOf(byId.get(a.id)), cascade_rank: i + 1 })),
      allocations_in: inn.map((a) => ({ ...a, power: powerOf(byId.get(a.id)) })),
      substation,
    };
  });
}

/* ── REQ-EN-2: which allocations a capacity drop would cut ─────────────── */

export interface WhatIf { cut: string[]; offline: boolean }
export function powerWhatIf(playerId: string, e: Energy, dropMw: number): Promise<WhatIf> {
  return planned('REQ-EN-2', `player/${encodeURIComponent(playerId)}/power/what-if`, async () => whatIfLocal(e, dropMw), { capacity_delta: -dropMw });
}
/** online ⇔ load + structsLoad ≤ capacity + capacitySecondary (structs-ai mechanics/power.md). */
export function whatIfLocal(e: Energy, dropMw: number): WhatIf {
  const p = e.power;
  if (!p) return { cut: [], offline: false };
  const supply = Number(p.capacity) + Number(p.connection_capacity) - dropMw;
  let load = Number(p.load);
  const structs = Number(p.structs_load);
  const cut: string[] = [];
  for (const a of e.allocations_out) {
    if (load + structs <= supply) break;
    cut.push(a.id);
    load -= Number(a.power ?? 0);
  }
  return { cut, offline: load + structs > supply };
}

/* ── REQ-MKT-*: the energy exchange ────────────────────────────────────── */

export interface MarketStat { provider_id: string; rate_change_24h_pct: number | null; volume_24h: Num | null; utilization: number | null }
export const marketStats = () => planned<MarketStat[]>('REQ-MKT-1', 'provider/market/stats', async () => [], { bucket: '1d' });

export interface Quote { total: number; denom: string; valid: boolean; errors: string[] }
export function quote(p: ProviderRow, capacityMw: number, durationBlocks: number): Promise<Quote> {
  return planned('REQ-MKT-2', `provider/${encodeURIComponent(p.id)}/quote`, async () => quoteLocal(p, capacityMw, durationBlocks), { capacity: capacityMw, duration: durationBlocks });
}
/** capacity × rate × duration, paid up front into escrow (structs-ai economy/energy-market.md). */
export function quoteLocal(p: ProviderRow, capacityMw: number, durationBlocks: number): Quote {
  const errors: string[] = [];
  if (capacityMw < Number(p.capacity_minimum) || capacityMw > Number(p.capacity_maximum)) errors.push('용량이 공급자 범위를 벗어났습니다.');
  if (durationBlocks < Number(p.duration_minimum) || durationBlocks > Number(p.duration_maximum)) errors.push('기간이 공급자 범위를 벗어났습니다.');
  return { total: capacityMw * Number(p.rate_amount) * durationBlocks, denom: p.rate_denom, valid: !errors.length, errors };
}

/* ── REQ-REP-*: replicants ─────────────────────────────────────────────── */

export interface Replicant { player_id: string; address: string; hd_index: number | null; username: string; alpha: Num; ore: Num; planet_id: string; capacity: Num; load: Num }

/** Replicants are players derived from the commander's own phrase (HD index ≥ 1). The guild can't
 * know the HD link, but it does know which players granted the commander permissions: REQ-REP-1.
 * Until then the wallet derives the addresses and the guild resolves them (REQ-REP-2). */
export function replicants(commanderId: string, derived: { index: number; address: string }[]): Promise<Replicant[]> {
  return planned('REQ-REP-1', `player/${encodeURIComponent(commanderId)}/replicants`, async () => {
    const ids = await resolveAddresses(derived.map((d) => d.address));
    const found = derived.map((d) => ({ ...d, player_id: ids[d.address] })).filter((d) => d.player_id);
    const rows = await soft(g.objects(found.map((f) => f.player_id!)), []);
    const byId = new Map(rows.map((r) => [r.id, r.object]));
    return found.map((f) => {
      const o = (byId.get(f.player_id!) || {}) as Record<string, Num>;
      return { player_id: f.player_id!, address: f.address, hd_index: f.index, username: String(o.username ?? ''), alpha: o.alpha ?? 0, ore: o.ore ?? 0, planet_id: String(o.planet_id ?? ''), capacity: o.capacity ?? 0, load: o.load ?? 0 };
    });
  });
}

export function resolveAddresses(addresses: string[]): Promise<Record<string, string | null>> {
  if (!addresses.length) return Promise.resolve({});
  return planned('REQ-REP-2', 'player-address/resolve', async () => {
    const guildId = (await g.thisGuild()).id;
    const out: Record<string, string | null> = {};
    await Promise.all(addresses.map(async (a) => { out[a] = await soft(g.playerIdFor(a, guildId), null); }));
    return out;
  }, { addresses: addresses.join(',') });
}

/* ── REQ-SIM-1: the daily engagement ──────────────────────────────────── */

export interface Daily { date: string; seed: string; ladder: { player_id: string; username: string; stars: number; blocks: number }[] }
export function daily(): Promise<Daily> {
  return planned('REQ-SIM-1', 'sim/daily', async () => {
    const date = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    return { date, seed: 'KR-' + date.replace(/-/g, ''), ladder: [] };
  });
}
