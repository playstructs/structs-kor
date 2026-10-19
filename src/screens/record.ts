/* 전적 (service record): rank, every objective, career numbers and medals. Opens from the
 * commander plate in the HUD. Local to this browser, like the career itself. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, raw, type Safe } from '../ui/dom';
import { career, missions, tutorialDone, RANKS, threshold } from '../game/progress';
import { insignia } from '../ui/shell';
import { session } from '../api/session';
import { wallet } from '../wallet/wallet';
import { spriteHtml } from '../game/map/art';
import { MEDALS } from '../game/medals';
import { portraitHtml, myPfp, setMyPfp, parsePfp, PFP_LAYERS, PFP_COUNTS, seededPfp, onPfp, type Part } from '../game/portrait';
import { guildApi } from '../api/guild';
import { sfx } from '../game/sfx';

const pixel = (type: number, size = 56): Safe => raw(spriteHtml(type, size));

const PART_KO: Record<Part, string> = { head: '머리', neck: '목', body: '몸', arms: '팔', background: '배경' };
const cur = () => ({ ...parsePfp(myPfp())! });

const screen: Screen = {
  render(root) {
    let chainPfp: string | null = null;
    const view = (): Safe => {
      const r = career.rank, st = career.stats;
      const ms = missions({ dash: null, backedUp: wallet.backedUp, tutorial: tutorialDone(), signedIn: session.status.state === 'in' });
      return html`
      <section class="card game-panel record-hero">
        <div class="record-face">${raw(portraitHtml(chainPfp ?? myPfp(), 144))}<span class="record-ins">${raw(insignia(r.i, 44))}</span></div>
        <div class="record-main">
          <span class="label c-hwang">전적</span>
          <h1>${r.name}</h1>
          <div class="plate-xp big"><i style="width:${Math.round(r.pct * 100)}%"></i></div>
          <span class="mono dim">${RANKS[r.i + 1] ? `${r.into} / ${r.need} XP → ${RANKS[r.i + 1]}` : '최고 계급'} · 총 ${n(r.xp)} XP</span>
          <div class="ranks">${RANKS.map((name, i) => html`<span class="${i < r.i ? 'done' : i === r.i ? 'now' : ''}" title="${name} · ${threshold(i)} XP">${name}</span>`)}</div>
        </div>
      </section>
      ${chainPfp ? html`<p class="note">초상화는 사령관 카드에 저장된 모습입니다. 내 정보에서 바꿀 수 있습니다.</p>` : html`<section class="card game-panel"><div class="card-head"><h2>초상화</h2><span class="end"><button class="btn ghost" data-act="dice">무작위</button></span></div>
        <div class="pfp-edit">${PFP_LAYERS.slice().reverse().map((part) => html`<div class="pfp-row"><span class="label">${PART_KO[part]}</span>
          <button class="hud-btn" data-act="part" data-part="${part}" data-d="-1" aria-label="${PART_KO[part]} 이전">◀</button>
          <span class="mono">${cur()[part]} / ${PFP_COUNTS[part]}</span>
          <button class="hud-btn" data-act="part" data-part="${part}" data-d="1" aria-label="${PART_KO[part]} 다음">▶</button></div>`)}</div></section>`}
      <div class="g4">${([['모의전', `${st.simWins}승 / ${st.simBattles}전`], ['누적 격파', String(st.kills)], ['최고 별', '★'.repeat(st.simStars) || '—'], ['연전 제패', `${st.gauntlets}회`], ['일일 교전', `${st.dailyPlays}회`], ['습격 격퇴', `${st.repelled}회`]] as [string, string][]).map(([k, v]) => html`<div class="stat"><small>${k}</small><strong>${v}</strong></div>`)}</div>
      <section class="card game-panel"><h2>훈장</h2>
        <div class="medals">${MEDALS.map((m) => { const got = m.earned(); return html`<div class="medal ${got ? 'got' : ''}">${pixel(m.icon)}<b>${m.name}</b><small>${got ? '획득' : m.how}</small></div>`; })}</div></section>
      <section class="card game-panel"><h2>작전 목표 전체</h2>
        <div class="all-missions">${ms.map((m) => html`<a class="mission ${m.ready ? 'ready' : ''} ${m.claimed ? 'claimed' : ''}" href="${href(m.claimed ? '/record' : m.ready ? '/console' : m.href ?? '/console')}">
          <div class="mission-top"><b>${m.title}</b><span class="mono c-hwang">${m.claimed ? '완료' : `+${m.xp} XP`}</span></div>
          <div class="meter"><i style="width:${Math.round((m.done / m.of) * 100)}%;background:${m.claimed ? 'var(--cheong-mid)' : m.ready ? 'var(--hwang)' : 'var(--cheong)'}"></i></div>
          <span class="dim" style="font-size:12px">${m.claimed ? '보상 수령함' : m.ready ? '함교에서 보상 수령' : m.hint}</span></a>`)}</div></section>`;
    };
    const paint = () => { if (root.isConnected) mount(root, view(), handlers); };
    const handlers = {
      part: (el: HTMLElement) => {
        const part = el.dataset.part as Part, max = PFP_COUNTS[part], p = cur();
        p[part] = ((p[part] - 1 + Number(el.dataset.d) + max) % max) + 1;
        sfx.play('tick'); setMyPfp(p);
      },
      dice: () => { sfx.play('confirm'); setMyPfp(parsePfp(seededPfp(String(Math.random())))!); },
    };
    paint();
    if (session.status.state === 'in' && session.playerId) void guildApi.player(session.playerId).then((p) => { chainPfp = p?.pfp || null; paint(); }).catch(() => null);
    const offs = [career.onChange(paint), onPfp(paint)];
    return () => { offs.forEach((f) => f()); };
  },
};
export default screen;
