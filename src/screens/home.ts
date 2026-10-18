/* The title screen (구조체.com). Public: REQ-PUB-1/2/3 give it live numbers without a sign-in;
 * until the guild serves them, the numbers appear once the visitor signs in. */
import type { Screen } from '../router';
import { html, mount, n, micro, raw } from '../ui/dom';
import { publicLeaderboard, publicSummary } from '../api/planned';
import { session } from '../api/session';
import { retiredNotice } from '../game/retire';
import { rankOf } from '../game/progress';
import { attract } from '../game/attract';
import { keys } from '../game/keys';
import { href, prefetch } from '../router';
import { LOGO } from '../ui/shell';
import { sfx } from '../game/sfx';

/* A visitor who played the retired demo: one note, then the real thing. */
function retiredCard() {
  if (!retiredNotice.pending || session.status.state === 'in') return html``;
  let rank = '';
  try { const xp = JSON.parse(localStorage.getItem('structs-kor.career.demo') || 'null')?.xp ?? 0; if (xp > 0) rank = rankOf(xp).name; } catch { /* no rank to carry */ }
  return html`<section class="retired-note" role="note"><b>데모 함교가 종료되었습니다</b><p>이제 바로 플레이로 실제 은하에 입대합니다. 무료이며, 지갑은 이 브라우저가 만들어 줍니다.${rank ? ` 데모에서 얻은 계급(${rank})은 입대하면 그대로 이어집니다.` : ''}</p><button class="btn ghost" type="button" data-act="dismissRetired">닫기</button></section>`;
}

const screen: Screen = {
  async render(root) {
    /* The title screen: the live battle runs behind, the menu sits in front. ↑↓ and Enter work. */
    const view = (s: Awaited<ReturnType<typeof publicSummary>> | null, lb: Awaited<ReturnType<typeof publicLeaderboard>> | null) => html`
    <div class="title-screen">
      <div class="title-bg" id="attract" aria-hidden="true"></div>
      <div class="title-in">
        <div class="title-logo">${raw(LOGO.replace('width="30" height="30"', 'width="72" height="72"'))}<h1>구조체</h1><span>STRUCTS</span></div>
        <p class="title-tag">우주는 구조체가 지배한다</p>
        ${retiredCard()}
        <nav class="title-menu" aria-label="타이틀 메뉴">
          ${session.status.state === 'in'
            ? html`<a class="sb wide" href="${href('/console')}"><i class="si icon-arrow"></i><span>바로 플레이 · 함교로</span></a>`
            : html`<a class="sb wide" href="${href('/start')}"><i class="si icon-arrow"></i><span>바로 플레이</span></a>`}
          ${session.status.state === 'in' ? html`<a class="sb wide" href="${href('/chat')}"><i class="si icon-phone"></i><span>길드 통신</span></a>` : html`<a class="sb wide" href="${href('/login')}"><i class="si icon-key"></i><span>로그인</span></a>`}
          <a class="sb wide" href="${href('/tutorial')}"><i class="si icon-tip"></i><span>훈련소</span></a>
          <a class="sb wide" href="${href('/sim')}"><i class="si icon-raid"></i><span>전투 시뮬레이터</span></a>
        </nav>
        <p class="title-keys"><kbd>↑</kbd><kbd>↓</kbd> 선택 · <kbd>Enter</kbd> 결정</p>
        <div class="title-stats mono">${[['사령관', s?.players], ['행성', s?.planets], ['구조체', s?.structs]].map(([k, v]) => html`<span>${k} <b>${v == null ? '—' : n(v)}</b></span>`)}<span class="c-cheong">● ${s?.guild_name ?? 'SN Corp'} 실시간</span></div>
      </div>
      ${lb?.length ? html`<aside class="title-rank" aria-label="사령관 랭킹"><h2>명예의 전당</h2><ol>${lb.slice(0, 5).map((p, i) => html`<li><span class="rk">${i + 1}</span><b>${p.username || p.player_id}</b><span class="mono c-hwang">${micro(p.alpha_balance_p, 0)} g</span></li>`)}</ol></aside>` : ''}
      <footer class="title-foot">시즌 1 · 한국 서버 · 모든 전투는 체인에 기록됩니다</footer>
    </div>`;

    const handlers = { dismissRetired: () => { retiredNotice.dismiss(); root.querySelector('.retired-note')?.remove(); } };
    // The bridge is where every play button goes: have it ready.
    setTimeout(() => { prefetch('/start'); prefetch('/console'); }, 600);
    const menuItems = () => [...root.querySelectorAll<HTMLElement>('.title-menu .sb')];
    // The highlighted entry (▶) follows the arrows and the mouse, focused or not.
    let sel = 0;
    const mark = (i: number, focus = true) => { const it = menuItems(); if (!it.length) return; sel = (i + it.length) % it.length; it.forEach((x, k) => x.classList.toggle('sel', k === sel)); if (focus) it[sel].focus({ preventScroll: true }); };
    const step = (by: number) => { mark(sel + by); sfx.play('click'); };
    root.addEventListener('mouseover', (e) => { const i = menuItems().indexOf((e.target as Element).closest?.('.title-menu .sb') as HTMLElement); if (i >= 0 && i !== sel) mark(i, false); });
    const offKeys = keys.scope({
      Enter: () => { if (!root.isConnected || root.contains(document.activeElement)) return false; menuItems()[sel]?.click(); },
      ArrowDown: () => step(1), ArrowUp: () => step(-1),
    });
    mount(root, view(null, null), handlers);
    const stage = document.createElement('div');
    stage.className = 'title-stage';
    const stop = attract(stage, innerHeight, true);
    const place = () => root.querySelector('#attract')?.appendChild(stage);
    place();
    mark(0);
    const [s, lb] = await Promise.all([publicSummary().catch(() => null), publicLeaderboard().catch(() => null)]);
    if (root.isConnected) { mount(root, view(s, lb), handlers); place(); mark(sel); }
    return () => { stop(); offKeys(); };
  },
};
export default screen;
