/* 작전 보드 layouts and the codes they travel as (B…). A code comes from a stranger: every card is
 * checked on the way in. Pure. */
import { isRefId } from './ids';

export type Kind = 'obj' | 'me' | 'market' | 'banks' | 'armada' | 'raids' | 'comms' | 'feed' | 'leaders' | 'duty' | 'watch';
export interface Card { k: Kind; id?: string; w: 1 | 2 | 3 }
export interface Board { name: string; cards: Card[] }
export const KINDS: Record<Kind, { name: string; icon: string; w: 1 | 2 | 3 }> = {
  obj: { name: '객체 카드', icon: 'icon-info', w: 1 }, me: { name: '내 기지', icon: 'icon-cmd-post', w: 1 }, market: { name: '전력 시장', icon: 'icon-transfers', w: 2 },
  banks: { name: '길드 은행', icon: 'icon-guild-directory', w: 1 }, armada: { name: '레플리칸트', icon: 'icon-member', w: 1 }, raids: { name: '습격 감시', icon: 'icon-raid', w: 1 },
  comms: { name: '통신', icon: 'icon-phone', w: 1 }, feed: { name: '행성 기록', icon: 'icon-combat-log', w: 2 }, leaders: { name: '순위', icon: 'icon-success', w: 1 },
  duty: { name: '근무 일지', icon: 'icon-computer', w: 1 }, watch: { name: '감시 목록', icon: 'icon-detected', w: 3 },
};
/* A board travels as a code: JSON → base64url, prefixed B. Checked on the way in. */
export const encodeBoard = (b: Board) => 'B' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(b)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodeBoard(code: string): Board | null {
  if (!/^B[A-Za-z0-9_-]{4,4000}$/.test(code.trim())) return null;
  try {
    const s = code.trim().slice(1);
    const b = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)))) as Board;
    const cards = (Array.isArray(b.cards) ? b.cards : []).filter((c) => c && typeof c.k === "string" && Object.hasOwn(KINDS, c.k) && (c.k !== 'obj' || isRefId(String(c.id)))).slice(0, 24).map((c) => ({ k: c.k, ...(c.k === 'obj' ? { id: String(c.id) } : {}), w: ([1, 2, 3].includes(c.w) ? c.w : KINDS[c.k].w) as 1 | 2 | 3 }));
    return cards.length ? { name: String(b.name || '공유 보드').slice(0, 20), cards } : null;
  } catch { return null; }
}

