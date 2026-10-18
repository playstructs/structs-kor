/* 지휘 함교 (Command Bridge): the commander's planet on the game's own battle board, with the
 * objectives, defence by ambit, live feed and a hotkey command bar around it. Live data comes from one
 * read (REQ-AGG-1) refreshed by GRASS events; the demo base (src/game/demo.ts) feeds the same view
 * block by block, raids included. */
import type { Screen } from '../router';
import { share } from '../social/share';
import { baseSituation } from '../social/situations';
import { href, go } from '../router';
import { html, mount, n, watts, micro, raw, esc, toast, type Safe } from '../ui/dom';
import { needSession, errorCard, loading } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { dashboard, type Dashboard } from '../api/planned';
import { actions } from '../api/actions';
import { guildApi, type LeaderPlayer, type StructRow } from '../api/guild';
import { wallet } from '../wallet/wallet';
import { session } from '../api/session';
import { onGrass, throttled } from '../grass/grass';
import { AMBIT, STRUCT_TYPE, activityLabel } from '../i18n/ko';
import { TYPES_BY_ID, STRUCT_TYPES, AMBITS, AMBIT_FLAG, COMMAND_SHIP_ID, type Ambit } from '../data/catalogue';
import { Board, type BoardStruct, type BoardWork } from '../game/map/board';
import { demo, DEMO_ID, ENGINE, OC, vetRank, ABILITIES, REFITS, type AbilityId, type RefitId } from '../game/demo';
import { hegemonyMeter } from '../game/meter';
import { advise, adviseReal } from '../game/advisor';
import { career, activeMissions, tutorialDone, RANKS, type MissionState } from '../game/progress';
import { sfx } from '../game/sfx';
import { banner, notify, float, shake } from '../game/fx';
import { keys } from '../game/keys';
import { spriteHtml, tileUrl, AMBIT_BG } from '../game/map/art';
import { portraitHtml, seededPfp, myPfp } from '../game/portrait';
import { pow, blocksUntil } from '../pow/engine';
import { estimateBlocks, BLOCK_SECONDS } from '../pow/work';
import { runTour, tourSeen, BRIDGE_TOUR } from '../game/tour';
import { dailyOrders, claimDaily, claimDailyBonus, DAILY_XP, DAILY_BONUS } from '../game/daily';

const DESTROYED = 32, ONLINE = 4;
const isFleetType = (t: number) => t <= 13;
const kw = (mw: unknown) => Number(mw) / 1e6;

type Panel = { kind: 'struct'; id: string } | { kind: 'build'; key: string; ambit: Ambit; cat: 'planet' | 'fleet'; slot: number } | null;

/** A struct's open work (its build, mine or refine proof) as the board draws it: how far the best proof
 * found has brought the wait for the chain's falling bar, and what's left. */
function workOf(id: string): BoardWork | null {
  const t = [...pow.tasks.values()].find((x) => x.objectId === id && x.kind !== 'RAID');
  if (!t || t.kind === 'RAID') return null;
  const done = t.status === 'ready' || t.status === 'submitting' || t.status === 'sent';
  const wait = t.best ? blocksUntil(t, t.best.zeros, pow.height) : Infinity, age = Math.max(0, pow.height - t.blockStart);
  const label = t.status === 'ready' ? '제출 대기' : t.status === 'submitting' || t.status === 'sent' ? '전송 중' : t.status === 'failed' ? '재시도' : Number.isFinite(wait) ? `${wait}블록` : pow.running ? '탐색 중' : '해시 정지';
  return { kind: t.kind, label, p: done ? 1 : Number.isFinite(wait) ? age / Math.max(1, age + wait) : null, done };
}

function toBoard(d: Dashboard): BoardStruct[] {
  return d.structs.map((s) => {
    const t = TYPES_BY_ID[s.type];
    const demoBuild = d.player.id === DEMO_ID ? demo.buildProgress(s.id) : null;
    const work = demoBuild != null ? { kind: 'BUILD' as const, label: `${Math.round(demoBuild * 100)}%`, p: demoBuild } : workOf(s.id);
    return {
      id: s.id, typeId: s.type, ambit: (s.operating_ambit || 'land') as Ambit, slot: s.slot ?? 0, side: 'defender',
      category: isFleetType(s.type) ? 'fleet' : 'planet', isCommand: s.type === COMMAND_SHIP_ID,
      health: (s.status & DESTROYED) || s.is_destroyed ? 0 : Number(s.health ?? t?.maxHealth ?? 1), maxHealth: t?.maxHealth ?? 1,
      online: (s.status & ONLINE) !== 0, protects: s.protected_struct_id,
      building: work?.kind === 'BUILD' ? work.p ?? 0 : null, work,
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
    /* Targeting (webapp ActionBarLock): an order waiting for its target tile. */
    let mode: 'attack' | 'defend' | null = null;
    let enemyPick: string | null = null;
    let intelTab: string | null = innerWidth > 1100 ? 'radar' : null;
    let opsOpen = false;
    let board: Board | null = null;
    const offs: (() => void)[] = [];

    const ctx = () => ({ dash: d, backedUp: wallet.backedUp, tutorial: tutorialDone(), signedIn: session.status.state === 'in' });

    const ensureBoard = () => {
      if (board || !d) return;
      board = new Board({
        slots: { space: d.planet?.space_slots ?? 4, air: d.planet?.air_slots ?? 4, land: d.planet?.land_slots ?? 4, water: d.planet?.water_slots ?? 4 },
        fog: !raiders().length, label: `행성 ${d.planet?.name ?? ''}`, speed: 1.25, stage: true, zoom: 'close',
        onPick: (id, side) => {
          if (side === 'defender') {
            // 방어 targeting: the picked friendly becomes the ward.
            if (mode === 'defend' && panel?.kind === 'struct' && id !== panel.id) {
              const me = panel.id;
              mode = null; markRaiders();
              signOnce(`guard|${me}`, () => actions.defenseSet(me, id)); paint(); return;
            }
            mode = null; enemyPick = null;
            panel = { kind: 'struct', id }; board!.select(id); markRaiders(); paint(); return;
          }
          // 공격 targeting, during a real raid: the selected struct fires on the clicked raider.
          if (mode === 'attack' && !isDemo && liveRaiders.length && panel?.kind === 'struct') {
            const me = panel.id;
            if (wallet.state !== 'unlocked') { toast('공격하려면 지갑 잠금을 해제하세요', 3000); return; }
            mode = null; markRaiders(); paint();
            signOnce(`attack|${me}`, () => actions.attack(me, id));
            return;
          }
          // Otherwise an enemy pick is a look: it fills the enemy bar.
          enemyPick = id; sfx.play('click'); paint();
        },
        onTile: (key, ambit, side) => {
          // Empty tiles on the raider's side are theirs: nothing to build or repair there.
          if (side !== 'defender') return;
          const [kind, , slot] = key.split('|');
          if (kind === 'plan' && !isDemo && !d?.player.planet_id) { sfx.play('error'); toast('아직 행성이 없습니다 · 기지 명령의 탐사로 첫 행성을 받으세요', 4000); return; }
          if (kind === 'plan') { panel = { kind: 'build', key, ambit, cat: 'planet', slot: Number(slot) }; }
          else if (kind === 'fleet') { panel = { kind: 'build', key, ambit, cat: 'fleet', slot: Number(key.split('|')[3]) }; }
          else if (kind === 'cmd') {
            // A sunk command ship leaves an empty tile; open it so it can be repaired.
            const wreck = d?.structs.find((x) => x.type === COMMAND_SHIP_ID && x.operating_ambit === ambit);
            if (!wreck) { if (!isDemo && !d?.structs.some((x) => x.type === COMMAND_SHIP_ID)) toast('지휘함이 아직 없습니다 · 함대 슬롯에 첫 함선을 건설하면 지휘함이 함께 배치됩니다', 4500); return; }
            panel = { kind: 'struct', id: wreck.id };
          } else return;
          mode = null; markRaiders();
          board!.select(null);
          paint();
        },
      });
    };
    const markRaiders = () => {
      if (!board) return;
      if (mode === 'attack') board.markTargets(liveRaiders.filter((x) => !(x.status & DESTROYED)).map((x) => x.id));
      else if (mode === 'defend' && d && panel?.kind === 'struct') { const me = panel.id; board.markTargets(d.structs.filter((x) => x.id !== me && !(x.status & DESTROYED)).map((x) => x.id)); }
      else board.markTargets([]);
    };
    const syncBoard = () => {
      if (!board || !d) return;
      const dd = d;
      void board.idle().then(() => { if (board && d === dd) { board.setStructs([...toBoard(dd), ...raiders()]); board.setFog(!raiders().length); } });
    };

    const decision = (): Safe => {
      const dc = isDemo ? demo.decision : null;
      if (!dc) return html``;
      return html`<section class="card game-panel decision"><div class="card-head"><span class="label c-hwang">결단</span><span class="end mono ${dc.left <= 8 ? 'c-jeok' : 'dim'}">${dc.left}블록 남음</span></div>
        <h2>${dc.title}</h2><p class="note">${dc.text}</p>
        <div class="choices">${dc.choices.map((c, i) => html`<button class="btn ${i === 0 ? 'gold' : 'ghost'} choice" data-act="decide" data-i="${i}" ${c.ok === false ? 'disabled' : ''}><b>${c.label} <kbd>${i + 1}</kbd></b><small>${c.effect}</small></button>`)}</div></section>`;
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

    /* 방어: the field read by ambit. For each, the enemies in it, my online guns that can reach it, and
     * my structs standing in it. An ambit with enemies and no gun on it is open; one with my structs
     * and no gun on it is a blind spot to fix before the next raid. */
    const AMBIT_EN: Record<Ambit, string> = { space: 'SPACE', air: 'AIR', land: 'LAND', water: 'WATER' };
    const reaches = (type: number, a: Ambit) => {
      const t = TYPES_BY_ID[type], f = AMBIT_FLAG[a];
      // A defence cannon answers whatever attacks the planet, from any ambit.
      return !!t && (t.planetaryDefenses === 'defensiveCannon' || (t.primaryWeaponDamage > 0 && (t.primaryWeaponAmbits & f) !== 0) || (t.secondaryWeaponDamage > 0 && (t.secondaryWeaponAmbits & f) !== 0));
    };
    const defence = (): Safe => {
      const mine = (d?.structs ?? []).filter((s) => !(s.status & DESTROYED) && !s.is_destroyed);
      const foes: { ambit: Ambit; type: number }[] = isDemo
        ? (demo.raid?.structs ?? []).filter((x) => x.hp > 0).map((x) => ({ ambit: x.ambit, type: x.type }))
        : liveRaiders.filter((x) => !(x.status & DESTROYED)).map((x) => ({ ambit: (x.operating_ambit || 'space') as Ambit, type: x.type }));
      const r = isDemo ? demo.raid : null, live = d?.active_raid, raiding = !!(r || live);
      const ore = Math.floor(Number(d?.player.ore ?? 0)), sh = d?.shield_health;
      const rows = AMBITS.map((a) => {
        const foe = foes.filter((f) => f.ambit === a).length;
        const guns = mine.filter((s) => (s.status & ONLINE) !== 0 && reaches(s.type, a)).length;
        const held = mine.filter((s) => s.operating_ambit === a).length;
        const st = foe ? (guns ? (guns >= foe ? ['even', '대응'] : ['thin', '열세']) : ['open', '무방비']) : held && !guns ? ['blind', '사각'] : guns ? ['ok', '엄호'] : ['none', '—'];
        return { a, foe, guns, held, st };
      });
      const pips = (k: number, cls: string) => html`<span class="dp ${cls}">${Array.from({ length: Math.min(k, 6) }, () => html`<i></i>`)}${k > 6 ? html`<small>+${k - 6}</small>` : ''}${k ? '' : html`<small>0</small>`}</span>`;
      const open = rows.filter((x) => x.st[0] === 'open'), blind = rows.filter((x) => x.st[0] === 'blind');
      return html`<section class="card game-panel defence"><div class="card-head"><h2>방어 현황</h2><span class="end label ${raiding ? 'c-jeok' : 'c-cheong'}">${raiding ? `적 ${foes.length}기` : '이상 없음'}</span></div>
        <div class="def-sum"><span title="행성 보호막">보호막 <b class="${(sh ?? 100) < 35 ? 'bad' : ''}">${sh == null ? '—' : sh + '%'}</b></span><span title="정제되지 않은 광석은 습격에 빼앗깁니다">노출 광석 <b class="${raiding && ore ? 'bad' : ore ? 'warn' : ''}">${n(ore)}</b></span>${r?.eta ? html`<span>도착 <b class="bad">${r.eta}블록</b></span>` : ''}</div>
        <table class="def-tab"><thead><tr><th scope="col">구역</th><th scope="col">적</th><th scope="col" title="이 구역을 칠 수 있는 가동 중 무기">아군 화력</th><th scope="col"><span class="sr">상태</span></th></tr></thead>
          <tbody>${rows.map((x) => html`<tr class="${x.st[0]}"><th scope="row"><b>${AMBIT[x.a]}</b><small>${AMBIT_EN[x.a]}</small></th><td>${pips(x.foe, 'foe')}</td><td>${pips(x.guns, 'gun')}</td><td><span class="def-st ${x.st[0]}">${x.st[1]}</span></td></tr>`)}</tbody></table>
        ${open.length ? html`<p class="note c-jeok">${open.map((x) => AMBIT[x.a]).join('·')}의 적을 칠 무기가 없습니다. 그 구역을 겨누는 구조체를 켜거나 지으세요.</p>`
          : blind.length ? html`<p class="note">사각지대: ${blind.map((x) => AMBIT[x.a]).join('·')}. 내 구조체가 있지만 그 구역을 칠 무기가 없습니다.</p>`
          : !raiding && ore ? html`<p class="note">습격 전에 광석을 정제하세요. 알파는 약탈되지 않습니다.</p>` : ''}
        ${isDemo ? html`<a class="btn ghost" href="${href('/galaxy')}" style="justify-content:space-between">은하 지도 · 정찰 <kbd>P</kbd></a>` : html`<a class="btn ghost" href="${href('/sim')}" style="justify-content:space-between">방어 시뮬레이션 <kbd>B</kbd></a>`}
      </section>`;
    };

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

    /* ── Action bar (structs-webapp ActionBarComponent): portrait + battery, then what's selected ──
     * Nothing selected: the base's command card. A struct: power switch, properties, its orders.
     * An empty slot: what can be built there. Orders that need a target (공격, 방어) turn the header
     * inverted until a tile is picked; Esc or the same button again cancels. */
    /* A command key (.ck): keycap, icon, label, and the value in its own strip below. Tones: gold (ready to
     * spend), offense/defense (an armed mode, sat pressed in), warn (a red rim), esc (the narrow way out). */
    const sbtn = (o: { act: string; label: string; key?: string; icon?: string; sub?: string; tone?: string; dis?: boolean; title?: string; data?: Record<string, string>; cd?: number }): Safe =>
      html`<button class="ck ${o.tone ?? ''}" type="button" data-act="${o.act}" ${raw(Object.entries(o.data ?? {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' '))} ${o.dis ? 'disabled' : ''} title="${o.title ?? o.label}"${o.key ? ` aria-keyshortcuts="${o.key}"` : ''}><span class="ck-face">${o.key ? html`<kbd>${o.key}</kbd>` : ''}${o.icon ? raw(`<i class="si icon-${o.icon}" aria-hidden="true"></i>`) : ''}<span class="lbl ${[...o.label].length > 4 ? 'long' : ''}">${o.label}</span>${o.sub ? html`<small class="val">${o.cd != null ? html`<i class="cd" style="width:${Math.round(o.cd * 100)}%"></i>` : ''}<span>${o.sub}</span></small>` : ''}</span></button>`;
    const escKey = (label: string, cart = false): Safe => html`<span class="ab-groove"></span>${sbtn({ act: 'close', label, key: 'Esc', icon: 'close', tone: cart ? 'esc cart' : 'esc', title: `${label} (Esc)` })}`;
    /* The build header's budget: free power as ten segments, or, while a cartridge is hovered or
     * focused, what would be left after building it. Painted in place so hovering never repaints. */
    const budget = (free: number, need?: number): { segs: string; text: string; bad: boolean } => {
      if (need == null) return { segs: Array(10).fill('on').join(' '), text: `${free.toFixed(2)}kW`, bad: false };
      if (need > free) return { segs: Array(10).fill('over').join(' '), text: `-${(need - free).toFixed(2)}kW`, bad: true };
      const spend = free > 0 ? Math.max(1, Math.round((need / free) * 10)) : 10;
      return { segs: Array.from({ length: 10 }, (_, k) => (k < 10 - spend ? 'on' : 'spend')).join(' '), text: `→${(free - need).toFixed(2)}kW`, bad: false };
    };
    const budgetHtml = (free: number): Safe => { const b = budget(free); return html`<span class="budget"><span>여유</span><span class="meter" aria-hidden="true">${b.segs.split(' ').map((c) => html`<i class="${c}"></i>`)}</span><b>${b.text}</b></span>`; };
    const previewBudget = (el: HTMLElement | null) => {
      const box = root.querySelector<HTMLElement>('.ab-bar.player .budget'), free = Number(box?.closest<HTMLElement>('[data-free]')?.dataset.free);
      if (!box || Number.isNaN(free)) return;
      const b = budget(free, el?.dataset.need ? Number(el.dataset.need) : undefined), segs = b.segs.split(' ');
      box.querySelectorAll('.meter i').forEach((i, k) => { i.className = segs[k]; });
      const t = box.querySelector('b')!; t.textContent = b.text; t.classList.toggle('bad', b.bad);
    };
    const freeKw = () => (d ? (isDemo ? demo.capacityKw() - demo.structsKw() - demo.soldKw() : kw(d.power?.total_capacity) - kw(d.power?.total_load)) : 0);
    const battery = (): Safe => {
      const cap = isDemo ? demo.capacityKw() : kw(d?.power?.total_capacity);
      const on = cap > 0 ? Math.max(0, Math.min(5, Math.round((freeKw() / cap) * 5))) : 0;
      return html`<div class="ab-batt" title="여유 전력 ${freeKw().toFixed(2)} kW">${Array.from({ length: 5 }, (_, i) => html`<i class="${i < on ? 'on' : ''}"></i>`)}</div>`;
    };
    const buildOptions = (ambit: Ambit, cat: 'planet' | 'fleet') => STRUCT_TYPES.filter((t) => t.category === cat && (t.possibleAmbit & AMBIT_FLAG[ambit]) !== 0 && t.id !== COMMAND_SHIP_ID && t.id <= 20);
    /** How long a build takes: the demo's own pace, or on the chain the proof's wait at this browser's
     * hash rate (2 MH/s until it has measured one). */
    const buildTime = (difficulty: number) => {
      if (isDemo) return `${Math.max(3, Math.round(difficulty / 140))}블록`;
      const b = estimateBlocks(difficulty, pow.rate || 2e6), min = Math.round((b * BLOCK_SECONDS) / 60);
      return min >= 60 ? `약 ${(min / 60).toFixed(1)}시간` : `약 ${Math.max(1, min)}분`;
    };
    const actionChunk = (): Safe => {
      if (!d) return html``;
      if (panel?.kind === 'build') {
        const { ambit, cat, slot } = panel, free = freeKw();
        return html`<div class="ab-head" data-free="${String(free)}">건설 · ${AMBIT[ambit]} ${slot + 1}<span class="chip">${cat === 'planet' ? '행성 슬롯' : '함대 슬롯'}</span>${budgetHtml(free)}</div>
          <div class="ab-row"><div class="ab-btns">${buildOptions(ambit, cat).map((t, i) => {
            const need = (t.passiveDraw * 1.2) / 1e6, ok = !isDemo || need <= free;
            // A cartridge: the unit on a tile of the slot's ambit, its name, and its draw as pips of the free power.
            const name = STRUCT_TYPE[t.id] ?? t.type, short = need > free;
            const on = free > 0 ? Math.min(5, Math.ceil((need / free) * 5)) : 5;
            const takes = buildTime(t.buildDifficulty);
            return html`<button class="ck cart" type="button" data-act="build" data-type="${String(t.id)}" data-need="${String(need)}" ${ok ? '' : 'disabled'} title="${name} · ${need.toFixed(2)} kW · ${takes}${short ? ' · 전력 부족' : ''}"${i < 9 ? ` aria-keyshortcuts="${i + 1}"` : ''}><span class="ck-face">
              <span class="view" style="background-color:${AMBIT_BG[ambit]};background-image:url('${tileUrl(ambit, 2, 'middle')}')">${pixel(t.id, 64)}${short ? html`<span class="band"><span>전력 부족</span></span>` : ''}</span>
              ${i < 9 ? html`<kbd>${String(i + 1)}</kbd>` : ''}<span class="lbl">${name}</span>
              <small class="val"><span class="pips" aria-hidden="true">${Array.from({ length: 5 }, (_, k) => html`<i class="${short ? 'over' : k < on ? 'on' : ''}"></i>`)}</span><span>${need.toFixed(1)}kW</span></small></span></button>`;
          })}${escKey('취소', true)}</div></div>
          ${isDemo || wallet.state === 'unlocked' ? '' : html`<div class="ab-head" style="font-weight:400">착공하려면 지갑 잠금을 해제하세요</div>`}`;
      }
      if (panel?.kind === 'struct') {
        const id = panel.id, s = d.structs.find((x) => x.id === id);
        if (!s) return html``;
        const t = TYPES_BY_ID[s.type], ds = isDemo ? demo.state.structs.find((x) => x.id === s.id) : undefined;
        const online = (s.status & ONLINE) !== 0, dead = (s.status & DESTROYED) !== 0;
        const bw = isDemo ? null : workOf(s.id), building = isDemo ? demo.buildProgress(s.id) : bw?.kind === 'BUILD' ? bw.p ?? 0 : null;
        const canSign = isDemo || wallet.state === 'unlocked';
        const max = ds?.max || t?.maxHealth || 1;
        const kills = ds?.kills ?? 0, v = vetRank(kills);
        const head = mode === 'attack' ? '공격할 적을 고르세요' : mode === 'defend' ? '지킬 아군을 고르세요' : `${STRUCT_TYPE[s.type] ?? t?.type}${ds?.name ? ` 「${ds.name}」` : ''}`;
        const guard = s.protected_struct_id ? d.structs.find((x) => x.id === s.protected_struct_id) : null;
        const btns: Safe[] = [];
        if (!dead && building == null) {
          if (!isDemo && t?.primaryWeaponDamage && isFleetType(s.type)) btns.push(sbtn({ act: 'target', label: '공격', key: 'A', icon: t.primaryWeaponControl === 'guided' ? 'smart-weapon' : 'ballistic-weapon', tone: mode === 'attack' ? 'offense' : '', dis: !canSign || !online || !liveRaiders.length, title: liveRaiders.length ? '주무기로 습격 함대를 공격' : '공격할 적 함대가 없습니다', data: { m: 'attack' } }));
          if (!isDemo) btns.push(guard ? sbtn({ act: 'guardClear', label: '방어 해제', key: 'D', icon: 'defend', tone: 'defense', dis: !canSign, data: { id: s.id } }) : sbtn({ act: 'target', label: '방어', key: 'D', icon: 'defend', tone: mode === 'defend' ? 'defense' : '', dis: !canSign, title: '이 구조체가 지킬 아군을 지정', data: { m: 'defend' } }));
          if (isDemo && online && OC.types.includes(s.type)) btns.push(sbtn({ act: 'overclock', label: ds?.oc ? '과부하 해제' : '과부하', key: 'V', icon: 'alert', tone: ds?.oc ? 'offense' : '', sub: s.type === 20 ? `발전×${OC.gen}` : `생산×${OC.out}`, title: `${ds?.oc ? '가동 중' : '과부하 운전'} · 블록당 ${Math.round(OC.wear * 100)}% 손상 위험`, data: { id: s.id } }));
          if (ds?.cat === 'fleet') for (const m of Object.keys(REFITS) as RefitId[]) { const why = demo.refitBlocked(s.id, m); btns.push(sbtn({ act: 'refit', label: REFITS[m].name, icon: 'kinetic-barrier', tone: ds.mod === m ? 'defense' : '', sub: `${REFITS[m].cost} α`, dis: !!why, title: why ?? REFITS[m].what, data: { id: s.id, m } })); }
        }
        if (isDemo && (dead || s.health < (t?.maxHealth ?? 0))) btns.push(sbtn({ act: 'repair', label: '수리', key: 'R', icon: 'add', tone: 'gold', sub: `${demo.repairCost(s.id).toFixed(1)} g`, data: { id: s.id } }));
        const sw = dead || building != null ? 'disabled' : online ? 'on' : 'off';
        return html`<div class="ab-head ${mode ? 'inv' : ''}">${head}<span class="sub">${s.id} · ${AMBIT[s.operating_ambit] ?? ''} ${s.slot + 1}</span></div>
          <div class="ab-row">
            <div class="ab-switch"><button type="button" data-act="power" data-id="${s.id}" data-state="${sw}" ${sw === 'disabled' || !canSign ? 'disabled' : ''} aria-label="${online ? '전원 끄기' : '전원 켜기'} (F)" title="${online ? '전원 끄기' : '전원 켜기'} (F)"></button><kbd>F</kbd></div>
            <div class="ab-props scr">
              <span title="내구도"><i class="si icon-armour"></i><b class="${dead ? 'bad' : ''}">${dead ? '파괴' : `${s.health}/${max}`}</b></span>
              <span title="전력 소비"><i class="si icon-unpowered"></i>${watts(t?.passiveDraw)}</span>
              ${t?.primaryWeaponDamage ? html`<span title="주무기"><i class="si icon-dmg"></i><b>${t.primaryWeaponDamage}×${t.primaryWeaponShots}</b></span>` : ''}
              <span class="${building != null ? 'warn' : online ? '' : 'gold'}">${building != null ? (bw ? `건설 · ${bw.label}` : `건설 ${Math.round(building * 100)}%`) : dead ? '잔해' : online ? '가동' : '꺼짐'}</span>
              ${bw && bw.kind !== 'BUILD' ? html`<span class="${bw.done ? 'gold' : ''}" title="작업 증명"><i class="si icon-${bw.kind === 'MINE' ? 'mine' : 'refine'}"></i>${bw.kind === 'MINE' ? '채굴' : '정제'} · ${bw.label}</span>` : ''}
              ${guard ? html`<span title="방어 중"><i class="si icon-defend"></i>${STRUCT_TYPE[guard.type] ?? guard.id}</span>` : ''}
              ${kills ? html`<span class="gold" title="전과">${v ? '★'.repeat(v) : ''} 격파 ${kills}</span>` : ''}
              ${building != null ? html`<div class="ab-prog" style="width:100%">${Array.from({ length: 10 }, (_, i) => html`<i class="${i < Math.round(building * 10) ? 'on' : ''}"></i>`)}</div>` : ''}
              ${v ? html`<form class="ab-name ship-name" data-act="nameShip" data-on="submit" data-id="${s.id}"><input class="input" name="n" maxlength="12" placeholder="함선 이름" value="${ds?.name ?? ''}" aria-label="함선 이름"><button class="btn ghost" type="submit">명명</button></form>` : ''}
            </div>
            <div class="ab-btns">${btns}${escKey('닫기')}</div>
          </div>
          ${!isDemo && !canSign ? html`<div class="ab-head" style="font-weight:400">명령을 서명하려면 지갑 잠금을 해제하세요</div>` : ''}`;
      }
      // Nothing selected: the base's command card.
      const pw = d.power, use = pw ? Number(pw.total_load) / Math.max(1, Number(pw.total_capacity)) : 0;
      const rank = career.rank.i;
      const abil = isDemo ? ABILITIES.filter((a) => rank >= a.rank).map((a) => {
        const left = demo.abilityLeft(a.id), locked = rank < a.rank, idle = (a.id === 'overshield' && !demo.raid) || ((a.id === 'rally' || a.id === 'strike') && demo.raid?.eta !== 0);
        const off = !!(left || locked || idle);
        return sbtn({ act: 'ability', label: a.name, key: a.key, icon: a.id === 'overshield' ? 'planetary-shield' : a.id === 'rally' ? 'raid' : a.id === 'strike' ? 'range' : 'refine', tone: off ? '' : 'gold ready', dis: off,
          sub: locked ? RANKS[a.rank] : left ? `${left}블록` : idle ? '대기' : '준비', cd: left && !locked ? 1 - left / a.cooldown : undefined,
          title: `${a.name} · ${locked ? `${RANKS[a.rank]} 이상` : left ? `재사용 ${left}블록` : idle ? (a.id === 'overshield' ? '습격 때 사용' : '습격 함대 도착 후') : a.what}`, data: { id: a.id } });
      }) : [];
      return html`<div class="ab-head">기지 명령<span class="sub">${d.planet?.name || `행성 ${d.player.planet_id || '—'}`} · 블록 ${d.height == null ? '—' : '#' + n(d.height)}</span></div>
        <div class="ab-row">
          <div class="ab-props scr">
            <span title="알파 매터 (약탈되지 않음)" class="gold"><i class="si icon-refine"></i><b>${micro(d.player.alpha)}</b>g</span>
            <span title="광석 (약탈 위험)"><i class="si icon-ore-ready"></i><b>${n(Math.floor(Number(d.player.ore ?? 0)))}</b></span>
            <span title="전력 부하" class="${use > 0.95 ? 'bad' : use > 0.8 ? 'warn' : ''}"><i class="si icon-unpowered"></i><b>${Math.round(use * 100)}%</b></span>
            <span title="남은 광맥"><i class="si icon-undiscovered-ore"></i><b>${n(d.planet?.undiscovered_ore)}</b></span>
          </div>
          <div class="ab-btns">
            ${!isDemo && !d.player.planet_id ? sbtn({ act: 'explore', label: '탐사', icon: 'undiscovered-ore', tone: 'gold', sub: '첫 행성', title: '행성 탐사: 정착할 행성을 찾습니다' }) : ''}
            ${sbtn({ act: 'buildNext', label: '건설', key: 'E', icon: 'deploy', sub: '빈 슬롯' })}
            ${sbtn({ act: 'refineAll', label: '정제', key: 'Q', icon: 'refine', tone: 'gold', sub: isDemo ? `+${demo.rates().alpha.toFixed(2)}α` : '알파' })}
            ${sbtn({ act: 'infuse', label: '주입', key: 'I', icon: 'send-alpha', sub: isDemo ? '1g→1kW' : '리액터' })}
            ${abil}
            ${sbtn({ act: 'nav', label: '전력망', key: 'G', icon: 'unpowered', tone: use > 0.9 ? 'warn' : '', sub: `${Math.round(use * 100)}%`, data: { to: '/energy' } })}
            ${sbtn({ act: 'nav', label: '거래', key: 'T', icon: 'transfers', sub: '시장', data: { to: '/market' } })}
            ${sbtn({ act: 'nav', label: '전투', key: 'B', icon: 'raid', sub: '모의전', data: { to: '/sim' } })}
            ${sbtn({ act: 'shareBase', label: d.active_raid ? '지원 요청' : '공유', icon: d.active_raid ? 'alert' : 'link-out', tone: d.active_raid ? 'warn' : '', sub: d.active_raid ? '습격 중' : '현황' })}
          </div>
        </div>`;
    };
    const actionBar = (): Safe => html`<div class="ab-bar player" role="region" aria-label="명령">
      <div class="ab-edge l"></div>
      <div class="ab-chunk"><button class="ab-face scr" type="button" data-act="menu" aria-label="메뉴 (F10)" title="메뉴 (F10)">${raw(portraitHtml(myPfp(), 72))}<i class="si icon-menu"></i></button>${battery()}</div>
      <div class="ab-conn"></div>
      <div class="ab-chunk grow">${actionChunk()}</div>
      <div class="ab-edge r"></div></div>`;

    /* The enemy bar, bottom-right: the raider in view (or the enemy struct picked), as webapp's
     * PLANET_RAIDER bar. Stance orders live here while the raid approaches. */
    const enemyBar = (): Safe => {
      const r = isDemo ? demo.raid : null, live = d?.active_raid;
      const picked = enemyPick && board?.get(enemyPick) ? board.get(enemyPick)! : null;
      if (!r && !live && !picked) return html``;
      const eta = r?.eta ?? 0;
      const f = r ? demo.raidForecast() : null, p = (x: number) => `${Math.round(x * 100)}%`;
      const name = r ? `${r.name} 함대` : live ? `습격 함대 ${live.fleet_id}` : '적 구조체';
      const btns: Safe[] = [];
      if (r && eta) btns.push(sbtn({ act: 'stance', label: '요격', key: 'A', icon: 'ballistic-weapon', tone: r.stance === 'intercept' ? 'offense' : '', title: '함포 추가 피해 확률 +30%p · 강타당할 확률도 늘어남', data: { v: 'intercept' } }), sbtn({ act: 'stance', label: '참호', key: 'S', icon: 'planetary-shield', tone: r.stance === 'entrench' ? 'defense' : '', title: `방어막 차단 확률 1.6배 · 시한까지 방어막 ${demo.entrenchHold()}% 이상이면 적이 철수`, data: { v: 'entrench' } }));
      btns.push(sbtn({ act: 'nav', label: '모의전', icon: 'combat-log', data: { to: '/sim' }, title: '방어 시뮬레이션' }));
      return html`<div class="ab-bar enemy" role="region" aria-label="적">
        <div class="ab-edge l"></div>
        <div class="ab-chunk grow">
          <div class="ab-head">${picked ? `${STRUCT_TYPE[picked.typeId] ?? '적'} · ${picked.health}/${picked.maxHealth}` : name}<span class="sub">${eta ? `${eta}블록 후 도착` : r || live ? '교전 중' : ''}</span></div>
          <div class="ab-row">
            <div class="ab-props scr">
              ${r ? html`<span><i class="si icon-fleet-tile"></i><b>${r.structs.length}</b>기</span>` : ''}
              <span title="노출된 광석"><i class="si icon-ore-ready"></i><b>${n(Math.floor(Number(d?.player.ore ?? 0)))}</b></span>
              ${f ? html`<span title="지금 기지로 40번 모의한 승률">승률 <b>${p(f[r!.stance ?? 'none'])}</b></span>` : ''}
              ${r?.stance ? html`<span class="gold">${r.stance === 'intercept' ? '요격 태세' : `참호 · 버팀선 ${demo.entrenchHold()}%`}</span>` : r && eta ? html`<span class="warn">태세 미정</span>` : ''}
            </div>
            <div class="ab-btns">${btns}</div>
          </div>
        </div>
        <div class="ab-conn"></div>
        <div class="ab-chunk"><div class="ab-face scr">${raw(portraitHtml(seededPfp(r?.fleetId ?? live?.fleet_id ?? enemyPick ?? 'x'), 72))}<i class="si icon-info"></i></div></div>
        <div class="ab-edge r"></div></div>`;
    };

    /* 전투 보고: the last defence, shown for a while after it ends. */
    const report = (): Safe => {
      const p = isDemo && !demo.raid ? demo.report : null;
      if (!p) return html``;
      const stance = p.stance === 'intercept' ? '요격' : p.stance === 'entrench' ? '참호' : '태세 없음';
      const stars = (k: number) => '★'.repeat(k);
      return html`<section class="card game-panel aar ${p.won ? 'won' : 'lost'}"><div class="card-head"><span class="label ${p.won ? 'c-cheong' : 'c-jeok'}">전투 보고</span><h2>${p.withdrew ? `${p.name} 철수 · 참호가 버텼다` : p.won ? `${p.name} 격퇴` : `${p.name}에게 약탈당함`}</h2><button class="end hud-btn" data-act="dismissReport" aria-label="보고 닫기">✕</button></div>
        ${p.odds != null ? html`<p class="note">도착 시 예상 승률 <b class="mono">${Math.round(p.odds * 100)}%</b>${p.won && p.odds < 0.4 ? ' · 열세를 뒤집었습니다' : !p.won && p.odds >= 0.7 ? ' · 우세에서 무너졌습니다' : ''}</p>` : ''}
        <div class="aar-stats"><div class="stat"><small>태세</small><strong>${stance}</strong></div><div class="stat"><small>방어막 차단</small><strong class="c-cheong">${p.blocked}</strong></div><div class="stat"><small>피격</small><strong class="${p.hits ? 'c-jeok' : ''}">${p.hits}</strong></div><div class="stat"><small>약탈 광석</small><strong class="${p.seized ? 'c-jeok' : ''}">${n(p.seized)}</strong></div></div>
        ${p.kills.length ? html`<div class="aar-kills">${p.kills.map((k) => html`<span class="aar-kill">${pixel(k.type, 28)}<b>${k.name ? `「${k.name}」` : STRUCT_TYPE[k.type] ?? k.type}</b><span class="mono">격파 ${k.n}</span></span>`)}</div>` : html`<p class="note">아무도 적을 격파하지 못했습니다.</p>`}
        ${p.promoted.length ? html`<p class="aar-promo">${p.promoted.map((x) => `${x.name ? `「${x.name}」` : STRUCT_TYPE[x.type] ?? x.type} 베테랑 ${stars(x.rank)}`).join(' · ')}</p>` : ''}
      </section>`;
    };

    const alarm = (): Safe => {
      const r = isDemo ? demo.raid : null;
      const live = d?.active_raid;
      if (!r && !live) return html``;
      const eta = r?.eta ?? 0;
      return html`<section class="raid-alarm ${eta ? '' : 'live'}" role="region" aria-label="습격 경보">
        <strong>${eta ? `▲ 적 함대 접근 · ${eta}블록` : '▲ 행성 습격 진행 중'}</strong>
        <span>${r ? `${r.name} 함대 ${r.fleetId} · ${r.structs.length}기` : `함대 ${live!.fleet_id}${live!.fleet_owner ? ` (${live!.fleet_owner})` : ''}`} · 노출된 광석 <b class="mono">${n(Math.floor(Number(d?.player.ore ?? 0)))}</b></span>
        ${r && eta ? html`<span class="stance" role="group" aria-label="대응 태세"><button class="btn ${r.stance === 'intercept' ? 'danger' : 'ghost'}" data-act="stance" data-v="intercept" aria-pressed="${r.stance === 'intercept'}" title="함포 추가 피해 확률 +30%p · 강타당할 확률도 늘어남">요격 <kbd>A</kbd></button><button class="btn ${r.stance === 'entrench' ? 'primary' : 'ghost'}" data-act="stance" data-v="entrench" aria-pressed="${r.stance === 'entrench'}" title="방어막 차단 확률 1.6배 · 강타 확률 절반 · 함포 추가 피해 확률 −10%p · 시한까지 방어막 ${demo.entrenchHold()}% 이상이면 적이 철수">참호 <kbd>S</kbd></button></span>` : r?.stance ? html`<span class="chip ${r.stance === 'intercept' ? 'jeok' : 'cheong'}">${r.stance === 'intercept' ? '요격 태세' : `참호 태세 · 버팀선 ${demo.entrenchHold()}%`}</span>` : ''}
        ${r ? (() => { const f = demo.raidForecast(); if (!f) return ''; const p = (x: number) => `${Math.round(x * 100)}%`, tone = (x: number) => (x >= 0.7 ? 'cheong' : x >= 0.4 ? 'hwang' : 'jeok');
          return eta ? html`<span class="forecast" title="지금 기지로 이 습격을 40번씩 모의한 승률 (현재 방어막 기준)">예상 승률 <span class="chip ${tone(f.intercept)}">요격 ${p(f.intercept)}</span><span class="chip ${tone(f.entrench)}">참호 ${p(f.entrench)}</span><span class="chip ${tone(f.none)}">미정 ${p(f.none)}</span></span>`
            : html`<span class="forecast">승률 <span class="chip ${tone(f[r.stance ?? 'none'])}">${p(f[r.stance ?? 'none'])}</span></span>`; })() : ''}
        <span class="end" style="display:flex;gap:8px;flex-wrap:wrap">${isDemo ? html`<button class="btn gold" data-act="refineAll" style="min-height:36px">정제소 가동 <kbd>Q</kbd></button>` : ''}<a class="btn danger" href="${href('/sim')}" style="min-height:36px">방어 시뮬레이션</a></span>
      </section>`;
    };

    /* 작전: objectives, the day's orders and the advisor as one tracker top-left (SC2's objectives
     * panel): a line per goal, a claim button when one is ready. Collapses to its headings. */
    const ops = (): Safe => {
      const ms = activeMissions(ctx(), 3), dl = dailyOrders(), r = career.rank;
      const tasks = [...pow.tasks.values()];
      const tips = (isDemo ? advise(r.i) : adviseReal(d!, { ready: tasks.filter((t) => t.status === 'ready').length, stuck: tasks.filter((t) => t.status === 'failed' && (t.tries ?? 0) >= 3).length, hashing: pow.running, unlocked: wallet.state === 'unlocked' })).slice(0, opsOpen ? 3 : 1);
      const ready = ms.filter((m) => m.ready).length + dl.orders.filter((o) => o.ready).length + (dl.bonusReady ? 1 : 0);
      return html`<div class="ops ${opsOpen ? 'open' : ''}" aria-label="작전">
        ${tips.length ? html`<section class="ops-sec adv advisor"><h2>참모<span class="end">ADVISOR</span></h2>${tips.map((t) => html`<p class="tip ${t.tone === 'jeok' ? 'bad' : t.tone === 'hwang' ? 'warn' : ''}">${t.text}${t.go === '/console' ? '' : html`<a href="${href(t.go)}">${t.cta} →</a>`}</p>`)}</section>` : ''}
        <section class="ops-sec obj"><h2>작전 목표${ready ? html` <span class="c-hwang">★${ready}</span>` : ''}<button type="button" data-act="opsToggle" aria-expanded="${opsOpen}">${opsOpen ? '접기 ▴' : '펼치기 ▾'}</button></h2>
          ${ms.length ? ms.slice(0, opsOpen ? 3 : 2).map((m: MissionState) => html`<div class="op ${m.ready ? 'ready' : ''}"><span>${m.title}</span><span class="xp">+${m.xp}</span>
            ${opsOpen && !m.ready ? html`<span class="bar"><i style="width:${Math.round((m.done / m.of) * 100)}%"></i></span>` : ''}
            ${m.ready ? html`<button class="btn gold" data-act="claim" data-id="${m.id}">보상 수령</button>` : ''}</div>`) : html`<p class="tip">모든 작전 완료 · ${r.name}</p>`}
          ${opsOpen ? html`<div class="op"><span></span><a href="${href('/record')}">모든 목표 · 전적 →</a></div>` : ''}
        </section>
        ${opsOpen || dl.orders.some((o) => o.ready) || dl.bonusReady ? html`<section class="ops-sec"><h2>일일 임무<span class="end">${dl.bonusClaimed ? '완수' : `초기화 ${dl.resetsIn}`}</span></h2>
          ${dl.orders.map((o) => html`<div class="op ${o.ready ? 'ready' : ''} ${o.claimed ? 'done' : ''}"><span>${o.title}</span><span class="xp">${o.claimed ? '✓' : `${Number.isInteger(o.done) ? o.done : o.done.toFixed(1)}/${o.target}`}</span>
            ${o.ready ? html`<button class="btn gold" data-act="daily" data-id="${o.id}">보상 +${DAILY_XP} XP</button>` : ''}</div>`)}
          ${dl.bonusReady ? html`<div class="op ready"><button class="btn gold" data-act="dailyBonus">전부 완료 보너스 +${DAILY_BONUS} XP</button></div>` : ''}</section>` : ''}
      </div>`;
    };

    /* Message log above the action bar: the live feed as game chat. */
    const msgs = (): Safe => html`<ol class="msgs" aria-label="전황" aria-live="polite">${(d?.activity ?? []).slice(0, 8).map((a) => {
      const bad = /attack|raid|cut|depart|arrive/.test(a.category);
      return html`<li class="${bad ? 'bad' : a.category.includes('refine') ? 'gold' : ''}"><span class="t">${a.block_height ? '#' + String(a.block_height).slice(-4) : new Date(a.time).toLocaleTimeString('ko-KR')}</span>${activityLabel(a.category)} <span class="faint">${typeof a.detail === 'string' && a.detail.length < 30 ? a.detail : a.planet_id}</span></li>`;
    })}</ol>`;

    /* Intel dock, right: one tab at a time (or none). */
    const INTEL: [string, string][] = isDemo ? [['radar', '방어'], ['power', '세력'], ['engine', '엔진']] : [['radar', '방어'], ['power', '세력'], ['pow', '증명']];
    const intel = (): Safe => {
      const threat = !!((isDemo && demo.raid) || d?.active_raid);
      const body = intelTab === 'radar' ? defence() : intelTab === 'power' ? standings() : intelTab === 'engine' ? engine() : intelTab === 'pow' ? html`<div id="pow-host">${powCard()}</div>` : html``;
      return html`<aside class="intel ${intelTab ? 'open' : ''}" aria-label="정보">
        <div class="intel-tabs" role="toolbar">${INTEL.map(([k, l]) => html`<button type="button" data-act="intel" data-k="${k}" aria-pressed="${intelTab === k}" class="${k === 'radar' && threat && intelTab !== 'radar' ? 'alert' : ''}">${l}</button>`)}<button type="button" data-act="intel" data-k="" title="정보 닫기 (Tab)" aria-label="정보 닫기">${intelTab ? '▸' : '◂'}</button></div>
        <div class="intel-body">${body}</div></aside>`;
    };

    const stageName = (): Safe => {
      const sh = d?.shield_health;
      return html`<div class="stage-name"><b>${d?.planet?.name || `행성 ${d?.player.planet_id || '—'}`}</b><span>행성 ${d?.planet?.id ?? '—'} · 본거지</span><span>보호막 <span class="${(sh ?? 100) < 35 ? 'c-jeok' : 'c-cheong'}">${sh == null ? '—' : sh + '%'}</span></span></div>`;
    };

    const dialog = (): Safe => {
      const dc = decision(), rp = report();
      if (dc.s) return html`<div class="dlg" role="dialog" aria-label="결단"><div class="dlg-in">${dc}</div></div>`;
      if (rp.s) return html`<div class="dlg ${isDemo && demo.report && !demo.report.won ? 'bad' : ''}" role="dialog" aria-label="전투 보고"><div class="dlg-in">${rp}</div></div>`;
      return html``;
    };

    const view = (): Safe => html`
      <div class="stage-bridge ${(isDemo && demo.raid) || d?.active_raid ? 'raid-on' : ''} ${mode ? 'targeting' : ''}">
        <div id="bd-host" class="bd-host" aria-label="행성"></div>
        ${stageName()}
        ${alarm()}
        ${ops()}
        ${intel()}
        ${msgs()}
        <div class="ab-dock">${enemyBar()}${actionBar()}</div>
        ${dialog()}
      </div>`;

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
        ...(() => { const nx = isDemo ? demo.nextRaider() : null; return nx ? [{ label: '다음 습격', value: `${nx.in}블록 · ${nx.name}`, tone: nx.in <= 8 ? 'var(--jeok)' : 'var(--text)', href: '/galaxy' }] : []; })(),
      ]);
    };

    const err = (m: string | null) => { if (m) { sfx.play('error'); toast(m, 3000); return true; } return false; };
    // One signature in flight per struct and order: a double click must not sign the same move twice.
    const inFlight = new Set<string>();
    const signOnce = (key: string, send: () => Promise<string>) => { if (inFlight.has(key)) return; inFlight.add(key); void sign(send()).finally(() => inFlight.delete(key)); };
    const sign = (p: Promise<string>) => p.then(() => { sfx.play('confirm'); toast('명령을 내렸습니다'); }).catch((e) => { sfx.play('error'); toast('실패: ' + (e as Error).message, 5000); });

    const firstEmpty = (): Panel => {
      if (!d) return null;
      for (const a of ['land', 'water', 'air', 'space'] as Ambit[]) {
        const count = Number((d.planet as unknown as Record<string, number> | null)?.[`${a}_slots`] ?? 4);
        for (let i = 0; i < count; i++) if (!d.structs.some((s) => !isFleetType(s.type) && s.operating_ambit === a && s.slot === i && !(s.status & DESTROYED))) return { kind: 'build', key: `plan|${a}|${i}`, ambit: a, cat: 'planet', slot: i };
      }
      return null;
    };

    const handlers = {
      shareBase: () => { void baseSituation(pid).then((st) => { if (st) share({ kind: 'situation', s: st }); }); },
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
      close: () => { mode = null; enemyPick = null; panel = null; board?.select(null); markRaiders(); paint(); },
      // An order that needs a target: arm it (same button again disarms), then pick on the map.
      target: (el: HTMLElement) => {
        const m = el.dataset.m as 'attack' | 'defend';
        if ((el as HTMLButtonElement).disabled) return;
        mode = mode === m ? null : m;
        sfx.play(mode ? (m === 'attack' ? 'alarm' : 'shield') : 'click');
        markRaiders(); paint();
      },
      intel: (el: HTMLElement) => { const k = el.dataset.k || null; intelTab = intelTab === k ? null : k; paint(); },
      opsToggle: () => { opsOpen = !opsOpen; paint(); },
      menu: () => dispatchEvent(new Event('structs:menu')),
      dismissReport: () => { demo.dismissReport(); },
      nav: (el: HTMLElement) => go(el.dataset.to!),
      explore: (el: HTMLElement) => {
        if (isDemo || !d || d.player.planet_id) return;
        if (wallet.state !== 'unlocked') { sfx.play('error'); toast('탐사하려면 지갑 잠금을 해제하세요', 3000); return; }
        (el as HTMLButtonElement).disabled = true;
        void actions.planetExplore(pid)
          .then(() => { sfx.play('confirm'); notify('탐사 시작', '정착할 행성을 찾는 중입니다', 'cheong', null); void load(); })
          .catch((e) => { sfx.play('error'); toast('탐사 실패: ' + (e as Error).message, 5000); (el as HTMLButtonElement).disabled = false; });
      },
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
      stance: (el: HTMLElement) => {
        const v = el.dataset.v as 'intercept' | 'entrench';
        if (err(demo.setStance(v))) return;
        sfx.play(v === 'intercept' ? 'alarm' : 'shield'); refresh();
      },
      ability: (el: HTMLElement) => {
        const id = el.dataset.id as AbilityId, a = ABILITIES.find((x) => x.id === id)!;
        if (err(demo.useAbility(id, career.rank.i))) return;
        sfx.play(id === 'rally' ? 'alarm' : id === 'overshield' ? 'shield' : 'coin'); if (id === 'rally') shake('sm');
        float(el, a.name, 'var(--hwang)', true); refresh();
      },
      refit: (el: HTMLElement) => {
        const m = el.dataset.m as RefitId;
        if (err(demo.refit(el.dataset.id!, m))) return;
        sfx.play('build'); float(el, REFITS[m].name, 'var(--hwang)', true); refresh();
      },
      nameShip: (el: HTMLElement) => {
        const n = String(new FormData(el as HTMLFormElement).get('n') ?? '');
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (err(demo.nameShip(el.dataset.id!, n))) return;
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
            .then(() => { sfx.play('build'); notify('착공', `${STRUCT_TYPE[type]} · ${AMBIT[p.ambit]} ${p.slot + 1} · ${buildTime(TYPES_BY_ID[type]?.buildDifficulty ?? 0)}`, 'cheong', null); panel = null; if (!pow.running) pow.start(); void load(); })
            .catch((e) => { sfx.play('error'); toast('착공 실패: ' + (e as Error).message, 5000); (el as HTMLButtonElement).disabled = false; });
          return;
        }
        if (!err(demo.build(Number(el.dataset.type), p.ambit, p.slot, p.cat))) {
          sfx.play('build');
          notify('착공', `${STRUCT_TYPE[Number(el.dataset.type)]} · ${AMBIT[p.ambit]} ${p.slot + 1}`, 'cheong', null);
          panel = null; refresh();
        }
      },
      buildNext: () => { if (!isDemo && d && !d.player.planet_id) { sfx.play('error'); toast('아직 행성이 없습니다 · 탐사로 첫 행성을 받으세요', 4000); return; } const p = firstEmpty(); panel = p; if (p?.kind === 'build' && board) { board.ping(p.key); board.reveal(p.key); } else if (!panel) toast('빈 행성 슬롯이 없습니다'); paint(); },
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
      r: () => { const b = root.querySelector<HTMLElement>('[data-act="repair"]'); if (!b) return false; handlers.repair(b); },
      // Esc peels back one layer: the armed order, then the selection, then opens the menu.
      Escape: () => { if (mode) { mode = null; markRaiders(); paint(); } else if (panel || enemyPick) handlers.close(); else handlers.menu(); },
      d: () => { const b = root.querySelector<HTMLElement>('.ab-bar.player [data-act="target"][data-m="defend"], .ab-bar.player [data-act="guardClear"]'); if (!b || (b as HTMLButtonElement).disabled) return false; (b.dataset.act === 'target' ? handlers.target : handlers.guardClear)(b); },
      // Digits: a pending decision's choice, else the build card's options, else (7–0) abilities.
      ...Object.fromEntries(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => [k, () => {
        const i = k === '0' ? 9 : Number(k) - 1;
        if (isDemo && demo.decision) return i < demo.decision.choices.length ? handlers.decide({ dataset: { i: String(i) } } as unknown as HTMLElement) : false;
        if (panel?.kind === 'build') {
          const b = root.querySelectorAll<HTMLButtonElement>('.ab-bar.player [data-act="build"]')[i];
          if (!b || b.disabled) return false;
          return handlers.build(b);
        }
        const a = ABILITIES.find((x) => x.key === k);
        if (!a || !isDemo) return false;
        const b = root.querySelector<HTMLButtonElement>(`[data-act="ability"][data-id="${a.id}"]`);
        if (!b || b.disabled) return false;
        handlers.ability(b);
      }])),
      // A: arm the selected struct's attack (signed in, during a raid); on the demo, 요격 stance. S 참호.
      a: () => {
        const t = root.querySelector<HTMLButtonElement>('.ab-bar.player [data-act="target"][data-m="attack"]');
        if (t && !t.disabled) { handlers.target(t); return; }
        const b = root.querySelector<HTMLElement>('[data-act="stance"][data-v="intercept"]'); if (!b) return false; handlers.stance(b);
      },
      s: () => { const b = root.querySelector<HTMLElement>('[data-act="stance"][data-v="entrench"]'); if (!b) return false; handlers.stance(b); },
    });
    offs.push(offKeys);

    // Mid-typing a ship's name, repaints wait (they'd wipe the field and break Korean input) and run as
    // soon as the field lets go of focus.
    let pending = false;
    // Typing in the name field, or mid-click on its button (Safari doesn't focus buttons on click).
    let pressing = false;
    const typing = () => { const a = document.activeElement; return pressing || (a instanceof HTMLInputElement && !!a.closest('.ship-name') && root.contains(a)); };
    root.addEventListener('pointerdown', (e) => { if ((e.target as Element).closest?.('.ship-name')) pressing = true; });
    const onPreview = (e: Event) => previewBudget((e.target as Element).closest?.<HTMLElement>('.ck.cart[data-need]') ?? null);
    root.addEventListener('pointerover', onPreview);
    root.addEventListener('focusin', onPreview);
    const onPointerUp = () => { if (!pressing) return; setTimeout(() => { pressing = false; if (pending && !typing()) { pending = false; paint(); } }, 0); };
    addEventListener('pointerup', onPointerUp);
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
      // A new commander's first look at the bridge: the spotlight tour.
      if (!tourSeen('bridge')) setTimeout(() => { if (root.isConnected) runTour('bridge', BRIDGE_TOUR); }, 900);
      offs.push(onGrass(`structs.grid.player.${pid}.>`, again), onGrass(`structs.player.*.${pid}`, again));
      if (d?.player.planet_id) offs.push(onGrass(`structs.planet.${d.player.planet_id}.>`, (e) => {
        again();
        if (e.category === 'struct_attack' && e.data.detail && board) board.playAttack(e.data.detail as never);
        // The raid alarm itself is src/game/alerts.ts, so it sounds on every screen.
      }));
    }
    offs.push(career.onChange(() => repaint()));
    offs.push(() => removeEventListener('pointerup', onPointerUp));
    // The tour's spotlight scrolls the field about; on a narrow screen it ends back on the planet.
    const onTourEnd = (e: Event) => { if ((e as CustomEvent).detail === 'bridge') board?.home(true); };
    addEventListener('structs:tour-end', onTourEnd);
    offs.push(() => removeEventListener('structs:tour-end', onTourEnd));
    // The proof card follows every hash; the advisor's proof tips follow at most every few seconds.
    let advisedAt = 0;
    const repaintAdvisor = () => { const el = root.querySelector('.ops'); if (el && d && Date.now() - advisedAt > 3000) { advisedAt = Date.now(); el.outerHTML = ops().s; } };
    // Work plates on the map follow the proofs too (painted only where a plate changed).
    let boardAt = 0;
    if (!isDemo) offs.push(pow.onChange(() => { paintPow(); repaintAdvisor(); if (Date.now() - boardAt > 1000) { boardAt = Date.now(); syncBoard(); } }));
    return () => { offs.forEach((f) => f()); board?.dispose(); setTiles([]); };
  },
};
export default screen;
