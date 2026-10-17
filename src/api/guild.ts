/* The Guild API as it exists today (structs-webapp src/Controller/*.php, plus /auth/matrix which the
 * live guild serves). Row shapes after structs-xyz src/guild/api.ts. NUMERIC columns arrive as
 * strings; `_p` fields are full-precision base units (see /api/denom).
 *
 * Everything here is a plain read. Screens should prefer the aggregate reads in planned.ts, which
 * fall back to these when the guild doesn't serve the aggregate yet. */
import { cached, call, get, post, type Envelope } from './http';

export type Num = string | number;
const enc = encodeURIComponent;

export interface GuildRow {
  id: string; endpoint: string; name: string; description: string; tag: string; logo: string; socials: string; website: string;
  primary_reactor_id: string; entry_substation_id: string; owner: string; status: string; default_commission: string; join_infusion_minimum: Num;
}
export interface DirectoryRow { guild_id: string; name: string; logo: string; alpha: Num; members: number }
export interface RosterRow { id: string; guild_id: string; username: string; pfp: string; guild_name: string; tag: string; alpha: Num; alpha_p?: string }
export interface PlayerRow {
  id: string; primary_address: string; guild_id: string; substation_id: string; planet_id: string; fleet_id: string; username: string; pfp: string;
  guild_name: string; tag: string; alpha: Num; ore: Num; load: Num; structs_load: Num; capacity: Num; connection_capacity: Num;
}
export interface PowerRow { player_id: string; username: string; capacity: Num; connection_capacity: Num; load: Num; structs_load: Num; total_load: Num; total_capacity: Num; margin: Num; connection_capacity_is_player_share: boolean }
export interface PlanetRow { id: string; owner: string; name: string; space_slots: number; air_slots: number; land_slots: number; water_slots: number; undiscovered_ore: Num }
export interface RaidRow { planet_id: string; fleet_id: string; status: string; updated_at: string; fleet_owner?: string; planet_owner?: string; seized_ore?: Num }
export interface ActivityRow { time: string; seq: number; planet_id: string; block_height?: number; category: string; detail: string | Record<string, unknown> }
export interface StructRow {
  id: string; type: number; owner: string; location_type: string; location_id: string; operating_ambit: string; slot: number;
  is_destroyed: boolean; health: number; status: number; protected_struct_id: string | null; defending_struct_ids: string | string[]; fuel: Num;
}
export interface StructTypeRow { id: number; type: string; category: string; [k: string]: unknown }
export interface FleetRow { id: string; owner: string; location_type: string; location_id: string; status: string; command_struct: string }
export interface WorkRow { object_id: string; player_id: string; target_id: string; category: 'BUILD' | 'MINE' | 'REFINE' | 'RAID'; block_start: number; difficulty_target: number }
export interface InfusionRow { destination_id: string; address: string; destination_type: string; player_id: string; fuel: Num; defusing: Num; power: Num; ratio: Num; commission: Num; fuel_p?: string; power_p?: string }
export interface AllocationRow { id: string; allocation_type: string; source_id: string; index: number; destination_id: string; creator: string; controller: string; created_at: string; updated_at: string }
export interface ProviderRow {
  id: string; owner: string; substation_id: string; rate_amount: Num; rate_denom: string; access_policy: string; capacity_minimum: Num; capacity_maximum: Num;
  duration_minimum: Num; duration_maximum: Num; provider_cancellation_penalty?: Num; consumer_cancellation_penalty?: Num; guild_id?: string; substation_owner?: string; committed_capacity?: Num; alpha_equivalent_rate_p?: string;
}
export interface AgreementRow { id: string; provider_id: string; allocation_id: string; capacity: Num; start_block: number; end_block: number; owner: string; blocks_remaining?: number; escrow_remaining?: Num }
export interface BankRow { guild_id: string; denom: string; collateral: Num; supply: Num; ratio: Num }
export interface BucketVolume { bucket: string; action: string; denom: string; volume: Num; count?: number }
export interface BlockRow { height: number; tip_height: number; lag_blocks: number; status: string; updated_at: string }
export interface PermissionRow { id: string; object_id: string; player_id: string; val: number }
export interface ObjectRow { id: string; type: string; object: Record<string, unknown> }
export interface SubstationRow { id: string; owner: string; name: string }
export type LeaderKind = 'player' | 'guild' | 'reactor' | 'substation' | 'provider';
export interface LeaderPlayer { player_id: string; username: string; guild_id: string; alpha_balance_p: string; alpha_value_p: string }
export interface LeaderGuild { guild_id: string; name: string; player_count: number; collateral_p: string; supply_p: string; ratio: Num; member_capacity_p: string; member_load_p: string }
export interface MatrixLogin { user_id: string; device_id: string; access_token: string; refresh_token?: string; expires_in?: number }

const page = <T>(path: string, n = 1, q?: Record<string, string | number | boolean | undefined>) =>
  call<T[]>(`${path}/page/${n}` + (q ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString() : '')).then((b) => b.data ?? []);

export const guildApi = {
  /* Public */
  thisGuild: () => cached('guild/this', 3_600_000, () => get<GuildRow>('guild/this')),
  timestamp: () => get<{ unix_timestamp: number }>('timestamp'),
  settings: () => cached('setting', 3_600_000, () => get<{ name: string; value: string }[]>('setting')),
  playerIdFor: (address: string, guildId: string) => get<{ player_id: string } | null>(`auth/player-address/${enc(address)}/guild/${enc(guildId)}/player-id`).then((r) => r?.player_id ?? null),
  login: (body: { address: string; signature: string; pubkey: string; guild_id: string; unix_timestamp: number }) => post<null>('auth/login', body),
  signup: (body: { primary_address: string; signature: string; pubkey: string; guild_id: string; username?: string }) => post<null>('auth/signup', body),
  logout: () => get<null>('auth/logout'),
  matrixLogin: (body: { address: string; pubkey: string; signature: string; guild_id: string; unix_timestamp: number; device_id?: string }) => post<MatrixLogin>('auth/matrix', body),

  /* Session */
  block: () => get<BlockRow>('block'),
  guild: (id: string) => cached(`guild/${id}`, 600_000, () => get<GuildRow>(`guild/${enc(id)}`)),
  directory: () => cached('guild/directory', 300_000, () => get<DirectoryRow[]>('guild/directory')),
  roster: (id: string) => cached(`roster/${id}`, 300_000, () => get<RosterRow[]>(`guild/${enc(id)}/roster`)),
  guildPower: (id: string) => get<Record<string, Num>>(`guild/${enc(id)}/power/stats`),
  memberCount: (id: string) => get<{ count: number }>(`guild/${enc(id)}/members/count`),
  bank: () => get<BankRow[]>('guild-bank'),
  bankHistory: (id: string, bucket: '1h' | '1d' = '1d') => get<BucketVolume[]>(`guild-bank/${enc(id)}/history`, { bucket }),

  player: (id: string) => get<PlayerRow>(`player/${enc(id)}`),
  playerPower: (id: string) => get<PowerRow>(`player/${enc(id)}/power`),
  playerCount: () => get<{ count: number }>('player/count'),
  activeCount: () => get<{ count: number }>('player/active/count'),
  oreStats: (id: string) => get<{ forfeited: Num; mined: Num; seized: Num }>(`player/${enc(id)}/ore/stats`),
  lastAction: (id: string) => get<{ last_action_block_height: number }>(`player/${enc(id)}/action/last/block/height`),

  planet: (id: string) => get<PlanetRow>(`planet/${enc(id)}`),
  planetCount: () => get<{ count: number }>('planet/count'),
  shieldHealth: (id: string) => get<{ health: number }>(`planet/${enc(id)}/shield/health`),
  activeRaid: (planetId: string) => get<RaidRow | null>(`planet/${enc(planetId)}/raid/active`),
  activity: (planetId: string, n = 1, limit = 30) => page<ActivityRow>(`planet-activity/planet/${enc(planetId)}`, n, { limit }),
  playerActivity: (playerId: string, n = 1, limit = 30) => page<ActivityRow>(`planet-activity/player/${enc(playerId)}`, n, { limit, order: 'desc' }),

  structsOf: (playerId: string) => get<StructRow[]>(`struct/player/${enc(playerId)}`),
  structTypes: () => cached('struct/type', 86_400_000, () => get<StructTypeRow[]>('struct/type')),
  structCount: () => get<{ count: number }>('struct/count', { is_destroyed: 0 }),
  fleetOf: (playerId: string) => get<FleetRow>(`fleet/player/${enc(playerId)}`),
  workOf: (playerId: string) => get<WorkRow[]>(`work/player/${enc(playerId)}`),

  infusionOf: (playerId: string) => get<InfusionRow>(`infusion/player/${enc(playerId)}`),
  infusionsOf: (playerId: string) => page<InfusionRow>(`infusion/list/player/${enc(playerId)}`),
  allocationsFrom: (sourceId: string) => page<AllocationRow>(`allocation/source/${enc(sourceId)}`),
  allocationsTo: (destId: string) => page<AllocationRow>(`allocation/destination/${enc(destId)}`),
  grid: (objectId: string) => page<{ attribute_type: string; object_id: string; val: Num }>(`grid/object/${enc(objectId)}`),
  substationsOf: (owner: string) => page<SubstationRow>(`substation/owner/${enc(owner)}`),
  playersOnSubstation: (id: string) => page<Record<string, unknown>>(`player/list/substation/${enc(id)}`, 1, { include_total: 1, limit: 1 }),

  providerMarket: () => cached('provider/market', 60_000, () => get<ProviderRow[]>('provider/market')),
  providersOf: (owner: string) => page<ProviderRow>(`provider/owner/${enc(owner)}`),
  agreementsOf: (owner: string) => get<AgreementRow[]>(`agreement/owner/${enc(owner)}/market`),
  permissionsTo: (playerId: string) => page<PermissionRow>(`permission/player/${enc(playerId)}`),

  leaderboard: <T = LeaderPlayer>(kind: LeaderKind, limit = 10) => cached(`lb/${kind}/${limit}`, 120_000, () => get<T[]>(`leaderboard/${kind}`, { limit })),
  objects: (ids: string[]) => ids.length ? get<ObjectRow[]>('objects', { ids: ids.slice(0, 200).join(',') }) : Promise.resolve([] as ObjectRow[]),
  resolve: (q: string) => get<Record<string, unknown>[]>('resolve', { q }),
  /** [tutorial branch] mini-game scores; used for the tutorial grade. */
  miniGameProgress: (body: { interface_name: string; game_name: string; score: number }) => call<unknown>('player/mini-game/progress', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as Promise<Envelope<unknown>>,
};
