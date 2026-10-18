/* Dev only (`?mock=1`, stored until `?mock=0`): a pretend Guild API so the signed-in screens can be
 * driven without a real session. Planned routes answer 404 like today's guild, so every fallback
 * in planned.ts runs too. Never part of a production build (http.ts imports it behind DEV). */
import type { Envelope } from './http';

const ME = '1-42', PLANET = '2-14';
const now = new Date().toISOString();
const player = (id: string, name: string, planet: string, alpha: number, ore: number) => ({
  id, primary_address: 'structs1' + id, guild_id: '0-5', substation_id: '4-7', planet_id: planet, fleet_id: '9-' + id.split('-')[1], username: name, pfp: '',
  guild_name: 'SN Corp', tag: 'SNC', alpha: alpha * 1e6, ore, load: 4e6, structs_load: 2.6e6, capacity: 9e6, connection_capacity: 1.2e6,
});
const PLAYERS: Record<string, ReturnType<typeof player>> = {
  [ME]: player(ME, '테스트 사령관', PLANET, 38.5, 64),
  '1-7': player('1-7', '은하수', '2-301', 512, 20), '1-9': player('1-9', '철갑상어', '2-77', 260, 140),
  '1-13': player('1-13', 'nova', '2-990', 120, 8), '1-21': player('1-21', '흑룡', '2-512', 88, 310),
};
const struct = (id: string, type: number, ambit: string, slot: number, loc: 'planet' | 'fleet', health: number, status = 5) => ({
  id, type, owner: ME, location_type: loc, location_id: loc === 'planet' ? PLANET : '9-42', operating_ambit: ambit, slot, is_destroyed: false, health, status, protected_struct_id: null, defending_struct_ids: [], fuel: 0,
});
const STRUCTS = [
  struct('5-1001', 1, 'space', 0, 'fleet', 6), struct('5-1002', 3, 'space', 1, 'fleet', 2), struct('5-1003', 9, 'land', 0, 'fleet', 3),
  struct('5-1010', 14, 'land', 0, 'planet', 6), struct('5-1011', 15, 'land', 1, 'planet', 6, 1), struct('5-1012', 20, 'air', 0, 'planet', 8), struct('5-1013', 19, 'water', 0, 'planet', 6),
];

/** `?mockraid=1`: 철갑상어 (1-9) is raiding the fixture planet. */
const RAID = (() => { try { const q = new URLSearchParams(location.search).get('mockraid'); if (q != null) localStorage.setItem('structs-kor.mockraid', q); return localStorage.getItem('structs-kor.mockraid') === '1'; } catch { return false; } })();
const raider = (id: string, type: number, ambit: string, slot: number, health: number) => ({ ...struct(id, type, ambit, slot, 'fleet', health), owner: '1-9', location_id: '9-9' });
const RAIDERS = [raider('5-2001', 1, 'space', 0, 6), raider('5-2002', 3, 'space', 0, 3), raider('5-2003', 9, 'land', 0, 3), raider('5-2004', 12, 'water', 1, 2)];

const ROUTES: [RegExp, (m: RegExpMatchArray) => unknown][] = [
  [/^block$/, () => ({ height: 2_955_801, tip_height: 2_955_801, lag_blocks: 0, status: 'ok', updated_at: now })],
  [/^player\/(1-\d+)$/, (m) => PLAYERS[m[1]] ?? null],
  [/^player\/(1-\d+)\/power$/, (m) => { const p = PLAYERS[m[1]]; if (!p) return null; return { player_id: p.id, username: p.username, capacity: p.capacity, connection_capacity: p.connection_capacity, load: p.load, structs_load: p.structs_load, total_load: p.load + p.structs_load, total_capacity: p.capacity + p.connection_capacity, margin: 0, connection_capacity_is_player_share: true }; }],
  [/^planet\/count$/, () => ({ count: 1840 })],
  [/^planet\/(2-\d+)$/, (m) => ({ id: m[1], owner: ME, name: '테스트 행성', space_slots: 4, air_slots: 4, land_slots: 4, water_slots: 4, undiscovered_ore: 12_400 })],
  [/^planet\/(2-\d+)\/shield\/health$/, () => ({ health: 64 })],
  [/^planet\/(2-\d+)\/raid\/active$/, () => (RAID ? { planet_id: PLANET, fleet_id: '9-9', status: 'ongoing', updated_at: now, fleet_owner: '1-9' } : null)],
  [/^fleet\/player\//, () => ({ id: '9-42', owner: ME, location_type: 'planet', location_id: PLANET, status: 'onStation', command_struct: '5-1001' })],
  [/^struct\/player\/(1-\d+)$/, (m) => (m[1] === ME ? STRUCTS : m[1] === '1-9' ? RAIDERS : [])],
  [/^work\/player\//, () => [{ object_id: '5-1011', player_id: ME, target_id: PLANET, category: 'REFINE', block_start: 2_953_000, difficulty_target: 2880 }]],
  [/^planet-activity\//, () => [{ time: now, seq: 1, planet_id: PLANET, block_height: 2_955_800, category: 'struct_block_ore_mine_complete', detail: '+2' }, { time: now, seq: 2, planet_id: PLANET, block_height: 2_955_790, category: 'struct_attack', detail: '' }]],
  [/^leaderboard\/player$/, () => Object.values(PLAYERS).sort((a, b) => b.alpha - a.alpha).map((p) => ({ player_id: p.id, username: p.username, guild_id: '0-5', alpha_balance_p: String(p.alpha), alpha_value_p: String(p.alpha) }))],
  [/^infusion\/list\/player\//, () => [{ destination_id: '3-15', address: '', destination_type: 'reactor', player_id: ME, fuel: 5e6, defusing: 0, power: 5e6, ratio: 1, commission: 3 }]],
  [/^allocation\/source\//, () => [{ id: '6-77', allocation_type: 'provider-agreement', source_id: ME, index: 0, destination_id: '1-9', creator: ME, controller: ME, created_at: now, updated_at: now }]],
  [/^allocation\/destination\//, () => []],
  [/^objects$/, () => [{ id: '6-77', type: 'allocation', object: { power: 2e6 } }]],
  [/^grid\/object\//, () => [{ attribute_type: 'connectionCount', object_id: '4-7', val: 12 }]],
  [/^player\/list\/substation\//, () => []],
  [/^provider\/market$/, () => [{ id: '10-3', substation_id: '4-7', guild_id: '0-5', rate_denom: 'ualpha', rate_amount: '2', access_policy: 'openMarket', capacity_minimum: 1e6, capacity_maximum: 20e6, duration_minimum: 14400, duration_maximum: 201600, consumer_cancellation_penalty: '0.1', provider_cancellation_penalty: '0.1', owner: '1-7' }]],
  [/^agreement\/owner\//, () => []],
  [/^guild\/(0-\d+)$/, (m) => ({ id: m[1], endpoint: '', name: 'SN Corp', description: 'Structs 한국 서버의 첫 길드.', tag: 'SNC', logo: '', socials: '', website: '', primary_reactor_id: '3-15', entry_substation_id: '4-7', owner: '1-7', status: 'active', default_commission: '0.03', join_infusion_minimum: 0 })],
  [/^guild\/(0-\d+)\/roster$/, () => Object.values(PLAYERS).map((p) => ({ id: p.id, guild_id: '0-5', username: p.username, pfp: JSON.stringify({ head: (Number(p.id.split('-')[1]) % 87) + 1, neck: 2, body: 7, arms: 3, background: 2 }), guild_name: 'SN Corp', tag: 'SNC', alpha: p.alpha }))],
  [/^guild\/(0-\d+)\/members\/count$/, () => ({ count: 5 })],
  [/^guild\/this$/, () => ({ id: '0-5', endpoint: '', name: 'SN Corp', description: 'Structs 한국 서버의 첫 길드.', tag: 'SNC', logo: '', socials: '', website: '', primary_reactor_id: '3-15', entry_substation_id: '4-7', owner: '1-7', status: 'active', default_commission: '0.03', join_infusion_minimum: 0 })],
  // Replicants: HD indexes 1–2 are enlisted, the rest are free.
  [/^auth\/player-address\/[^/]+\/guild\/[^/]+\/player-id$/, (m) => { const n = (m.input ?? '').length % 5; return n < 2 ? { player_id: `1-${300 + n}` } : null; }],
  [/^resolve$/, () => []],
  [/^guild-bank$/, () => [{ guild_id: '0-5', denom: 'uguild.0-5', collateral: 40e9, supply: 38e9, ratio: 1.05 }]],
];

export function mock<T>(path: string): Envelope<T> | null {
  const bare = path.replace(/^\/+/, '').split('?')[0];
  for (const [re, f] of ROUTES) { const m = bare.match(re); if (m) return { success: true, errors: [], data: f(m) as T }; }
  return null;
}
export const MOCK_PLAYER = ME;
