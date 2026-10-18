/* Amounts as players type them. Pure. */

/** Alpha in grams: "12", "1.5k" (kg), "300m" (mg), "40μg"; null when it isn't a positive amount. */
export function parseGrams(s: string): number | null {
  const m = s.trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(k|kg|m|mg|μg|ug|g)?$/);
  if (!m) return null;
  const v = Number(m[1]), u = m[2] ?? 'g';
  const g = u === 'k' || u === 'kg' ? v * 1000 : u === 'm' || u === 'mg' ? v / 1000 : u === 'μg' || u === 'ug' ? v / 1e6 : v;
  return Number.isFinite(g) && g > 0 ? g : null;
}
