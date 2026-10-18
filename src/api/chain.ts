/* Chain reads the Guild API doesn't cover yet, from the chain's LCD (REST): bank balances and guild
 * membership applications. Each tries the planned Guild API route first (REQ-WAL-1, REQ-GLD-1), so
 * the guild can take them over with no client change. Under ?mock=1 they answer from fixtures. */
import { endpoints } from '../config';
import { MOCK, ApiError, get } from './http';
import { fellBack, isMissing, markMissing } from './requirements';

export interface Coin { denom: string; amount: string }
export interface Application { guildId: string; playerId: string; joinType: string; status: string; proposer: string; substationId: string }

async function lcd<T>(path: string): Promise<T> {
  const r = await fetch(endpoints.lcd + path);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body as { message?: string } | null)?.message || `LCD ${r.status}`);
  return body as T;
}
async function planned<T>(req: string, path: string, fallback: () => Promise<T>): Promise<T> {
  if (!isMissing(req)) {
    try { const v = await get<T>(path); if (v != null) return v; markMissing(req); } catch (e) { if (!(e instanceof ApiError) || e.code !== 'missing') throw e; markMissing(req); }
  }
  fellBack(req);
  return fallback();
}

/* ── Mock fixtures ── */
const mockApps: Application[] = [
  { guildId: '0-5', playerId: '1-88', joinType: 'request', status: 'proposed', proposer: '1-88', substationId: '' },
  { guildId: '0-5', playerId: '1-91', joinType: 'request', status: 'proposed', proposer: '1-91', substationId: '' },
  { guildId: '0-5', playerId: '1-120', joinType: 'invite', status: 'proposed', proposer: '1-7', substationId: '4-7' },
];

/** Every coin an address holds: ualpha and any uguild.<id> tokens. */
export function balances(address: string): Promise<Coin[]> {
  if (MOCK) return Promise.resolve([{ denom: 'ualpha', amount: '38500000' }, { denom: 'uguild.0-5', amount: '12000000' }, { denom: 'uguild.0-1', amount: '500000' }]);
  return planned<Coin[]>('REQ-WAL-1', `account/${encodeURIComponent(address)}/balances`,
    async () => (await lcd<{ balances: Coin[] }>(`/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}?pagination.limit=100`)).balances ?? []);
}

const norm = (a: Record<string, unknown>): Application => ({
  guildId: String(a.guildId ?? a.guild_id ?? ''), playerId: String(a.playerId ?? a.player_id ?? ''), joinType: String(a.joinType ?? a.join_type ?? ''),
  status: String(a.registrationStatus ?? a.registration_status ?? a.status ?? ''), proposer: String(a.proposer ?? ''), substationId: String(a.substationId ?? a.substation_id ?? ''),
});
/** Open join requests and invites, for one guild or (playerId) for one commander. */
export async function applications(o: { guildId?: string; playerId?: string }): Promise<Application[]> {
  const all = MOCK ? mockApps : await planned<Application[]>('REQ-GLD-1', `guild/membership/applications`, async () => {
    const r = await lcd<{ guildMembershipApplication?: Record<string, unknown>[] }>('/structs/guild_membership_application?pagination.limit=1000');
    return (r.guildMembershipApplication ?? []).map(norm);
  });
  return all.filter((a) => (!o.guildId || a.guildId === o.guildId) && (!o.playerId || a.playerId === o.playerId) && !/approved|denied|revoked/i.test(a.status));
}
/** Mock only: approving/denying moves the fixture so the screen can be exercised. */
export function mockResolve(playerId: string) { const i = mockApps.findIndex((a) => a.playerId === playerId); if (i >= 0) mockApps.splice(i, 1); }

/* Guild tokens are named for their guild ("SN Corp 토큰"), not their denom ("uguild.0-5"). Names come
 * from the guild directory, fetched once in the background the first time a token is shown. */
const guildNames = new Map<string, string>();
let asked = false;
export function nameGuilds(rows: { guild_id: string; name: string }[]) { for (const r of rows) if (r.name) guildNames.set(r.guild_id, r.name); }
function askNames() {
  if (asked) return; asked = true;
  void get<{ guild_id: string; name: string }[]>('guild/directory').then((rows) => nameGuilds(rows ?? [])).catch(() => { asked = false; });
}
export const denomLabel = (d: string) => {
  if (d === 'ualpha') return '알파';
  if (!d.startsWith('uguild.')) return d;
  const id = d.slice(7), name = guildNames.get(id);
  if (!name) askNames();
  return name ? `${name} 토큰` : `길드 ${id} 토큰`;
};
