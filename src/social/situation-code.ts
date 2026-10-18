/* Situation links: a moment frozen in a URL (/s/S…), readable by anyone, signed in or not. JSON →
 * UTF-8 → base64url, prefixed S. Decoding is defensive: the link came from a stranger. Pure. */
export type SituationKind = 'raid' | 'battle' | 'market' | 'base' | 'replay' | 'daily' | 'guild' | 'alert' | 'fleet';
export interface Situation {
  t: SituationKind; title: string; sub?: string;
  /** label → value lines, at most eight. */
  lines: [string, string][];
  /** Objects it is about; chat unfurls them under it. */
  ids?: string[];
  /** Where "open" goes (a sim replay, the daily, a screen). */
  go?: string;
  tone?: 'cheong' | 'hwang' | 'jeok';
  by?: string; at: number;
}

export const KINDS: SituationKind[] = ['raid', 'battle', 'market', 'base', 'replay', 'daily', 'guild', 'alert', 'fleet'];

/* ── Encoding: JSON → UTF-8 → base64url, prefixed S. ── */
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
export function encodeSituation(s: Situation): string { return 'S' + b64u(new TextEncoder().encode(JSON.stringify({ ...s, lines: s.lines.slice(0, 8) }))); }
export function decodeSituation(code: string): Situation | null {
  if (!/^S[A-Za-z0-9_-]{8,6000}$/.test(code)) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(unb64u(code.slice(1)))) as Situation;
    if (!s || typeof s.title !== 'string' || !KINDS.includes(s.t) || !Array.isArray(s.lines)) return null;
    s.title = s.title.slice(0, 80); if (s.sub != null) s.sub = String(s.sub).slice(0, 160); if (s.by != null) s.by = String(s.by).slice(0, 40);
    s.at = Number(s.at) || 0;
    s.lines = s.lines.filter((l) => Array.isArray(l) && l.length === 2).map(([a, b]) => [String(a).slice(0, 40), String(b).slice(0, 80)] as [string, string]).slice(0, 8);
    s.ids = (s.ids ?? []).filter((x) => typeof x === 'string' && /^\d{1,2}-\d{1,9}$/.test(x)).slice(0, 4);
    if (s.go && !/^\/[a-z0-9/?=&._~-]*$/i.test(s.go)) delete s.go;
    return s;
  } catch { return null; }
}

