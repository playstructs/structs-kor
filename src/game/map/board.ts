/* The battle board: the game's planet/fleet map (structs-webapp MapComponent, by way of
 * structs-universe raidview.js) as one DOM grid of 128 px pixel-art tiles, with the official Lottie
 * attack, impact, shake, evade and destroy animations played through a serial event queue.
 *
 *   edge-top(space) · space ×2 · edge-bottom(space)⊕edge-top(air) · air ×2 · … · edge-bottom(water)
 *
 * Columns, left to right: defender command · planetary (≥2) · defender fleet ×2 · divider ·
 * attacker fleet ×2 · attacker command. The simulator's fleets meet away from home, so it has no
 * planetary block. Attacker mounts are mirrored so raiders face the planet. */
import './board.css';
import { AMBITS, type Ambit } from '../../data/catalogue';
import type { AttackDetail } from '../../sim/chain';
import { AMBIT_BG, beaconUrl, blockedUrl, flips, focusUrl, horizonUrl, injectArt, isEvade, layerZ, lottiePath, slugOf, stillLayers, tileUrl, typeNameOf, type HPos } from './art';
import { sfx } from '../sfx';
import { float, shake, flash } from '../fx';
import { esc } from '../../ui/dom';
import { STRUCT_TYPE, AMBIT as AMBIT_KO } from '../../i18n/ko';

export type BoardSide = 'defender' | 'attacker';
export interface BoardStruct {
  id: string; typeId: number; ambit: Ambit; slot: number; side: BoardSide;
  category: 'planet' | 'fleet'; isCommand: boolean; health: number; maxHealth: number;
  online?: boolean; hidden?: boolean; protects?: string | null; building?: number | null;
  /** Running past spec (demo overclock): drawn hot. */
  hot?: boolean;
  /** Veteran rank (0–3): stars on its tag. */
  vet?: number;
  /** Work it owes the chain (a build, a mine or a refine) and how far along: a plate under the tile. */
  work?: BoardWork | null;
}
/** An order in flight about a tile: `target` is a struct id or a tile key (plan|land|0, fleet|defender|space|1).
 * `ghost` shows the build marker on an empty tile while a build order is on its way. */
export interface BoardOrder { target: string; phase: 'sending' | 'pending' | 'done' | 'failed'; label: string; ghost?: boolean }
const ORDER_PHASE: Record<BoardOrder['phase'], string> = { sending: '전송 중', pending: '처리 중', done: '완료', failed: '실패' };
export interface BoardWork { kind: 'BUILD' | 'MINE' | 'REFINE'; label: string; p: number | null; done?: boolean }
const WORK: Record<BoardWork['kind'], { ko: string; glyph: string }> = { BUILD: { ko: '건설', glyph: '\ue90c' }, MINE: { ko: '채굴', glyph: '\ue91b' }, REFINE: { ko: '정제', glyph: '\ue925' } };
export interface BoardOpts {
  /** Planetary slots per ambit; omit for a fleet-only (simulator) board. */
  slots?: Partial<Record<Ambit, number>>;
  /** Hide the attacker half (no raider present). */
  fog?: boolean;
  /** Animation speed multiplier (the simulator runs hot). */
  speed?: number;
  onPick?: (id: string, side: BoardSide) => void;
  onTile?: (key: string, ambit: Ambit, side: BoardSide) => void;
  label?: string;
  /** The tallest the board may draw (px), so the whole field fits on screen. */
  maxHeight?: () => number;
  zoom?: 'full' | 'close';
  /** No sound, words or screen shake (attract mode). */
  quiet?: boolean;
  /** The board is the whole screen: it fills its host's height too, and drags to pan. */
  stage?: boolean;
}

type Col = 'DC' | 'DP' | 'DF' | 'X' | 'AF' | 'AC';
const TILE = 128, ROWS = 2;

import { planAttack, type AnimEvent } from './plan';

type LottieModule = typeof import('lottie-web').default;
let lottieP: Promise<LottieModule> | null = null;
const lottie = () => (lottieP ??= import('lottie-web/build/player/lottie_svg').then((m) => (m.default ?? m) as LottieModule));
/** Each bundle's JSON is fetched and parsed once; every play gets its own copy (lottie mutates it). */
const bundles = new Map<string, Promise<unknown>>();
const bundle = (path: string) => {
  let p = bundles.get(path);
  if (!p) { p = fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))); bundles.set(path, p); p.catch(() => bundles.delete(path)); }
  return p.then((d) => structuredClone(d));
};

export class Board {
  readonly el: HTMLElement;
  private map: HTMLElement;
  private cols: Col[];
  private anchors = new Map<string, HTMLElement>();
  /** Playable cells in reading order, with their grid position, for the keyboard cursor. */
  private cells: HTMLElement[] = [];
  private cursor: HTMLElement | null = null;
  private wantFocus = false;
  private static uid = 0;
  private id = ++Board.uid;
  private structs = new Map<string, BoardStruct>();
  private selected: string | null = null;
  private marked = new Set<string>();
  private queue: AnimEvent[] = [];
  private playing = false;
  private idleFns: (() => void)[] = [];
  private seq = 0;
  /** Newest event already landed per struct: an older one finishing late must not roll health back. */
  private landedSeq = new Map<string, number>();
  /** What each mount last drew, so unchanged structs are left alone (no restarted idle bob). */
  private painted = new Map<string, string>();
  private ro: ResizeObserver;
  private disposed = false;
  private framed = false;
  /** Where the camera last was while the board was on screen. */
  private cam = { l: 0, t: 0 };
  /** The camera has been pointed at the planet's built structs once. */
  private homed = false;
  /** The player has moved the camera themselves: stop pointing it at the planet on refreshes. */
  private userMoved = false;
  /** Tiles showing an order in flight, with what they show (so a refresh doesn't restart the animation). */
  private ordered = new Map<HTMLElement, string>();
  speed: number;
  /** 'full' fits the whole field; 'close' fills the width and scrolls. */
  zoom: 'full' | 'close' = 'full';

  constructor(private opts: BoardOpts = {}) {
    this.speed = opts.speed ?? 1;
    this.zoom = opts.zoom ?? 'full';
    this.cols = this.columns();
    this.el = document.createElement('div');
    this.el.className = 'bd';
    this.el.innerHTML = `<div class="bd-scroll"><div class="bd-map" role="grid" tabindex="0" aria-label="${esc(opts.label ?? '전장')} · 방향키로 이동, Enter로 선택"></div></div><button class="bd-zoom hud-btn" type="button" title="확대/전체 보기 (Z)" aria-label="확대/전체 보기"></button>`;
    this.el.querySelector('.bd-zoom')!.addEventListener('click', () => this.toggleZoom());
    this.map = this.el.querySelector('.bd-map')!;
    this.build();
    this.map.addEventListener('click', (e) => this.click(e));
    this.map.addEventListener('keydown', (e) => this.key(e));
    // Only keyboard focus shows the cursor: a click focuses the map too, and walking the cursor to the
    // first tile then would scroll the camera away from where the player clicked.
    this.map.addEventListener('focus', () => { this.wantFocus = true; if (!this.map.matches(':focus-visible')) return; if (!this.cursor) this.moveCursor(this.cells[0] ?? null); else this.cursor.classList.add('bd-cursor'); });
    this.map.addEventListener('blur', (e) => {
      this.cursor?.classList.remove('bd-cursor');
      // Focus moved somewhere else on purpose (not lost to a re-render detaching us).
      if (e.relatedTarget || (this.el.isConnected && document.activeElement !== document.body)) this.wantFocus = false;
    });
    if (opts.stage) { this.el.classList.add('bd-stage'); this.pan(); }
    const sc = this.el.querySelector<HTMLElement>('.bd-scroll')!;
    sc.addEventListener('scroll', () => { if (this.el.isConnected) this.cam = { l: sc.scrollLeft, t: sc.scrollTop }; }, { passive: true });
    for (const ev of ['wheel', 'touchmove'] as const) sc.addEventListener(ev, () => { this.userMoved = true; }, { passive: true });
    this.ro = new ResizeObserver(() => this.fit());
    addEventListener('resize', this.onResize);
    this.ro.observe(this.el);
  }

  private onResize = () => this.fit();
  dispose() {
    this.disposed = true; this.ro.disconnect(); removeEventListener('resize', this.onResize);
    // Land what was still queued so whoever awaits idle() settles on the true outcome.
    for (const q of this.queue.splice(0)) this.land(q);
    this.playing = false;
    for (const f of this.idleFns.splice(0)) f();
    this.el.remove();
  }

  /* ── Grid ── */
  private columns(): Col[] {
    const most = Math.max(0, ...AMBITS.map((a) => Number(this.opts.slots?.[a] ?? 0)));
    const plan = this.opts.slots ? Math.max(2, Math.ceil(most / ROWS)) : 0;
    const counts: [Col, number][] = [['DC', 1], ['DP', plan], ['DF', 2], ['X', 1], ['AF', 2], ['AC', 1]];
    return counts.flatMap(([c, n]) => Array<Col>(n).fill(c));
  }
  private hpos(i: number): HPos { return i === 0 ? 'left' : i === this.cols.length - 1 ? 'right' : 'middle'; }
  private slotAt(col: Col, row: number, i: number) {
    const first = this.cols.indexOf(col), last = this.cols.lastIndexOf(col);
    return (last - i) + row * (last - first + 1);
  }

  private build() {
    const cols = this.cols, n = cols.length;
    const strip = (ambit: Ambit, v: number) => `<div class="bd-strip">${cols.map((_, i) => `<div class="bd-tile" style="background-image:url('${tileUrl(ambit, v, this.hpos(i))}')"></div>`).join('')}</div>`;
    const horizon = () => `<div class="bd-strip">${cols.map((_, i) => `<div class="bd-tile" style="background-image:url('${horizonUrl(this.hpos(i))}')"></div>`).join('')}</div>`;
    const transition = (prev: Ambit | null, next: Ambit | null) => `<div class="bd-row bd-transition">${prev ? strip(prev, 4) : ''}${next === 'land' ? horizon() : ''}${next ? strip(next, 0) : ''}</div>`;
    const divider = cols.indexOf('X');
    const slotsFor = (a: Ambit) => Number(this.opts.slots?.[a] ?? ROWS * 2);
    let html = '', prev: Ambit | null = null;
    for (const ambit of AMBITS) {
      if (this.opts.slots && slotsFor(ambit) <= 0) continue;
      html += transition(prev, ambit);
      prev = ambit;
      for (let r = 0; r < ROWS; r++) {
        html += `<div class="bd-row">${r === 0 ? `<div class="bd-band"><b>${AMBIT_KO[ambit]}</b></div>` : ''}`;
        for (let i = 0; i < n; i++) {
          const col = cols[i], side: BoardSide = i < divider ? 'defender' : 'attacker';
          const bg = `background-color:${AMBIT_BG[ambit]};background-image:url('${tileUrl(ambit, r === 0 ? 1 : 3, this.hpos(i))}')`;
          let key: string | null = null, marker = '';
          if (col === 'X') { html += `<div class="bd-cell bd-divider" style="${bg}"></div>`; continue; }
          if (col === 'DC' || col === 'AC') {
            if (r === 0) key = `cmd|${side}|${ambit}`; else marker = `<img class="bd-marker" src="${blockedUrl(ambit)}" alt="">`;
          } else if (col === 'DP') {
            const s = this.slotAt('DP', r, i);
            if (s >= slotsFor(ambit)) marker = `<img class="bd-marker" src="${blockedUrl(ambit)}" alt="">`;
            else { key = `plan|${ambit}|${s}`; marker = `<img class="bd-marker bd-beacon" src="${beaconUrl(ambit)}" alt="">`; }
          } else key = `fleet|${side}|${ambit}|${this.slotAt(col, r, i)}`;
          // On the home planet, an empty tile of ours says it can be built on.
          const tip = key && this.opts.slots && side === 'defender' && col !== 'DC' ? '<span class="bd-slot-tip" aria-hidden="true">+ 건설</span>' : '';
          html += `<div class="bd-cell${key ? '' : ' bd-blocked'}" style="${bg}" ${key ? `data-key="${key}" data-ambit="${ambit}" data-side="${side}"` : ''}>${marker}${tip}${key ? `<div class="bd-mount${side === 'attacker' ? ' bd-flip' : ''}"></div><img class="bd-focus" alt="">` : ''}</div>`;
        }
        html += '</div>';
      }
    }
    html += transition(prev, null);
    if (this.opts.fog != null) html += `<div class="bd-fog${this.opts.fog ? '' : ' off'}" style="left:${divider * TILE}px;width:${(n - divider) * TILE}px"><div class="bd-fog-edge"></div><div class="bd-fog-body"></div><span>미확인 영역</span></div>`;
    this.map.innerHTML = html;
    this.map.style.width = `${n * TILE}px`;
    this.anchors.clear();
    for (const c of this.map.querySelectorAll<HTMLElement>('.bd-cell[data-key]')) this.anchors.set(c.dataset.key!, c);
    // Grid semantics and positions for keyboard play.
    let r = 0;
    for (const row of this.map.querySelectorAll<HTMLElement>('.bd-row')) {
      if (row.classList.contains('bd-transition')) { row.setAttribute('aria-hidden', 'true'); continue; }
      row.setAttribute('role', 'row');
      row.querySelectorAll<HTMLElement>('.bd-cell').forEach((c, col) => { c.setAttribute('role', 'gridcell'); c.dataset.r = String(r); c.dataset.c = String(col); c.id = `bd${this.id}-${r}-${col}`; });
      r++;
    }
    this.cells = [...this.map.querySelectorAll<HTMLElement>('.bd-cell[data-key]')];
    this.cursor = null;
    this.ordered.clear();
    this.fit();
  }

  /** Put the board into a freshly rendered host, keeping keyboard focus if it had it. */
  attach(host: Element) {
    if (this.el.parentElement !== host) {
      // Moving the board resets its scroll box: keep the camera where the player left it. A re-render
      // has usually detached it already (its scroll then reads 0), so the camera is the last one seen.
      const sc = this.el.querySelector<HTMLElement>('.bd-scroll')!, { l, t } = this.cam;
      host.appendChild(this.el);
      sc.scrollLeft = l; sc.scrollTop = t;
    }
    this.fit();
    if (this.wantFocus && document.activeElement !== this.map) { this.map.focus({ preventScroll: true }); this.cursor?.classList.add('bd-cursor'); }
  }

  /** Fit the board's width to its box; snap to integer upscales on big screens so pixels stay crisp. */
  fit() {
    const w = this.el.clientWidth;
    if (!w) return;
    const mapW = this.cols.length * TILE, mapH = this.map.scrollHeight || 13 * TILE;
    let z = w / mapW;
    const maxH = this.opts.maxHeight?.();
    const scroll = this.el.querySelector<HTMLElement>('.bd-scroll')!;
    if (this.opts.stage) {
      // Full: the whole field between the HUD bars, like a chessboard. Close: fill the screen and pan.
      const cs = getComputedStyle(scroll), h = scroll.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), ww = scroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const fitZ = Math.min(ww / mapW, h / mapH);
      z = this.zoom === 'full' ? fitZ : Math.max(1, Math.min(2, w / mapW));
      if (this.zoom === 'close') z = Math.floor(z * 2) / 2;
      this.el.querySelector('.bd-zoom')!.innerHTML = this.zoom === 'full' ? '<i class="si icon-add"></i>' : '<i class="si icon-subtract"></i>';
      this.map.style.setProperty('zoom', String(z));
      this.el.style.setProperty('--bd-zoom', String(z));
      // The camera opens on the middle of the field (air/land), not the edge of space; on a screen
      // narrower than the field, on the planet rather than the empty fleet lanes.
      if (!this.framed && (scroll.scrollHeight > scroll.clientHeight || scroll.scrollWidth > scroll.clientWidth)) {
        this.framed = true;
        if (!this.home()) { scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * 0.4; this.cam = { l: scroll.scrollLeft, t: scroll.scrollTop }; }
      }
      return;
    }
    if (this.zoom === 'close' && maxH) { z = Math.min(2, z); scroll.style.maxHeight = `${Math.max(240, maxH)}px`; scroll.style.overflowY = 'auto'; }
    else { scroll.style.maxHeight = ''; scroll.style.overflowY = ''; if (maxH) z = Math.min(z, Math.max(240, maxH) / mapH); }
    this.el.querySelector('.bd-zoom')!.innerHTML = this.zoom === 'full' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21M10 7v6M7 10h6"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21M7 10h6"/></svg>';
    if (z >= 2) z = Math.floor(z);
    this.map.style.setProperty('zoom', String(z));
    this.el.style.setProperty('--bd-zoom', String(z));
  }

  /** Drag the field to pan it (webapp's MapPanController): past 5 px a press is a pan, not a click. */
  private pan() {
    const sc = this.el.querySelector<HTMLElement>('.bd-scroll')!;
    let from: { x: number; y: number; l: number; t: number } | null = null, moved = false;
    sc.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.pointerType === 'touch') return; from = { x: e.clientX, y: e.clientY, l: sc.scrollLeft, t: sc.scrollTop }; moved = false; });
    addEventListener('pointermove', (e) => {
      if (!from) return;
      const dx = e.clientX - from.x, dy = e.clientY - from.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved && sc.scrollWidth <= sc.clientWidth && sc.scrollHeight <= sc.clientHeight) return;
      moved = true; this.userMoved = true; document.body.classList.add('is-map-panning');
      sc.scrollLeft = from.l - dx; sc.scrollTop = from.t - dy;
    });
    addEventListener('pointerup', () => { from = null; document.body.classList.remove('is-map-panning'); });
    // The click that ends a drag is not a tile pick.
    sc.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }

  /** On a screen narrower than the field, point the stage camera at the planet: its built structs, or
   * its slots while it has none. False when the field fits across and the camera was left alone. */
  home(smooth = false): boolean {
    const sc = this.el.querySelector<HTMLElement>('.bd-scroll');
    if (!sc || !this.opts.stage || sc.scrollWidth <= sc.clientWidth) return false;
    const built = [...this.structs.values()].filter((s) => s.side === 'defender' && s.category === 'planet' && !s.isCommand && s.health > 0).map((s) => this.anchors.get(this.keyFor(s))).filter((c): c is HTMLElement => !!c);
    const cells = built.length ? built : [...this.anchors].filter(([k]) => k.startsWith('plan|')).map(([, c]) => c);
    if (!cells.length) return false;
    if (built.length) this.homed = true;
    // The view is the scroll box less its padding (the HUD bars lie over that).
    const cs = getComputedStyle(sc), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    const r = sc.getBoundingClientRect(), rs = cells.map((c) => c.getBoundingClientRect()), viewH = sc.clientHeight - pt - pb;
    const left = Math.min(...rs.map((b) => b.left)), right = Math.max(...rs.map((b) => b.right));
    const top = Math.min(...rs.map((b) => b.top)), bottom = Math.max(...rs.map((b) => b.bottom));
    // Centred when it fits. Wider than the screen, it shows from its left edge, the side it is built
    // from; taller, the camera goes where most of it is rather than the empty sky between ambits.
    const x = right - left <= sc.clientWidth ? (left + right) / 2 - r.left - sc.clientWidth / 2 : left - r.left - 8;
    const midY = bottom - top <= viewH ? (top + bottom) / 2 : rs.reduce((a, b) => a + b.top + b.height / 2, 0) / rs.length;
    const y = midY - r.top - pt - viewH / 2;
    sc.scrollTo({ left: sc.scrollLeft + x, top: sc.scrollTop + y, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) this.cam = { l: sc.scrollLeft, t: sc.scrollTop };
    return true;
  }

  toggleZoom() { this.zoom = this.zoom === 'full' ? 'close' : 'full'; this.fit(); }
  /** Scroll a struct into view in close-up. */
  reveal(id: string) {
    const cell = this.cellOf(id) ?? this.anchors.get(id) ?? null, sc = this.el.querySelector<HTMLElement>('.bd-scroll');
    if (this.zoom !== 'close' || !cell || !sc) return;
    const c = cell.getBoundingClientRect(), r = sc.getBoundingClientRect();
    if (c.top >= r.top && c.bottom <= r.bottom) return;
    sc.scrollTo({ top: c.top - r.top + sc.scrollTop - sc.clientHeight / 2 + c.height / 2, behavior: 'smooth' });
  }

  /** Lift or lower the fog over the attacker's half. */
  setFog(on: boolean) { this.map.querySelector('.bd-fog')?.classList.toggle('off', !on); }

  private keyFor(s: BoardStruct) {
    if (s.isCommand) return `cmd|${s.side}|${s.ambit}`;
    if (s.category === 'planet') return `plan|${s.ambit}|${s.slot}`;
    return `fleet|${s.side}|${s.ambit}|${s.slot}`;
  }
  private cellOf(id: string) { const s = this.structs.get(id); return s ? this.anchors.get(this.keyFor(s)) ?? null : null; }

  /* ── Structs ── */
  /** Replace the board's structs (keeps any animation in flight). */
  setStructs(list: BoardStruct[]) {
    const next = new Map(list.map((s) => [s.id, s]));
    for (const [id, old] of this.structs) {
      const now = next.get(id);
      // Gone, or moved to another tile: empty the tile it used to hold.
      if (!now || this.keyFor(now) !== this.keyFor(old)) { this.clear(this.cellOf(id)); this.painted.delete(id); }
    }
    this.structs = next;
    for (const s of list) this.paint(s.id);
    // Until the planet has something built, each refresh re-aims at its slots, but never once the
    // player has looked elsewhere: an instant jump after a click reads as the map teleporting.
    if (this.framed && !this.homed && !this.userMoved) this.home();
  }
  get(id: string) { return this.structs.get(id); }

  private clear(cell: HTMLElement | null) {
    if (!cell) return;
    for (const [id, x] of this.structs) if (this.cellOf(id) === cell && x.health <= 0) this.painted.delete(id);
    cell.querySelector('.bd-mount')?.replaceChildren();
    cell.querySelector('.bd-hud')?.remove();
    cell.classList.remove('bd-has');
    cell.removeAttribute('aria-label');
  }

  private paint(id: string, hpOverride?: number) {
    const s = this.structs.get(id), cell = this.cellOf(id);
    if (!s || !cell) return;
    const mount = cell.querySelector<HTMLElement>('.bd-mount')!;
    const hp = hpOverride ?? s.health;
    const w = s.work ?? null;
    const sig = [s.typeId, hp, s.maxHealth, s.online, s.hidden, s.protects, s.building, s.isCommand, s.hot, s.vet, w && `${w.kind}${w.label}${w.p}${w.done}`].join('|');
    if (this.painted.get(id) === sig && cell.querySelector('.bd-still')) return;
    this.painted.set(id, sig);
    if (hp <= 0) { this.clear(cell); return; }
    cell.classList.add('bd-has');
    const building = s.building != null || w?.kind === 'BUILD';
    const offline = s.online === false && !building;
    const layers = building
      ? `<img src="${import.meta.env.BASE_URL}img/structs/deployment-indicator/deployment-indicator.gif" style="z-index:200" alt="">`
      : stillLayers(s.typeId, hp, s.maxHealth, s.hidden).map((l) => `<img src="${l.src}" style="z-index:${l.z}" alt="">`).join('');
    const pips = Array.from({ length: s.maxHealth }, (_, i) => `<i class="${i < hp ? 'on' : ''}"></i>`).join('');
    const badges = [offline ? '<span class="bd-badge off" title="전원 꺼짐">꺼짐</span>' : '', s.protects ? '<span class="bd-badge def" title="아군을 지키는 중">방어</span>' : '', s.isCommand ? '<span class="bd-badge cmd" title="지휘함">지휘</span>' : '', s.hot && !offline ? '<span class="bd-badge hot" title="과부하 운전">과열</span>' : '', s.vet ? `<span class="bd-badge vet" title="베테랑">${'★'.repeat(s.vet)}</span>` : ''].join('');
    const plate = w ? `<div class="bd-work ${w.kind.toLowerCase()}${w.done ? ' done' : ''}" title="${WORK[w.kind].ko} · ${esc(w.label)}"><i class="si">${WORK[w.kind].glyph}</i><span>${WORK[w.kind].ko}</span><em>${esc(w.label)}</em>${w.p != null ? `<b><i style="width:${Math.round(Math.max(0, Math.min(1, w.p)) * 100)}%"></i></b>` : ''}</div>` : '';
    mount.innerHTML = `<div class="bd-still${offline ? ' bd-offline' : ''}${s.hot && !offline ? ' bd-hot' : ''}${s.hidden ? ' bd-stealth' : ''}">${layers}</div><div class="bd-anims"></div>`;
    let hud = cell.querySelector<HTMLElement>('.bd-hud');
    if (!hud) { hud = document.createElement('div'); hud.className = 'bd-hud'; cell.appendChild(hud); }
    hud.innerHTML = `<div class="bd-pips">${pips}</div><div class="bd-badges">${badges}</div>${plate}`;
    cell.setAttribute('aria-label', `${s.side === 'defender' ? '아군' : '적'} ${STRUCT_TYPE[s.typeId] ?? typeNameOf(s.typeId)} 내구도 ${hp}/${s.maxHealth}${w ? ` · ${WORK[w.kind].ko} ${w.label}` : ''}`);
  }

  /* ── Orders in flight ── */
  /** Mark the tiles that orders are about: sending and processing pulse, done flashes, failed shows red.
   * The first order about a tile wins (the newest, as the list comes newest first). */
  setOrders(list: BoardOrder[]) {
    const want = new Map<HTMLElement, BoardOrder>();
    for (const o of list) { const cell = this.cellOf(o.target) ?? this.anchors.get(o.target); if (cell && !want.has(cell)) want.set(cell, o); }
    for (const cell of [...this.ordered.keys()]) if (!want.has(cell)) { cell.querySelector('.bd-order')?.remove(); this.ordered.delete(cell); }
    for (const [cell, o] of want) {
      const moving = o.phase === 'sending' || o.phase === 'pending';
      const ghost = !!o.ghost && moving && !cell.classList.contains('bd-has');
      const sig = `${o.phase}|${o.label}|${ghost}`;
      if (this.ordered.get(cell) === sig) continue;
      this.ordered.set(cell, sig);
      let el = cell.querySelector<HTMLElement>('.bd-order');
      if (!el) { el = document.createElement('div'); el.setAttribute('role', 'status'); cell.appendChild(el); }
      el.className = `bd-order ${o.phase}`;
      el.innerHTML = `${ghost ? `<img class="bd-order-ghost" src="${import.meta.env.BASE_URL}img/structs/deployment-indicator/deployment-indicator.gif" alt="">` : ''}<div class="bd-order-plate"><i aria-hidden="true">${o.phase === 'done' ? '✓' : o.phase === 'failed' ? '✕' : ''}</i><span>${esc(o.label)}</span><em>${ORDER_PHASE[o.phase]}</em></div>`;
    }
  }

  /* ── Selection & targeting marks ── */
  select(id: string | null) {
    if (this.selected) this.ring(this.selected, null);
    this.selected = id;
    if (id) this.ring(id, 'friendly');
  }
  /** Mark valid targets with the enemy focus ring (cleared with an empty list). */
  markTargets(ids: string[]) {
    for (const id of this.marked) if (id !== this.selected) this.ring(id, null);
    this.marked = new Set(ids);
    for (const id of ids) this.ring(id, 'enemy');
  }
  private ring(id: string, kind: 'friendly' | 'enemy' | null) {
    const cell = this.cellOf(id);
    const img = cell?.querySelector<HTMLImageElement>('.bd-focus');
    if (!cell || !img) return;
    cell.classList.toggle('bd-focused', !!kind);
    cell.classList.toggle('bd-target', kind === 'enemy');
    if (kind) img.src = focusUrl(kind);
  }
  /** Mark empty tiles a selected unit may move to (cleared with an empty list). */
  markTiles(keys: string[]) {
    for (const c of this.map.querySelectorAll('.bd-dest')) c.classList.remove('bd-dest');
    for (const k of keys) this.anchors.get(k)?.classList.add('bd-dest');
  }
  /** Pulse a tile (a hint for the tutorial and objectives). */
  ping(key: string) { const c = this.cellOf(key) ?? this.anchors.get(key); if (!c) return; c.classList.remove('bd-ping'); void c.offsetWidth; c.classList.add('bd-ping'); }

  private moveCursor(cell: HTMLElement | null) {
    if (!cell) return;
    this.cursor?.classList.remove('bd-cursor');
    this.cursor = cell;
    cell.classList.add('bd-cursor');
    this.map.setAttribute('aria-activedescendant', cell.id);
    const k = cell.dataset.key!;
    const s = [...this.structs.values()].find((x) => this.keyFor(x) === k && x.health > 0);
    if (s) this.reveal(s.id); else this.revealCell(cell);
  }
  private revealCell(cell: HTMLElement) {
    const sc = this.el.querySelector<HTMLElement>('.bd-scroll');
    if (this.zoom !== 'close' || !sc) return;
    const c = cell.getBoundingClientRect(), r = sc.getBoundingClientRect();
    if (c.top < r.top || c.bottom > r.bottom) sc.scrollTo({ top: c.top - r.top + sc.scrollTop - sc.clientHeight / 2 + c.height / 2, behavior: 'smooth' });
  }
  /** Arrow keys walk the playable cells (nearest in that direction); Enter/Space acts like a click. */
  private key(e: KeyboardEvent) {
    const dirs: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.key === 'Enter' || e.key === ' ') {
      if (!this.cursor) return;
      e.preventDefault(); e.stopPropagation();
      this.click({ target: this.cursor } as unknown as Event);
      return;
    }
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const at = this.cursor ?? this.cells[0];
    if (!at) return;
    const r0 = Number(at.dataset.r), c0 = Number(at.dataset.c);
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const c of this.cells) {
      const dr = Number(c.dataset.r) - r0, dc = Number(c.dataset.c) - c0;
      const along = dr * d[0] + dc * d[1];
      if (along <= 0) continue;
      const across = Math.abs(d[0] ? dc : dr);
      const score = along + across * 3;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    this.moveCursor(best ?? at);
  }

  private click(e: Event) {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.bd-cell[data-key]');
    if (!cell) return;
    const key = cell.dataset.key!, side = cell.dataset.side as BoardSide;
    const s = [...this.structs.values()].find((x) => this.keyFor(x) === key && x.health > 0);
    if (s) this.opts.onPick?.(s.id, side); else this.opts.onTile?.(key, cell.dataset.ambit as Ambit, side);
  }

  /* ── Combat: one attack event → the game's ordered animation events ── */
  playAttack(d: AttackDetail) {
    for (const e of planAttack(d, (id) => this.structs.get(id))) this.enqueue(e);
  }

  /** Play an arbitrary named animation on a struct (deployments, active loops, victory). */
  play(structId: string, names: string[], healthAfter: number | null = null) { this.enqueue({ structId, names, healthAfter }); }

  /** Resolve when the queue has drained. */
  idle(): Promise<void> { return this.playing || this.queue.length ? new Promise((r) => this.idleFns.push(r)) : Promise.resolve(); }
  get busy() { return this.playing || this.queue.length > 0; }

  private enqueue(e: AnimEvent) {
    e.seq = ++this.seq;
    // A backlog fast-forwards: health lands at once, flourishes are skipped (raidview SIM_BACKLOG).
    if (this.queue.length >= 6) { for (const q of this.queue.splice(0)) this.land(q); this.land(e); return; }
    this.queue.push(e);
    if (!this.playing) void this.next();
  }
  private land(e: AnimEvent) {
    const s = this.structs.get(e.structId);
    if (!s || e.healthAfter == null) return;
    if ((e.seq ?? 0) < (this.landedSeq.get(e.structId) ?? 0)) return;
    this.landedSeq.set(e.structId, e.seq ?? 0);
    s.health = e.healthAfter;
    this.paint(e.structId);
  }
  private async next() {
    if (this.disposed) return;
    const e = this.queue.shift();
    if (!e) { this.playing = false; for (const f of this.idleFns.splice(0)) f(); return; }
    this.playing = true;
    try { await this.run(e); } catch { /* one lost flourish must not stall the fight */ }
    this.land(e);
    void this.next();
  }

  private async run(e: AnimEvent) {
    const s = this.structs.get(e.structId), cell = this.cellOf(e.structId);
    // A hidden tab pauses animation frames: land the result now rather than stall the fight.
    if (!s || !cell || document.hidden) return;
    const mount = cell.querySelector<HTMLElement>('.bd-mount')!;
    this.reveal(e.structId);
    const still = mount.querySelector<HTMLElement>('.bd-still');
    const box = mount.querySelector<HTMLElement>('.bd-anims');
    // Sound and words first so they land with the frame, not after the bundle loads.
    const kind = e.names[0] ?? '';
    if (this.opts.quiet) { /* attract mode: pictures only */ }
    else if (kind.startsWith('ATTACK_')) sfx.play('shot');
    else if (kind.startsWith('DESTROY_')) { sfx.play('boom'); shake(s.isCommand ? 'lg' : 'sm'); flash(s.side === 'defender' ? 'rgba(230,77,64,.3)' : 'rgba(239,183,25,.25)'); float(cell, s.isCommand ? '지휘함 격파!' : '격파', 'var(--hwang)', true); }
    else if (kind.startsWith('IMPACT_')) { sfx.play('hit'); if (e.dmg) float(cell, `−${e.dmg}`, s.side === 'defender' ? 'var(--jeok)' : 'var(--warn)', true); }
    else if (isEvade(kind)) { sfx.play('evade'); float(cell, '회피', 'var(--cheong-hi)'); }
    if (!this.opts.quiet && e.miss && !kind.startsWith('IMPACT_') && !isEvade(kind)) float(cell, e.miss, 'var(--text-dim)');
    if (!e.names.length || !box) { await wait(260 / this.speed); return; }

    const evadeOnly = e.names.every(isEvade);
    const destroys = e.names.some((n) => n.startsWith('DESTROY_'));
    cell.classList.add('bd-busy');
    if (!evadeOnly) still?.classList.add('bd-hidden');
    const L = await lottie();
    const hpNow = s.health;
    const done = e.names.map((name) => new Promise<void>((resolve) => {
      const layer = document.createElement('div');
      layer.className = 'bd-anim' + (flips(name) ? ' bd-flip' : '');
      layer.style.zIndex = String(layerZ(name) * 100);
      box.appendChild(layer);
      const path = lottiePath(name, slugOf(s.typeId));
      let finished = false;
      let a: ReturnType<LottieModule['loadAnimation']> | null = null;
      const end = () => { if (finished) return; finished = true; clearTimeout(t1); clearTimeout(t2); a?.destroy(); layer.remove(); resolve(); };
      const t1 = setTimeout(() => { if (!a?.isLoaded) end(); }, 4000);
      const t2 = setTimeout(end, 15000 / this.speed);
      bundle(path).then((data) => {
        if (finished) return;
        a = L.loadAnimation({ container: layer, renderer: 'svg', loop: false, autoplay: false, animationData: data, assetsPath: path.replace(/data\.json$/, 'images/') });
        a.setSpeed(this.speed);
        a.addEventListener('DOMLoaded', () => { injectArt(layer, s.typeId, hpNow, s.maxHealth); a!.play(); });
        a.addEventListener('complete', end);
      }, end);
    }));
    await Promise.all(done);
    cell.classList.remove('bd-busy');
    if (!destroys) still?.classList.remove('bd-hidden');
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
