/* 지휘 함교 (Command Bridge): the commander's planet on the game's own battle board, with the
 * objectives, threat radar, live feed and a hotkey command bar around it. Live data comes from one
 * read (REQ-AGG-1) refreshed by GRASS events; the demo base (src/game/demo.ts) feeds the same view
 * block by block, raids included. */
import type { Screen } from '../router';
import { href, go } from '../router';
import { html, mount, n, watts, micro, raw, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { dashboard, type Dashboard } from '../api/planned';
import { actions } from '../api/actions';
import { guildApi, type LeaderPlayer, type StructRow } from '../api/guild';
import { wallet } from '../wallet/wallet';
import { session } from '../api/session';
import { onGrass, throttled } from '../grass/grass';
import { AMBIT, STRUCT_TYPE, activityLabel } from '../i18n/ko';
import { TYPES_BY_ID, STRUCT_TYPES, AMBIT_FLAG, COMMAND_SHIP_ID, type Ambit } from '../data/catalogue';
import { Board, type BoardStruct } from '../game/map/board';
import { demo, DEMO_ID, ENGINE, OC, vetRank, ABILITIES, type AbilityId } from '../game/demo';
import { hegemonyMeter } from '../game/meter';
import { advise, adviseReal } from '../game/advisor';
import { career, activeMissions, tutorialDone, RANKS, type MissionState } from '../game/progress';
import { sfx } from '../game/sfx';
import { banner, notify, float, flash, shake } from '../game/fx';
import { keys } from '../game/keys';
import { spriteHtml } from '../game/map/art';
import { portraitHtml, seededPfp, myPfp } from '../game/portrait';
import { pow, blocksUntil } from '../pow/engine';
import { runTour, tourSeen, BRIDGE_TOUR } from '../game/tour';
import { dailyOrders, claimDaily, claimDailyBonus, DAILY_XP, DAILY_BONUS } from '../game/daily';

const DESTROYED = 32, ONLINE = 4;
const isFleetType = (t: number) => t <= 13;
const kw = (mw: unknown) => Number(mw) / 1e6;

type Panel = { kind: 'struct'; id: string } | { kind: 'build'; key: string; ambit: Ambit; cat: 'planet' | 'fleet'; slot: number } | null;

function toBoard(d: Dashboard): BoardStruct[] {
  return d.structs.map((s) => {
    const t = TYPES_BY_ID[s.type];
    return {
      id: s.id, typeId: s.type, ambit: (s.operating_ambit || 'land') as Ambit, slot: s.slot ?? 0, side: 'defender',
      category: isFleetType(s.type) ? 'fleet' : 'planet', isCommand: s.type === COMMAND_SHIP_ID,
      health: (s.status & DESTROYED) || s.is_destroyed ? 0 : Number(s.health ?? t?.maxHealth ?? 1), maxHealth: t?.maxHealth ?? 1,
      online: (s.status & ONLINE) !== 0, protects: s.protected_struct_id,
      building: d.player.id === DEMO_ID ? demo.buildProgress(s.id) : null,
      hot: d.player.id === DEMO_ID && !!demo.state.structs.find((x) => x.id === s.id)?.oc,
      vet: d.player.id === DEMO_ID ? vetRank(demo.state.structs.find((x) => x.id === s.id)?.kills) : 0,
    } satisfies BoardStruct;
  });
}
/** Raiders on the board: the demo's, or (signed in) the raiding fleet's real structs. */
let liveRaiders: StructRow[] = [];
function raiders(): BoardStruct[] {
  if (liveRaiders.length) return liveRaiders.map((x) => ({ id: x.id, typeId: x.type, ambit: (x.operating_ambit || 'space') as Ambit, slot: x.slot ?? 0, side: 'attacker', category: 'fleet', isCommand: x.type === COMMAND_SHIP_ID, health: Number(x.health), maxHealth: TYPES_BY_ID[x.type]?.maxHealth ?? 1, online: (x.status & ONLINE) !== 0 }));
  const r = demo.raid;
  if (!r || r.eta > 0) return [];
  return r.structs.map((x) => ({ id: x.id, typeId: x.type, ambit: x.ambit, slot: x.slot, side: 'attacker', category: 'fleet', isCommand: x.type === COMMAND_SHIP_ID, health: x.hp, maxHealth: x.max, online: true }));
}

const pixel = (type: number, size = 56): Safe => raw(spriteHtml(type, size));

const screen: Screen = {
  async render(root) {
    const pid = needSession(root, '지휘 함교', { demo: true });
    if (!pid) return;
    const isDemo = pid === DEMO_ID;
    liveRaiders = [];
    mount(root, loading());
    let d = null as Dashboard | null;
    let panel: Panel = null;
    let board: Board | null = null;
    let lastRaidKey = '';
    const offs: (() => void)[] = [];

    const ctx = () => ({ dash: d, backedUp: wallet.backedUp, tutorial: tutorialDone(), signedIn: session.status.state === 'in' });

    const ensureBoard = () => {
      if (board || !d) return;
      board = new Board({
        slots: { space: d.planet?.space_slots ?? 4, air: d.planet?.air_slots ?? 4, land: d.planet?.land_slots ?? 4, water: d.planet?.water_slots ?? 4 },
        fog: !raiders().length, label: `행성 ${d.planet?.name ?? ''}`, speed: 1.25, maxHeight: () => innerHeight - 260, zoom: 'close',
        onPick: (id, side) => {
          if (side === 'defender') { panel = { kind: 'struct', id }; board!.select(id); markRaiders(); paint(); return; }
          const enemy = STRUCT_TYPE[board!.get(id)?.typeId ?? 0] ?? '';
          // Signed in, during a real raid: the selected struct fires on the clicked raider.
          if (!isDemo && liveRaiders.length && panel?.kind === 'struct') {
            const me = panel.id, mine = STRUCT_TYPE[d?.structs.find((x) => x.id === me)?.type ?? 0] ?? me;
            if (wallet.state !== 'unlocked') { toast('공격하려면 지갑 잠금을 해제하세요', 3000); return; }
            if (!confirm(`체인에 서명합니다: ${mine} ${me} → ${enemy} ${id} 공격 (주무기). 보낼까요?`)) return;
            void sign(actions.attack(me, id));
            return;
          }
          notify('적 구조체', `${enemy} · ${isDemo ? '시뮬레이터에서 대응을 연습하세요' : '내 구조체를 먼저 선택하면 공격할 수 있습니다'}`, 'jeok', 'tick');
        },
        onTile: (key, ambit, side) => {
          // Empty tiles on the raider's side are theirs: nothing to build or repair there.
          if (side !== 'defender') return;
          const [kind, , slot] = key.split('|');
          if (kind === 'plan') { panel = { kind: 'build', key, ambit, cat: 'planet', slot: Number(slot) }; }
          else if (kind === 'fleet') { panel = { kind: 'build', key, ambit, cat: 'fleet', slot: Number(key.split('|')[3]) }; }
          else if (kind === 'cmd') {
            // A sunk command ship leaves an empty tile; open it so it can be repaired.
            const wreck = d?.structs.find((x) => x.type === COMMAND_SHIP_ID && x.operating_ambit === ambit);
            if (!wreck) return;
            panel = { kind: 'struct', id: wreck.id };
          } else return;
          board!.select(null);
          paint();
        },
      });
    };
    const markRaiders = () => { if (board && !isDemo) board.markTargets(panel?.kind === 'struct' && liveRaiders.length ? liveRaiders.filter((x) => !(x.status & DESTROYED)).map((x) => x.id) : []); };
    const syncBoard = () => {
      if (!board || !d) return;
      const dd = d;
      void board.idle().then(() => { if (board && d === dd) { board.setStructs([...toBoard(dd), ...raiders()]); board.setFog(!raiders().length); } });
    };

    /* ── Panels ── */
    const objectives = (): Safe => {
      // Three at a time (ready ones first, as activeMissions orders them); the rest live in 전적.
      const ms = activeMissions(ctx(), 3);
      const r = career.rank;
      return html`<section class="card game-panel obj"><div class="card-head"><h2>작전 목표</h2><span class="end mono faint">${r.name} · ${r.xp} XP</span></div>
        ${ms.map((m: MissionState) => html`<div class="mission ${m.ready ? 'ready' : ''}">
          <div class="mission-top"><b>${m.title}</b><span class="mono c-hwang">+${m.xp} XP</span></div>
          <div class="meter"><i style="width:${Math.round((m.done / m.of) * 100)}%;background:${m.ready ? 'var(--hwang)' : 'var(--cheong)'}"></i></div>
          <div class="mission-bot"><span class="dim">${m.ready ? '완료!' : m.of > 1 ? `${m.done} / ${m.of}` : m.hint}</span>
            ${m.ready ? html`<button class="btn gold" style="min-height:32px;padding:0 12px" data-act="claim" data-id="${m.id}">보상 수령</button>` : m.href ? html`<a href="${href(m.href)}" class="mission-go">이동 →</a>` : ''}</div>
        </div>`)}
        ${ms.length ? html`<a class="mission-go" href="${href('/record')}" style="justify-self:end">모든 목표 · 전적 →</a>` : html`<p class="empty">모든 작전을 완료했습니다. 원수의 길은 계속됩니다.</p>`}
      </section>`;
    };

    const decision = (): Safe => {
      const dc = isDemo ? demo.decision : null;
      if (!dc) return html``;
      return html`<section class="card game-panel decision" aria-live="polite"><div class="card-head"><span class="label c-hwang">결단</span><span class="end mono ${dc.left <= 8 ? 'c-jeok' : 'dim'}">${dc.left}블록 남음</span></div>
        <h2>${dc.title}</h2><p class="note">${dc.text}</p>
        <div class="choices">${dc.choices.map((c, i) => html`<button class="btn ${i === 0 ? 'gold' : 'ghost'} choice" data-act="decide" data-i="${i}" ${c.ok === false ? 'disabled' : ''}><b>${c.label} <kbd>${i + 1}</kbd></b><small>${c.effect}</small></button>`)}</div></section>`;
    };
    const advisor = (): Safe => {
      const tasks = [...pow.tasks.values()];
      const tips = isDemo ? advise(career.rank.i) : d ? adviseReal(d, { ready: tasks.filter((t) => t.status === 'ready').length, stuck: tasks.filter((t) => t.status === 'failed' && (t.tries ?? 0) >= 3).length, hashing: pow.running, unlocked: wallet.state === 'unlocked' }) : [];
      if (!tips.length) return html``;
      return html`<section class="card game-panel advisor"><div class="card-head"><h2>참모 보고</h2><span class="end label c-cheong">ADVISOR</span></div>
        <ol class="tips">${tips.map((t) => html`<li class="tip ${t.tone}"><p>${t.text}</p>${t.go === '/console' ? '' : html`<a class="btn ghost" href="${href(t.go)}">${t.cta}</a>`}</li>`)}</ol></section>`;
    };
    /* 지휘관 능력: three active powers, each on its cooldown, unlocked by rank. */
    const abilities = (): Safe => {
      if (!isDemo) return html``;
      const rank = career.rank.i, rally = demo.rallying;
      return html`<section class="card game-panel abilities"><div class="card-head"><h2>지휘관 능력</h2>${rally ? html`<span class="end chip jeok mono">총동원 ${rally}블록</span>` : ''}</div>
        <div class="ab-row">${ABILITIES.map((a) => { const left = demo.abilityLeft(a.id), locked = rank < a.rank, idle = (a.id === 'overshield' && !demo.raid) || (a.id === 'rally' && demo.raid?.eta !== 0); return html`<button class="ab ${left || locked || idle ? '' : 'ready'}" data-act="ability" data-id="${a.id}" ${left || locked || idle ? 'disabled' : ''} title="${a.what}">
          <b>${a.name} <kbd>${a.key}</kbd></b><small>${locked ? `${RANKS[a.rank]} 이상` : left ? `재사용 ${left}블록` : idle ? (a.id === 'rally' ? '습격 함대 도착 후' : '습격 때 사용') : a.what}</small>
          ${left && !locked ? html`<i class="ab-cd" style="width:${Math.round((left / a.cooldown) * 100)}%"></i>` : ''}</button>`; })}</div></section>`;
    };
    const daily = (): Safe => {
      const d = dailyOrders();
      // Done for the day: one line, not a card of finished bars.
      if (d.bonusClaimed) return html`<section class="card game-panel daily"><div class="card-head"><h2>일일 임무</h2><span class="end chip hwang">완수</span></div><p class="note">새 임무까지 ${d.resetsIn}.</p></section>`;
      return html`<section class="card game-panel daily"><div class="card-head"><h2>일일 임무</h2><span class="end mono faint">초기화 ${d.resetsIn}</span></div>
        ${d.orders.map((o) => html`<div class="mission ${o.ready ? 'ready' : ''} ${o.claimed ? 'claimed' : ''}">
          <div class="mission-top"><b>${o.title}</b><span class="mono c-hwang">${o.claimed ? '완료' : `+${DAILY_XP} XP`}</span></div>
          <div class="meter"><i style="width:${Math.round((o.done / o.target) * 100)}%;background:${o.ready || o.claimed ? 'var(--hwang)' : 'var(--cheong)'}"></i></div>
          <div class="mission-bot"><span class="dim">${o.done} / ${o.target}</span>${o.ready ? html`<button class="btn gold" style="min-height:32px;padding:0 12px" data-act="daily" data-id="${o.id}">보상 수령</button>` : ''}</div></div>`)}
        ${d.bonusReady ? html`<button class="btn gold" data-act="dailyBonus">전부 완료 보너스 +${DAILY_BONUS} XP</button>` : d.bonusClaimed ? html`<p class="note c-hwang">오늘의 임무 완수. 내일 새 임무가 옵니다.</p>` : ''}
      </section>`;
    };

    const engine = (): Safe => {
      if (!isDemo) return html``;
      const e = demo.engine;
      const total = ENGINE.reduce((a, x) => a + x.cost, 0);
      return html`<section class="card game-panel engine ${e.done ? 'done' : ''}"><div class="card-head">${pixel(20, 44)}<div><h2>월드 엔진</h2><span class="mono faint">제${demo.era + 1}시대 · ${e.done ? '가동 중 · 은하의 패권' : `${e.stage + 1}단계 · ${e.next!.name}`}</span></div></div>
        <div class="engine-stages">${ENGINE.map((x, i) => html`<span class="${i < e.stage ? 'done' : i === e.stage ? 'now' : ''}" title="${x.perk}">${x.name}</span>`)}</div>
        <div class="meter" style="height:10px"><i style="width:${Math.min(100, (e.paid / total) * 100)}%;background:linear-gradient(90deg,var(--hwang-line),var(--hwang))"></i></div>
        <span class="mono dim" style="font-size:12px">${n(Math.floor(e.paid))} / ${n(total)} α${e.next ? ` · 다음 보상: ${e.next.perk}` : ''}</span>
        ${e.done ? html`<button class="btn gold lg era-btn" data-act="newEra"><span>새 시대 열기 · 제${demo.era + 2}시대</span><small>기지와 은하가 처음부터 · 생산 +${15 * (demo.era + 1)}% 영구 · 연구·교리·길드 유지 · 경쟁 세력도 더 빨리 큽니다</small></button>` : html`<div style="display:flex;gap:6px;flex-wrap:wrap">${[10, 50].map((v) => html`<button class="btn gold" style="min-height:34px;padding:0 10px" data-act="engine" data-g="${v}" ${demo.state.alpha >= v ? '' : 'disabled'}>${v} α</button>`)}<button class="btn ghost" style="min-height:34px;padding:0 10px" data-act="engine" data-g="all" ${demo.state.alpha >= 1 ? '' : 'disabled'}>전부</button></div>`}
      </section>`;
    };

    const radar = (): Safe => {
      const r = isDemo ? demo.raid : null;
      const live = d?.active_raid;
      const blips: Safe[] = [];
      if (r) {
        const dist = r.eta === 0 ? 8 : 18 + r.eta * 11;
        blips.push(html`<i class="blip enemy" style="left:calc(50% + ${dist * 0.8}px);top:calc(50% - ${dist * 0.5}px)"></i><span class="blip-l" style="left:calc(50% + ${dist * 0.8 + 10}px);top:calc(50% - ${dist * 0.5 + 6}px)">${r.fleetId} · ${r.eta ? r.eta + '블록' : '교전'}</span>`);
      }
      if (live && !r) blips.push(html`<i class="blip enemy" style="left:calc(50% + 10px);top:calc(50% - 8px)"></i><span class="blip-l" style="left:calc(50% + 20px);top:calc(50% - 14px)">${live.fleet_id} · 습격</span>`);
      return html`<section class="card game-panel"><div class="card-head"><h2>위협 레이더</h2><span class="end label ${blips.length ? 'c-jeok' : 'c-cheong'}">${blips.length ? `적 ${blips.length}` : '이상 없음'}</span></div>
        <div class="radar" role="img" aria-label="${blips.length ? '적 함대 접근 중' : '주변에 적 없음'}"><div class="radar-sweep"></div><i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i><i class="blip home"></i>${blips}</div>
        ${isDemo ? html`<a class="btn ghost" href="${href('/galaxy')}" style="justify-content:space-between">은하 지도 · 정찰 <kbd>P</kbd></a>` : ''}
        ${isDemo && !r ? html`<p class="note">다음 정찰 보고까지 약 ${demo.state.nextRaid}블록. 습격 전에 광석을 정제하세요 — 알파는 약탈되지 않습니다.</p>` : ''}
        ${r && r.eta > 0 ? html`<p class="note c-jeok">${r.name} · 함대 ${r.structs.length}기 · ${r.eta}블록 후 도착. 정제되지 않은 광석 ${n(Math.floor(demo.state.ore))}이 노출되어 있습니다.</p>` : ''}
      </section>`;
    };

    const feed = (): Safe => html`<section class="card game-panel feed"><div class="card-head"><h2>전황</h2><span class="end label c-cheong">● 실시간</span></div>
      ${d?.activity.length ? html`<ol class="log" style="padding:0">${d.activity.slice(0, 12).map((a) => {
        const bad = /attack|raid|cut|depart|arrive/.test(a.category);
        return html`<li class="${bad ? 'bad' : ''}"><span class="faint">${a.block_height ? '#' + String(a.block_height).slice(-4) : new Date(a.time).toLocaleTimeString('ko-KR')}</span> <span class="${bad ? 'c-jeok' : a.category.includes('refine') ? 'c-hwang' : 'c-cheong'}">${activityLabel(a.category)}</span> <span class="dim">${typeof a.detail === 'string' && a.detail.length < 30 ? a.detail : a.planet_id}</span></li>`;
      })}</ol>` : html`<p class="empty" style="padding:8px">기록이 없습니다.</p>`}</section>`;

    let leaders: LeaderPlayer[] | null = null;
    const standings = (): Safe => {
      if (!isDemo) {
        if (!leaders?.length) return html``;
        const mine = leaders.findIndex((l) => l.player_id === pid);
        return html`<section class="card game-panel"><div class="card-head"><h2>세력 순위</h2><span class="end label c-hwang">ALPHA</span></div>
          <ol class="standings">${leaders.slice(0, 8).map((l, i) => html`<li class="${l.player_id === pid ? 'me' : ''}"><span class="rk mono">${i + 1}</span><div><b>${l.username || l.player_id}</b><small class="mono">알파 ${micro(l.alpha_balance_p, 0)} g</small></div>${l.player_id === pid ? html`<span class="chip cheong">나</span>` : ''}</li>`)}</ol>
          ${mine < 0 ? html`<p class="note">아직 상위 ${leaders.length}위 밖입니다. 정제해서 알파를 쌓으세요.</p>` : ''}
          <a class="btn ghost" href="${href('/galaxy')}" style="justify-content:space-between">은하 지도 <kbd>P</kbd></a></section>`;
      }
      const me = { id: DEMO_ID, name: '나 · 한빛 IV', worth: demo.netWorth(), fleet: d?.structs.filter((x) => isFleetType(x.type) && !(x.status & DESTROYED)).length ?? 0, me: true };
      const rows = [me, ...demo.rivals().map((r) => ({ id: r.id, name: r.vassal != null ? `♛ ${r.name}` : r.name, worth: demo.rivalWorth(r), fleet: r.fleet, me: false, ore: r.ore }))].sort((a, b) => b.worth - a.worth);
      return html`<section class="card game-panel"><div class="card-head"><h2>세력 순위</h2><span class="end label c-hwang">POWER</span></div>
        ${hegemonyMeter()}
        <ol class="standings">${rows.map((r, i) => html`<li class="${r.me ? 'me' : ''}"><span class="rk mono">${i + 1}</span>${raw(portraitHtml(r.me ? myPfp() : seededPfp(r.id), 32))}<div><b>${r.name}</b><small class="mono">세력 ${n(Math.round(r.worth))} · 함대 ${r.fleet}기${!r.me && 'ore' in r ? ` · 광석 ${n(Math.floor((r as { ore: number }).ore))}` : ''}</small></div>
          ${r.me ? html`<span class="chip cheong">나</span>` : html`<a class="btn danger" style="min-height:34px;padding:0 10px" href="${href('/sim?raid=' + r.id)}">습격</a>`}</li>`)}</ol>
        <p class="note">순위 = 알파 + 광석 가치 + 구조체 + 연구. 습격은 내 함대로 직접 출격합니다.</p></section>`;
    };

    /* 작업 증명: the work this commander owes the chain, hashed here and sent when it qualifies. */
    const KIND_KO: Record<string, string> = { BUILD: '건설', MINE: '채굴', REFINE: '정제', RAID: '습격' };
    const powCard = (): Safe => {
      const tasks = [...pow.tasks.values()];
      const canSign = wallet.state === 'unlocked';
      return html`<section class="card game-panel pow"><div class="card-head"><h2>작업 증명</h2><span class="end mono ${pow.running ? 'c-cheong' : 'faint'}">${pow.running ? `● ${n(Math.round(pow.rate))} H/s · ${pow.threads}스레드` : '대기'}</span></div>
        ${tasks.length ? tasks.map((t) => {
          const need = pow.required(t), have = t.best?.zeros ?? 0;
          const wait = t.best ? blocksUntil(t, have, pow.height) : Infinity;
          const label = t.status === 'sent' ? '전송됨' : t.status === 'submitting' ? '전송 중…' : t.status === 'ready' ? '제출 가능' : t.status === 'failed' ? '재시도 대기' : t.status === 'hashing' ? (Number.isFinite(wait) ? `약 ${wait}블록 후` : '탐색 중') : '대기';
          return html`<div class="pow-task ${t.status}"><div class="mission-top"><b>${KIND_KO[t.kind] ?? t.kind} · <span class="mono">${t.objectId}</span></b><span class="mono ${t.status === 'ready' || t.status === 'sent' ? 'c-cheong' : 'dim'}">${label}</span></div>
            <div class="pow-bar" title="필요 0의 개수 ${need} · 찾은 최고 ${have}"><i style="width:${Math.min(100, (have / Math.max(1, need)) * 100)}%"></i></div>
            <div class="mission-bot"><span class="mono dim">선행 0 ${have}개 / 필요 ${need}개 · ${n(t.hashes)} 해시</span>${(t.status === 'ready' && !pow.autoSubmit) || (t.status === 'failed' && (t.tries ?? 0) >= 3) ? html`<button class="btn primary" style="min-height:30px;padding:0 10px" data-act="powSubmit" data-id="${t.id}" ${canSign ? '' : 'disabled'}>${t.status === 'failed' ? '다시 제출' : '제출'}</button>` : ''}</div>
            ${t.error ? html`<span class="c-jeok" style="font-size:12px">${t.error.slice(0, 80)}</span>` : ''}</div>`;
        }) : html`<p class="note">진행 중인 작업이 없습니다. 건설·채굴·정제를 시작하면 여기서 증명을 계산합니다.</p>`}
        ${tasks.length ? html`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button class="btn ${pow.running ? 'ghost' : 'primary'}" data-act="powToggle">${pow.running ? '해시 정지' : '해시 시작'}</button>
          <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" data-act="powAuto" ${pow.autoSubmit ? 'checked' : ''}> 자동 제출</label></div>
          ${canSign ? '' : html`<p class="note">증명을 제출하려면 지갑 잠금을 해제하세요. 해시 계산은 지금도 할 수 있습니다.</p>`}` : ''}
      </section>`;
    };
    const paintPow = () => { const h = root.querySelector('#pow-host'); if (h) h.innerHTML = powCard().s; };

    const inspector = (): Safe => {
      if (!panel || !d) return html``;
      if (panel.kind === 'struct') {
        const id = panel.id;
        const s = d.structs.find((x) => x.id === id);
        if (!s) return html``;
        const t = TYPES_BY_ID[s.type];
        const online = (s.status & ONLINE) !== 0, dead = (s.status & DESTROYED) !== 0;
        const building = isDemo ? demo.buildProgress(s.id) : null;
        const canSign = isDemo || wallet.state === 'unlocked';
        return html`<section class="card game-panel inspector"><div class="card-head">${pixel(s.type)}<div><h2>${STRUCT_TYPE[s.type] ?? t?.type}</h2><span class="mono faint">${s.id} · ${AMBIT[s.operating_ambit] ?? ''} ${s.slot + 1}</span></div><button class="end hud-btn" data-act="close" aria-label="닫기">✕</button></div>
          <div class="g2" style="gap:8px">
            <div class="stat"><small>내구도</small><strong class="${dead ? 'c-jeok' : ''}">${dead ? '파괴됨' : `${s.health} / ${t?.maxHealth}`}</strong></div>
            <div class="stat"><small>전력 소비</small><strong>${watts(t?.passiveDraw)}</strong></div>
            <div class="stat"><small>상태</small><strong class="${building != null ? 'c-warn' : online ? 'c-cheong' : 'c-hwang'}">${building != null ? `건설 ${Math.round(building * 100)}%` : online ? '가동' : '꺼짐'}</strong></div>
            <div class="stat"><small>무기</small><strong style="font-size:13px">${t?.primaryWeaponDamage ? `${t.primaryWeaponDamage}×${t.primaryWeaponShots} 피해` : '없음'}</strong></div>
            ${isDemo && (demo.state.structs.find((x) => x.id === s.id)?.kills ?? 0) > 0 ? (() => { const ds = demo.state.structs.find((x) => x.id === s.id)!, k = ds.kills!, v = vetRank(k); return html`<div class="stat"><small>전과${ds.name ? ` · 「${ds.name}」` : ''}</small><strong style="font-size:13px" class="c-hwang">${v ? `베테랑 ${'★'.repeat(v)} · ` : ''}격파 ${k}${v >= 2 ? ' · 방어 사격 +1' : ''}</strong></div>
              ${v ? html`<form class="ship-name" data-act="nameShip" data-on="submit" data-id="${s.id}"><input class="input" name="n" maxlength="12" placeholder="함선 이름" value="${ds.name ?? ''}" aria-label="함선 이름"><button class="btn ghost" type="submit">이름 붙이기</button></form>` : ''}`; })() : ''}
          </div>
          ${t ? html`<p class="note">${[t.passiveWeaponry, t.unitDefenses, t.planetaryDefenses, t.planetaryMining, t.planetaryRefinery, t.powerGeneration].filter((v) => v && !/^no[A-Z]/.test(String(v))).join(' · ') || '특수 능력 없음'}</p>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${!dead && building == null ? html`<button class="btn ${online ? 'ghost' : 'primary'}" data-act="power" data-id="${s.id}" ${canSign ? '' : 'disabled'}>${online ? '전원 끄기' : '전원 켜기'} <kbd>F</kbd></button>` : ''}
            ${isDemo && !dead && online && building == null && OC.types.includes(s.type) ? (() => { const oc = !!demo.state.structs.find((x) => x.id === s.id)?.oc; return html`<button class="btn ${oc ? 'danger' : 'gold'} oc-btn" data-act="overclock" data-id="${s.id}"><span>${oc ? '과부하 해제' : '과부하 운전'} <kbd>V</kbd></span><small>${oc ? `가동 중 · 블록당 ${Math.round(OC.wear * 100)}% 손상 위험` : s.type === 20 ? `발전 ×${OC.gen} · 손상 위험 ${Math.round(OC.wear * 100)}%/블록` : `생산 ×${OC.out} · 전력 ×${OC.power} · 손상 위험 ${Math.round(OC.wear * 100)}%/블록`}</small></button>`; })() : ''}
            ${isDemo && (dead || s.health < (t?.maxHealth ?? 0)) ? html`<button class="btn gold" data-act="repair" data-id="${s.id}">수리 · ${demo.repairCost(s.id).toFixed(1)} g <kbd>R</kbd></button>` : ''}
            ${!isDemo && !canSign ? html`<span class="note">전원을 바꾸려면 지갑 잠금을 해제하세요.</span>` : ''}
          </div>
          ${!isDemo && !dead && building == null ? html`<div class="guard-row">
            ${s.protected_struct_id ? html`<span class="chip cheong">방어 중 → ${STRUCT_TYPE[d.structs.find((x) => x.id === s.protected_struct_id)?.type ?? 0] ?? ''} ${s.protected_struct_id}</span>
              <button class="btn ghost" data-act="guardClear" data-id="${s.id}" ${canSign ? '' : 'disabled'}>방어 해제</button>`
            : html`<label class="field" style="flex:1 1 160px"><span>방어할 아군</span><select class="input" data-act="guardPick" data-on="change">${d.structs.filter((x) => x.id !== s.id && !(x.status & DESTROYED)).map((x) => html`<option value="${x.id}">${STRUCT_TYPE[x.type] ?? x.type} ${x.id}</option>`)}</select></label>
              <button class="btn primary" data-act="guardSet" data-id="${s.id}" ${canSign ? '' : 'disabled'}>방어 지정</button>`}
          </div>` : ''}
          </section>`;
      }
      const { ambit, cat, slot } = panel;
      const options = STRUCT_TYPES.filter((t) => t.category === cat && (t.possibleAmbit & AMBIT_FLAG[ambit]) !== 0 && t.id !== COMMAND_SHIP_ID && t.id <= 20);
      const free = isDemo ? demo.capacityKw() - demo.structsKw() - demo.soldKw() : kw(d.power?.total_capacity) - kw(d.power?.total_load);
      return html`<section class="card game-panel inspector"><div class="card-head"><div><h2>건설 · ${AMBIT[ambit]} ${slot + 1}</h2><span class="mono faint">${cat === 'planet' ? '행성 슬롯' : '함대 슬롯'} · 여유 전력 ${free.toFixed(2)} kW</span></div><button class="end hud-btn" data-act="close" aria-label="닫기">✕</button></div>
        <div class="build-grid">${options.map((t) => {
          const need = (t.passiveDraw * 1.2) / 1e6, ok = !isDemo || need <= free;
          return html`<button class="build-opt" data-act="build" data-type="${t.id}" ${ok ? '' : 'disabled'} title="${t.type}">${pixel(t.id, 48)}<b>${STRUCT_TYPE[t.id]}</b><span class="mono ${ok ? 'faint' : 'c-jeok'}">${need.toFixed(2)} kW · ${Math.max(3, Math.round(t.buildDifficulty / 140))}블록</span></button>`;
        })}</div>
        ${isDemo ? '' : html`<p class="note">착공은 체인에 서명해 보냅니다 (충전 필요). 완공에 필요한 작업 증명은 이 화면의 <b>작업 증명</b> 카드가 계산해 자동 제출합니다.${wallet.state === 'unlocked' ? '' : ' 지갑 잠금을 먼저 해제하세요.'}</p>`}
      </section>`;
    };

    const alarm = (): Safe => {
      const r = isDemo ? demo.raid : null;
      const live = d?.active_raid;
      if (!r && !live) return html``;
      const eta = r?.eta ?? 0;
      return html`<section class="raid-alarm ${eta ? '' : 'live'}" role="alert">
        <strong>${eta ? `▲ 적 함대 접근 · ${eta}블록` : '▲ 행성 습격 진행 중'}</strong>
        <span>${r ? `${r.name} 함대 ${r.fleetId} · ${r.structs.length}기` : `함대 ${live!.fleet_id}${live!.fleet_owner ? ` (${live!.fleet_owner})` : ''}`} · 노출된 광석 <b class="mono">${n(Math.floor(Number(d?.player.ore ?? 0)))}</b></span>
        <span class="end" style="display:flex;gap:8px;flex-wrap:wrap">${isDemo ? html`<button class="btn gold" data-act="refineAll" style="min-height:36px">정제소 가동 <kbd>Q</kbd></button>` : ''}<a class="btn danger" href="${href('/sim')}" style="min-height:36px">방어 시뮬레이션</a></span>
      </section>`;
    };

    const header = (): Safe => {
      const sh = d?.shield_health;
      const segs = 20, on = sh == null ? 0 : Math.round((sh / 100) * segs);
      return html`<div class="planet-head">
        <div><span class="label c-cheong">행성 ${d?.planet?.id ?? '—'} · 본거지</span><h1>${d?.planet?.name || `행성 ${d?.player.planet_id || '—'}`}</h1></div>
        <div class="shield"><div class="shield-l"><span class="label">궤도 보호막</span><span class="mono c-white">${sh == null ? '—' : sh + '%'}</span></div>
          <div class="shield-bar">${Array.from({ length: segs }, (_, i) => html`<i class="${i < on ? (sh! < 35 ? 'low' : 'on') : ''}"></i>`)}</div></div>
        <div class="vein"><span class="label">남은 광맥</span><span class="mono c-hwang">${n(d?.planet?.undiscovered_ore)}</span></div>
      </div>`;
    };

    const commandBar = (): Safe => {
      const pw = d?.power;
      const use = pw ? Number(pw.total_load) / Math.max(1, Number(pw.total_capacity)) : 0;
      const cmds: [string, string, string, string, string][] = [
        ['E', '건설', '빈 슬롯', 'buildNext', 'neutral'],
        ['Q', '정제', isDemo ? `+${demo.rates().alpha.toFixed(2)} α/블록` : '알파 확보', 'refineAll', 'gold'],
        ['I', '주입', isDemo ? '1 g → 1 kW' : '리액터', 'infuse', 'neutral'],
        ['G', '전력망', `${Math.round(use * 100)}% 부하`, 'nav:/energy', use > 0.9 ? 'danger' : 'neutral'],
        ['T', '거래', isDemo ? `${demo.price.toFixed(3)} α/kW` : '전력 시장', 'nav:/market', 'neutral'],
        ['B', '전투', '시뮬레이터', 'nav:/sim', 'danger'],
      ];
      return html`<nav class="cmdbar" aria-label="명령">${cmds.map(([k, t, s, act, tone]) => html`<button class="cmd ${tone}" data-act="${act.startsWith('nav:') ? 'nav' : act}" data-to="${act.slice(4)}"><kbd>${k}</kbd><span><b>${t}</b><small class="mono">${s}</small></span></button>`)}</nav>`;
    };

    const view = (): Safe => html`
      ${alarm()}
      <div class="bridge">
        <aside class="bridge-l">${decision()}${advisor()}${daily()}${objectives()}${engine()}${radar()}</aside>
        <section class="bridge-c card game-panel" aria-label="행성">
          ${header()}
          <div id="bd-host" class="bd-host"></div>
          <div class="planet-foot"><span>보유 광석 <b class="mono c-white">${n(Math.floor(Number(d?.player.ore ?? 0)))}</b> <span class="faint">(약탈 가능)</span></span><span>알파 <b class="mono c-hwang">${micro(d?.player.alpha)} g</b> <span class="faint">(안전)</span></span><span>블록 <b class="mono c-white">${d?.height == null ? '—' : '#' + n(d.height)}</b></span><span class="faint" style="margin-left:auto">빈 슬롯을 누르면 건설 · 구조체를 누르면 정보</span></div>
        </section>
        <aside class="bridge-r">${abilities()}${inspector()}${isDemo ? '' : html`<div id="pow-host">${powCard()}</div>`}${standings()}${feed()}</aside>
      </div>
      ${commandBar()}`;

    const paint = () => {
      if (!root.isConnected || !d) return;
      ensureBoard();
      mount(root, view(), handlers);
      const host = root.querySelector('#bd-host');
      if (host && board) board.attach(host);
      syncBoard();
      tiles();
    };

    const tiles = () => {
      if (!d) return;
      const pw = d.power;
      const use = pw ? Number(pw.total_load) / Math.max(1, Number(pw.total_capacity)) : 0;
      const r = isDemo ? demo.rates() : null;
      const alive = d.structs.filter((s) => !(s.status & DESTROYED)).length;
      setTiles([
        { label: '알파 매터', value: micro(d.player.alpha) + ' g', num: Number(d.player.alpha) / 1e6, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)', href: '/market', delta: r ? `+${r.alpha.toFixed(2)}/블록` : '' },
        { label: '광석 · 약탈 위험', value: n(d.player.ore), num: Math.floor(Number(d.player.ore)), fmt: (v) => n(Math.round(v)), delta: r ? `${r.ore >= 0 ? '+' : ''}${r.ore.toFixed(1)}/블록` : '', deltaTone: r && r.ore > 0 ? 'var(--warn)' : 'var(--cheong)', alert: !!(isDemo && demo.raid && Number(d.player.ore) > 0) },
        { label: `전력 · ${Math.round(use * 100)}%`, value: pw ? `${watts(Number(pw.total_load))} / ${watts(Number(pw.total_capacity))}` : '—', tone: use > 0.95 ? 'var(--jeok)' : use > 0.8 ? 'var(--warn)' : 'var(--cheong)', href: '/energy', alert: use > 0.95 },
        { label: '구조체', value: `${alive}`, num: alive, fmt: (v) => n(Math.round(v)) },
        { label: '보호막', value: d.shield_health == null ? '—' : d.shield_health + '%', tone: (d.shield_health ?? 100) < 35 ? 'var(--jeok)' : 'var(--cheong-hi)' },
      ]);
    };

    const err = (m: string | null) => { if (m) { sfx.play('error'); toast(m, 3000); return true; } return false; };
    // One signature in flight per struct and order: a double click must not sign the same move twice.
    const inFlight = new Set<string>();
    const signOnce = (key: string, send: () => Promise<string>) => { if (inFlight.has(key)) return; inFlight.add(key); void sign(send()).finally(() => inFlight.delete(key)); };
    const sign = (p: Promise<string>) => p.then((h) => { sfx.play('confirm'); toast(`전송됨 · ${h.slice(0, 10)}…`); }).catch((e) => { sfx.play('error'); toast('실패: ' + (e as Error).message, 5000); });

    const firstEmpty = (): Panel => {
      if (!d) return null;
      for (const a of ['land', 'water', 'air', 'space'] as Ambit[]) {
        const count = Number((d.planet as unknown as Record<string, number> | null)?.[`${a}_slots`] ?? 4);
        for (let i = 0; i < count; i++) if (!d.structs.some((s) => !isFleetType(s.type) && s.operating_ambit === a && s.slot === i && !(s.status & DESTROYED))) return { kind: 'build', key: `plan|${a}|${i}`, ambit: a, cat: 'planet', slot: i };
      }
      return null;
    };

    const handlers = {
      claim: (el: HTMLElement) => { career.claim(el.dataset.id!); paint(); },
      daily: (el: HTMLElement) => { claimDaily(el.dataset.id!); paint(); },
      decide: (el: HTMLElement) => {
        const e = demo.decide(Number(el.dataset.i));
        if (e) { sfx.play('error'); toast(e); return; }
        sfx.play('confirm'); career.award(15, '결단'); refresh();
      },
      dailyBonus: () => { claimDailyBonus(); paint(); },
      powToggle: () => { if (pow.running) pow.stop(); else { pow.start(); sfx.play('confirm'); } paintPow(); },
      powAuto: (el: HTMLElement) => { pow.autoSubmit = (el as HTMLInputElement).checked; paintPow(); },
      powSubmit: (el: HTMLElement) => { void pow.submit(el.dataset.id!); },
      engine: (el: HTMLElement) => {
        const g = el.dataset.g === 'all' ? Math.floor(demo.state.alpha) : Number(el.dataset.g);
        if (err(demo.buildEngine(g))) return;
        sfx.play('build'); float(el, `+${g} α`, 'var(--hwang)', true); refresh();
      },
      close: () => { panel = null; board?.select(null); paint(); },
      nav: (el: HTMLElement) => go(el.dataset.to!),
      power: (el: HTMLElement) => {
        const id = el.dataset.id!;
        if (isDemo) { if (!err(demo.toggle(id))) { sfx.play('confirm'); refresh(); } return; }
        const s = d?.structs.find((x) => x.id === id);
        if (s) signOnce(`power|${id}`, () => (s.status & ONLINE) ? actions.structDeactivate(id) : actions.structActivate(id));
      },
      guardPick: () => { /* read on 방어 지정 */ },
      guardSet: (el: HTMLElement) => {
        const ward = root.querySelector<HTMLSelectElement>('[data-act="guardPick"]')?.value;
        if (!ward) return;
        signOnce(`guard|${el.dataset.id}`, () => actions.defenseSet(el.dataset.id!, ward));
      },
      guardClear: (el: HTMLElement) => { signOnce(`guard|${el.dataset.id}`, () => actions.defenseClear(el.dataset.id!)); },
      overclock: (el: HTMLElement) => {
        const id = el.dataset.id!;
        if (err(demo.overclock(id))) return;
        const on = demo.state.structs.find((x) => x.id === id)?.oc;
        sfx.play(on ? 'alarm' : 'confirm'); if (on) shake('sm');
        float(el, on ? '과부하!' : '정상 운전', on ? 'var(--jeok-hi)' : 'var(--cheong-hi)');
        refresh();
      },
      newEra: () => {
        if (!confirm(`제${demo.era + 2}시대를 엽니다. 기지, 알파, 속국이 모두 처음으로 돌아가고 생산 보너스가 영구히 총 +${15 * (demo.era + 1)}%가 됩니다. 진행할까요?`)) return;
        if (err(demo.newEra())) return;
        sfx.play('victory'); shake('lg');
        banner({ kicker: '새 시대', title: `제${demo.era + 1}시대`, sub: `생산 +${15 * demo.era}% · 은하가 다시 깨어납니다`, tone: 'gold', ms: 3600 });
        career.award(500, `제${demo.era + 1}시대 개막`);
        refresh();
      },
      ability: (el: HTMLElement) => {
        const id = el.dataset.id as AbilityId, a = ABILITIES.find((x) => x.id === id)!;
        if (err(demo.useAbility(id, career.rank.i))) return;
        sfx.play(id === 'rally' ? 'alarm' : id === 'overshield' ? 'shield' : 'coin'); if (id === 'rally') shake('sm');
        float(el, a.name, 'var(--hwang)', true); refresh();
      },
      nameShip: (el: HTMLElement) => {
        const n = String(new FormData(el as HTMLFormElement).get('n') ?? '');
        if (err(demo.nameShip(el.dataset.id!, n))) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        sfx.play('confirm'); toast(n.trim() ? `「${n.trim().slice(0, 12)}」` : '이름을 지웠습니다'); refresh();
      },
      repair: (el: HTMLElement) => { if (!err(demo.repair(el.dataset.id!))) { sfx.play('build'); float(el, '수리 완료', 'var(--cheong-hi)'); refresh(); } },
      build: (el: HTMLElement) => {
        if (!panel || panel.kind !== 'build') return;
        const p = panel;
        if (!isDemo) {
          if (wallet.state !== 'unlocked') { sfx.play('error'); toast('착공하려면 지갑 잠금을 해제하세요', 3000); return; }
          const type = Number(el.dataset.type);
          (el as HTMLButtonElement).disabled = true;
          void actions.structBuild(pid, type, p.ambit, p.slot)
            .then((h) => { sfx.play('build'); notify('착공 전송', `${STRUCT_TYPE[type]} · ${AMBIT[p.ambit]} ${p.slot + 1} · ${h.slice(0, 10)}…`, 'cheong', null); panel = null; if (!pow.running) pow.start(); void load(); })
            .catch((e) => { sfx.play('error'); toast('착공 실패: ' + (e as Error).message, 5000); (el as HTMLButtonElement).disabled = false; });
          return;
        }
        if (!err(demo.build(Number(el.dataset.type), p.ambit, p.slot, p.cat))) {
          sfx.play('build');
          notify('착공', `${STRUCT_TYPE[Number(el.dataset.type)]} · ${AMBIT[p.ambit]} ${p.slot + 1}`, 'cheong', null);
          panel = null; refresh();
        }
      },
      buildNext: () => { const p = firstEmpty(); panel = p; if (p?.kind === 'build' && board) board.ping(p.key); else if (!panel) toast('빈 행성 슬롯이 없습니다'); paint(); },
      refineAll: () => {
        if (!isDemo) { go('/energy'); return; }
        const off = demo.state.structs.filter((x) => x.type === 15 && !x.online && x.building == null && x.hp > 0);
        if (!off.length) {
          if (!demo.state.structs.some((x) => x.type === 15 && x.hp > 0)) { panel = firstEmpty(); toast('정제소가 없습니다 — 지상 슬롯에 정제소를 건설하세요', 3500); paint(); return; }
          toast('모든 정제소가 이미 가동 중입니다'); return;
        }
        for (const x of off) if (err(demo.toggle(x.id))) return;
        sfx.play('confirm'); notify('정제 개시', `정제소 ${off.length}기 가동 · 광석이 알파로 바뀝니다`, 'hwang', null); refresh();
      },
      infuse: () => {
        if (!isDemo) { go('/energy'); return; }
        if (!err(demo.infuse(1))) { sfx.play('coin'); notify('리액터 주입', '알파 1 g → 용량 +1 kW', 'hwang', null); refresh(); }
      },
    };

    const offKeys = keys.scope({
      z: () => board?.toggleZoom(),
      e: () => handlers.buildNext(),
      q: () => handlers.refineAll(),
      i: () => handlers.infuse(),
      f: () => { if (panel?.kind === 'struct') handlers.power({ dataset: { id: panel.id } } as unknown as HTMLElement); },
      v: () => { const b = root.querySelector<HTMLElement>('[data-act="overclock"]'); if (!b) return false; handlers.overclock(b); },
      r: () => { if (isDemo && panel?.kind === 'struct') handlers.repair(document.querySelector('[data-act="repair"]') ?? document.body); },
      Escape: () => handlers.close(),
      ...Object.fromEntries(ABILITIES.map((a) => [a.key, () => { if (!isDemo) return false; const b = root.querySelector<HTMLElement>(`[data-act="ability"][data-id="${a.id}"]`); if (!b || (b as HTMLButtonElement).disabled) return false; handlers.ability(b); }])),
      '1': () => (isDemo && demo.decision ? handlers.decide({ dataset: { i: '0' } } as unknown as HTMLElement) : false),
      '2': () => (isDemo && demo.decision ? handlers.decide({ dataset: { i: '1' } } as unknown as HTMLElement) : false),
    });
    offs.push(offKeys);

    // Mid-typing a ship's name, repaints wait (they'd wipe the field and break Korean input) and run as
    // soon as the field lets go of focus.
    let pending = false;
    const typing = () => { const a = document.activeElement; return a instanceof HTMLElement && !!a.closest('.ship-name') && root.contains(a); };
    const repaint = () => { if (typing()) { pending = true; return; } pending = false; paint(); };
    const refresh = () => { if (isDemo) { d = demo.dashboard(); repaint(); } };
    // Focus moving within the name form (to its button) isn't leaving it: the click must land first.
    root.addEventListener('focusout', (e) => { const to = (e as FocusEvent).relatedTarget as Element | null; if (to?.closest?.('.ship-name')) return; if (pending) setTimeout(() => { if (pending && !typing()) { pending = false; paint(); } }, 0); });
    const load = async () => {
      try {
        d = isDemo ? demo.dashboard() : await dashboard(pid);
        if (!isDemo) {
          // A failed work read must not look like "all done" and drop the proofs in progress.
          if (d.work) pow.sync(d.work, d.height);
          const owner = d.active_raid?.fleet_owner;
          liveRaiders = owner && owner !== pid ? (await guildApi.structsOf(owner).catch(() => [] as StructRow[])).filter((x) => isFleetType(x.type) && !(x.status & DESTROYED) && (!d!.active_raid?.fleet_id || x.location_id === d!.active_raid.fleet_id)) : [];
        }
        paint();
      } catch (e) { mount(root, errorCard(e)); }
    };
    await load();
    if (!isDemo) void guildApi.leaderboard('player', 10).then((l) => { leaders = l; paint(); }).catch(() => null);

    if (isDemo) {
      demo.run();
      offs.push(demo.onBlock(refresh));
      offs.push(demo.onAttack((detail) => { board?.playAttack(detail); }));
      // First visit to the demo: a short briefing.
      if (demo.state.seq === 0) setTimeout(() => banner({ kicker: '데모 함교', title: '한빛 IV 지휘', sub: '광석을 캐고, 정제하고, 습격을 막아내세요', tone: 'cheong', ms: 3200 }), 300);
      // First command: a short spotlight tour of the bridge.
      if (!tourSeen('bridge')) setTimeout(() => { if (root.isConnected) runTour('bridge', BRIDGE_TOUR); }, demo.state.seq === 0 ? 3900 : 600);
    } else {
      const again = throttled(() => void load(), 2000);
      offs.push(onGrass(`structs.grid.player.${pid}.>`, again), onGrass(`structs.player.*.${pid}`, again));
      if (d?.player.planet_id) offs.push(onGrass(`structs.planet.${d.player.planet_id}.>`, (e) => {
        again();
        if (e.category === 'struct_attack' && e.data.detail && board) board.playAttack(e.data.detail as never);
        const key = e.category + ':' + String(e.data.status ?? '');
        if (e.category === 'raid_status' && key !== lastRaidKey) { lastRaidKey = key; sfx.play('alarm'); flash(); }
      }));
    }
    offs.push(career.onChange(() => repaint()));
    // The proof card follows every hash; the advisor's proof tips follow at most every few seconds.
    let advisedAt = 0;
    const repaintAdvisor = () => { const el = root.querySelector('.advisor'); if (el && Date.now() - advisedAt > 3000) { advisedAt = Date.now(); el.outerHTML = advisor().s; } };
    if (!isDemo) offs.push(pow.onChange(() => { paintPow(); repaintAdvisor(); }));
    return () => { offs.forEach((f) => f()); board?.dispose(); setTiles([]); };
  },
};
export default screen;
