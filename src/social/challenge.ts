/* Battle links in chat: a simulator replay (/sim/R…) or a daily result (/daily/<day>/D…) unfurls as a
 * challenge card — who fought, how it ended, the fleets in miniature — with Watch and Take it on (and,
 * on someone else's replay, a live duel with them in those fleets). A live match offer
 * (/sim?join=<match>&room=<room>, src/chat/duel.ts) is a card with the lobby's state and a way in.
 * The decoders (and the sim code behind them) load only when a message actually carries such a link.
 * After structs-universe chat-sim.js / simcard.js. */
import { esc } from '../ui/dom';

const SIM = /\/sim\/(R[A-Za-z0-9_-]{4,20000})/;
const DAILY = /\/daily\/(\d{4}-\d{2}-\d{2})(?:\/(D[A-Za-z0-9_-]{4,4000}))?/;
const LIVE = /\/sim\?join=([A-Za-z0-9]{8,32})&room=([A-Za-z0-9%._~!:-]{3,300})/;

export const hasChallenge = (body: string) => SIM.test(body) || DAILY.test(body) || LIVE.test(body);

/** A placeholder for the first challenge link in a message (filled by hydrateChallenges). `from`: who
 * posted it (a player id), and whether that is me: someone else's replay can be a live duel with them. */
export function challengeSlot(body: string, base: string, from?: { id: string; mine: boolean }): string {
  const s = body.match(SIM), d = body.match(DAILY), l = body.match(LIVE);
  const who = from ? ` data-from="${esc(from.id)}" data-mine="${from.mine ? '1' : ''}"` : '';
  if (l) return `<div class="chal-slot" data-chal="live" data-match="${esc(l[1])}" data-room="${esc(l[2])}" data-base="${esc(base)}"${who}></div>`;
  if (s) return `<div class="chal-slot" data-chal="sim" data-code="${esc(s[1])}" data-base="${esc(base)}"${who}></div>`;
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
    const from = el.dataset.from && /^1-\d{1,9}$/.test(el.dataset.from) && !el.dataset.mine ? el.dataset.from : null;
    if (el.dataset.chal === 'live') {
      const [{ offers, statusOf }, { openBattle }] = await Promise.all([import('../chat/duel'), import('../sim/live')]);
      const match = el.dataset.match ?? '', room = el.dataset.room ?? '';
      const o = offers.get(match), b = o ? openBattle(o.frame.battle) : null;
      const st = statusOf(match), mine = !!el.dataset.mine;
      const stale = o && Date.now() - o.frame.at > 15 * 60_000 && st !== 'live' && st !== 'ended';
      const label = st === 'live' ? '진행 중' : st === 'ended' ? '끝난 대전' : st === 'cancelled' ? '취소됨' : stale ? '만료' : '대기 중';
      const side = (k: string) => b ? mini(b.units.filter((u) => u.side === k).map((u) => u.type)) : '';
      el.outerHTML = `<article class="chal live ${st === 'open' || st == null ? 'win' : ''}"><header><span class="sit-kind"><i class="si icon-raid"></i>실시간 대전</span><b>${esc(o?.frame.host.name ?? '대전 신청')}${b?.title ? ` · ${esc(b.title)}` : ''}</b><span class="chip ${st === 'live' ? 'jeok' : st === 'ended' || st === 'cancelled' || stale ? '' : 'hwang'}">${label}</span></header>
        ${b ? `<div class="chal-vs"><span class="chal-side">${side('player')}</span><b class="mono">VS</b><span class="chal-side foe">${side('computer')}</span></div><p class="note">턴 ${b.blockMs / 1000}초 · 시작 충전 ${b.charge} · 신청자가 턴을 진행하고, 받는 쪽은 오른쪽 함대를 지휘합니다.</p>` : '<p class="note">사람 대 사람, 실전과 같은 규칙으로 한 수씩.</p>'}
        <div class="chal-acts">${mine ? '<span class="faint">내가 보낸 신청 · 시뮬레이터 화면에서 기다리세요</span>' : st === 'open' || (st == null && !stale) ? `<a class="btn danger sm" href="${base}/sim?join=${esc(match)}&room=${esc(room)}"><i class="si icon-raid"></i> 대기실 입장</a>` : ''}${o && !mine ? `<a class="btn ghost sm" href="${base}/sim?duel=${esc(o.frame.host.id)}">내가 신청하기</a>` : ''}</div></article>`;
      continue;
    }
    if (el.dataset.chal === 'sim') {
      const r = decodeReplay(el.dataset.code ?? '');
      if (!r) { el.remove(); continue; }
      const mine = r.units.filter((u) => u.side === 'player').map((u) => u.type), theirs = r.units.filter((u) => u.side === 'computer').map((u) => u.type);
      const verdict = r.winner === 'player' ? '승리' : r.winner === 'computer' ? '패배' : r.winner ? '무승부' : '전투 기록';
      el.outerHTML = `<article class="chal ${r.winner === 'player' ? 'win' : r.winner === 'computer' ? 'loss' : ''}"><header><span class="sit-kind"><i class="si icon-combat-log"></i>전투 기록</span><b>${esc(r.title || '시뮬레이터 전투')}</b><span class="chip ${r.winner === 'player' ? 'cheong' : 'jeok'}">${verdict}</span></header>
        <div class="chal-vs"><span class="chal-side">${mini(mine)}</span><b class="mono">VS</b><span class="chal-side foe">${mini(theirs)}</span></div>
        <div class="chal-acts"><a class="btn primary sm" href="${base}/sim/${esc(el.dataset.code ?? '')}">▶ 다시 보기</a><a class="btn ghost sm" href="${base}/sim?from=${esc(el.dataset.code ?? '')}">같은 조건으로 도전</a>${from ? `<a class="btn danger sm" href="${base}/sim?duel=${esc(from)}&from=${esc(el.dataset.code ?? '')}" title="이 함대로 ${esc(from)}와 실시간 대전"><i class="si icon-raid"></i> 실시간 대전</a>` : ''}</div></article>`;
    } else {
      const day = el.dataset.day ?? '', code = el.dataset.code ?? '';
      const c = code ? daily.decodeDaily(code) : null;
      const no = daily.dailyNo(day);
      el.outerHTML = `<article class="chal daily"><header><span class="sit-kind"><i class="si icon-success"></i>일일 교전 #${no}</span><b>${c ? `${esc(c.name || '익명')}의 기록` : '오늘의 작전에 도전'}</b><span class="mono faint">${esc(day)}</span></header>
        ${c ? `<p class="note">명령 ${c.orders.length}개로 치른 전투 · 열면 실전 규칙으로 다시 확인합니다.</p>` : '<p class="note">모든 사령관이 같은 함대, 같은 적과 싸웁니다.</p>'}
        <div class="chal-acts">${c ? `<a class="btn primary sm" href="${base}/daily/${esc(day)}/${esc(code)}">▶ 기록 보기</a>` : ''}<a class="btn gold sm" href="${base}/sim?daily=${esc(day)}">도전</a></div></article>`;
    }
  }
}
