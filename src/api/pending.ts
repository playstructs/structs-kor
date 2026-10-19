/* Orders in flight, as the player should see them. Every order sent through actions.act() lives here
 * from the moment it's given until the chain has run it:
 *
 *   sending  queued, signed and on its way (no answer yet)
 *   pending  accepted, waiting for a block to run it
 *   done     a block ran it (shown briefly, then dropped)
 *   failed   refused on sending, or a block ran it and it failed (shown a little longer)
 *
 * Each order names what it's about (`targets`), so the bridge map can mark the tile, a panel can show
 * its own control as busy, and the HUD can count what's still on its way. */
import { orderName } from '../i18n/ko';
import { TYPES_BY_ID } from '../data/catalogue';
import { onTx, txLog } from './txlog';
import { playerMessage } from './errors';

export type Phase = 'sending' | 'pending' | 'done' | 'failed';
export interface Order { id: number; name: string; label: string; targets: string[]; phase: Phase; at: number; hash?: string; error?: string; typeId?: number }

const DONE_MS = 2500, FAILED_MS = 7000, MOCK_BLOCK_MS = 1500;
const live: Order[] = [];
const recent: Order[] = [];
let seq = 0;
const fns = new Set<() => void>();
const emit = () => { for (const f of fns) { try { f(); } catch (e) { console.error(e); } } };

/** What an order is about, as keys: `s:<struct>`, `slot:<planet|fleet>|<ambit>|<slot>`, `f:<fleet>`,
 * `p:<planet>`, `explore:<player>`, `a:<agreement>`, `prov:<provider>`. */
function targetsOf(name: string, v: Record<string, unknown>): string[] {
  const s = (k: string) => (v[k] ? [`s:${String(v[k])}`] : []);
  switch (name) {
    case 'MsgStructBuildInitiate': {
      const cat = TYPES_BY_ID[Number(v.structTypeId)]?.category ?? 'planet';
      return [`slot:${cat}|${String(v.operatingAmbit)}|${String(v.slot)}`];
    }
    case 'MsgStructAttack': return [...s('operatingStructId'), ...((v.targetStructId as string[] | undefined) ?? []).map((t) => `s:${t}`)];
    case 'MsgStructDefenseSet': return [...s('defenderStructId'), ...s('protectedStructId')];
    case 'MsgStructDefenseClear': return s('defenderStructId');
    case 'MsgFleetMove': return [`f:${String(v.fleetId)}`, `p:${String(v.destinationLocationId)}`];
    case 'MsgPlanetExplore': return [`explore:${String(v.playerId)}`];
    case 'MsgPlanetRaidComplete': return [`f:${String(v.fleetId)}`];
    case 'MsgPlanetUpdateName': return [`p:${String(v.planetId)}`];
    case 'MsgAgreementClose': case 'MsgAgreementDurationIncrease': case 'MsgAgreementCapacityIncrease': case 'MsgAgreementCapacityDecrease': return [`a:${String(v.agreementId)}`];
    case 'MsgAgreementOpen': case 'MsgProviderDelete': case 'MsgProviderWithdrawBalance': case 'MsgProviderUpdateAccessPolicy': return [`prov:${String(v.providerId)}`];
    default: return s('structId');
  }
}

function retire(o: Order) {
  const i = live.indexOf(o);
  if (i >= 0) live.splice(i, 1);
  emit();
}
function settle(o: Order, ok: boolean, error?: string) {
  if (o.phase === 'done' || o.phase === 'failed') return;
  o.phase = ok ? 'done' : 'failed';
  if (error) o.error = playerMessage(error);
  recent.unshift(o); recent.splice(12);
  emit();
  dispatchEvent(new CustomEvent('structs:order', { detail: o }));
  setTimeout(() => retire(o), ok ? DONE_MS : FAILED_MS);
}

export const pending = {
  /** Orders still on screen (in flight, or just finished). */
  list: (): readonly Order[] => live,
  /** The last finished ones, newest first (for the HUD's list). */
  recent: (): readonly Order[] => recent,
  /** How many are still on their way. */
  get inFlight() { return live.filter((o) => o.phase === 'sending' || o.phase === 'pending').length; },
  /** The newest order about this target (see targetsOf for the keys). */
  of(target: string): Order | undefined { return live.find((o) => o.targets.includes(target)); },
  /** Whether an order about this target is still on its way. */
  busy(target: string): boolean { const o = this.of(target); return !!o && (o.phase === 'sending' || o.phase === 'pending'); },
  onChange(f: () => void) { fns.add(f); return () => { fns.delete(f); }; },

  /* Called by actions.act() only. */
  begin(name: string, value: Record<string, unknown>): Order {
    const o: Order = { id: ++seq, name, label: orderName(name), targets: targetsOf(name, value), phase: 'sending', at: Date.now(), typeId: name === 'MsgStructBuildInitiate' ? Number(value.structTypeId) : undefined };
    live.unshift(o); emit();
    return o;
  },
  sent(o: Order, hash: string, mock: boolean) {
    o.hash = hash; o.phase = 'pending'; emit();
    // The dev mock applies orders at once: give it a block's pause so the states can be seen.
    if (mock) setTimeout(() => settle(o, true), MOCK_BLOCK_MS);
  },
  refused(o: Order, error: string) { settle(o, false, error); },
};

// The chain's answers arrive through the tx log (it polls each hash until a block includes it).
onTx(() => {
  for (const o of live) {
    if (o.phase !== 'pending' || !o.hash) continue;
    const t = txLog().find((x) => x.hash === o.hash);
    if (!t || t.status === 'pending') continue;
    if (t.status === 'ok' || t.status === 'unknown') settle(o, true);
    else settle(o, false, t.error);
  }
});
