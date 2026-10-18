/* Commander portraits: the game's layered pixel art (72×72, back to front background · arms ·
 * body · neck · head), from structs-universe frontend/pfp.js. A player's `pfp` is a JSON recipe
 * like {"head":12,"neck":2,"body":7,"arms":3,"background":3}; indices are 1-based and checked
 * against the art that ships, so a bad recipe paints the placeholder, never a broken image. */
import { esc } from '../ui/dom';
import { rngFor } from '../core/util';

export const PFP_LAYERS = ['background', 'arms', 'body', 'neck', 'head'] as const;
export type Part = (typeof PFP_LAYERS)[number];
export const PFP_COUNTS: Record<Part, number> = { head: 87, neck: 10, body: 57, arms: 34, background: 6 };
export type Pfp = Record<Part, number>;

const base = import.meta.env?.BASE_URL ?? '/';
const isLayer = (part: Part, v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PFP_COUNTS[part];

export function parsePfp(json: string | null | undefined): Pfp | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    return p && typeof p === 'object' && isLayer('head', p.head) ? (p as Pfp) : null;
  } catch { return null; }
}

/** The portrait as stacked <img> layers in a square frame of `size` px. */
export function portraitHtml(json: string | null | undefined, size = 44, title = ''): string {
  const p = parsePfp(json);
  const layers = p
    ? PFP_LAYERS.filter((part) => isLayer(part, p[part])).map((part) => `<img src="${base}img/pfp/${part}/pfp_${part}_${p[part]}.png" alt="" class="pfp-l pfp-${part}">`).join('')
    : `<img src="${base}img/portrait-placeholder.png" alt="" class="pfp-l">`;
  return `<span class="pfp" style="width:${size}px;height:${size}px" ${title ? `title="${esc(title)}"` : 'aria-hidden="true"'}>${layers}</span>`;
}

/** A stable random face for anyone without one (rivals, guests): seeded, so it never changes. */
export function seededPfp(seed: string): string {
  const r = rngFor('pfp:' + seed);
  const pick = (part: Part) => 1 + Math.floor(r() * PFP_COUNTS[part]);
  return JSON.stringify({ background: pick('background'), arms: pick('arms'), body: pick('body'), neck: pick('neck'), head: pick('head') });
}

/* The local commander's face (guest and demo), editable in the service record. */
const KEY = 'structs-kor.pfp';
export function myPfp(): string {
  try { return localStorage.getItem(KEY) || seededPfp('me:' + (localStorage.getItem('structs-kor.pfp.seed') ?? 'x')); } catch { return seededPfp('me'); }
}
export function setMyPfp(p: Pfp) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* fine */ } for (const f of fns) f(); }
const fns = new Set<() => void>();
export const onPfp = (f: () => void) => { fns.add(f); return () => fns.delete(f); };
