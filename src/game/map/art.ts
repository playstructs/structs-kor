/* Struct art and animation dispatch, transcribed from structs-universe frontend/battle-art.js and
 * raidview.js (Apache-2.0, Slow Ninja Inc), which in turn follow structs-webapp's
 * StructTypeArtSetBuilder and AnimationEventFactory. Art is the official 128×128 pixel art. */
import { TYPES_BY_ID, type Ambit } from '../../data/catalogue';

const base = import.meta.env?.BASE_URL ?? '/'; // (tests run outside Vite)

interface Art { dir: string; top?: string[]; bottom?: string[]; hidden?: boolean }
export const ART: Record<string, Art> = {
  battleship: { dir: 'battleship' },
  command_ship: { dir: 'cmd-ship', top: ['top-weapon'] },
  cruiser: { dir: 'cruiser', top: ['top-weapon-ballistic', 'top-weapon-smart'], bottom: ['bottom-ripples'] },
  destroyer: { dir: 'destroyer', top: ['top-weapon'], bottom: ['bottom-ripples'] },
  ore_extractor: { dir: 'extractor', top: ['top-drill'] },
  frigate: { dir: 'frigate', bottom: ['bottom-weapon'] },
  field_generator: { dir: 'generator', top: ['top-tube'] },
  continental_power_plant: { dir: 'generator', top: ['top-tube'] },
  world_engine: { dir: 'generator', top: ['top-tube'] },
  high_altitude_interceptor: { dir: 'interceptor', bottom: ['bottom-weapon'] },
  jamming_satellite: { dir: 'jamming-sat', top: ['top-weapon'] },
  mobile_artillery: { dir: 'mobile-artillery', top: ['top-weapon'] },
  orbital_shield_generator: { dir: 'orb-shield', top: ['top-weapon'] },
  ore_bunker: { dir: 'ore-bunker', top: ['top-weapon'] },
  planetary_defense_cannon: { dir: 'pdc', top: ['top-weapon'] },
  pursuit_fighter: { dir: 'pursuit-fighter', bottom: ['bottom-weapon'] },
  ore_refinery: { dir: 'refinery', top: ['top-bays'] },
  starfighter: { dir: 'starfighter', top: ['top-weapon-ballistic'], bottom: ['bottom-weapon-smart'] },
  sam_launcher: { dir: 'sam-launcher', top: ['top-weapon'] },
  stealth_bomber: { dir: 'stealth-bomber', bottom: ['bottom-weapon'] },
  submersible: { dir: 'submersible', top: ['top-weapon'], bottom: ['bottom-ripples'], hidden: true },
  tank: { dir: 'tank', top: ['top-weapon'] },
};

export const slugOf = (typeId: number) => (TYPES_BY_ID[typeId]?.type ?? '').toLowerCase().replace(/[^a-z]+/g, '_');
export const typeNameOf = (typeId: number) => TYPES_BY_ID[typeId]?.type ?? '';
export const artPath = (dir: string, suffix: string) => `${base}img/structs/${dir}/${dir}-${suffix}.webp`;

/** The still's layers, bottom to top, for a struct at `hp` of `max`. */
export function stillLayers(typeId: number, hp: number, max: number, hidden = false): { src: string; z: number }[] {
  const art = ART[slugOf(typeId)];
  if (!art) return [];
  const damaged = max > 0 && hp > 0 && hp < max;
  const hull = hidden && art.hidden ? 'struct-hidden' : damaged ? 'struct-dmg' : 'struct-base';
  return [
    ...(art.bottom ?? []).map((s) => ({ src: artPath(art.dir, s), z: 100 })),
    { src: artPath(art.dir, hull), z: 200 },
    ...(art.top ?? []).map((s) => ({ src: artPath(art.dir, s), z: 300 })),
  ];
}

/** A struct's still as stacked <img> layers in a framed square (menus, cards, medals). */
export const spriteHtml = (typeId: number, size = 48) =>
  `<span class="px-icon" style="width:${size}px;height:${size}px">${stillLayers(typeId, 1, 1).map((l) => `<img src="${l.src}" style="z-index:${l.z}" alt="">`).join('')}</span>`;

/* ── Tiles ─────────────────────────────────────────────────────────────── */
export const AMBIT_BG: Record<Ambit, string> = { space: '#222034', air: '#80B2FF', land: '#B3A38C', water: '#408BFF' };
const V_POS = ['edge-top', 'top', 'middle', 'bottom', 'edge-bottom'];
export type HPos = 'left' | 'middle' | 'right';
export function tileUrl(ambit: Ambit, v: number, h: HPos) {
  const hi = h === 'left' ? 1 : h === 'right' ? 3 : 2;
  return `${base}img/tiles/${ambit}/${ambit}-${v}-${hi}-${V_POS[v]}-${h}.png`;
}
export const horizonUrl = (h: HPos) => `${base}img/tiles/horizon/horizon-1-${h === 'left' ? 1 : h === 'right' ? 3 : 2}-${h}.png`;
export const blockedUrl = (a: Ambit) => `${base}img/tiles/blocked/${a}.png`;
export const beaconUrl = (a: Ambit) => `${base}img/tiles/beacon/${a}.gif`;
export const fogUrl = (p: 'left' | 'middle') => `${base}img/tiles/fog-of-war/fog-of-war-${p}.png`;
export const focusUrl = (k: 'friendly' | 'enemy' | 'neutral') => `${base}img/focus/focus-${k}.png`;

/* ── Animation dispatch (AnimationEventFactory) ───────────────────────── */
const P = 'primaryWeapon', S = 'secondaryWeapon';
type A = Ambit;
interface Clause { atk: string; from?: A[]; to?: A[]; same?: boolean; weapon: string }
const RULES: { impact: string; shake: string; any: Clause[] }[] = [
  { impact: 'IMPACT_HORIZONTAL_CANNON', shake: 'SHAKE_HORIZONTAL_DEFAULT', any: [
    { atk: 'Battleship', from: ['space'], to: ['space'], weapon: P }, { atk: 'Tank', from: ['land'], to: ['land'], weapon: P }] },
  { impact: 'IMPACT_HORIZONTAL_MISSILE', shake: 'SHAKE_HORIZONTAL_DEFAULT', any: [
    { atk: 'Starfighter', from: ['space'], to: ['space'], weapon: P }, { atk: 'Frigate', from: ['space'], to: ['space'], weapon: P },
    { atk: 'Pursuit Fighter', from: ['air'], to: ['air'], weapon: P }, { atk: 'Battleship', from: ['space'], to: ['space'], weapon: S },
    { atk: 'Command Ship', same: true, weapon: P }] },
  { impact: 'IMPACT_HORIZONTAL_TORPEDO', shake: 'SHAKE_HORIZONTAL_DEFAULT', any: [{ atk: 'High Altitude Interceptor', from: ['air'], to: ['air'], weapon: P }] },
  { impact: 'IMPACT_HORIZONTAL_GATLING', shake: 'SHAKE_HORIZONTAL_GATLING', any: [{ atk: 'Starfighter', from: ['space'], to: ['space'], weapon: S }] },
  { impact: 'IMPACT_ANGLED_DOWN_MISSILE', shake: 'SHAKE_ANGLED_DOWN_DEFAULT', any: [
    { atk: 'Cruiser', from: ['water'], to: ['land', 'water'], weapon: P }, { atk: 'Submersible', from: ['water'], to: ['water'], weapon: P },
    { atk: 'Frigate', from: ['space'], to: ['air'], weapon: P }] },
  { impact: 'IMPACT_ANGLED_DOWN_TORPEDO', shake: 'SHAKE_ANGLED_DOWN_DEFAULT', any: [
    { atk: 'Destroyer', from: ['water'], to: ['water'], weapon: P }, { atk: 'Stealth Bomber', from: ['air'], to: ['water', 'land'], weapon: P }] },
  { impact: 'IMPACT_ANGLED_DOWN_CANNON', shake: 'SHAKE_ANGLED_DOWN_DEFAULT', any: [
    { atk: 'Mobile Artillery', from: ['land'], to: ['water', 'land'], weapon: P }, { atk: 'Battleship', from: ['space'], to: ['water', 'land'], weapon: P },
    { atk: 'Planetary Defense Cannon', from: ['land', 'water'], to: ['water', 'land'], weapon: P }] },
  { impact: 'IMPACT_ANGLED_UP_CANNON', shake: 'SHAKE_ANGLED_UP_DEFAULT', any: [{ atk: 'Planetary Defense Cannon', from: ['land', 'water'], to: ['space', 'air'], weapon: P }] },
  { impact: 'IMPACT_ANGLED_UP_MISSILE', shake: 'SHAKE_ANGLED_UP_DEFAULT', any: [
    { atk: 'SAM Launcher', from: ['land'], to: ['air', 'space'], weapon: P }, { atk: 'Submersible', from: ['water'], to: ['air', 'space'], weapon: P }] },
  { impact: 'IMPACT_ANGLED_UP_TORPEDO', shake: 'SHAKE_ANGLED_UP_DEFAULT', any: [
    { atk: 'Destroyer', from: ['water'], to: ['air'], weapon: P }, { atk: 'High Altitude Interceptor', from: ['air'], to: ['space'], weapon: P }] },
  { impact: 'IMPACT_ANGLED_UP_GATLING', shake: 'SHAKE_ANGLED_UP_GATLING', any: [{ atk: 'Cruiser', from: ['water'], to: ['air'], weapon: S }] },
];
export const EVADE_ART: Record<string, string> = {
  defensiveManeuver: 'DEFENSIVE_MANEUVER', signalJamming: 'SIGNAL_JAMMING', lowOrbitBallisticInterceptorNetwork: 'LOW_ORBIT_BALLISTIC_INTERCEPTOR_NETWORK',
};
const EVADES = Object.values(EVADE_ART);
export const isEvade = (n: string) => EVADES.includes(n);

/** One shot → the receive-damage layers (impact + shake), or [] when the combination has no art. */
export function receiveDamage(atkType: string, atkAmbit: A | undefined, tgtAmbit: A | undefined, weapon: string, healthAfter: number): string[] {
  const suffix = healthAfter > 0 ? 'FIRST' : 'LAST';
  for (const r of RULES) for (const c of r.any) {
    if (c.atk !== atkType || c.weapon !== weapon) continue;
    if (c.same ? atkAmbit && atkAmbit === tgtAmbit : (!c.from || c.from.includes(atkAmbit!)) && (!c.to || c.to.includes(tgtAmbit!))) return [r.impact, `${r.shake}_${suffix}`];
  }
  return [];
}

/** The game mirrors every impact_* and destroy_* layer and nothing else. */
export const flips = (n: string) => n.startsWith('IMPACT_') || n.startsWith('DESTROY_');
/** Stacking for layers that play together: explosion over the shaking hull. */
export const layerZ = (n: string) => (n.startsWith('IMPACT_') ? 4 : n.startsWith('SHAKE_') ? 3 : n.startsWith('DESTROY_') ? 2 : 1);

const PER_TYPE = new Set(['attack_primary_weapon', 'attack_secondary_weapon', 'active_loop', 'stealth_activate', 'stealth_deactivate']);
const LITERAL: Record<string, string> = { VICTORY_BANNER: 'victory-banner', DEFEAT_BANNER: 'defeat-banner' };
export function lottiePath(name: string, slug?: string) {
  const dir = LITERAL[name] || name.toLowerCase();
  return PER_TYPE.has(dir) && slug ? `${base}lottie/${dir}/${slug}/data.json` : `${base}lottie/${dir}/data.json`;
}

/** Template bundles ship placeholder hulls in tagged layers; swap in this struct's own art. */
export function injectArt(box: Element, typeId: number, hp: number, max: number) {
  const art = ART[slugOf(typeId)];
  const full = max > 0 && hp >= max;
  const srcs: Record<string, string | null> = {
    struct_init: art ? artPath(art.dir, full ? 'struct-base' : 'struct-dmg') : null,
    struct_dmg: art ? artPath(art.dir, 'struct-dmg') : null,
    struct_top_layer_1: art?.top?.[0] ? artPath(art.dir, art.top[0]) : null,
    struct_top_layer_2: art?.top?.[1] ? artPath(art.dir, art.top[1]) : null,
    struct_bottom_layer_1: art?.bottom?.[0] ? artPath(art.dir, art.bottom[0]) : null,
  };
  for (const [cls, src] of Object.entries(srcs)) {
    const img = box.querySelector(`.${cls} image`);
    if (!img) continue;
    if (src) { img.setAttribute('href', src); img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', src); } else img.remove();
  }
}
