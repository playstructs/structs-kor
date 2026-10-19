/* 연구소: spend alpha on permanent edges for the base. The deeper branches wait for rank, so
 * promotions are power. Runs on the demo base (research has no chain counterpart). */
import type { Screen } from '../router';
import { html, mount, n, raw, toast, type Safe } from '../ui/dom';
import { needSession } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { demo, TECH, DEMO_ID, DOCTRINES, DOCTRINE_SWITCH, type TechId, type DoctrineId } from '../game/demo';
import { career, RANKS } from '../game/progress';
import { sfx } from '../game/sfx';
import { banner, float } from '../game/fx';
import { spriteHtml } from '../game/map/art';

const pixel = (type: number, size = 64): Safe => raw(spriteHtml(type, size));
const BRANCH: [string, TechId[]][] = [['경제', ['mine', 'refine', 'trade']], ['전력', ['grid']], ['방어', ['shield', 'guns', 'bunker']], ['패권', ['spy', 'fort', 'diplo']]];

const screen: Screen = {
  render(root) {
    const pid = needSession(root, '연구소', { demo: true });
    if (!pid) return;
    if (pid !== DEMO_ID) {
      mount(root, html`<section class="card game-panel" style="max-width:640px;margin:40px auto"><span class="label c-hwang">연구소</span><h1 style="font-size:30px">연구는 데모 함교에서</h1><p class="note">체인에는 연구가 없습니다. 연구소는 데모 기지의 경제를 실험하는 곳입니다.</p></section>`);
      return;
    }
    const view = (): Safe => {
      const rank = career.rank.i;
      const alpha = demo.state.alpha;
      return html`
      <div class="card-head"><h1 style="font-size:28px">연구소</h1><span class="end mono c-hwang">보유 알파 ${n(alpha, 2)} g</span></div>
      <p class="note">알파로 기지를 영구 강화합니다. 깊은 기술은 계급이 오르면 열립니다 — 작전 목표와 전투로 진급하세요.</p>
      <section class="doctrines"><div class="card-head"><h2>교리</h2><span class="end note">${demo.doctrine ? `전환 비용 ${DOCTRINE_SWITCH} g` : '첫 선택은 무료 · 하나만 따를 수 있습니다'}</span></div>
        <div class="doc-row">${DOCTRINES.map((d) => { const on = demo.doctrine === d.id; return html`<article class="doc ${on ? 'on' : ''}">
          <div class="tech-top">${pixel(d.icon, 48)}<div><b>${d.name}</b><small class="dim">${d.motto}</small></div></div>
          <ul>${d.perks.map((p) => html`<li>${p}</li>`)}</ul>
          ${on ? html`<span class="chip hwang">따르는 중</span>` : html`<button class="btn ${demo.doctrine ? 'ghost' : 'gold'}" data-act="adopt" data-id="${d.id}" ${demo.doctrine && alpha < DOCTRINE_SWITCH ? 'disabled' : ''}>${demo.doctrine ? `전환 · ${DOCTRINE_SWITCH} g` : '이 교리를 따른다'}</button>`}
        </article>`; })}</div></section>
      <div class="tree">${BRANCH.map(([name, ids]) => html`<section class="branch"><h2>${name}</h2><div class="branch-row">${ids.map((id, k) => {
        const t = TECH.find((x) => x.id === id)!;
        const l = demo.level(id), maxed = l >= t.max, locked = rank < t.rank, cost = t.cost[l];
        return html`${k ? html`<i class="link ${l || demo.level(ids[k - 1]) ? 'lit' : ''}" aria-hidden="true"></i>` : ''}<article class="tech ${maxed ? 'max' : locked ? 'locked' : l ? 'some' : ''}">
          <div class="tech-top">${pixel(t.icon)}<div><b>${t.name}</b><span class="pips">${Array.from({ length: t.max }, (_, i) => html`<i class="${i < l ? 'on' : ''}"></i>`)}</span></div></div>
          <p>${l ? t.desc(l) : '미연구'}${!maxed ? html` <span class="next">→ ${t.desc(l + 1)}</span>` : ''}</p>
          ${maxed ? html`<span class="chip hwang">최고 단계</span>` : locked ? html`<span class="chip jeok">${RANKS[t.rank]} 이상 해금</span>` :
            html`<button class="btn ${alpha >= cost ? 'gold' : 'ghost'}" data-act="buy" data-id="${id}" ${alpha >= cost ? '' : 'disabled'}>연구 · ${cost} g</button>`}
        </article>`;
      })}</div></section>`)}</div>`;
    };
    const paint = () => {
      if (!root.isConnected) return;
      mount(root, view(), handlers);
      const r = demo.rates();
      setTiles([
        { label: '알파 매터', value: '', num: demo.state.alpha, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)', delta: `+${r.alpha.toFixed(2)}/블록` },
        { label: '연구 단계', value: String(TECH.reduce((a, t) => a + demo.level(t.id), 0)) + ' / ' + TECH.reduce((a, t) => a + t.max, 0) },
        { label: '계급', value: career.rank.name, tone: 'var(--warn)' },
      ]);
    };
    const handlers = {
      adopt: (el: HTMLElement) => {
        const id = el.dataset.id as DoctrineId;
        const m = demo.adopt(id);
        if (m) { sfx.play('error'); toast(m); return; }
        const d = DOCTRINES.find((x) => x.id === id)!;
        sfx.play('levelup');
        banner({ kicker: '교리 채택', title: d.name, sub: d.perks.join(' · '), tone: 'gold', ms: 2400 });
        paint();
      },
      buy: (el: HTMLElement) => {
        const id = el.dataset.id as TechId;
        const m = demo.research(id, career.rank.i);
        if (m) { sfx.play('error'); toast(m); return; }
        const t = TECH.find((x) => x.id === id)!;
        sfx.play('levelup');
        float(el, `${t.name} ${demo.level(id)}단계`, 'var(--warn)', true);
        career.bump('research');
        if (demo.level(id) === t.max) banner({ kicker: '연구 완료', title: t.name, sub: t.desc(t.max), tone: 'gold', ms: 2200 });
        paint();
      },
    };
    paint();
    const offs = [demo.onBlock(paint), career.onChange(paint)];
    return () => { offs.forEach((f) => f()); setTiles([]); };
  },
};
export default screen;
