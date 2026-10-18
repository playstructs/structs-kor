/* Hangul matching for search boxes: plain substring, or by initial consonants (초성), so ㄱㄹㅅ finds
 * 거래소. Pure. */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export const chosung = (s: string) => Array.from(s, (c) => { const k = c.charCodeAt(0) - 0xac00; return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c; }).join('');
const isJamo = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);
/** 3 prefix, 2 substring or 초성, 1 empty query, 0 no match. */
export function matches(label: string, q: string): number {
  const L = label.toLowerCase(), Q = q.toLowerCase().trim();
  if (!Q) return 1;
  if (L.startsWith(Q)) return 3;
  if (L.includes(Q)) return 2;
  if (isJamo(Q) && chosung(L).replace(/\s/g, '').includes(Q)) return 2;
  return 0;
}
