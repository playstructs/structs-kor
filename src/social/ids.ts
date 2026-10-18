/* Object ids in text: `<type>-<index>`, strictly bounded on both sides (1-194 is not 1-1945). Pure. */
import { esc } from '../ui/dom';
import { entityOf } from '../i18n/ko';
export const ID_RE = /(^|[^0-9A-Za-z_-])(\d{1,2}-\d{1,9})(?![0-9A-Za-z_-])/g;
export type RefKind = 'guild' | 'player' | 'planet' | 'reactor' | 'substation' | 'struct' | 'fleet' | 'provider';
/** Kinds worth a card. Allocations and infusions are plumbing; a card that says nothing is worse than text. */
export const REF_KINDS: Record<string, RefKind> = { '0': 'guild', '1': 'player', '2': 'planet', '3': 'reactor', '4': 'substation', '5': 'struct', '9': 'fleet', '10': 'provider' };
export const isRefId = (s: string) => /^\d{1,2}-\d{1,9}$/.test(s) && !!REF_KINDS[s.split('-')[0]];

/** Ids a text names, in order, once each, only kinds worth a card. */
export function idsIn(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ID_RE)) {
    const id = m[2];
    if (REF_KINDS[id.split('-')[0]] && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Escaped text with every id turned into a chip (a link to the object's page). */
export function linkIds(escaped: string, base: string): string {
  return escaped.replace(ID_RE, (_m, pre: string, id: string) => {
    const k = REF_KINDS[id.split('-')[0]];
    return k ? `${pre}<a class="ref-chip ${k}" href="${base}/o/${id}" data-ref-id="${id}" title="${esc(entityOf(id))} ${id}">${id}</a>` : `${pre}<span class="mono">${id}</span>`;
  });
}

