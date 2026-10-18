/* /o/<id>: any object's own page, the target of every shared link. The live card, then what that
 * kind of object has to show: a planet is watched on the battle board (its owner's structs, any
 * raiding fleet, the battle log); a player shows their record and recent moves; a guild its roster.
 * /s/<code>: a shared situation (a frozen moment), with the objects it names as live cards. */
import type { Screen } from '../router';
import { current, href } from '../router';
import { html, mount, raw, n, micro, esc, toast, type Safe } from '../ui/dom';
import { guildApi, type ActivityRow, type StructRow } from '../api/guild';
import { session } from '../api/session';
import { MOCK } from '../api/http';
import { resolveRef, refCardHtml, refSlot, isRefId, REF_KINDS, type RefCard } from '../social/refs';
import { decodeSituation, situationHtml, share } from '../social/share';
import { watchlist, toggleWatch } from '../social/actions';
import { entityOf, activityLabel, STRUCT_TYPE } from '../i18n/ko';
import { Board, type BoardStruct } from '../game/map/board';
import { TYPES_BY_ID, COMMAND_SHIP_ID, type Ambit } from '../data/catalogue';
import { portraitHtml, seededPfp } from '../game/portrait';
import { setTiles } from '../ui/shell';
import { onGrass, throttled } from '../grass/grass';
import { serviceRecord, roman, type Ribbon } from '../social/record';
import { history, sparkHtml } from '../social/history';
import { actions } from '../api/actions';
import { wallet } from '../wallet/wallet';

const ONLINE = 4, DESTROYED = 32;
const base = () => href('');
const ago = (t: string) => { const s = (Date.now() - new Date(t).getTime()) / 1000; return !Number.isFinite(s) ? '' : s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`; };
const detail = (d: ActivityRow['detail']) => (typeof d === 'string' ? d : Object.entries(d ?? {}).slice(0, 3).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '));

function activityList(rows: ActivityRow[]): Safe {
  return rows.length ? html`<ol class="newswire obj-log">${rows.map((r) => html`<li class="${/attack|raid|health|destroy/.test(r.category) ? 'hot' : ''}"><span class="mono faint">${r.block_height ? '#' + n(r.block_height) : ago(r.time)}</span> <b>${activityLabel(r.category)}</b> ${raw(esc(detail(r.detail)))}</li>`)}</ol>` : html`<p class="empty">기록이 없습니다.</p>`;
}

const toBoard = (list: StructRow[], side: 'defender' | 'attacker'): BoardStruct[] => list.filter((s) => !s.is_destroyed).map((s) => ({
  id: s.id, typeId: s.type, ambit: (s.operating_ambit || 'land') as Ambit, slot: s.slot ?? 0, side, category: s.location_type === 'fleet' || s.type <= 13 ? 'fleet' : 'planet',
  isCommand: s.type === COMMAND_SHIP_ID, health: (s.status & DESTROYED) ? 0 : Number(s.health ?? 1), maxHealth: TYPES_BY_ID[s.type]?.maxHealth ?? 1, online: (s.status & ONLINE) !== 0,
  protects: s.protected_struct_id,
}));

function situationScreen(root: HTMLElement, code: string) {
  const s = decodeSituation(code);
  if (!s) { mount(root, html`<section class="card danger" style="max-width:560px;margin:40px auto"><h1>상황 링크가 잘못되었습니다</h1><p class="note">링크가 잘렸거나 손상되었습니다.</p></section>`); return; }
  const me = session.playerId;
  const paint = () => mount(root, html`
    <div class="card-head"><h1 style="font-size:28px">공유된 상황</h1><span class="label c-cheong">SITUATION</span><button class="btn ghost end" data-act="share">다시 공유</button></div>
    <div class="obj-wrap"><div class="obj-main">${raw(situationHtml(s, base()))}</div>
      <aside class="obj-side">${(s.ids ?? []).length ? html`<h2 style="font-size:18px">관련 객체</h2>${(s.ids ?? []).map((id) => raw(refSlot(id, { base: base(), me })))}` : ''}</aside></div>`, { share: () => share({ kind: 'situation', s }) });
  paint();
}

const screen: Screen = {
  async render(root) {
    const path = current();
    const seg = path.split('/')[2] ?? '';
    if (path.startsWith('/s/')) return situationScreen(root, seg);
    const id = decodeURIComponent(seg);
    if (!isRefId(id)) {
      mount(root, html`<section class="card" style="max-width:560px;margin:40px auto"><h1 style="font-size:26px">객체 찾기</h1><p class="note">플레이어(1-), 행성(2-), 구조체(5-), 함대(9-), 길드(0-), 변전소(4-), 공급자(10-) ID를 입력하세요.</p>
        <form data-act="find" data-on="submit" style="display:flex;gap:8px"><input class="input mono" name="id" placeholder="2-14" autofocus><button class="btn primary">열기</button></form>
        ${watchlist().length ? html`<h2 style="font-size:18px">감시 목록</h2><div class="obj-watch">${watchlist().map((w) => raw(refSlot(w, { base: base(), compact: true, me: session.playerId })))}</div>` : ''}</section>`, {
        find: (el) => { const v = String(new FormData(el as HTMLFormElement).get('id') || '').trim(); if (isRefId(v)) location.assign(href(`/o/${v}`)); },
      });
      return;
    }
    const kind = REF_KINDS[id.split('-')[0]];
    const me = session.playerId;
    let ribbonsNow: Ribbon[] = [];
    let card: RefCard | null = null, log: ActivityRow[] = [], extra: Safe = html``, board: Board | null = null, timer = 0;
    const signedIn = session.status.state === 'in' || MOCK;

    const view = (): Safe => html`
      <div class="card-head"><h1 style="font-size:28px">${card?.title ?? `${entityOf(id)} ${id}`}</h1><span class="label c-cheong">${entityOf(id)} · ${id}</span>
        <span class="end" style="display:flex;gap:6px">${kind === 'planet' || kind === 'fleet' ? html`<a class="btn ghost" href="${href(`/chat?room=${encodeURIComponent(`#${kind}-${id}`)}`)}" title="이 ${kind === 'planet' ? '행성' : '함대'}의 통신방">통신방</a>` : ''}<button class="btn ghost" data-act="watch">${watchlist().includes(id) ? '★ 감시 중' : '☆ 감시'}</button><button class="btn primary" data-act="share">공유</button></span></div>
      <div class="obj-wrap">
        <div class="obj-main">
          ${kind === 'planet' || kind === 'fleet' ? html`<section class="card flush game-panel obj-board"><div id="obj-board"></div></section>` : ''}
          ${extra}
          ${log.length || kind === 'planet' || kind === 'player' ? html`<section class="card game-panel"><h2>${kind === 'planet' ? '전투 기록' : '최근 활동'}</h2>${activityList(log)}</section>` : ''}
        </div>
        <aside class="obj-side">${card ? raw(refCardHtml(card, { base: base(), me, noShare: true })) : signedIn ? html`<div class="card"><div class="skeleton" style="height:120px"></div></div>` : html`<div class="card"><p class="note">이 객체의 실시간 정보는 길드 회원만 볼 수 있습니다.</p><a class="btn primary" href="${href('/start')}">바로 플레이</a></div>`}</aside>
      </div>`;
    const handlers = {
      share: () => share({ kind: 'object', id }),
      shareRec: () => { const top = ribbonsNow.filter((r) => r.tier).sort((a, b) => b.tier - a.tier).slice(0, 6); share({ kind: 'situation', s: { t: 'base', title: `${card?.title ?? id}의 복무 기록`, sub: top.length ? `최고 ${top[0].name} ${roman(top[0].tier)}` : undefined, lines: top.map((r) => [`${r.name} ${roman(r.tier)}`, `${n(r.value ?? 0, r.unit === 'g' ? 1 : 0)} ${r.unit}`] as [string, string]), ids: [id], go: `/o/${id}`, tone: 'hwang', at: Date.now() } }); },
      watch: () => { toggleWatch(id); paint(); },
      rename: (el: HTMLElement) => { const name = String(new FormData(el as HTMLFormElement).get('name') || '').trim(); if (name) void actions.planetName(id, name).then((h) => toast(`행성 이름 변경 · ${h.slice(0, 10)}…`)).catch((e) => toast('실패: ' + (e as Error).message, 5000)); },
    };
    const paint = () => {
      if (!root.isConnected) return;
      const host = root.querySelector('#obj-board');
      if (host && board) host.remove();
      mount(root, view(), handlers);
      const slot = root.querySelector('#obj-board');
      if (slot && board) { slot.replaceWith(host!); }
    };

    const loadPlanet = async () => {
      const p = await guildApi.planet(id).catch(() => null);
      if (!p) return;
      const [mine, raid] = await Promise.all([guildApi.structsOf(p.owner).catch(() => [] as StructRow[]), guildApi.activeRaid(id).catch(() => null)]);
      const hOre = await history('ore', id);
      const here = mine.filter((s) => s.location_id === id || (s.location_type === 'fleet' && s.type <= 13 && s.location_id.startsWith('9-')));
      let attackers: StructRow[] = [];
      if (raid?.fleet_owner) attackers = (await guildApi.structsOf(raid.fleet_owner).catch(() => [])).filter((s) => s.location_id === raid.fleet_id);
      const host = root.querySelector('#obj-board');
      if (!board && host) {
        board = new Board({ slots: { space: p.space_slots, air: p.air_slots, land: p.land_slots, water: p.water_slots }, fog: !attackers.length, label: `행성 ${p.name || id}`, zoom: 'full', quiet: true, maxHeight: () => Math.min(560, innerHeight * 0.6) });
        board.attach(host);
      }
      board?.setStructs([...toBoard(here, 'defender'), ...toBoard(attackers, 'attacker')]);
      board?.setFog(!attackers.length);
      const mineP = p.owner === me;
      extra = html`${mineP ? html`<form class="invite-form planet-name" data-act="rename" data-on="submit"><input class="input" name="name" maxlength="24" value="${p.name}" placeholder="행성 이름" aria-label="행성 이름"><button class="btn ghost sm" ${wallet.state === 'unlocked' && !MOCK ? '' : 'disabled'}>행성 이름 변경</button></form>` : ''}${hOre.length ? html`<section class="card game-panel">${raw(sparkHtml(hOre, { label: '행성 광석 (7일)', unit: '', tone: 'var(--hwang)' }))}</section>` : ''}<section class="card game-panel"><div class="card-head"><h2>구조체</h2><span class="end mono dim">${n(here.length)} 아군${attackers.length ? ` · ${n(attackers.length)} 습격` : ''}</span></div>
        <div class="obj-structs">${[...here, ...attackers].slice(0, 24).map((s) => html`<a class="obj-struct ${attackers.includes(s) ? 'enemy' : ''}" href="${href(`/o/${s.id}`)}"><b>${STRUCT_TYPE[s.type] ?? s.type}</b><small class="mono">${s.id} · ♥${s.health}</small></a>`)}</div></section>`;
    };
    const loadFleet = async () => {
      const owner = card?.owner;
      if (!owner) return;
      const ships = (await guildApi.structsOf(owner).catch(() => [] as StructRow[])).filter((s) => s.location_id === id && !s.is_destroyed);
      const host = root.querySelector('#obj-board');
      if (!board && host) {
        board = new Board({ fog: true, label: `함대 ${id}`, zoom: 'full', quiet: true, maxHeight: () => Math.min(460, innerHeight * 0.5) });
        board.attach(host);
      }
      board?.setStructs(toBoard(ships, 'defender'));
      extra = html`<section class="card game-panel"><div class="card-head"><h2>함대 구성</h2><span class="end mono dim">${n(ships.length)}척</span></div>
        <div class="obj-structs">${ships.map((s) => html`<a class="obj-struct" href="${href(`/o/${s.id}`)}"><b>${STRUCT_TYPE[s.type] ?? s.type}</b><small class="mono">${s.id} · ♥${s.health}</small></a>`)}</div>
        ${me && owner !== me ? html`<a class="btn ghost sm" href="${href(`/sim?vs=${owner}`)}">이 함대와 실전 예측</a>` : ''}</section>`;
    };
    const loadPlayer = async () => {
      const [stats, structs, rib, hOre, hLoad, hCap] = await Promise.all([guildApi.oreStats(id).catch(() => null), guildApi.structsOf(id).catch(() => [] as StructRow[]), serviceRecord(id).catch(() => [] as Ribbon[]), history('ore', id), history('load', id), history('capacity', id)]);
      ribbonsNow = rib;
      const alive = structs.filter((s) => !s.is_destroyed);
      extra = html`<section class="card game-panel"><h2>전적</h2><div class="stat-grid obj-stats">
        <div class="stat"><small>채굴한 광석</small><strong class="mono">${stats ? n(stats.mined) : '—'}</strong></div>
        <div class="stat"><small>약탈한 광석</small><strong class="mono c-jeok">${stats ? n(stats.seized) : '—'}</strong></div>
        <div class="stat"><small>빼앗긴 광석</small><strong class="mono">${stats ? n(stats.forfeited) : '—'}</strong></div>
        <div class="stat"><small>구조체</small><strong class="mono">${n(alive.length)}</strong></div>
        <div class="stat"><small>함대 전력</small><strong class="mono">${n(alive.filter((s) => s.type <= 13).length)}</strong></div>
        <div class="stat"><small>행성 시설</small><strong class="mono">${n(alive.filter((s) => s.type > 13).length)}</strong></div></div></section>
        ${hOre.length + hLoad.length + hCap.length ? html`<section class="card game-panel"><div class="card-head"><h2>지난 7일</h2><span class="end dim" style="font-size:12px">길드 통계 기록</span></div><div class="spark-grid">${raw(sparkHtml(hOre, { label: '보유 광석', unit: '', tone: 'var(--hwang)' }))}${raw(sparkHtml(hLoad, { label: '전력 부하', unit: 'kW', scale: 1e6 }))}${raw(sparkHtml(hCap, { label: '전력 용량', unit: 'kW', scale: 1e6, tone: 'var(--cheong-hi)' }))}</div></section>` : ''}
        ${rib.length ? html`<section class="card game-panel"><div class="card-head"><h2>복무 기록</h2><span class="end dim" style="font-size:12px">체인 기록 · 등급 I–VI</span><button class="btn ghost sm" data-act="shareRec">공유</button></div>
          <div class="ribbons">${rib.map((r) => html`<div class="ribbon t${r.tier} ${r.family === '습격' ? 'raid' : r.family === '방어' ? 'def' : 'ind'}" title="${r.next ? `다음 등급까지 ${n(r.next)} ${r.unit}` : r.tier ? '최고 등급' : ''}"><span class="rb-bar"></span><b>${r.name}</b><strong class="mono">${r.value == null ? '—' : n(r.value, r.unit === 'g' ? 1 : 0)}</strong><small>${r.unit}${r.tier ? ` · ${roman(r.tier)}` : ''}</small></div>`)}</div></section>` : ''}`;
    };
    const loadGuild = async () => {
      const roster = await guildApi.roster(id).catch(() => []);
      extra = html`<section class="card game-panel"><div class="card-head"><h2>길드원</h2><a class="btn ghost end" href="${href(`/guild?id=${id}`)}">길드 화면</a></div>
        <ol class="standings">${[...roster].sort((a, b) => Number(b.alpha) - Number(a.alpha)).slice(0, 15).map((m, i) => html`<li><span class="rk mono">${i + 1}</span>${raw(portraitHtml(m.pfp || seededPfp(m.id), 30))}<div><a href="${href(`/o/${m.id}`)}"><b>${m.username || m.id}</b></a><small class="mono">알파 ${micro(m.alpha, 1)} g</small></div></li>`)}</ol></section>`;
    };
    const load = async () => {
      if (!signedIn) { paint(); return; }
      card = await resolveRef(id, true);
      const planetId = kind === 'planet' ? id : card?.planetId && kind === 'struct' ? card.planetId : null;
      try {
        if (kind === 'planet') await loadPlanet();
        else if (kind === 'player') await loadPlayer();
        else if (kind === 'guild') await loadGuild();
        else if (kind === 'fleet') await loadFleet();
        log = planetId ? await guildApi.activity(planetId, 1, 30).catch(() => []) : kind === 'player' ? await guildApi.playerActivity(id, 1, 25).catch(() => []) : [];
      } catch { /* the card still stands */ }
      paint();
      if (kind === 'planet' && !board) await loadPlanet();
      if (card) setTiles(card.rows.slice(0, 3).map(([label, value]) => ({ label, value })));
    };
    paint();
    await load();
    // Live: a watched planet refreshes every 15 s (raids move fast); everything else every minute.
    timer = window.setInterval(() => { if (root.isConnected && !document.hidden) void load(); }, kind === 'planet' ? 15_000 : 60_000);
    // A watched planet plays its fights as they happen (GRASS), like the bridge does for your own.
    const again = throttled(() => { if (root.isConnected) void load(); }, 2500);
    const offLive = kind === 'planet' ? onGrass(`structs.planet.${id}.>`, (e) => {
      if (e.category === 'struct_attack' && e.data.detail && board) board.playAttack(e.data.detail as never);
      else again();
    }) : () => undefined;
    return () => { clearInterval(timer); offLive(); board?.dispose(); setTiles([]); };
  },
};
export default screen;
