/* 복무 규칙 (standing orders) for the replicant squad, run in this browser while the client is open
 * and the wallet unlocked: sweep alpha home above a line, and replicate when the substation has room.
 * Every action is a normal signed transaction and lands in the duty log. Structs Desktop runs the
 * same doctrine around the clock; here it runs while you play. Under ?mock=1 nothing is signed: the
 * log says what would have happened. */
import { session } from '../api/session';
import { wallet } from '../wallet/wallet';
import { MOCK } from '../api/http';
import { guildApi } from '../api/guild';
import { replicants as listReplicants, energy as energyOf, type Replicant } from '../api/planned';
import { actions } from '../api/actions';
import { GUILD_ID } from '../config';
import { pushNative } from './native';

export type Role = 'productive' | 'bait' | 'raider';
export interface Doctrine {
  enabled: boolean; autopilot: boolean; sweepAbove: number; keep: number; rally: string; roles: Record<string, Role>;
  autoSweep: boolean; autoReplicate: boolean; maxReps: number; newRole: Role;
}
export interface DutyEntry { at: number; text: string; tone?: 'cheong' | 'hwang' | 'jeok' }

const KEY = 'structs-kor.doctrine', LOG = 'structs-kor.duty';
const DEFAULT: Doctrine = { enabled: true, autopilot: false, sweepAbove: 2, keep: 0.2, rally: '', roles: {}, autoSweep: false, autoReplicate: false, maxReps: 12, newRole: 'productive' };
export const SCAN = 12;
export const MIN_SHARE_MW = 4e6;
export const CALLSIGNS = ['Vesper', 'Kestrel', 'Orrin', 'Lumen', 'Tamsin', 'Corvid', 'Halcyon', 'Sable', 'Wren', 'Juno', 'Ferro', 'Nox'];

let fns: (() => void)[] = [];
export const onOrders = (f: () => void) => { fns.push(f); return () => { fns = fns.filter((x) => x !== f); }; };
const emit = () => { for (const f of fns) f(); };

export function doctrine(): Doctrine { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT }; } }
export function setDoctrine(patch: Partial<Doctrine>) { try { localStorage.setItem(KEY, JSON.stringify({ ...doctrine(), ...patch })); } catch { /* fine */ } emit(); }
export function dutyLog(): DutyEntry[] { try { return JSON.parse(localStorage.getItem(LOG) || '[]'); } catch { return []; } }
export function duty(text: string, tone?: DutyEntry['tone']) { pushNative('orders', '복무 규칙', text); try { localStorage.setItem(LOG, JSON.stringify([{ at: Date.now(), text, tone }, ...dutyLog()].slice(0, 60))); } catch { /* fine */ } emit(); }

/** Addresses HD index 1…SCAN (needs the phrase). */
export const derived = () => (wallet.state === 'unlocked' ? Array.from({ length: SCAN }, (_, i) => ({ index: i + 1, address: wallet.key(i + 1).address })) : []);
export async function roster(pid: string): Promise<Replicant[]> { return listReplicants(pid, derived()); }

/** Enlist HD index `i` with the guild (its own signup, signed by its own key). */
export async function replicate(i: number, role: Role): Promise<void> {
  const name = `${CALLSIGNS[i % CALLSIGNS.length]}-${i}`;
  if (MOCK) { duty(`모의: #${i} ${name} 복제 신청 (${role === 'productive' ? '생산형' : role === 'bait' ? '미끼형' : '레이더형'})`, 'cheong'); return; }
  const k = wallet.key(i);
  const s = wallet.signMessage(i, `GUILD${GUILD_ID}ADDRESS${k.address}NONCE0`);
  await guildApi.signup({ primary_address: k.address, signature: s.signature, pubkey: s.pubkey, guild_id: GUILD_ID, username: name });
  setDoctrine({ roles: { ...doctrine().roles, [`idx:${i}`]: role } });
  duty(`#${i} ${name} 복제 신청 — 사령부 등록 대기`, 'cheong');
}

/** Send every replicant's alpha above `above` g home to the commander, keeping `keep` g each. */
export async function sweep(list: Replicant[], above: number, keep: number): Promise<{ sent: number; total: number }> {
  let sent = 0, total = 0;
  const home = wallet.commander?.address;
  for (const r of list) {
    const g = Number(r.alpha) / 1e6;
    if (g <= above || r.hd_index == null) continue;
    const amount = Math.floor((g - keep) * 1e6);
    if (amount <= 0) continue;
    if (MOCK) { duty(`모의: ${r.username || r.player_id} → 사령관 ${(amount / 1e6).toFixed(2)} g 회수`, 'hwang'); sent++; total += amount; continue; }
    if (!home) break;
    try {
      await actions.playerSend(home, { denom: 'ualpha', amount: String(amount) }, r.hd_index);
      duty(`${r.username || r.player_id} → 사령관 ${(amount / 1e6).toFixed(2)} g 회수`, 'hwang');
      sent++; total += amount;
    } catch (e) { duty(`${r.username || r.player_id} 회수 실패: ${(e as Error).message}`, 'jeok'); }
  }
  return { sent, total };
}

/** The substation's share per connection, and whether one more player fits. */
export async function shareNow(pid: string): Promise<{ share: number; free: number; conns: number; ok: boolean }> {
  const me = await guildApi.player(pid);
  const en = await energyOf(me).catch(() => null);
  const free = en?.power ? Number(en.power.capacity) - Number(en.power.load) : 0;
  // The guild sends grid attributes as strings: "584" + 1 must not become "5841".
  const conns = Number(en?.substation?.connection_count ?? 0) || 0;
  // What this commander actually gets from the substation (the energy screen's figure), else the grid's.
  const mine = Number(me.connection_capacity), grid = Number(en?.substation?.connection_capacity);
  const share = Number.isFinite(mine) && mine > 0 ? mine : Number.isFinite(grid) && en?.substation?.connection_capacity != null ? grid : free / Math.max(1, conns + 1);
  return { share, free, conns, ok: share >= MIN_SHARE_MW };
}

let timer = 0, running = false;
async function tick() {
  if (running) return;
  const d = doctrine(), pid = session.playerId;
  if (!d.enabled || (!d.autoSweep && !d.autoReplicate) || session.status.state !== 'in' || !pid || (!MOCK && wallet.state !== 'unlocked')) return;
  running = true;
  try {
    const list = await roster(pid);
    if (d.autoSweep) await sweep(list, d.sweepAbove, d.keep);
    if (d.autoReplicate && list.length < d.maxReps && !MOCK) {
      const s = await shareNow(pid);
      const used = new Set(list.map((r) => r.hd_index));
      const next = derived().find((x) => !used.has(x.index))?.index;
      if (s.ok && next) await replicate(next, d.newRole);
    }
  } catch (e) { duty(`규칙 실행 오류: ${(e as Error).message}`, 'jeok'); }
  running = false;
}

/** Start the orders loop (once): every two minutes, and a first look a minute after sign-in. */
export function startOrders() {
  if (timer) return;
  timer = window.setInterval(() => void tick(), 120_000);
  session.onChange((s) => { if (s.state === 'in') setTimeout(() => void tick(), 60_000); });
}
export const runOrdersNow = () => tick();
