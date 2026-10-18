/* 작전 (campaign map): five missions in order, stars earned, the next one waiting. Each opens in
 * the simulator with its own fleets and briefing. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, raw, type Safe } from '../ui/dom';
import { demo } from '../game/demo';
import { MISSIONS, progress, unlocked } from '../game/campaign';
import { spriteHtml } from '../game/map/art';
import { DIFFICULTY_KO } from './sim-labels';

const screen: Screen = {
  render(root) {
    const p = progress();
    const done = MISSIONS.filter((m) => m.id in p).length;
    const stars = Object.values(p).reduce((a, s) => a + s, 0);
    const view = (): Safe => html`
      <div class="card-head"><h1 style="font-size:28px">작전</h1><span class="label c-jeok">CAMPAIGN</span><span class="end mono c-hwang">${done} / ${MISSIONS.length} 완료 · ★ ${stars} / ${MISSIONS.length * 3}</span></div>
      <p class="note">붉은 연합과의 전쟁, 그리고 해적 87호·검은 별 길드·청룡 상단과의 결전. 임무마다 하나의 전술을 배웁니다. 앞 임무를 끝내야 다음 임무가 열립니다.</p>
      <ol class="campaign">${MISSIONS.map((m) => {
        const open = unlocked(m), got = p[m.id];
        return html`<li class="mission-card ${open ? '' : 'locked'} ${got != null ? 'cleared' : ''}">
          <div class="mc-no">${m.no}</div>
          <div class="mc-art">${raw(spriteHtml(m.icon, 72))}</div>
          <div class="mc-body"><span class="label dim">${m.place} · ${DIFFICULTY_KO[m.difficulty]}</span><h2>${m.title}</h2><p>${open ? m.brief : '이전 임무를 완료하면 열립니다.'}</p>
            ${open ? html`<p class="mc-lesson">전술 · ${m.lesson}</p>` : ''}</div>
          <div class="mc-side"><span class="mc-stars" aria-label="별 ${got ?? 0}개">${'★'.repeat(got ?? 0)}${'☆'.repeat(3 - (got ?? 0))}</span>
            ${open ? html`<a class="btn ${got != null ? 'ghost' : 'danger'}" href="${href('/sim?mission=' + m.id)}">${got != null ? '다시 출격' : '출격'}</a>` : html`<span class="chip">잠김</span>`}
            <span class="mono c-hwang" style="font-size:12px">${got != null ? '완료' : `첫 완료 +${m.xp} XP${demo.on ? ` · +${Math.round(m.xp / 10)} α` : ''}`}</span></div>
        </li>`;
      })}</ol>`;
    mount(root, view());
  },
};
export default screen;
