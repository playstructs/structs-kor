/* The landing page (구조체.com). Public: REQ-PUB-1/2/3 give it live numbers without a sign-in;
 * until the guild serves them, the numbers appear once the visitor signs in. */
import type { Screen } from '../router';
import { html, mount, n, micro, raw } from '../ui/dom';
import { publicDirectory, publicLeaderboard, publicSummary } from '../api/planned';
import { startDemo } from '../ui/gate';
import { attract } from '../game/attract';
import { demo, HEGEMONY } from '../game/demo';
import { career } from '../game/progress';
import { portraitHtml, myPfp } from '../game/portrait';
import { keys } from '../game/keys';
import { go, href, prefetch } from '../router';

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
      ${raid ? html`<span class="chip jeok">⚠ ${raid.name} 함대 ${raid.eta ? `${raid.eta}블록 후 도착` : '교전 중'}</span>` : demo.decision ? html`<span class="chip hwang">결단 대기 · ${demo.decision.title}</span>` : demo.boss ? html`<span class="chip jeok">공허 함대 출현 · ${demo.boss.left}블록</span>` : ''}
      ${(() => { const last = [...demo.chronicle].reverse().find((c) => !c.text.startsWith('연속')); return last || demo.streak > 1 ? html`<small class="dim">${demo.streak > 1 && (demo.state.streak?.day === dayToday() || demo.state.streak?.day === dayToday(-1)) ? `연속 ${demo.streak}일 복귀${last ? ' · ' : ''}` : ''}${last ? `최근: ${last.text}` : ''}</small>` : ''; })()}</div>
    <button class="btn gold lg save-go" data-act="resume">▶ 계속하기 <kbd>Enter</kbd></button></div></section>`;
}

const STEPS = [
  ['01', '채굴', '#43CDB6', '#133546', '행성을 탐사하고 광석을 캐내세요. 작업증명(PoW)으로 채굴 속도가 결정됩니다.'],
  ['02', '정제', '#EBAA49', '#3A2F12', '광석을 알파 매터로 정제하세요. 정제된 알파는 빼앗기지 않고, 1g은 1kW 전력이 됩니다.'],
  ['03', '길드', '#C5D7D9', '#2B3550', '길드에 가입해 변전소 전력을 나누고, 동맹 행성을 함께 방어하세요.'],
  ['04', '습격', '#EE7D69', '#5D0C15', '함대를 출격시켜 적 행성의 광석을 습격하세요. 먼저 시뮬레이터로 확인하세요.'],
];

const screen: Screen = {
  async render(root) {
    const view = (s: Awaited<ReturnType<typeof publicSummary>> | null, lb: Awaited<ReturnType<typeof publicLeaderboard>> | null, dir: Awaited<ReturnType<typeof publicDirectory>> | null) => html`
    <div style="margin:-16px">
      ${continueCard()}
      <section style="position:relative;overflow:hidden;border-bottom:1px solid var(--line)">
        <div aria-hidden="true" style="position:absolute;right:24px;top:40px;writing-mode:vertical-rl;font-family:var(--f-display);font-size:120px;line-height:1;color:var(--surface);letter-spacing:12px">구조체</div>
        <div class="g2" style="position:relative;max-width:1280px;margin:0 auto;padding:88px 24px 96px;align-items:center;gap:56px">
          <div style="display:flex;flex-direction:column;gap:26px">
            <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="chip jeok label">시즌 1</span><span class="chip cheong label">한국 서버 오픈</span></div>
            <h1 style="font-size:clamp(56px,8vw,96px);line-height:1.02">우주는<br><span class="c-cheong">구조체</span>가<br>지배한다</h1>
            <p style="margin:0;max-width:34em;font-size:19px;line-height:1.75">행성을 채굴하고, 알파 매터를 정제하고, 길드와 함께 함대를 지휘하세요. 모든 전략과 전투는 블록체인 위에 영원히 기록됩니다.</p>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <button class="btn gold lg" data-act="demo">${demo.on ? '▶ 데모 함교로 복귀' : '▶ 지금 바로 플레이 · 데모 함교'}</button>
              <a class="btn primary lg" href="${href('/start')}">사령관 입대</a>
              <a class="btn ghost lg" href="${href('/sim')}">전투 시뮬레이터</a>
            </div>
          </div>
          <div class="card" style="padding:0;gap:0;box-shadow:10px 10px 0 var(--sunken)">
            <div style="display:flex;justify-content:space-between;padding:12px 16px;background:var(--cheong-bg);color:var(--cheong-hi)" class="label"><span>${s?.guild_name ?? 'SN Corp'} · 실시간 교전</span><span class="c-cheong">● LIVE</span></div>
            <div id="attract" style="min-height:280px;background:#0E0D1C"></div>
            <div class="g3" style="gap:0;border-top:2px solid var(--line)">
              ${[['사령관', s?.players], ['행성', s?.planets], ['구조체', s?.structs]].map(([k, v]) => html`<div style="padding:14px 16px;border-right:1px solid var(--line)"><small class="dim" style="font-size:12px">${k}</small><div class="mono c-white" style="font-size:20px;font-weight:600">${v == null ? '—' : n(v)}</div></div>`)}
            </div>
            ${s && s.players == null ? html`<p class="note" style="padding:10px 16px">실시간 수치는 로그인 후 표시됩니다.</p>` : ''}
          </div>
        </div>
      </section>

      <section style="max-width:1280px;margin:0 auto;padding:88px 24px;display:flex;flex-direction:column;gap:40px">
        <div><span class="label c-cheong">HOW TO PLAY</span><h2 style="font-size:52px;margin-top:10px">네 단계로 은하를 정복하라</h2></div>
        <div class="g4">${STEPS.map(([no, t, c, bg, d]) => html`
          <article class="card"><div style="display:flex;justify-content:space-between;align-items:center"><span class="mono dim">${no}</span><span style="width:44px;height:44px;background:${bg};border:2px solid ${c}"></span></div>
          <h3 style="font-size:30px">${t}</h3><p style="margin:0;line-height:1.7">${d}</p></article>`)}
        </div>
      </section>

      <section style="background:var(--bg-raised);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
        <div style="max-width:1280px;margin:0 auto;padding:88px 24px" class="g2">
          <div class="card flush">
            <div class="card-head" style="padding:16px"><h2>길드</h2><span class="end label c-hwang">GUILDS</span></div>
            ${dir?.length ? html`<table class="t"><thead><tr><th>길드</th><th class="r">멤버</th><th class="r">알파</th></tr></thead><tbody>${dir.slice(0, 6).map((d) => html`<tr><td class="c-white">${d.name}</td><td class="r mono">${n(d.members)}</td><td class="r mono c-hwang">${micro(d.alpha, 0)} g</td></tr>`)}</tbody></table>` : html`<p class="empty">로그인하면 길드 목록을 볼 수 있습니다.</p>`}
          </div>
          <div class="card flush">
            <div class="card-head" style="padding:16px"><h2>이번 주 사령관 랭킹</h2><span class="end label c-jeok">RANKING</span></div>
            ${lb?.length ? html`<table class="t"><thead><tr><th>순위</th><th>사령관</th><th class="r">알파 매터</th></tr></thead><tbody>${lb.map((p, i) => html`<tr><td style="font-family:var(--f-display);font-size:20px;color:${i === 0 ? 'var(--hwang)' : i === 2 ? 'var(--jeok)' : 'var(--text)'}">${i + 1}</td><td class="c-white">${p.username || p.player_id}</td><td class="r mono c-hwang">${micro(p.alpha_balance_p, 0)} g</td></tr>`)}</tbody></table>` : html`<p class="empty">로그인하면 랭킹을 볼 수 있습니다.</p>`}
          </div>
        </div>
      </section>

      <section style="background:var(--cheong-bg);border-top:2px solid var(--cheong)">
        <div class="g2" style="max-width:1280px;margin:0 auto;padding:80px 24px;align-items:center">
          <div style="display:flex;flex-direction:column;gap:16px"><h2 style="font-size:52px">어디서든 지휘하세요</h2><p style="margin:0;font-size:18px;line-height:1.7;color:#C8F4E8">웹, 데스크톱, 모바일 — 하나의 계정, 하나의 은하. 진행 상황은 체인에 저장되어 어느 기기에서나 이어집니다.</p></div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <a class="btn primary lg" href="${href('/console')}" style="justify-content:space-between">웹 브라우저 <span class="mono">구조체.com →</span></a>
            <a class="btn ghost lg" href="#mac" style="justify-content:space-between">macOS <span class="mono c-cheong">[다운로드 링크]</span></a>
            <a class="btn ghost lg" href="#win" style="justify-content:space-between">Windows <span class="mono c-cheong">[다운로드 링크]</span></a>
          </div>
        </div>
      </section>
    </div>`;

    const handlers = { demo: () => startDemo('/console'), resume: () => go('/console') };
    // The bridge is where every play button goes: have it ready.
    setTimeout(() => { prefetch('/console'); prefetch('/sim'); }, 600);
    const offKeys = keys.scope({ Enter: () => (demo.on && root.isConnected ? go('/console') : false) });
    mount(root, view(null, null, null), handlers);
    const stage = document.createElement('div');
    const stop = attract(stage, 340);
    const place = () => root.querySelector('#attract')?.appendChild(stage);
    place();
    const [s, lb, dir] = await Promise.all([publicSummary().catch(() => null), publicLeaderboard().catch(() => null), publicDirectory().catch(() => null)]);
    if (root.isConnected) { mount(root, view(s, lb, dir), handlers); place(); }
    return () => { stop(); offKeys(); };
  },
};
export default screen;
