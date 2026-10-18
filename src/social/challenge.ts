/* Battle links in chat: a simulator replay (/sim/R…) or a daily result (/daily/<day>/D…) unfurls as a
 * challenge card — who fought, how it ended, the fleets in miniature — with Watch and Take it on.
 * The decoders (and the sim code behind them) load only when a message actually carries such a link.
 * After structs-universe chat-sim.js / simcard.js. */
import { esc } from '../ui/dom';

const SIM = /\/sim\/(R[A-Za-z0-9_-]{4,20000})/;
const DAILY = /\/daily\/(\d{4}-\d{2}-\d{2})(?:\/(D[A-Za-z0-9_-]{4,4000}))?/;

export const hasChallenge = (body: string) => SIM.test(body) || DAILY.test(body);

/** A placeholder for the first challenge link in a message (filled by hydrateChallenges). */
export function challengeSlot(body: string, base: string): string {
  const s = body.match(SIM), d = body.match(DAILY);
  if (s) return `<div class="chal-slot" data-chal="sim" data-code="${esc(s[1])}" data-base="${esc(base)}"></div>`;
  if (d) return `<div class="chal-slot" data-chal="daily" data-day="${esc(d[1])}" data-code="${esc(d[2] ?? '')}" data-base="${esc(base)}"></div>`;
  return '';
}

export async function hydrateChallenges(root: ParentNode) {
  const slots = [...root.querySelectorAll<HTMLElement>('.chal-slot:not([data-done])')];
  if (!slots.length) return;
  const [{ decodeReplay }, daily, { spriteHtml }, { STRUCT_TYPE }] = await Promise.all([import('../sim/fleets'), import('../sim/daily'), import('../game/map/art'), import('../i18n/ko')]);
  const mini = (types: number[]) => types.slice(0, 7).map((t) => `<span title="${esc(STRUCT_TYPE[t] ?? t)}">${spriteHtml(t, 28)}</span>`).join('');
  for (const el of slots) {
    el.dataset.done = '1';
    const base = el.dataset.base ?? '';
    if (el.dataset.chal === 'sim') {
      const r = decodeReplay(el.dataset.code ?? '');
      if (!r) { el.remove(); continue; }
      const mine = r.units.filter((u) => u.side === 'player').map((u) => u.type), theirs = r.units.filter((u) => u.side === 'computer').map((u) => u.type);
      const verdict = r.winner === 'player' ? '승리' : r.winner === 'computer' ? '패배' : r.winner ? '무승부' : '전투 기록';
      el.outerHTML = `<article class="chal ${r.winner === 'player' ? 'win' : r.winner === 'computer' ? 'loss' : ''}"><header><span class="sit-kind"><i class="si icon-combat-log"></i>전투 기록</span><b>${esc(r.title || '시뮬레이터 전투')}</b><span class="chip ${r.winner === 'player' ? 'cheong' : 'jeok'}">${verdict}</span></header>
        <div class="chal-vs"><span class="chal-side">${mini(mine)}</span><b class="mono">VS</b><span class="chal-side foe">${mini(theirs)}</span></div>
        <div class="chal-acts"><a class="btn primary sm" href="${base}/sim/${esc(el.dataset.code ?? '')}">▶ 다시 보기</a><a class="btn ghost sm" href="${base}/sim?from=${esc(el.dataset.code ?? '')}">같은 조건으로 도전</a></div></article>`;
    } else {
      const day = el.dataset.day ?? '', code = el.dataset.code ?? '';
      const c = code ? daily.decodeDaily(code) : null;
      const no = daily.dailyNo(day);
      el.outerHTML = `<article class="chal daily"><header><span class="sit-kind"><i class="si icon-success"></i>일일 교전 #${no}</span><b>${c ? `${esc(c.name || '익명')}의 기록` : '오늘의 작전에 도전'}</b><span class="mono faint">${esc(day)}</span></header>
        ${c ? `<p class="note">명령 ${c.orders.length}개로 치른 전투 · 열면 체인 규칙으로 다시 검증합니다.</p>` : '<p class="note">모든 사령관이 같은 함대, 같은 적과 싸웁니다.</p>'}
        <div class="chal-acts">${c ? `<a class="btn primary sm" href="${base}/daily/${esc(day)}/${esc(code)}">▶ 기록 보기</a>` : ''}<a class="btn gold sm" href="${base}/sim?daily=${esc(day)}">도전</a></div></article>`;
    }
  }
}
