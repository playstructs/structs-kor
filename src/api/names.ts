/* Commander names for ids that screens would otherwise print raw (1-42). Looked up once, kept for the
 * visit; a screen paints the id at first and repaints when the name arrives (onNames). */
import { guildApi } from './guild';

const known = new Map<string, string>();
const asked = new Set<string>();
const fns = new Set<() => void>();
let queued = false;

/** The commander's callsign if known, else the id (and the name is fetched). */
export function nameOf(id: string | null | undefined): string {
  if (!id) return '—';
  const n = known.get(id);
  if (n) return n;
  if (/^1-\d+$/.test(id) && !asked.has(id)) {
    asked.add(id);
    void guildApi.player(id).then((p) => {
      if (!p?.username) return;
      known.set(id, p.username);
      if (!queued) { queued = true; setTimeout(() => { queued = false; for (const f of fns) f(); }, 50); }
    }).catch(() => null);
  }
  return id;
}
/** Remember a name a screen already has (a roster row), so nothing is fetched for it. */
export const noteName = (id: string, name: string) => { if (id && name) known.set(id, name); };
export function onNames(f: () => void) { fns.add(f); return () => { fns.delete(f); }; }
