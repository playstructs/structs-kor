/* Reading the game straight from the chain (the public LCD), for when the guild session is missing.
 * Safari and Firefox in strict mode won't keep the guild's session cookie for a site on another
 * domain, so members-only Guild API reads fail even though the commander is enlisted. Like
 * structs.xyz, the client then plays from the chain: this module answers the same row shapes the
 * Guild API does (PlayerRow, StructRow, WorkRow…), so screens don't care which one they got.
 *
 * Power comes straight from the chain in mW. The substation's per-connection share is the
 * substation's own connectionCapacity grid attribute (structsd GetCapacitySecondary). */
import { endpoints } from '../config';
import { TYPES_BY_ID } from '../data/catalogue';
import type { PlayerRow, PowerRow, PlanetRow, FleetRow, StructRow, WorkRow, LeaderPlayer } from './guild';

type Grid = Record<string, string | undefined>;
interface LcdPlayer { Player: { id: string; guildId: string; substationId: string; primaryAddress: string; planetId: string; fleetId: string; name: string; pfp: string; pfpClientRenderAttributes?: string }; gridAttributes?: Grid }
interface LcdPlanet { Planet: { id: string; owner: string; name: string; maxOre: string; spaceSlots: string; airSlots: string; landSlots: string; waterSlots: string; space: string[]; air: string[]; land: string[]; water: string[] }; gridAttributes?: Grid }
interface LcdFleet { Fleet: { id: string; owner: string; locationType: string; locationId: string; status: string; space: string[]; air: string[]; land: string[]; water: string[]; commandStruct: string } }
interface LcdStruct { Struct: { id: string; type: string; owner: string; locationType: string; locationId: string; operatingAmbit: string; slot: string }; structAttributes?: Record<string, string | boolean | undefined>; structDefenders?: string[] }

/* Screens ask for the same player and structs several times a paint: answers live for a few seconds
 * (a block is ~6 s), and a request in flight is shared. */
const memo = new Map<string, { at: number; v: Promise<unknown> }>();
function get<T>(path: string, ttl = 4000): Promise<T> {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.v as Promise<T>;
  const v = fetch(endpoints.lcd + path, { signal: AbortSignal.timeout(15_000) }).then((r) => {
    if (!r.ok) throw new Error(`LCD ${r.status} ${path}`);
    return r.json() as Promise<T>;
  });
  memo.set(path, { at: Date.now(), v });
  v.catch(() => memo.delete(path));
  if (memo.size > 200) memo.delete(memo.keys().next().value as string);
  return v;
}
const LEADERS_TTL = 300_000;
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const ids = (...lists: (string[] | undefined)[]) => [...new Set(lists.flatMap((l) => l ?? []).filter(Boolean))];

export const chainread = {
  height: () => get<{ block: { header: { height: string } } }>('/cosmos/base/tendermint/v1beta1/blocks/latest').then((r) => Number(r.block.header.height)),
  playerRaw: (id: string) => get<LcdPlayer>(`/structs/player/${encodeURIComponent(id)}`),

  async player(id: string): Promise<PlayerRow> {
    const p = await this.playerRaw(id);
    const g = p.gridAttributes ?? {};
    const [alpha, share] = await Promise.all([
      get<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${encodeURIComponent(p.Player.primaryAddress)}?pagination.limit=100`)
        .then((b) => b.balances.find((c) => c.denom === 'ualpha')?.amount ?? '0').catch(() => '0'),
      this.connectionShare(p.Player.substationId),
    ]);
    return {
      id, primary_address: p.Player.primaryAddress, guild_id: p.Player.guildId, substation_id: p.Player.substationId,
      planet_id: p.Player.planetId, fleet_id: p.Player.fleetId, username: p.Player.name, pfp: p.Player.pfpClientRenderAttributes || p.Player.pfp || '',
      guild_name: '', tag: '', alpha, ore: n(g.ore), load: n(g.load), structs_load: n(g.structsLoad), capacity: n(g.capacity), connection_capacity: share,
    };
  },

  /** The substation's share per connected player, in mW (0 without a substation). */
  async connectionShare(substationId: string): Promise<number> {
    if (!substationId) return 0;
    const s = await get<{ gridAttributes?: Grid }>(`/structs/substation/${encodeURIComponent(substationId)}`).catch(() => null);
    return n(s?.gridAttributes?.connectionCapacity);
  },

  power(p: PlayerRow): PowerRow {
    const cap = n(p.capacity), share = n(p.connection_capacity), load = n(p.load) + n(p.structs_load);
    return { player_id: p.id, username: p.username, capacity: cap, connection_capacity: share, load: p.load, structs_load: p.structs_load, total_load: load, total_capacity: cap + share, margin: cap + share - load, connection_capacity_is_player_share: true };
  },

  async planet(id: string): Promise<{ row: PlanetRow; structIds: string[] }> {
    const p = await get<LcdPlanet>(`/structs/planet/${encodeURIComponent(id)}`);
    const P = p.Planet, g = p.gridAttributes ?? {};
    return {
      row: { id: P.id, owner: P.owner, name: P.name, space_slots: n(P.spaceSlots), air_slots: n(P.airSlots), land_slots: n(P.landSlots), water_slots: n(P.waterSlots), undiscovered_ore: Math.max(0, n(P.maxOre) - n(g.ore)) },
      structIds: ids(P.space, P.air, P.land, P.water),
    };
  },

  async fleet(id: string): Promise<{ row: FleetRow; structIds: string[] }> {
    const { Fleet: F } = await get<LcdFleet>(`/structs/fleet/${encodeURIComponent(id)}`);
    return {
      row: { id: F.id, owner: F.owner, location_type: F.locationType, location_id: F.locationId, status: F.status, command_struct: F.commandStruct },
      structIds: ids(F.space, F.air, F.land, F.water, [F.commandStruct]),
    };
  },

  async struct(id: string): Promise<{ row: StructRow; attrs: Record<string, string | boolean | undefined> }> {
    const s = await get<LcdStruct>(`/structs/struct/${encodeURIComponent(id)}`);
    const a = s.structAttributes ?? {}, S = s.Struct;
    return {
      row: {
        id: S.id, type: n(S.type), owner: S.owner, location_type: S.locationType, location_id: S.locationId, operating_ambit: S.operatingAmbit, slot: n(S.slot),
        is_destroyed: a.isDestroyed === true, health: n(a.health), status: n(a.status), protected_struct_id: null, defending_struct_ids: s.structDefenders ?? [], fuel: 0,
      },
      attrs: a,
    };
  },

  /** How many planets have been discovered. Planet ids are sequential (2-1, 2-2, …) and the list is too
   * big to count in one query, so find the highest id that exists by doubling, then halving. */
  async planetCount(): Promise<number> {
    const has = (i: number) => get<LcdPlanet>(`/structs/planet/2-${i}`, LEADERS_TTL).then(() => true, () => false);
    if (!(await has(1))) return 0;
    let lo = 1, hi = 2;
    while (await has(hi)) { lo = hi; hi *= 2; if (hi > 1 << 24) return lo; }
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await has(mid)) lo = mid; else hi = mid; }
    return lo;
  },

  /** The commanders holding the most alpha, best first (the guild's leaderboard/player, from the chain).
   * The bank lists every alpha holder (~1,400 on testnet, two pages); each top address maps to its
   * commander through the address registry. Cached for a few minutes: it's a standings table. */
  async leaders(limit = 10): Promise<LeaderPlayer[]> {
    const owners: { address: string; balance: { amount: string } }[] = [];
    let key = '';
    for (let i = 0; i < 10; i++) {
      const q = `?pagination.limit=1000${key ? '&pagination.key=' + encodeURIComponent(key) : ''}`;
      const r = await get<{ denom_owners: typeof owners; pagination?: { next_key?: string | null } }>(`/cosmos/bank/v1beta1/denom_owners/ualpha${q}`, LEADERS_TTL);
      owners.push(...r.denom_owners);
      key = r.pagination?.next_key ?? '';
      if (!key) break;
    }
    const top = owners.filter((o) => o.address).sort((a, b) => n(b.balance.amount) - n(a.balance.amount)).slice(0, limit * 2);
    const rows = await Promise.all(top.map(async (o) => {
      const a = await get<{ playerId?: string }>(`/structs/address/${encodeURIComponent(o.address)}`, LEADERS_TTL).catch(() => null);
      if (!a?.playerId || a.playerId === '1-0') return null;
      const p = await get<LcdPlayer>(`/structs/player/${encodeURIComponent(a.playerId)}`, LEADERS_TTL).catch(() => null);
      return p ? { player_id: a.playerId, username: p.Player.name, guild_id: p.Player.guildId, alpha_balance_p: o.balance.amount, alpha_value_p: o.balance.amount } : null;
    }));
    // One commander can hold alpha on several addresses: count each once, at their biggest.
    const seen = new Set<string>();
    return rows.filter((r): r is LeaderPlayer => !!r && !seen.has(r.player_id) && !!seen.add(r.player_id)).slice(0, limit);
  },

  /** Every struct the commander has on their planet and in their fleet, with the work each one owes. */
  async base(p: PlayerRow): Promise<{ planet: PlanetRow | null; fleet: FleetRow | null; structs: StructRow[]; work: WorkRow[] }> {
    const [planet, fleet] = await Promise.all([
      p.planet_id ? this.planet(p.planet_id).catch(() => null) : null,
      p.fleet_id ? this.fleet(p.fleet_id).catch(() => null) : null,
    ]);
    const all = await Promise.all(ids(planet?.structIds, fleet?.structIds).map((id) => this.struct(id).catch(() => null)));
    const got = all.filter((x): x is NonNullable<typeof x> => !!x && x.row.owner === p.id);
    const work: WorkRow[] = [];
    for (const { row, attrs } of got) {
      const t = TYPES_BY_ID[row.type];
      if (!t || row.is_destroyed) continue;
      const built = (row.status & 2) !== 0, online = (row.status & 4) !== 0;
      if ((row.status & 1) && !built && n(attrs.blockStartBuild)) work.push({ object_id: row.id, player_id: p.id, target_id: p.planet_id, category: 'BUILD', block_start: n(attrs.blockStartBuild), difficulty_target: n(t.buildDifficulty) });
      if (built && online && n(attrs.blockStartOreMine) && n(t.oreMiningDifficulty)) work.push({ object_id: row.id, player_id: p.id, target_id: p.planet_id, category: 'MINE', block_start: n(attrs.blockStartOreMine), difficulty_target: n(t.oreMiningDifficulty) });
      if (built && online && n(attrs.blockStartOreRefine) && n(t.oreRefiningDifficulty)) work.push({ object_id: row.id, player_id: p.id, target_id: p.planet_id, category: 'REFINE', block_start: n(attrs.blockStartOreRefine), difficulty_target: n(t.oreRefiningDifficulty) });
    }
    return { planet: planet?.row ?? null, fleet: fleet?.row ?? null, structs: got.map((x) => x.row), work };
  },
};
