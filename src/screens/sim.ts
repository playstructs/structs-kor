/* 전투 시뮬레이터: structsd's combat rules run locally (src/sim/chain.ts, ported from
 * structs-xyz/structs-universe), so nothing is sent anywhere. The daily engagement and its ladder
 * come from the guild (REQ-SIM-1); until then the daily is seeded from today's date. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, type Safe } from '../ui/dom';
import { Chain, type Msg } from '../sim/chain';
import { Ai, type Difficulty } from '../sim/ai';
import { CPU, YOU, MAX_CHARGE, chainSetup, dailyScenario, layout, encodeBattle, type Preset, type Unit } from '../sim/fleets';
import { daily } from '../api/planned';
import { AMBIT, AMBITS, STRUCT_TYPE } from '../i18n/ko';
import type { WeaponSystem } from '../data/catalogue';

type Phase = 'setup' | 'deploy' | 'battle' | 'debrief';
interface Side { lost: number; attacks: number; damage: number; evaded: number; blocked: number; counter: number }
const zero = (): Side => ({ lost: 0, attacks: 0, damage: 0, evaded: 0, blocked: 0, counter: 0 });

const MODES: [string, string, string][] = [
  ['single', '단판', '내 함대 대 컴퓨터 함대 단판 승부.'],
  ['daily', '일일 교전', '모든 사령관이 같은 시드로 겨룹니다.'],
];
const PRESET_KO: Record<Preset, string> = { easy: '4기', difficult: '8기', hard: '12기', random: '무작위 6–16' };
const DIFF_KO: Record<Difficulty, string> = { easy: '쉬움', difficult: '어려움', hard: '매우 어려움' };

const screen: Screen = {
  render(root) {
    let phase: Phase = 'setup', mode = 'single', preset: Preset = 'difficult', diff: Difficulty = 'difficult';
    let blockMs = 2000, charge = 10, seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    let units: Unit[] = [];
    let chain: Chain | null = null, ai: Ai | null = null, auto: Ai | null = null, idMap: Record<string, string> = {};
    let timer: ReturnType<typeof setInterval> | null = null, paused = false, autopilot = false;
    let log: { h: number; text: string; tone: string }[] = [];
    let stats = { player: zero(), computer: zero() }, blocks = 0, winner: 'player' | 'computer' | 'draw' | null = null;
    let picked: string | null = null, ws: WeaponSystem = 'primaryWeapon', queued: Msg | null = null;
    let ladder: Awaited<ReturnType<typeof daily>> | null = null;

    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const side = (owner: string) => (owner === YOU.id ? 'player' : 'computer');
    const typeName = (id: string) => { const s = chain?.get(id); return s ? STRUCT_TYPE[s.typeId] ?? String(s.typeId) : id; };

    const start = () => {
      const { setup, idMap: m } = chainSetup(units, seed, { player: charge, computer: charge });
      chain = new Chain(setup); idMap = m;
      ai = new Ai(CPU.id, diff, seed); auto = new Ai(YOU.id, 'hard', seed + ':you');
      log = []; stats = { player: zero(), computer: zero() }; blocks = 0; winner = null; picked = null; queued = null; paused = false;
      phase = 'battle'; paint();
      stop(); timer = setInterval(tick, blockMs);
    };

    const tick = () => {
      if (!chain || paused || winner) return;
      const mine = autopilot ? auto!.decide(chain) : queued;
      if (mine) chain.submit(YOU.id, mine);
      queued = null;
      const theirs = ai!.decide(chain);
      if (theirs) chain.submit(CPU.id, theirs);
      const b = chain.produceBlock();
      blocks++;
      for (const tx of b.txs) {
        const who = side(tx.signer);
        if (!tx.ok) { if (who === 'player') log.unshift({ h: b.height, text: `명령 거부: ${tx.error}`, tone: 'c-warn' }); continue; }
        for (const ev of tx.events) {
          if (ev.category !== 'struct_attack') continue;
          const d = ev.detail;
          stats[who].attacks++;
          for (const shot of d.eventAttackShotDetail || []) {
            const dmg = Math.max(0, (shot.targetHealthBefore ?? 0) - (shot.targetHealthAfter ?? 0));
            stats[who].damage += dmg;
            if (shot.evaded) stats[side(shot.targetPlayerId)].evaded++;
            if (shot.blocked) stats[side(shot.targetPlayerId)].blocked++;
            if (shot.targetDestroyed) stats[side(shot.targetPlayerId)].lost++;
            for (const c of shot.eventAttackDefenderCounterDetail || []) stats[side(shot.targetPlayerId)].counter += c.counterDamage || 0;
            const what = shot.evaded ? '회피' : shot.blocked ? `차단 (${STRUCT_TYPE[chain.get(shot.blockedByStructId)?.typeId ?? 0] ?? '방어자'})` : shot.targetDestroyed ? '파괴!' : `피해 ${dmg}`;
            log.unshift({ h: b.height, text: `${who === 'player' ? '아군' : '적'} ${typeName(d.attackerStructId)} → ${typeName(shot.targetStructId)} · ${what}`, tone: who === 'player' ? 'c-cheong' : 'c-jeok' });
          }
        }
      }
      log = log.slice(0, 40);
      const fleets = chain.fleetsAtBattle();
      if (fleets.length < 2) {
        winner = fleets.includes(YOU.fleetId) ? 'player' : fleets.includes(CPU.fleetId) ? 'computer' : 'draw';
        stop(); phase = 'debrief';
      } else if (blocks > 400) { winner = 'draw'; stop(); phase = 'debrief'; }
      paint();
    };

    const board = (owner: string): Safe => html`${AMBITS.map((a) => html`<div style="display:grid;grid-template-columns:52px repeat(4,minmax(0,1fr));gap:6px">
      <span class="dim" style="display:flex;align-items:center;justify-content:center;background:var(--bg-raised);font-size:12px">${AMBIT[a]}</span>
      ${[0, 1, 2, 3].map((slot) => {
        const s = chain ? Object.values(chain.structs).find((x) => x.owner === owner && x.ambit === a && x.slot === slot && !(chain!.isDestroyed(x) && x.destroyedAt != null && chain!.height - x.destroyedAt > 5)) : null;
        const u = !chain ? units.find((x) => x.side === side(owner) && x.ambit === a && x.slot === slot) : null;
        if (!s && !u) return html`<div style="min-height:58px;background:var(--bg-raised);border:1px dashed var(--line)"></div>`;
        const type = s ? s.typeId : u!.type;
        const max = s ? chain!.typeOf(s).maxHealth : 1;
        const hp = s ? (chain!.isDestroyed(s) ? 0 : s.health) : 1;
        const me = owner === YOU.id;
        const isPicked = s && picked === s.id;
        const canTarget = s && !me && picked && chain && !chain.canAttack(chain.get(picked)!, s, ws);
        return html`<button data-act="${me ? 'pick' : 'target'}" data-id="${s?.id ?? ''}" ${!chain || hp === 0 ? 'disabled' : ''} aria-label="${STRUCT_TYPE[type]} ${me ? '아군' : '적'} 내구도 ${hp}/${max}"
          style="min-height:58px;padding:6px 8px;text-align:left;display:flex;flex-direction:column;justify-content:space-between;gap:4px;font-size:13px;color:#fff;cursor:pointer;
          background:${me ? 'var(--cheong-bg)' : 'var(--jeok-bg)'};border:${isPicked ? '3px solid var(--hwang)' : canTarget ? '2px solid var(--jeok-strong)' : `1px solid ${me ? 'var(--cheong-mid)' : 'var(--jeok-deep)'}`};opacity:${hp === 0 ? 0.35 : 1}">
          <span>${STRUCT_TYPE[type]}</span>${s ? html`<span style="height:4px;background:var(--sunken)"><i style="display:block;height:100%;width:${(hp / max) * 100}%;background:${me ? 'var(--cheong)' : 'var(--jeok)'}"></i></span>` : ''}</button>`;
      })}</div>`)}`;

    const pills = (list: [string, string][], cur: string, act: string) => html`<div style="display:flex;flex-wrap:wrap;gap:6px">${list.map(([v, l]) => html`<button class="pill ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`)}</div>`;

    const views: Record<Phase, () => Safe> = {
      setup: () => html`<div class="g2">
        <section class="card"><h1 style="font-size:30px">교전 설정</h1>
          <div class="field"><span>모드</span>${pills(MODES.map(([v, l]) => [v, l]), mode, 'mode')}<span class="dim" style="font-size:13px">${MODES.find((m) => m[0] === mode)![2]}</span></div>
          ${mode === 'single' ? html`
          <div class="field"><span>난이도</span>${pills((Object.keys(DIFF_KO) as Difficulty[]).map((d) => [d, DIFF_KO[d]]), diff, 'diff')}</div>
          <div class="field"><span>적 규모</span>${pills((Object.keys(PRESET_KO) as Preset[]).map((p) => [p, PRESET_KO[p]]), preset, 'preset')}</div>` : ''}
          <div class="field"><span>블록 시간</span>${pills([['2000', '2초 · 훈련'], ['6000', '6초 · 체인']], String(blockMs), 'block')}</div>
          <label class="field"><span>시작 충전량 · <b class="mono c-cheong">${charge}</b> / ${MAX_CHARGE}</span><input type="range" min="0" max="${MAX_CHARGE}" value="${charge}" data-act="charge" style="accent-color:var(--cheong);min-height:32px"></label>
          ${mode === 'single' ? html`<label class="field"><span>시드</span><input class="input" value="${seed}" data-act="seed"></label>` : ''}
          <button class="btn primary lg" data-act="toDeploy">배치 단계로</button>
        </section>
        <section class="card"><h2>오늘의 일일 교전 ${ladder ? html`<span class="mono dim" style="font-size:14px">${ladder.date}</span>` : ''}</h2>
          <p class="note">${dailyScenario().name} · ${DIFF_KO[dailyScenario().difficulty]}</p>
          ${ladder?.ladder.length ? html`<ol class="log" style="padding:0">${ladder.ladder.map((r, i) => html`<li style="display:flex;justify-content:space-between;padding:8px 10px;background:${i === 0 ? 'var(--hwang-bg)' : 'var(--bg-raised)'}"><span>${i + 1} · ${r.username}</span><span>${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)} · ${r.blocks}블록</span></li>`)}</ol>`
            : html`<p class="empty">아직 오늘의 기록이 없습니다.</p>`}
          <p class="note">함대는 본거지 밖에서 만나므로 행성 구조체는 없습니다. CMD 함선이 파괴되면 전투가 끝납니다.</p>
        </section></div>`,
      deploy: () => html`<section class="card"><div class="card-head"><h1 style="font-size:26px">배치 확인</h1><span class="mono dim">${units.length} / 34 유닛 · 시드 ${seed}</span>
          <span class="end" style="display:flex;gap:8px"><button class="btn ghost" data-act="reroll">다시 뽑기</button><button class="btn ghost" data-act="toSetup">설정으로</button><button class="btn danger lg" data-act="start">전투 시작</button></span></div>
        <div class="g2"><div style="display:flex;flex-direction:column;gap:6px"><h3 class="c-cheong" style="font-size:18px">내 함대</h3>${board(YOU.id)}</div>
        <div style="display:flex;flex-direction:column;gap:6px"><h3 class="c-jeok" style="font-size:18px">컴퓨터 함대 · ${DIFF_KO[diff]}</h3>${board(CPU.id)}</div></div></section>`,
      battle: () => html`<div class="row">
        <section class="card grow">
          <div class="card-head"><h2>블록 <span class="mono">#${chain?.height ?? 0}</span></h2>
            <span class="mono dim" style="font-size:13px">${blockMs / 1000}초/블록 · 충전 아군 ${chain?.chargeOf(YOU.id) ?? 0} · 적 ${chain?.chargeOf(CPU.id) ?? 0}</span>
            <span class="end" style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="pill ${ws === 'primaryWeapon' ? 'on' : ''}" data-act="ws" data-v="primaryWeapon">주무기</button>
              <button class="pill ${ws === 'secondaryWeapon' ? 'on' : ''}" data-act="ws" data-v="secondaryWeapon">보조무기</button>
              <button class="pill ${autopilot ? 'on' : ''}" data-act="autopilot">자동</button>
              <button class="pill" data-act="pause">${paused ? '재개' : '일시정지'}</button></span></div>
          <p class="note">${autopilot ? '자동 조종 중입니다.' : picked ? `${typeName(picked)} 선택됨 → 빨간 테두리의 적을 누르세요.` : '내 유닛을 눌러 선택한 뒤 적을 눌러 공격하세요.'}${queued ? ' · 다음 블록에 발사' : ''}</p>
          <div class="g2"><div style="display:flex;flex-direction:column;gap:6px">${board(YOU.id)}</div><div style="display:flex;flex-direction:column;gap:6px">${board(CPU.id)}</div></div>
        </section>
        <section class="side" style="background:var(--sunken);border:2px solid var(--line);display:flex;flex-direction:column">
          <h2 style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:18px">전투 기록</h2>
          <ol class="log">${log.map((l) => html`<li><span class="faint">#${l.h}</span> <span class="${l.tone}">${l.text}</span></li>`)}</ol>
        </section></div>`,
      debrief: () => {
        const p = stats.player, c = stats.computer;
        const stars = winner !== 'player' ? 0 : 1 + (p.lost <= units.filter((u) => u.side === 'player').length / 3 ? 1 : 0) + (blocks < 60 ? 1 : 0);
        return html`<div class="row">
          <section class="card accent side" style="align-items:center;text-align:center;justify-content:center">
            <span class="label c-cheong">DEBRIEF</span>
            <strong style="font-family:var(--f-display);font-size:72px;color:#fff;line-height:1">${winner === 'player' ? '승리' : winner === 'computer' ? '패배' : '무승부'}</strong>
            <span style="font-size:44px;color:var(--hwang);letter-spacing:6px" aria-label="별 3개 중 ${stars}개">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
            <span class="mono">${blocks}블록 · ${n((blocks * blockMs) / 1000)}초</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn ghost" data-act="toSetup">다시 하기</button><a class="btn gold" href="${href('/chat')}">채팅에 도전 공유</a></div>
          </section>
          <section class="card grow"><h2>전투 통계</h2>
            <div class="scroll-x"><table class="t" style="min-width:420px"><thead><tr><th>항목</th><th class="r c-cheong">나</th><th class="r c-jeok">컴퓨터</th></tr></thead><tbody>
              ${([['손실', 'lost'], ['공격', 'attacks'], ['피해', 'damage'], ['회피', 'evaded'], ['차단', 'blocked'], ['반격 피해', 'counter']] as [string, keyof Side][]).map(([l, k]) => html`<tr><td>${l}</td><td class="r mono">${p[k]}</td><td class="r mono">${c[k]}</td></tr>`)}
            </tbody></table></div>
            <div style="display:flex;gap:8px;align-items:center;padding:12px;background:var(--bg-raised);border:1px solid var(--line);flex-wrap:wrap"><span class="dim" style="font-size:12px">공유 링크</span><code class="mono c-cheong" style="flex:1 1 auto;overflow-wrap:anywhere;font-size:13px">structs.app/sim/${encodeBattle({ units, difficulty: diff, blockMs })}</code></div>
          </section></div>`;
      },
    };

    const steps = (): Safe => html`<nav aria-label="시뮬레이션 단계" class="tabs">${(['setup', 'deploy', 'battle', 'debrief'] as Phase[]).map((p, i) => html`<span class="tab ${phase === p ? 'on' : ''}" aria-current="${phase === p ? 'step' : 'false'}">${i + 1} · ${{ setup: '설정', deploy: '배치', battle: '전투', debrief: '결과' }[p]}</span>`)}</nav>`;
    const paint = () => { if (root.isConnected) mount(root, html`<h1 class="sr">전투 시뮬레이터</h1>${steps()}${views[phase]()}`, handlers); };
    const handlers = {
      mode: (el: HTMLElement) => { mode = el.dataset.v!; paint(); },
      diff: (el: HTMLElement) => { diff = el.dataset.v as Difficulty; paint(); },
      preset: (el: HTMLElement) => { preset = el.dataset.v as Preset; paint(); },
      block: (el: HTMLElement) => { blockMs = Number(el.dataset.v); paint(); },
      charge: (el: HTMLElement) => { charge = Number((el as HTMLInputElement).value); paint(); },
      seed: (el: HTMLElement) => { seed = (el as HTMLInputElement).value || seed; },
      toSetup: () => { stop(); chain = null; phase = 'setup'; paint(); },
      toDeploy: () => {
        if (mode === 'daily') { const d = dailyScenario(); units = d.units; seed = d.seed; diff = d.difficulty; }
        else units = layout(preset, seed);
        chain = null; phase = 'deploy'; paint();
      },
      reroll: () => { seed = 'KR-' + Math.random().toString(36).slice(2, 7).toUpperCase(); units = layout(preset, seed); paint(); },
      start,
      ws: (el: HTMLElement) => { ws = el.dataset.v as WeaponSystem; paint(); },
      autopilot: () => { autopilot = !autopilot; paint(); },
      pause: () => { paused = !paused; paint(); },
      pick: (el: HTMLElement) => { picked = el.dataset.id || null; paint(); },
      target: (el: HTMLElement) => {
        if (!chain || !picked || !el.dataset.id) return;
        const why = chain.canAttack(chain.get(picked)!, chain.get(el.dataset.id)!, ws);
        if (why) { log.unshift({ h: chain.height, text: `공격 불가: ${why}`, tone: 'c-warn' }); paint(); return; }
        queued = { '@type': '/structs.structs.MsgStructAttack', operatingStructId: picked, targetStructId: [el.dataset.id], weaponSystem: ws };
        paint();
      },
    };
    void idMap;
    paint();
    void daily().then((d) => { ladder = d; if (phase === 'setup') paint(); }).catch(() => null);
    return stop;
  },
};
export default screen;
