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

/* Enlisting against the mock: each POST auth/signup makes a new player for that address, kept in
 * this browser (so a playtest profile keeps its commander across runs). */
type MockAccount = { id: string; name: string };
const ACCOUNTS_KEY = 'structs-kor.mock.accounts';
const accounts = (): Record<string, MockAccount> => { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}'); } catch { return {}; } };
function signup(body: { primary_address?: string; username?: string }) {
  const all = accounts(), a = body.primary_address;
  if (!a) return null;
  if (!all[a]) {
    const n = Object.keys(all).length;
    all[a] = { id: `1-${1000 + Math.floor(Math.random() * 8000) * 10 + n}`, name: body.username || `cmdr-${n}` };
    try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all)); } catch { /* storage refused */ }
  }
  return null;
}
const byId = (id: string) => Object.values(accounts()).find((x) => x.id === id);

/* /objects?ids=…: structs, fleets, substations, reactors and providers by id (object cards). */
function objects(ids: string): { id: string; type: string; object: Record<string, unknown> }[] {
  const out: { id: string; type: string; object: Record<string, unknown> }[] = [];
  for (const id of ids.split(',').filter(Boolean)) {
    const s = [...STRUCTS, ...RAIDERS].find((x) => x.id === id);
    if (s) { out.push({ id, type: 'struct', object: s }); continue; }
    const k = id.split('-')[0];
    if (k === '9') { const owner = id === '9-9' ? '1-9' : '1-' + id.split('-')[1]; out.push({ id, type: 'fleet', object: { id, owner, status: id === '9-9' && RAID ? 'away' : 'onStation', location_id: id === '9-9' && RAID ? PLANET : PLAYERS[owner]?.planet_id ?? PLANET, command_struct: id === '9-9' ? '5-2001' : '5-1001' } }); }
    else if (k === '4') out.push({ id, type: 'substation', object: { id, owner: '1-7', name: '서울 변전소' } });
    else if (k === '3') out.push({ id, type: 'reactor', object: { id, guild_id: '0-5', validator: 'structsvaloper1mock000000000000', default_commission: '0.03' } });
    else if (k === '6') out.push({ id, type: 'allocation', object: { power: 2e6 } });
  }
  return out;
}

const prov = (id: string, owner: string, denom: string, rate: string, policy: string, cmin: number, cmax: number, sub = '4-7', guild = '0-5') => ({ id, substation_id: sub, guild_id: guild, rate_denom: denom, rate_amount: rate, access_policy: policy, capacity_minimum: cmin, capacity_maximum: cmax, duration_minimum: 14400, duration_maximum: 201600, consumer_cancellation_penalty: '0.1', provider_cancellation_penalty: '0.1', owner, committed_capacity: cmax / 4 });
const PROVIDERS = [
  prov('10-3', '1-7', 'ualpha', '2', 'openMarket', 1e6, 20e6), prov('10-8', '1-13', 'uguild.0-5', '3', 'openMarket', 2e6, 50e6),
  prov('10-11', '1-21', 'ualpha', '4', 'guildMarket', 5e6, 100e6, '4-9'), prov('10-15', '1-9', 'uguild.0-1', '1', 'openMarket', 1e6, 8e6, '4-2', '0-1'),
  prov('10-20', ME, 'ualpha', '3', 'openMarket', 1e6, 10e6),
];

const guild = (id: string, name: string, tag: string, owner: string, description: string) => ({ id, endpoint: '', name, description, tag, logo: '', socials: '', website: '', primary_reactor_id: '3-' + id.split('-')[1], entry_substation_id: '4-7', owner, status: 'active', default_commission: '0.03', join_infusion_minimum: 0 });
const GUILDS: Record<string, ReturnType<typeof guild>> = {
  '0-5': guild('0-5', 'SN Corp', 'SNC', ME, 'Structs 한국 서버의 첫 길드. 신입 환영, 매주 합동 습격.'),
  '0-1': guild('0-1', 'Slow Ninja', 'SN', '1-500', 'The oldest guild in the galaxy.'),
  '0-9': guild('0-9', '흑룡단', 'BLK', '1-21', '밤에 움직이는 습격 전문 길드.'),
};

const ROUTES: [RegExp, (m: RegExpMatchArray, q: URLSearchParams) => unknown][] = [
  [/^block$/, () => ({ height: 2_955_801, tip_height: 2_955_801, lag_blocks: 0, status: 'ok', updated_at: now })],
  [/^player\/(1-\d+)$/, (m) => PLAYERS[m[1]] ?? (byId(m[1]) ? { ...player(m[1], byId(m[1])!.name, '2-' + m[1].split('-')[1], 5, 0), alpha: 5e6 } : null)],
  [/^timestamp$/, () => ({ unix_timestamp: Math.floor(Date.now() / 1000) })],
  [/^auth\/login$/, () => null],
  [/^auth\/logout$/, () => null],
  [/^player\/(1-\d+)\/power$/, (m) => { const p = PLAYERS[m[1]]; if (!p) return null; return { player_id: p.id, username: p.username, capacity: p.capacity, connection_capacity: p.connection_capacity, load: p.load, structs_load: p.structs_load, total_load: p.load + p.structs_load, total_capacity: p.capacity + p.connection_capacity, margin: 0, connection_capacity_is_player_share: true }; }],
  [/^planet\/count$/, () => ({ count: 1840 })],
  [/^planet\/(2-\d+)$/, (m) => ({ id: m[1], owner: Object.values(PLAYERS).find((p) => p.planet_id === m[1])?.id ?? ME, name: m[1] === PLANET ? '테스트 행성' : `${Object.values(PLAYERS).find((p) => p.planet_id === m[1])?.username ?? '무명'}의 행성`, space_slots: 4, air_slots: 4, land_slots: 4, water_slots: 4, undiscovered_ore: 12_400 })],
  [/^planet\/(2-\d+)\/shield\/health$/, () => ({ health: 64 })],
  [/^planet\/(2-\d+)\/raid\/active$/, () => (RAID ? { planet_id: PLANET, fleet_id: '9-9', status: 'ongoing', updated_at: now, fleet_owner: '1-9' } : null)],
  [/^fleet\/player\//, () => ({ id: '9-42', owner: ME, location_type: 'planet', location_id: PLANET, status: 'onStation', command_struct: '5-1001' })],
  // A commander who enlisted here gets the fixture base as a starter, on their own planet and fleet.
  [/^struct\/player\/(1-\d+)$/, (m) => (m[1] === ME ? STRUCTS : m[1] === '1-9' ? RAIDERS : byId(m[1]) ? STRUCTS.map((x) => ({ ...x, owner: m[1], location_id: x.location_type === 'planet' ? '2-' + m[1].split('-')[1] : '9-' + m[1].split('-')[1] })) : [])],
  [/^work\/player\//, () => [{ object_id: '5-1011', player_id: ME, target_id: PLANET, category: 'REFINE', block_start: 2_953_000, difficulty_target: 2880 }]],
  [/^planet-activity\//, () => [{ time: now, seq: 1, planet_id: PLANET, block_height: 2_955_800, category: 'struct_block_ore_mine_complete', detail: '+2' }, { time: now, seq: 2, planet_id: PLANET, block_height: 2_955_790, category: 'struct_attack', detail: '' }]],
  [/^leaderboard\/player$/, () => Object.values(PLAYERS).sort((a, b) => b.alpha - a.alpha).map((p) => ({ player_id: p.id, username: p.username, guild_id: '0-5', alpha_balance_p: String(p.alpha), alpha_value_p: String(p.alpha) }))],
  [/^infusion\/list\/player\//, () => [{ destination_id: '3-15', address: '', destination_type: 'reactor', player_id: ME, fuel: 5e6, defusing: 0, power: 5e6, ratio: 1, commission: 3 }]],
  [/^allocation\/source\//, () => [{ id: '6-77', allocation_type: 'provider-agreement', source_id: ME, index: 0, destination_id: '1-9', creator: ME, controller: ME, created_at: now, updated_at: now }]],
  [/^allocation\/destination\//, () => []],
  [/^objects$/, (_m, q) => objects(q.get('ids') ?? '')],
  [/^grid\/object\//, () => [{ attribute_type: 'connectionCount', object_id: '4-7', val: 12 }]],
  [/^player\/list\/substation\//, () => []],
  [/^provider\/market$/, () => PROVIDERS],
  [/^provider\/owner\/(1-\d+)/, (m) => PROVIDERS.filter((p) => p.owner === m[1])],
  [/^agreement\/owner\//, () => [{ id: '11-4', provider_id: '10-3', allocation_id: '6-77', capacity: 5e6, start_block: 2_940_000, end_block: 2_990_000, owner: ME, blocks_remaining: 34_199, escrow_remaining: 3.4e8 }]],
  [/^guild\/(0-\d+)$/, (m) => GUILDS[m[1]] ?? null],
  [/^guild\/(0-\d+)\/roster$/, () => Object.values(PLAYERS).map((p) => ({ id: p.id, guild_id: '0-5', username: p.username, pfp: JSON.stringify({ head: (Number(p.id.split('-')[1]) % 87) + 1, neck: 2, body: 7, arms: 3, background: 2 }), guild_name: 'SN Corp', tag: 'SNC', alpha: p.alpha }))],
  [/^guild\/(0-\d+)\/members\/count$/, (m) => ({ count: m[1] === '0-5' ? 5 : m[1] === '0-1' ? 41 : 9 })],
  [/^guild\/this$/, () => GUILDS['0-5']],
  [/^guild\/directory$/, () => Object.values(GUILDS).map((g) => ({ guild_id: g.id, name: g.name, logo: '', alpha: g.id === '0-5' ? 980e6 : g.id === '0-1' ? 2400e6 : 310e6, members: g.id === '0-5' ? 5 : g.id === '0-1' ? 41 : 9 }))],
  [/^guild\/(0-\d+)\/power\/stats$/, () => ({ capacity: 420e6, load: 260e6, connection_capacity: 12e6 })],
  // Replicants: HD indexes 1–2 are enlisted, the rest are free.
  // An address that signed up here has its player; before any signup, nobody is enlisted (so /start
  // really registers). After it, replicant HD indexes 1–2 count as enlisted, the rest are free.
  [/^auth\/player-address\/([^/]+)\/guild\/[^/]+\/player-id$/, (m) => {
    const all = accounts(), mine = all[decodeURIComponent(m[1])];
    if (mine) return { player_id: mine.id };
    if (!Object.keys(all).length) return null;
    const n = (m.input ?? '').length % 5; return n < 2 ? { player_id: `1-${300 + n}` } : null;
  }],
  [/^resolve$/, () => []],
  [/^guild-bank$/, () => [{ guild_id: '0-5', denom: 'uguild.0-5', collateral: 40e9, supply: 38e9, ratio: 1.05 }, { guild_id: '0-1', denom: 'uguild.0-1', collateral: 9e9, supply: 10e9, ratio: 0.9 }]],
];

export function mock<T>(path: string, init: RequestInit = {}): Envelope<T> | null {
  const bare = path.replace(/^\/+/, '').split('?')[0];
  if (bare === 'auth/signup' && init.method === 'POST') { try { signup(JSON.parse(String(init.body ?? '{}'))); } catch { /* bad body */ } return { success: true, errors: [], data: null as T }; }
  for (const [re, f] of ROUTES) { const m = bare.match(re); if (m) return { success: true, errors: [], data: f(m, new URLSearchParams(path.split('?')[1] ?? '')) as T }; }
  return null;
}
export const MOCK_PLAYER = ME;
