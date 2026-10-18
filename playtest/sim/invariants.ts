/* Invariants: things that must hold on every block whatever the player does. A violation is a bug
 * (or a rule the game never wrote down), reported once per run with the block it first appeared. */
import type { demo as Demo } from '../../src/game/demo';
import { TYPES_BY_ID } from '../../src/data/catalogue';

export interface Violation { id: string; b: number; message: string }

const AMBIT_BIT: Record<string, number> = { space: 16, air: 8, land: 4, water: 2 };

export function checkInvariants(demo: typeof Demo, b: number): Violation[] {
  const out: Violation[] = [];
  const bad = (id: string, message: string) => out.push({ id, b, message });
  const s = demo.state;

  for (const k of ['alpha', 'ore', 'shield', 'vein', 'height', 'infusedKw'] as const) {
    const v = s[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) bad(`nonfinite.${k}`, `state.${k} is ${v}`);
  }
  if (s.alpha < -1e-9) bad('negative.alpha', `alpha went negative: ${s.alpha}`);
  if (s.ore < -1e-9) bad('negative.ore', `ore went negative: ${s.ore}`);
  if (s.shield < 0 || s.shield > 100.0001) bad('range.shield', `shield out of 0..100: ${s.shield}`);
  if (s.vein < 0) bad('negative.vein', `undiscovered ore went negative: ${s.vein}`);

  const slots = new Map<string, string>();
  for (const x of s.structs) {
    if (!Number.isFinite(x.hp) || x.hp < 0 || x.hp > x.max) bad(`range.hp.${x.type}`, `struct ${x.id} (type ${x.type}) hp ${x.hp} outside 0..${x.max}`);
    const t = TYPES_BY_ID[x.type];
    if (!t) { bad('unknown.type', `struct ${x.id} has unknown type ${x.type}`); continue; }
    if (t.category !== x.cat) bad(`category.${x.type}`, `struct ${x.id}: a ${t.type} (${t.category}) sits in a ${x.cat} slot`);
    const bit = AMBIT_BIT[x.ambit];
    if (bit == null || ((t.possibleAmbit ?? 30) & bit) === 0) bad(`ambit.${x.type}.${x.ambit}`, `a ${t.type} was placed in ${x.ambit}, which its type does not allow (possibleAmbit ${t.possibleAmbit})`);
    if (x.slot < 0 || x.slot > 3 || !Number.isInteger(x.slot)) bad('range.slot', `struct ${x.id} in slot ${x.slot}`);
    if (x.type !== 1 && x.hp > 0) {
      const k = `${x.cat}|${x.ambit}|${x.slot}`;
      if (slots.has(k)) bad('slot.double', `${k} holds both ${slots.get(k)} and ${x.id}`);
      slots.set(k, x.id);
    }
    if (x.oc && (!x.online || x.hp <= 0)) bad('oc.offline', `struct ${x.id} is overclocked while offline or destroyed`);
  }
  for (const c of s.contracts) if (!(c.kw > 0) || !Number.isFinite(c.rate) || c.left < 0) bad('contract', `contract ${c.id}: ${c.kw} kW at ${c.rate}, ${c.left} left`);
  for (const r of demo.rivals()) {
    if (!(r.fleet >= 0)) bad('rival.fleet', `${r.name} fleet ${r.fleet}`);
    if (!Number.isFinite(r.alpha) || !Number.isFinite(r.ore)) bad('rival.nonfinite', `${r.name} alpha ${r.alpha} ore ${r.ore}`);
    if (r.ore < -1e-9 || r.alpha < -1e-9) bad('rival.negative', `${r.name} alpha ${r.alpha} ore ${r.ore}`);
  }
  const w = demo.netWorth();
  if (!Number.isFinite(w)) bad('nonfinite.worth', `net worth ${w}`);
  const cap = demo.capacityKw(), load = demo.structsKw();
  if (!Number.isFinite(cap) || !Number.isFinite(load)) bad('nonfinite.power', `capacity ${cap} load ${load}`);

  // The save is JSON in localStorage: it must survive the round trip unchanged.
  try {
    const j = JSON.stringify(s);
    const back = JSON.stringify(JSON.parse(j));
    if (j !== back) bad('save.roundtrip', 'state changes when saved and loaded');
    if (j.length > 4_000_000) bad('save.size', `save is ${(j.length / 1e6).toFixed(1)} MB; localStorage quota is ~5 MB`);
  } catch (e) { bad('save.serialise', `state cannot be saved: ${(e as Error).message}`); }
  return out;
}
