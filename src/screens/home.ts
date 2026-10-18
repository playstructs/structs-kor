/* The title screen (구조체.com). Public: REQ-PUB-1/2/3 give it live numbers without a sign-in;
 * until the guild serves them, the numbers appear once the visitor signs in. */
import type { Screen } from '../router';
import { html, mount, n, micro, raw } from '../ui/dom';
import { publicLeaderboard, publicSummary } from '../api/planned';
import { startDemo } from '../ui/gate';
import { attract } from '../game/attract';
import { demo, HEGEMONY } from '../game/demo';
import { career } from '../game/progress';
import { portraitHtml, myPfp } from '../game/portrait';
import { keys } from '../game/keys';
import { go, href, prefetch } from '../router';
import { LOGO } from '../ui/shell';
import { sfx } from '../game/sfx';

/* A returning commander's save: the empire at a glance and one button back in. */
const dayToday = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function continueCard() {
  if (!demo.on) return html``;
  const st = demo.state, h = demo.hegemony(), t = demo.hegemonyTier, vassals = demo.rivals().filter((r) => r.vassal != null).length;
  const raid = demo.raid;
  return html`<section class="save-slot"><div class="save-in">
    ${raw(portraitHtml(myPfp(), 88))}
    <div class="save-who"><span class="label c-hwang">이어하기 · 제${demo.era + 1}시대</span><b>${career.rank.name} · 한빛 IV</b>
      <div class="save-stats mono"><span>알파 <b class="c-hwang">${n(st.alpha, 1)} g</b></span><span>패권 <b>${(h * 100).toFixed(0)}%</b>${t ? ` · ${HEGEMONY[t - 1].title}` : ''}</span><span>속국 <b>${vassals}</b></span><span>거점 <b>${demo.outposts.filter((o) => o.mine).length} / ${demo.outposts.length}</b></span><span>블록 <b>#${n(st.height)}</b></span></div>
      ${raid ? html`<span class="chip jeok">⚠ ${raid.name} 함대 ${raid.eta ? `${raid.eta}블록 후 도착` : '교전 중'}</span>` : demo.decision ? html`<span class="chip hwang">결단 대기 · ${demo.decision.title}</span>` : demo.boss ? html`<span class="chip jeok">공허 함대 출현 · ${demo.boss.left}블록</span>` : demo.revenge ? html`<span class="chip hwang">보복 기회 · ${demo.revenge.name} ${demo.revenge.left}블록</span>` : demo.black.offers.length ? html`<span class="chip hwang">밀수선 입항 · ${demo.black.left}블록</span>` : ''}
      ${(() => { const last = [...demo.chronicle].reverse().find((c) => !c.text.startsWith('연속')); return last || demo.streak > 1 ? html`<small class="dim">${demo.streak > 1 && (demo.state.streak?.day === dayToday() || demo.state.streak?.day === dayToday(-1)) ? `연속 ${demo.streak}일 복귀${last ? ' · ' : ''}` : ''}${last ? `최근: ${last.text}` : ''}</small>` : ''; })()}</div>
    <button class="btn gold lg save-go" data-act="resume">▶ 계속하기 <kbd>Enter</kbd></button></div></section>`;
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
        ${continueCard()}
        <nav class="title-menu" aria-label="타이틀 메뉴">
          <button class="sb wide" data-act="demo" type="button"><i class="si icon-arrow"></i><span>${demo.on ? '데모 함교로 복귀' : '바로 플레이 · 데모 함교'}</span></button>
          <a class="sb wide" href="${href('/start')}"><i class="si icon-add"></i><span>사령관 입대</span></a>
          <a class="sb wide" href="${href('/login')}"><i class="si icon-key"></i><span>로그인</span></a>
          <a class="sb wide" href="${href('/tutorial')}"><i class="si icon-tip"></i><span>훈련소</span></a>
          <a class="sb wide" href="${href('/sim')}"><i class="si icon-raid"></i><span>전투 시뮬레이터</span></a>
        </nav>
        <p class="title-keys"><kbd>↑</kbd><kbd>↓</kbd> 선택 · <kbd>Enter</kbd> 결정</p>
        <div class="title-stats mono">${[['사령관', s?.players], ['행성', s?.planets], ['구조체', s?.structs]].map(([k, v]) => html`<span>${k} <b>${v == null ? '—' : n(v)}</b></span>`)}<span class="c-cheong">● ${s?.guild_name ?? 'SN Corp'} 실시간</span></div>
      </div>
      ${lb?.length ? html`<aside class="title-rank" aria-label="사령관 랭킹"><h2>명예의 전당</h2><ol>${lb.slice(0, 5).map((p, i) => html`<li><span class="rk">${i + 1}</span><b>${p.username || p.player_id}</b><span class="mono c-hwang">${micro(p.alpha_balance_p, 0)} g</span></li>`)}</ol></aside>` : ''}
      <footer class="title-foot">시즌 1 · 한국 서버 · 모든 전투는 체인에 기록됩니다</footer>
    </div>`;

    const handlers = { demo: () => startDemo('/console'), resume: () => go('/console') };
    // The bridge is where every play button goes: have it ready.
    setTimeout(() => { prefetch('/console'); prefetch('/sim'); }, 600);
    const menuItems = () => [...root.querySelectorAll<HTMLElement>('.save-go, .title-menu .sb')];
    // The highlighted entry (▶) follows the arrows and the mouse, focused or not.
    let sel = 0;
    const mark = (i: number, focus = true) => { const it = menuItems(); if (!it.length) return; sel = (i + it.length) % it.length; it.forEach((x, k) => x.classList.toggle('sel', k === sel)); if (focus) it[sel].focus({ preventScroll: true }); };
    const step = (by: number) => { mark(sel + by); sfx.play('click'); };
    root.addEventListener('mouseover', (e) => { const i = menuItems().indexOf((e.target as Element).closest?.('.save-go, .title-menu .sb') as HTMLElement); if (i >= 0 && i !== sel) mark(i, false); });
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
