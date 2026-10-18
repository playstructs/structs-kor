/* One chain attack event → the ordered animation events the game plays, per shot (structs-webapp
 * StructListener, by way of structs-universe raidview.js planAttack):
 *   counters first (their shot, then the attacker's damage and maybe its destruction), then the
 *   attacker's weapon unless a counter already killed it, then the evade / block / impact on the
 *   target. Health is threaded from the event itself, never from live state. Pure: no DOM. */
import type { AttackDetail } from '../../sim/chain';
import type { Ambit } from '../../data/catalogue';
import { EVADE_ART, receiveDamage } from './art';

export interface AnimEvent { seq?: number; structId: string; names: string[]; healthAfter: number | null; dmg?: number; counter?: boolean; miss?: string }
export interface Known { health: number; ambit: Ambit; category: 'planet' | 'fleet' }

export function planAttack(d: AttackDetail, lookup: (id: string) => Known | undefined): AnimEvent[] {
  const P = 'primaryWeapon';
  const atkId = d.attackerStructId, atkType = d.attackerStructType, atkAmbit = d.attackerStructOperatingAmbit;
  const weapon = d.weaponSystem || P;
  let running: number | null = d.attackerHealthBefore ?? lookup(atkId)?.health ?? null;
  let attackerDead = false;
  const ev: AnimEvent[] = [];
  const attackAnim = (id: string, ws: string, counter = false) => ev.push({ structId: id, names: [ws === 'secondaryWeapon' ? 'ATTACK_SECONDARY_WEAPON' : 'ATTACK_PRIMARY_WEAPON'], healthAfter: null, counter });
  const destroyName = (id: string, ambit?: Ambit) => {
    const v = lookup(id);
    let a = ambit ?? v?.ambit ?? 'land';
    if (v?.category === 'planet' && a === 'water') a = 'land';
    return `DESTROY_${a.toUpperCase()}`;
  };
  for (const shot of d.eventAttackShotDetail ?? []) {
    for (const c of shot.eventAttackDefenderCounterDetail ?? []) {
      attackAnim(c.counterByStructId, String(c.counterByStructWeaponSystem ?? P), true);
      const after: number | null = running == null ? null : Math.max(0, running - (c.counterDamage || 0));
      running = after;
      ev.push({ structId: atkId, names: receiveDamage(c.counterByStructType, c.counterByStructOperatingAmbit, atkAmbit, String(c.counterByStructWeaponSystem ?? P), after ?? 1), healthAfter: after, dmg: c.counterDamage, counter: true });
      if (c.counterDestroyedAttacker && !attackerDead) { attackerDead = true; ev.push({ structId: atkId, names: [destroyName(atkId, atkAmbit)], healthAfter: 0 }); }
    }
    if (!attackerDead) attackAnim(atkId, weapon);
    const tgtAmbit = shot.targetStructOperatingAmbit;
    if (shot.evaded) ev.push({ structId: shot.targetStructId, names: EVADE_ART[shot.evadedCause ?? ''] ? [EVADE_ART[shot.evadedCause!]] : [], healthAfter: shot.targetHealthAfter, miss: '회피' });
    if (shot.blocked && shot.blockedByStructId) {
      const b = lookup(shot.blockedByStructId);
      const bAfter = shot.blockerHealthAfter ?? b?.health ?? 1;
      ev.push({ structId: shot.blockedByStructId, names: receiveDamage(atkType, atkAmbit, b?.ambit, weapon, bAfter), healthAfter: bAfter, dmg: (shot.blockerHealthBefore ?? bAfter) - bAfter, miss: '방어' });
      if (shot.blockerDestroyed) ev.push({ structId: shot.blockedByStructId, names: [destroyName(shot.blockedByStructId)], healthAfter: 0 });
    }
    const hb = shot.targetHealthBefore, ha = shot.targetHealthAfter;
    if (hb != null && ha != null && hb !== ha) {
      ev.push({ structId: shot.targetStructId, names: receiveDamage(atkType, atkAmbit, tgtAmbit, weapon, ha), healthAfter: ha, dmg: hb - ha });
      if (shot.targetDestroyed) ev.push({ structId: shot.targetStructId, names: [destroyName(shot.targetStructId, tgtAmbit)], healthAfter: 0 });
    } else if (!shot.evaded && !shot.blocked) ev.push({ structId: shot.targetStructId, names: [], healthAfter: ha, miss: '빗나감' });
  }
  return ev;
}
