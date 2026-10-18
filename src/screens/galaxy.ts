/* 은하 지도: the demo galaxy at a glance. Planets sit on four spiral arms by discovery order
 * (structs-xyz galaxyLayout), your home in teal, rivals in coral sized by power, raids in flight
 * drawn as live routes. Pick a rival to read its intel, scout its fleet (1 g alpha shows exactly
 * what you'd fight) or strike. */
import type { Screen } from '../router';
import { href } from '../router';
import { html, mount, n, raw, toast, esc, micro, type Safe } from '../ui/dom';
import { guildApi, type PlayerRow, type RaidRow, type LeaderPlayer, type FleetRow } from '../api/guild';
import { actions } from '../api/actions';
import { wallet } from '../wallet/wallet';
import { pow } from '../pow/engine';
import { errorCard, loading } from '../ui/gate';
import { needSession } from '../ui/gate';
import { setTiles } from '../ui/shell';
import { demo, DEMO_ID, DOMINION, TEMPER, OPS, OUTPOST, opOdds, withAllies, ALLY, type Rival, type OpId, type OutpostId, REVENGE, GRUDGE } from '../game/demo';
import { hegemonyMeter, powerChart } from '../game/meter';
import { hash32, mulberry } from '../core/util';
import { layout } from '../sim/fleets';
import { STRUCT_TYPE, AMBIT } from '../i18n/ko';
import { spriteHtml } from '../game/map/art';
import { portraitHtml, seededPfp } from '../game/portrait';
import { sfx } from '../game/sfx';
import { notify, banner } from '../game/fx';
import { career } from '../game/progress';
import { transmit } from '../game/comms';
import { estimateOdds } from '../game/odds';
import { runTour, tourSeen, GALAXY_TOUR } from '../game/tour';
import { keys } from '../game/keys';

const R = 130, REF = 1400, ARMS = 4;
/** structs-xyz planetPosition, flattened to the galactic plane. */
function pos(index: number, ref = REF): [number, number] {
  const rnd = mulberry(hash32('planet:' + index));
  const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const t = Math.sqrt(Math.min(index, ref) / ref);
  const r = R * t * (0.9 + rnd() * 0.2) + 2;
  const arm = Math.floor(rnd() * ARMS);
  const angle = (arm / ARMS) * Math.PI * 2 + r * 0.042 + g() * (0.28 + 0.5 * (1 - t));
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}
const HOME = 118;
const planetIx = (id: string) => Number(id.split('-')[1]) % REF || 7;
/** The fleet a rival will field next time: fixed until it changes, so scouting tells the truth. */
export const raidSeed = (r: Rival) => `RAID-${r.id}-${r.raided}-${r.fleet}`;
/** The fleet a rival fields: its command ship and as many ships as it really has, so every raid
 * that costs it a ship makes the next one easier. */
export const rivalFleet = (r: Rival) => {
  const all = layout(r.fleet <= 4 ? 'easy' : r.fleet <= 8 ? 'difficult' : 'hard', raidSeed(r)).filter((u) => u.side === 'computer');
  return [...all.filter((u) => u.type === 1), ...all.filter((u) => u.type !== 1).slice(0, Math.max(1, r.fleet))];
};

const pixel = (type: number, size = 36): Safe => raw(spriteHtml(type, size));

/* ── Drawing: any set of planets, one optional route ── */
interface GxNode { id: string; label: string; index: number; weight: number; home: boolean; vassal?: boolean; void?: boolean; site?: 'mine' | 'theirs' | 'free' }
interface GxRoute { from: number; to: number; t: number; label: string }
/** Where the map is looking: centre and zoom (1 = the whole galaxy). */
interface Cam { x: number; y: number; z: number }
const viewBox = (c: Cam) => { const w = 300 / c.z; return `${(c.x - w / 2).toFixed(1)} ${(c.y - w / 2).toFixed(1)} ${w.toFixed(1)} ${w.toFixed(1)}`; };
function drawGalaxy(nodes: GxNode[], routes: GxRoute | GxRoute[] | null, sel: string | null, ref = REF, stars = 420, war: { from: number; to: number } | null = null, cam: Cam = { x: 0, y: 0, z: 1 }): Safe {
  const maxW = Math.max(1, ...nodes.map((x) => x.weight));
  const P = (i: number) => pos(i, ref).map((v) => +v.toFixed(1)) as [number, number];
  const dots = Array.from({ length: stars }, (_, i) => { const [x, y] = pos(i * 3 + 1, Math.max(ref, stars * 3)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 9 === 0 ? 0.9 : 0.45}" fill="${i % 7 === 0 ? '#86DFC6' : '#C5D7D9'}" opacity="${(0.25 + (i % 5) * 0.12).toFixed(2)}"/>`; }).join('');
  // Tribute lanes: every vassal's alpha flows home.
  const home = nodes.find((x) => x.home);
  let path = home ? nodes.filter((x) => x.vassal).map((x) => { const [vx, vy] = P(x.index), [hx, hy] = P(home.index); return `<path d="M${vx},${vy} L${hx},${hy}" class="gx-tribute"/>`; }).join('') : '';
  if (war) {
    // A rival-on-rival strike: a quick amber arc with a burst where it lands.
    const [ax, ay] = P(war.from), [bx, by] = P(war.to);
    path += `<path d="M${ax},${ay} Q${(ax + bx) / 2 - 18},${(ay + by) / 2 + 18} ${bx},${by}" class="gx-war"/><circle cx="${bx}" cy="${by}" r="6" class="gx-burst"/>`;
  }
  // A coalition comes down two lanes at once.
  for (const route of Array.isArray(routes) ? routes : routes ? [routes] : []) {
    const [rx, ry] = P(route.from), [hx, hy] = P(route.to);
    const fx = rx + (hx - rx) * route.t, fy = ry + (hy - ry) * route.t;
    path += `<path d="M${rx},${ry} Q${(rx + hx) / 2 + 20},${(ry + hy) / 2 - 20} ${hx},${hy}" class="gx-route"/><circle cx="${fx}" cy="${fy}" r="2.4" class="gx-fleet"/><text x="${fx + 4}" y="${fy - 3}" class="gx-eta">${esc(route.label)}</text>`;
  }
  const node = (x: GxNode) => {
    const [cx, cy] = P(x.index), rr = 2.2 + (x.weight / maxW) * 5.5, label = esc(x.label);
    return `<g class="gx-node ${x.home ? 'home' : x.void ? 'void' : x.site ? `site ${x.site}` : x.vassal ? 'vassal' : 'rival'} ${sel === x.id ? 'sel' : ''}" data-id="${esc(x.id)}" tabindex="0" role="button" aria-label="${label}">
      <circle cx="${cx}" cy="${cy}" r="${rr + 4}" class="halo"/><circle cx="${cx}" cy="${cy}" r="${rr}" class="core"/>
      <text x="${cx}" y="${cy - rr - 3}" text-anchor="middle">${x.vassal ? '♛ ' : ''}${label}</text></g>`;
  };
  return raw(`<svg class="gx" viewBox="${viewBox(cam)}" role="img" aria-label="은하 지도: 내 행성과 경쟁 세력">
    <defs><radialGradient id="gxcore"><stop offset="0" stop-color="#F3C878" stop-opacity=".55"/><stop offset=".25" stop-color="#43CDB6" stop-opacity=".12"/><stop offset="1" stop-color="#16142A" stop-opacity="0"/></radialGradient></defs>
    <circle r="150" fill="url(#gxcore)"/>${dots}${path}
    ${nodes.filter((x) => !x.home).map(node).join('')}${nodes.filter((x) => x.home).map(node).join('')}</svg>`);
}
/** Click and Enter on a planet → `pick(id)`; returns the unbinding. */
function bindNodes(root: HTMLElement, pick: (id: string) => void): () => void {
  const onClick = (e: Event) => { const g = (e.target as Element).closest<SVGGElement>('.gx-node'); if (g) pick(g.dataset.id!); };
  const onKey = (e: KeyboardEvent) => { const g = (e.target as Element).closest<SVGGElement>('.gx-node'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(g.dataset.id!); } };
  root.addEventListener('click', onClick); root.addEventListener('keydown', onKey);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}
const SCOUT = 'structs-kor.scouted';
const scouted = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(SCOUT) || '{}'); } catch { return {}; } };

const screen: Screen = {
  render(root) {
    const pid = needSession(root, '은하 지도', { demo: true });
    if (!pid) return;
    if (pid !== DEMO_ID) return realGalaxy(root, pid);
    let sel: string | null = null;
    // The camera: wheel or +/− to zoom, drag to pan, 0 to see everything. Kept across repaints.
    const cam: Cam = { x: 0, y: 0, z: 1 };
    const clampCam = () => { cam.z = Math.max(1, Math.min(4, cam.z)); const lim = 150 - 150 / cam.z; cam.x = Math.max(-lim, Math.min(lim, cam.x)); cam.y = Math.max(-lim, Math.min(lim, cam.y)); };
    const applyCam = () => { clampCam(); root.querySelector('svg.gx')?.setAttribute('viewBox', viewBox(cam)); };
    const zoom = (f: number) => { cam.z *= f; applyCam(); };
    // Scaled by how far the wheel moved, so a trackpad glides instead of slamming to the limit.
    const onWheel = (e: WheelEvent) => { if (!(e.target as Element).closest?.('svg.gx') || !e.deltaY) return; e.preventDefault(); zoom(Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002)); };
    // One pointer at a time, captured, so a release outside the window can't leave the map panning.
    let drag: { x: number; y: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const svg = (e.target as Element).closest?.('svg.gx');
      if (!svg || (e.target as Element).closest('.gx-node') || drag) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { (svg as SVGSVGElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) { drag = null; return; }
      const svg = root.querySelector<SVGSVGElement>('svg.gx'); if (!svg) return;
      const k = 300 / cam.z / Math.max(1, svg.getBoundingClientRect().width);
      cam.x -= (e.clientX - drag.x) * k; cam.y -= (e.clientY - drag.y) * k;
      drag.x = e.clientX; drag.y = e.clientY; applyCam();
    };
    const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);

    const map = (): Safe => {
      const raid = demo.raid;
      const nodes: GxNode[] = [
        ...demo.rivals().map((r) => ({ id: r.id, label: demo.bounty?.target === r.id ? `◆ ${r.name}` : r.name, index: planetIx(r.id), weight: demo.rivalWorth(r), home: false, vassal: r.vassal != null })),
        { id: DEMO_ID, label: '한빛 IV', index: HOME, weight: demo.netWorth(), home: true },
        ...demo.outposts.map((o) => ({ id: `op:${o.id}`, label: `▲ ${o.name}`, index: o.index, weight: demo.netWorth() * 0.15, home: false, site: (o.mine ? 'mine' : o.owner ? 'theirs' : 'free') as 'mine' | 'theirs' | 'free' })),
        ...(demo.boss ? [{ id: 'void', label: `공허 함대 · ${demo.boss.left}`, index: 1390, weight: demo.netWorth() * 0.8, home: false, void: true }] : []),
      ];
      const from = raid ? demo.rivals().find((r) => r.id === raid.owner) : null;
      const w = demo.war;
      const partner = raid?.partner ? demo.rivals().find((r) => r.id === raid.partner) : null;
      const lane = (id: string, label: string): GxRoute => ({ from: planetIx(id), to: HOME, t: raid!.eta === 0 ? 1 : 1 - raid!.eta / 6, label });
      return drawGalaxy(nodes, raid && from ? [lane(from.id, raid.eta ? raid.eta + '블록' : '교전'), ...(partner ? [lane(partner.id, '연합')] : [])] : null, sel, REF, 420, w ? { from: planetIx(w.from), to: planetIx(w.to) } : null, cam);
    };

    /* Scouted rivals get a war-room estimate: 12 autopilot play-outs, cached until either fleet changes. */
    const oddsCache = new Map<string, { won: number; played: number }>();
    let oddsStop: (() => void) | null = null, oddsKey = '', partial: { key: string; won: number; played: number } | null = null;
    const oddsChip = (r: Rival): Safe => {
      const mine = withAllies(demo.fleetUnits().units);
      if (!mine.some((u) => u.type === 1)) return html`<span class="chip jeok mono">지휘함 없음 · 출격 불가</span>`;
      const key = `${raidSeed(r)}|${mine.map((u) => `${u.id}:${u.health}`).join(',')}`;
      if (!oddsCache.has(key) && oddsKey !== key) {
        oddsStop?.(); oddsKey = key;
        const diff = r.fleet <= 4 ? 'easy' : r.fleet <= 7 ? 'difficult' : 'hard';
        // Only a finished estimate is cached; a half-run one restarts if you come back to it.
        oddsStop = estimateOdds([...mine, ...rivalFleet(r)], diff, 12, (won, played) => { partial = { key, won, played }; if (played === 12) oddsCache.set(key, { won, played }); if (played === 12 || played % 4 === 0) paint(); });
      }
      const o = oddsCache.get(key) ?? (partial?.key === key ? partial : null);
      const pct = o && o.played ? Math.round((o.won / o.played) * 100) : null;
      return html`<span class="chip ${pct == null ? '' : pct >= 60 ? 'cheong' : pct >= 35 ? 'hwang' : 'jeok'} mono" title="자동 지휘(어려움) 기준 모의 교전">${pct == null ? '승률 계산 중…' : `예상 승률 ${pct}%${o!.played < 12 ? ` · ${o!.played}/12` : ''}`}</span>`;
    };
    const intel = (): Safe => {
      const site = sel?.startsWith('op:') ? demo.outposts.find((o) => `op:${o.id}` === sel) : null;
      if (site) {
        const holder = site.owner && !site.mine ? demo.rivals().find((r) => r.id === site.owner) : null;
        return html`<section class="card game-panel accent intel"><div class="card-head"><h2>▲ ${site.name}</h2><span class="chip ${site.mine ? 'cheong' : holder ? 'jeok' : ''} mono">${site.mine ? '내 거점' : holder ? holder.name : '중립'}</span></div>
          <p class="note">장악하면: <b>${site.perk}</b> · 세력 +40</p>
          <div class="g2" style="gap:8px"><div class="stat"><small>수비대</small><strong>${site.garrison} / ${OUTPOST.maxGarrison}</strong></div><div class="stat"><small>${site.mine ? '방어 성공률 (최강 세력 기준)' : '공략 성공률'}</small><strong class="${site.odds >= 0.6 ? 'c-cheong' : site.odds >= 0.35 ? 'c-hwang' : 'c-jeok'}">${Math.round(site.odds * 100)}%</strong></div></div>
          ${site.mine ? html`<button class="btn gold" data-act="fortify" data-id="${site.id}" ${site.garrison >= OUTPOST.maxGarrison || demo.state.alpha < OUTPOST.fortify ? 'disabled' : ''}>요새화 · ${OUTPOST.fortify} g</button>
            <p class="note">경쟁 세력이 때때로 거점을 노립니다. 전함과 수비대가 많을수록 버팁니다.</p>`
          : html`<button class="btn danger lg" data-act="claim" data-id="${site.id}" ${demo.state.alpha < OUTPOST.claim ? 'disabled' : ''}>거점 공략 · ${OUTPOST.claim} g</button>
            <p class="note">성공률은 내 전함 수 대 수비대${holder ? '와 점령 세력의 함대' : ''}. 실패하면 함선이 손상됩니다.</p>`}
        </section>`;
      }
      const v = demo.boss;
      if (sel === 'void' && v) return html`<section class="card game-panel accent intel void-intel"><div class="card-head"><h2>공허 함대</h2><span class="chip jeok mono">${v.left}블록 남음</span></div>
        <p class="note">은하 바깥에서 온 함대입니다. ${v.left}블록 뒤 떠나면서 누군가를 덮칩니다 — 당신일 수도, 경쟁 세력일 수도 있습니다.</p>
        <div class="g2" style="gap:8px"><div class="stat"><small>함대</small><strong class="c-jeok">${v.fleet}기</strong></div><div class="stat"><small>격파 전리품</small><strong class="c-hwang">${v.reward} α</strong></div></div>
        <a class="btn danger lg" href="${href('/sim?raid=void')}">요격 출격</a>
        <p class="note">놓아두면: 덮친 세력의 함대 −2, 광석 절반. 당신을 덮치면 광석 절반과 구조체 손상.</p></section>`;
      const r = demo.rivals().find((x) => x.id === sel);
      if (!r) return html`<section class="card game-panel"><h2>정보</h2><p class="note">행성을 눌러 세력의 정보를 확인하세요. 붉은 점선은 진행 중인 습격 경로입니다.</p>
        ${hegemonyMeter()}
        <div class="stat"><small>내 세력</small><strong>${n(Math.round(demo.netWorth()))}</strong></div>
        <div class="g2" style="gap:8px"><div class="stat"><small>공물 · 블록당</small><strong class="c-hwang">+${demo.rates().tribute.toFixed(3)} α</strong></div>
        <div class="stat"><small>속국</small><strong>${demo.rivals().filter((r) => r.vassal != null).length} / ${demo.vassalCap()}</strong></div></div>
        <p class="note">세력을 ${DOMINION.raidsToSubjugate}번 약탈하면 복속을 요구할 수 있습니다. 복속한 세력은 습격하지 않고 매 블록 공물을 바칩니다. 함대가 다시 커지면 반란을 일으킵니다.</p></section>`;
      if (r.vassal != null) {
        const loy = demo.loyalty(r);
        return html`<section class="card game-panel accent intel"><div class="card-head">${raw(portraitHtml(seededPfp(r.id), 56))}<h2>${r.name}</h2><span class="chip hwang mono">♛ 복속</span></div>
          <div class="g2" style="gap:8px">
            <div class="stat"><small>공물 · 블록당</small><strong class="c-hwang">+${demo.tributeOf(r).toFixed(3)} α</strong></div>
            <div class="stat"><small>복속 기간</small><strong>${n(demo.state.height - r.vassal)}블록</strong></div>
            <div class="stat"><small>함대</small><strong class="${r.fleet >= DOMINION.rebelFleet ? 'c-jeok' : ''}">${r.fleet}기</strong></div>
            <div class="stat"><small>누적 공물 (전체)</small><strong>${demo.tributeTotal.toFixed(1)} α</strong></div>
          </div>
          <div class="loyal"><span class="label ${loy < 0.25 ? 'c-jeok' : 'dim'}">충성도 ${Math.round(loy * 100)}%${loy <= 0 ? ' · 반란 위험!' : ''}</span><div class="bar"><i style="width:${Math.round(loy * 100)}%;background:${loy < 0.25 ? 'var(--jeok)' : loy < 0.6 ? 'var(--hwang)' : 'var(--cheong)'}"></i></div></div>
          <button class="btn gold" data-act="disarm" ${r.fleet <= 2 ? 'disabled' : ''} style="justify-content:space-between">함선 해체 명령 <span class="mono">${DOMINION.disarmCost} g · 함대 −1</span></button>
          <p class="note">함대가 ${DOMINION.rebelFleet}기에 이르면 반란을 일으킬 수 있습니다. 이 세력을 습격하면 복속이 깨집니다.</p></section>`;
      }
      const sc = scouted()[r.id] === raidSeed(r);
      const fleet = sc ? rivalFleet(r) : [];
      const threat = demo.rivalWorth(r) / Math.max(1, demo.netWorth());
      return html`<section class="card game-panel accent intel"><div class="card-head">${raw(portraitHtml(seededPfp(r.id), 56))}<h2>${r.name}</h2><span class="chip jeok mono">${r.tag}</span>${demo.pactLeft(r.id) ? html`<span class="chip cheong mono">불가침 ${demo.pactLeft(r.id)}블록</span>` : ''}${demo.bounty?.target === r.id ? html`<span class="chip hwang mono">현상금 ${demo.bountyPayout()} α · ${demo.bounty.left}블록</span>` : ''}</div>
        <div class="g2" style="gap:8px">
          <div class="stat"><small>세력</small><strong>${n(Math.round(demo.rivalWorth(r)))}</strong></div>
          <div class="stat"><small>위협도</small><strong class="${threat > 1.2 ? 'c-jeok' : threat > 0.8 ? 'c-warn' : 'c-cheong'}">${threat > 1.2 ? '높음' : threat > 0.8 ? '보통' : '낮음'}</strong></div>
          <div class="stat"><small>비축 광석 · 약탈 가능</small><strong class="c-hwang">${n(Math.floor(r.ore))}</strong></div>
          <div class="stat"><small>함대</small><strong>${r.fleet}기</strong></div>
        </div>
        ${TEMPER[r.id] ? html`<p class="note"><span class="chip ${TEMPER[r.id].raid >= 3 ? 'jeok' : TEMPER[r.id].raid === 1 ? 'hwang' : 'cheong'}">${TEMPER[r.id].name}</span> ${TEMPER[r.id].note}</p>` : ''}
        ${r.grudge ? html`<p class="note grudge"><span class="mono c-jeok" aria-label="원한 ${r.grudge} / ${GRUDGE.max}">${'●'.repeat(r.grudge)}${'○'.repeat(GRUDGE.max - r.grudge)}</span> 원한 · 당신을 노릴 확률 +${Math.round(GRUDGE.per * r.grudge * 100)}% · ${GRUDGE.fade}블록마다 하나씩 사라짐</p>` : ''}
        ${sc ? html`<div class="scout"><span class="label c-cheong">정찰 보고 · 다음 교전 함대</span>${fleet.map((u) => html`<div class="scout-u">${pixel(u.type)}<span>${STRUCT_TYPE[u.type]}</span><small class="mono">${AMBIT[u.ambit]}</small></div>`)}</div>
          ${demo.ally?.id === r.id ? '' : oddsChip(r)}`
          : html`<button class="btn ghost" data-act="scout" style="justify-content:space-between">정찰기 파견 <span class="mono c-hwang">1 g · <kbd>S</kbd></span></button>`}
        ${demo.ally?.id === r.id ? html`<div class="notice">동맹 · ${demo.ally.left}블록 남음. 이 세력은 당신을 습격하지 않고, 당신의 습격에 빈 슬롯만큼 함선을 최대 ${ALLY.ships.length}척 보냅니다. 공작을 벌이면 동맹이 깨집니다.</div>`
          : html`<button class="btn ghost" data-act="ally" ${demo.ally || demo.state.alpha < ALLY.cost || r.id === '1-666' ? 'disabled' : ''} style="justify-content:space-between">${r.id === '1-666' ? '동맹 불가 · 누구와도 손잡지 않음' : `동맹 제안 · ${ALLY.term}블록`} <span class="mono">${ALLY.cost} g</span></button>`}
        <div class="ops"><span class="label dim">공작${(r.sabotaged ?? 0) > demo.state.height ? html` · <span class="c-cheong">사보타주 ${(r.sabotaged ?? 0) - demo.state.height}블록</span>` : ''}</span>
          ${(r.opUntil ?? 0) > demo.state.height ? html`<span class="mono c-warn" style="font-size:12px">경계 태세 · ${(r.opUntil ?? 0) - demo.state.height}블록</span>` : ''}
          ${(Object.keys(OPS) as OpId[]).map((k) => html`<button class="btn ghost op" data-act="op" data-op="${k}" ${demo.state.alpha < OPS[k].cost || (r.opUntil ?? 0) > demo.state.height || (k === 'sabotage' && (r.sabotaged ?? 0) > demo.state.height) ? 'disabled' : ''}><b>${OPS[k].name}</b><small>${OPS[k].what} · 성공 ${Math.round(opOdds(k) * 100)}% · ${OPS[k].cost} g</small></button>`)}
          <small class="dim">발각되면 불가침이 깨지고 보복 함대가 옵니다.</small></div>
        <div class="loyal"><span class="label dim">복속까지 약탈 ${Math.min(r.raided, DOMINION.raidsToSubjugate)} / ${DOMINION.raidsToSubjugate}</span><div class="bar"><i style="width:${Math.min(100, (r.raided / DOMINION.raidsToSubjugate) * 100)}%;background:var(--hwang)"></i></div></div>
        ${r.raided >= DOMINION.raidsToSubjugate ? html`<button class="btn gold lg" data-act="subjugate" style="justify-content:space-between">♛ 복속 요구 <span class="mono">주둔군 ${DOMINION.cost} g · 함대 4기로</span></button>` : ''}
        ${demo.ally?.id === r.id ? html`<p class="note">동맹은 습격할 수 없습니다.</p>` : html`<a class="btn danger lg" href="${href('/sim?raid=' + r.id)}">${demo.revenge?.rival === r.id ? `보복 출격 (${demo.revenge.left}블록) · 예상 노획 ${n(Math.floor(Math.min(r.ore, r.ore * 0.6 * REVENGE.bonus)))}` : `습격 출격 · 예상 노획 ${n(Math.floor(r.ore * 0.6))}`}${demo.bounty?.target === r.id ? ` + 현상금 ${demo.bountyPayout()} α` : ''}${demo.pactLeft(r.id) ? ' · 불가침 파기' : ''}</a>`}
        <p class="note">약탈 성공 시 이 세력의 함대가 1기 줄고, 다음 함대 구성이 바뀝니다.</p></section>`;
    };

    const news = (): Safe => {
      const list = demo.news;
      return html`<section class="card game-panel"><div class="card-head"><h2>은하 전황</h2><span class="end label c-hwang">WIRE</span></div>
        <span class="label dim">세력 추이</span>${powerChart()}
        ${list.length ? html`<ol class="newswire">${list.map((x) => html`<li><span class="mono faint">#${n(x.h)}</span> ${x.text}</li>`)}</ol>` : html`<p class="note">세력들이 서로 습격하면 여기에 소식이 올라옵니다. 약해진 세력은 복속할 기회입니다.</p>`}</section>`;
    };
    const view = (): Safe => html`
      <div class="card-head"><h1 style="font-size:28px">은하 지도</h1><span class="label c-cheong">GALAXY</span><span class="end mono dim">블록 #${n(demo.state.height)}</span></div>
      <div class="gx-wrap"><section class="card game-panel gx-card">${map()}<span class="gx-hint mono">휠·<kbd>+</kbd><kbd>−</kbd> 확대 · 드래그 이동 · <kbd>0</kbd> 전체</span></section><aside>${intel()}${news()}</aside></div>`;

    const paint = () => {
      if (!root.isConnected) return;
      mount(root, view(), handlers);
      setTiles([
        { label: '내 세력', value: n(Math.round(demo.netWorth())), tone: 'var(--cheong-hi)' },
        { label: '알파 매터', value: '', num: demo.state.alpha, fmt: (v) => n(v, 2) + ' g', tone: 'var(--hwang)' },
        { label: '위협', value: demo.raid ? `${demo.raid.name} · ${demo.raid.eta || '교전'}` : (() => { const nx = demo.nextRaider(); return nx ? `${nx.in}블록 뒤 · ${nx.name} ${Math.round(nx.p * 100)}%` : '없음'; })(), tone: demo.raid ? 'var(--jeok)' : 'var(--cheong)', alert: !!demo.raid },
      ]);
    };
    const handlers = {
      ally: () => {
        const r = demo.rivals().find((x) => x.id === sel);
        if (!r) return;
        const e = demo.formAlliance(r.id);
        if (e) { sfx.play('error'); toast(e); return; }
        sfx.play('confirm'); banner({ kicker: '동맹', title: r.name, sub: `${ALLY.term}블록 · 습격 중지 · 함선 지원`, tone: 'cheong', ms: 2200 });
        setTimeout(() => transmit(r.id, 'submit'), 900);
        paint();
      },
      claim: (el: HTMLElement) => {
        const res = demo.claimOutpost(el.dataset.id as OutpostId);
        if (typeof res === 'string') { sfx.play('error'); toast(res); return; }
        if (res.ok) { sfx.play('victory'); banner({ kicker: '거점 장악', title: res.text.split(' · ')[0], sub: res.text.split(' · ')[1], tone: 'cheong', ms: 2400 }); career.award(50, '거점 장악'); }
        else { sfx.play('defeat'); notify('공략 실패', res.text, 'jeok', null); }
        paint();
      },
      fortify: (el: HTMLElement) => {
        const e = demo.fortify(el.dataset.id as OutpostId);
        if (e) { sfx.play('error'); toast(e); return; }
        sfx.play('build'); paint();
      },
      op: (el: HTMLElement) => {
        const r = demo.rivals().find((x) => x.id === sel);
        if (!r) return;
        const res = demo.covert(r.id, el.dataset.op as OpId);
        if (typeof res === 'string') { sfx.play('error'); toast(res); return; }
        if (res.ok) { sfx.play('evade'); notify('공작 성공', res.text, 'cheong', null); }
        else { sfx.play('alarm'); notify('공작 발각', res.text, 'jeok', null); setTimeout(() => transmit(r.id, 'raid'), 900); }
        paint();
      },
      subjugate: () => {
        const r = demo.rivals().find((x) => x.id === sel);
        if (!r) return;
        const e = demo.subjugate(r.id);
        if (e) { sfx.play('error'); toast(e); return; }
        sfx.play('victory');
        banner({ kicker: '복속', title: `${r.name} 무릎을 꿇다`, sub: `매 블록 공물 +${demo.tributeOf(r).toFixed(3)} α`, tone: 'gold', ms: 2600 });
        career.award(60, `${r.name} 복속`);
        setTimeout(() => transmit(r.id, 'submit'), 1200);
        paint();
      },
      disarm: () => {
        const r = demo.rivals().find((x) => x.id === sel);
        if (!r) return;
        const e = demo.disarm(r.id);
        if (e) { sfx.play('error'); toast(e); return; }
        sfx.play('build'); notify('함선 해체', `${r.name} 함대 ${r.fleet}기 · 충성도 ${Math.round(demo.loyalty(r) * 100)}%`, 'hwang', null);
        paint();
      },
      scout: () => {
        const r = demo.rivals().find((x) => x.id === sel);
        if (!r) return;
        if (!demo.spend(1)) { sfx.play('error'); toast('알파 1 g 필요'); return; }
        try { localStorage.setItem(SCOUT, JSON.stringify({ ...scouted(), [r.id]: raidSeed(r) })); } catch { /* fine */ }
        sfx.play('evade'); notify('정찰 완료', `${r.name} 함대 ${rivalFleet(r).length}기 확인`, 'cheong', null);
        paint();
      },
    };
    const unbind = bindNodes(root, (id) => { sel = id === DEMO_ID ? null : id; sfx.play(id === 'void' ? 'alarm' : 'tick'); paint(); });
    paint();
    const offs = [demo.onBlock(paint), keys.scope({ s: () => sel && handlers.scout(), Escape: () => { sel = null; paint(); }, '=': () => zoom(1.25), '+': () => zoom(1.25), '-': () => zoom(1 / 1.25), '0': () => { cam.x = 0; cam.y = 0; cam.z = 1; applyCam(); } })];
    // First visit: a short tour of the map and its panel.
    if (!tourSeen('galaxy')) { const t = setTimeout(() => { if (root.isConnected) runTour('galaxy', GALAXY_TOUR); }, 700); offs.push(() => clearTimeout(t)); }
    offs.push(() => { root.removeEventListener('wheel', onWheel); root.removeEventListener('pointerdown', onDown); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp); });
    return () => { oddsStop?.(); offs.forEach((f) => f()); unbind(); setTiles([]); };
  },
};
export default screen;

/* ── The real galaxy: the guild's top commanders by alpha, their home worlds placed by planet id. ── */
async function realGalaxy(root: HTMLElement, pid: string): Promise<() => void> {
  mount(root, loading('은하 지도 불러오는 중…'));
  const soft = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
  let me: PlayerRow;
  let leaders: LeaderPlayer[] = [], players: (PlayerRow | null)[] = [], planets = 0, raid: RaidRow | null = null, fleet: FleetRow | null = null, recalling = false;
  try {
    me = await guildApi.player(pid);
    [leaders, planets, raid, fleet] = await Promise.all([
      soft(guildApi.leaderboard('player', 12), [] as LeaderPlayer[]),
      soft(guildApi.planetCount().then((c) => c.count), 0),
      me.planet_id ? soft(guildApi.activeRaid(me.planet_id), null) : Promise.resolve(null),
      soft(guildApi.fleetOf(pid), null),
    ]);
    players = await Promise.all(leaders.filter((l) => l.player_id !== pid).map((l) => soft(guildApi.player(l.player_id), null)));
  } catch (e) { mount(root, errorCard(e)); return () => undefined; }
  const ix = (planetId: string) => Number(String(planetId).split('-')[1]) || 1;
  const ref = Math.max(200, planets);
  const others = players.filter((x): x is PlayerRow => !!x && !!x.planet_id);
  const alphaOf = (x: PlayerRow) => Number(x.alpha) / 1e6;
  let sel: string | null = null;
  const shield = new Map<string, number | null>();

  const view = (): Safe => {
    const nodes: GxNode[] = [
      ...others.map((x) => ({ id: x.id, label: x.username || x.id, index: ix(x.planet_id), weight: alphaOf(x), home: false })),
      ...(me.planet_id ? [{ id: me.id, label: me.username || '나', index: ix(me.planet_id), weight: alphaOf(me), home: true }] : []),
    ];
    const raider = raid?.fleet_owner ? others.find((x) => x.id === raid!.fleet_owner) : null;
    const route = raid && me.planet_id ? { from: raider ? ix(raider.planet_id) : ix(me.planet_id) + 37, to: ix(me.planet_id), t: 1, label: '습격 중' } : null;
    const p = others.find((x) => x.id === sel);
    const rank = [...leaders].findIndex((l) => l.player_id === pid);
    return html`
      <div class="card-head"><h1 style="font-size:28px">은하 지도</h1><span class="label c-cheong">GALAXY</span><span class="end mono dim">행성 ${n(planets)}개 · 상위 사령관 ${others.length}명</span></div>
      <div class="gx-wrap"><section class="card game-panel gx-card">${drawGalaxy(nodes, route, sel, ref, Math.min(600, Math.max(200, planets)))}</section>
      <aside>${p ? html`<section class="card game-panel accent intel"><div class="card-head">${raw(portraitHtml(p.pfp, 56))}<h2>${p.username || p.id}</h2>${p.tag ? html`<span class="chip jeok mono">${p.tag}</span>` : ''}</div>
          <div class="g2" style="gap:8px">
            <div class="stat"><small>알파 매터</small><strong class="c-hwang">${micro(p.alpha)} g</strong></div>
            <div class="stat"><small>보유 광석 · 약탈 가능</small><strong>${n(p.ore)}</strong></div>
            <div class="stat"><small>행성</small><strong class="mono">${p.planet_id}</strong></div>
            <div class="stat"><small>보호막</small><strong>${shield.has(p.planet_id) ? (shield.get(p.planet_id) == null ? '—' : shield.get(p.planet_id) + '%') : '…'}</strong></div>
          </div>
          <p class="note">${p.guild_name || p.guild_id} · 함대가 도착하면 습격이 시작되고, 습격 증명은 함교의 작업 증명 카드가 계산합니다.</p>
          ${fleet ? html`<button class="btn danger lg" data-act="launch" data-to="${p.planet_id}" ${wallet.state === 'unlocked' && fleet.location_id !== p.planet_id ? '' : 'disabled'}>${fleet.location_id === p.planet_id ? '함대 주둔 중' : `함대 ${fleet.id} 출격 → ${p.planet_id}`}</button>` : ''}
          ${wallet.state === 'unlocked' ? '' : html`<p class="note">출격하려면 지갑 잠금을 해제하세요.</p>`}
          <a class="btn ghost" href="${href('/sim')}">시뮬레이터로 먼저 대비</a></section>`
        : html`<section class="card game-panel"><h2>정보</h2><p class="note">행성을 눌러 사령관을 살펴보세요. 크기는 알파 보유량입니다.${raid ? ' 붉은 점선은 내 행성을 습격 중인 함대입니다.' : ''}</p>
          ${fleet && fleet.status !== 'onStation' ? html`<div class="notice">함대 ${fleet.id} 원정 중 · ${fleet.location_id}<button class="btn ghost" style="min-height:32px;margin-left:auto" data-act="recall" ${wallet.state === 'unlocked' ? '' : 'disabled'}>귀환</button></div>` : ''}
          <div class="g2" style="gap:8px"><div class="stat"><small>내 알파</small><strong class="c-hwang">${micro(me.alpha)} g</strong></div><div class="stat"><small>알파 순위</small><strong>${rank >= 0 ? `#${rank + 1}` : '순위권 밖'}</strong></div></div></section>`}</aside></div>`;
  };
  const handlers = {
    launch: (el: HTMLElement) => {
      if (!fleet) return;
      const to = el.dataset.to!;
      if (!confirm(`체인에 서명합니다: 함대 ${fleet.id}를 행성 ${to}(으)로 보냅니다. 도착하면 습격이 시작되고, 방어자와 교전합니다. 출격할까요?`)) return;
      (el as HTMLButtonElement).disabled = true;
      void actions.fleetMove(fleet.id, to)
        .then((h) => { sfx.play('alarm'); notify('출격', `함대 ${fleet!.id} → ${to} · ${h.slice(0, 10)}…`, 'jeok', null); if (!pow.running) pow.start(); fleet = { ...fleet!, status: 'away', location_id: to }; paint(); })
        .catch((e) => { sfx.play('error'); toast('출격 실패: ' + (e as Error).message, 5000); (el as HTMLButtonElement).disabled = false; });
    },
    recall: (el: HTMLElement) => {
      if (!fleet || !me.planet_id || recalling) return;
      recalling = true; (el as HTMLButtonElement).disabled = true;
      void actions.fleetMove(fleet.id, me.planet_id)
        .then(() => { sfx.play('confirm'); notify('귀환', `함대 ${fleet!.id} → ${me.planet_id}`, 'cheong', null); fleet = { ...fleet!, status: 'onStation', location_id: me.planet_id }; paint(); })
        .catch((e) => { sfx.play('error'); toast('귀환 실패: ' + (e as Error).message, 5000); (el as HTMLButtonElement).disabled = false; })
        .finally(() => { recalling = false; });
    },
  };
  const paint = () => { if (root.isConnected) mount(root, view(), handlers); };
  const unbind = bindNodes(root, (id) => {
    if (id === me.id) { sel = null; paint(); return; }
    sel = id; sfx.play('tick'); paint();
    const p = others.find((x) => x.id === id);
    if (p && !shield.has(p.planet_id)) void soft(guildApi.shieldHealth(p.planet_id).then((r) => r.health), null).then((h) => { shield.set(p.planet_id, h); paint(); });
  });
  paint();
  setTiles([{ label: '알파 매터', value: micro(me.alpha) + ' g', tone: 'var(--hwang)' }, { label: '은하 행성', value: n(planets) }, { label: '위협', value: raid ? '습격 중' : '없음', tone: raid ? 'var(--jeok)' : 'var(--cheong)', alert: !!raid }]);
  return () => { unbind(); setTiles([]); };
}
