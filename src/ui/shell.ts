/* The frame around every screen, dressed as a game HUD: commander plate (rank, XP), resource
 * counters that roll when they change, the command dock with its hotkeys, and the footer. */
import { TRANSPORT } from '../config';
import { session } from '../api/session';
import { REQUIREMENTS, fallbacksUsed, onFallback } from '../api/requirements';
import { onRoute, href } from '../router';
import { esc } from './dom';
import { wallet } from '../wallet/wallet';
import { career, RANKS } from '../game/progress';
import { sfx } from '../game/sfx';
import { music } from '../game/music';
import { roll, notes, float } from '../game/fx';
import { NAV_KEYS } from '../game/keys';
import { demo, HEGEMONY } from '../game/demo';
import { portraitHtml, myPfp, onPfp } from '../game/portrait';
import { guildApi } from '../api/guild';

export const LOGO = `<svg class="pix" width="30" height="30" viewBox="0 0 9 9" aria-hidden="true"><rect width="9" height="9" fill="#133546"/><rect x="1" y="1" width="3" height="3" fill="#43CDB6"/><rect x="5" y="1" width="3" height="3" fill="#EE7D69"/><rect x="1" y="5" width="3" height="3" fill="#EBAA49"/><rect x="5" y="5" width="3" height="3" fill="#C5D7D9"/></svg>`;

const I = (d: string) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${d}</svg>`;
const NAV: { path: string; label: string; icon: string }[] = [
  { path: '/console', label: '함교', icon: I('<circle cx="12" cy="12" r="8"/><path d="M2 12h20"/>') },
  { path: '/galaxy', label: '은하', icon: I('<circle cx="12" cy="12" r="2"/><path d="M12 4c5 0 8 3 8 6M12 20c-5 0-8-3-8-6M4 8c2-3 5-4 8-4M20 16c-2 3-5 4-8 4"/>') },
  { path: '/energy', label: '전력망', icon: I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>') },
  { path: '/market', label: '거래소', icon: I('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>') },
  { path: '/research', label: '연구소', icon: I('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10"/>') },
  { path: '/campaign', label: '작전', icon: I('<path d="M4 21V4h11l-1 4h6v9h-9l1-4H4"/>') },
  { path: '/sim', label: '전투', icon: I('<path d="M5 19L19 5M15 5h4v4M9 19H5v-4M5 5l5 5M19 19l-5-5"/>') },
  { path: '/replicants', label: '레플리칸트', icon: I('<rect x="3" y="6" width="8" height="8"/><rect x="13" y="10" width="8" height="8"/><path d="M7 14v4h6"/>') },
  { path: '/guild', label: '길드', icon: I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>') },
  { path: '/chat', label: '통신', icon: I('<path d="M4 5h16v11H9l-5 4z"/>') },
  { path: '/tutorial', label: '훈련소', icon: I('<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/>') },
  { path: '/codex', label: '교본', icon: I('<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h6z"/>') },
];
const keyOf = (p: string) => NAV_KEYS.find((k) => k.path === p)?.key.toUpperCase() ?? '';

/** Pixel insignia: chevrons for enlisted, bars for officers, stars for generals. */
export function insignia(i: number, size = 30): string {
  const tier = i < 7 ? 0 : i < 13 ? 1 : 2;
  const count = tier === 0 ? Math.min(4, i + 1) - (i > 3 ? 0 : 0) : tier === 1 ? (i - 7) % 3 + 1 : Math.min(5, i - 12);
  const fg = tier === 0 ? '#C5D7D9' : tier === 1 ? '#43CDB6' : '#EBAA49';
  const bg = tier === 2 ? '#3A2F12' : tier === 1 ? '#133546' : '#222034';
  let marks = '';
  for (let k = 0; k < count; k++) {
    if (tier === 0) marks += `<path d="M2 ${3 + k * 2}l3.5 2 3.5-2" stroke="${fg}" stroke-width="1" fill="none"/>`;
    else if (tier === 1) marks += `<rect x="${1.5 + k * 2.2}" y="3" width="1.4" height="5" fill="${fg}"/>`;
    else marks += `<rect x="${(k % 3) * 3 + 1}" y="${k < 3 ? 2 : 6}" width="2" height="2" fill="${fg}"/>`;
  }
  return `<svg class="pix insignia" width="${size}" height="${size}" viewBox="0 0 11 11" aria-hidden="true"><rect width="11" height="11" fill="${bg}"/><rect x=".5" y=".5" width="10" height="10" fill="none" stroke="${fg}" stroke-width=".6" opacity=".6"/>${marks}</svg>`;
}

export function shell(root: HTMLElement) {
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <a class="brand" href="${href('/')}">${LOGO}<b>구조체</b><span>STRUCTS</span></a>
      <a class="plate" id="plate" href="${href('/record')}" aria-label="전적 · 사령관 계급"></a>
      <div class="tiles" id="tiles"></div>
      <div class="hud-tools">
        <button class="hud-btn" id="snd" type="button" data-silent aria-label="소리"></button>
        <button class="hud-btn" id="mus" type="button" aria-label="음악"></button>
        <button class="hud-btn bell" id="bell" type="button" aria-label="알림 기록" aria-expanded="false"></button>
        <button class="hud-btn" id="kbd" type="button" aria-label="단축키 (?)"><span class="mono">?</span></button>
        <div id="who" style="display:flex;gap:8px;align-items:center"></div>
      </div>
    </header>
    <div class="dc-strip"></div>
    <div id="demo-bar"></div>
    <div class="body">
      <nav class="rail" id="rail" aria-label="주 메뉴">
        ${NAV.map((n) => `<a href="${href(n.path)}" data-path="${n.path}">${n.icon}<span>${n.label}</span><kbd class="rail-key">${keyOf(n.path)}</kbd></a>`).join('')}
      </nav>
      <main class="main" id="outlet" tabindex="-1"></main>
    </div>
    <footer id="foot" class="foot"></footer>
  </div>`;

  const rail = root.querySelector<HTMLElement>('#rail')!;
  onRoute((p) => {
    const bare = p === '/' || p === '/login' || p === '/start';
    rail.style.display = bare ? 'none' : '';
    document.documentElement.dataset.route = p.slice(1) || 'home';
    for (const a of rail.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('on', a.dataset.path === p);
  });

  /* Commander plate: insignia, rank, XP to the next one. */
  const plate = root.querySelector<HTMLElement>('#plate')!;
  const paintPlate = () => {
    const r = career.rank;
    const next = RANKS[r.i + 1];
    // On the demo base the plate also wears the hegemony title and the era.
    const t = demo.on && session.status.state !== 'in' ? demo.hegemonyTier : 0;
    const title = t ? `<span class="plate-title">${esc(HEGEMONY[t - 1].title)}${demo.era ? ` · 제${demo.era + 1}시대` : ''}</span>` : demo.on && demo.era && session.status.state !== 'in' ? `<span class="plate-title">제${demo.era + 1}시대</span>` : '';
    plate.innerHTML = `<span class="plate-face">${portraitHtml(chainPfp ?? myPfp(), 40)}<span class="plate-ins">${insignia(r.i, 18)}</span></span><span class="plate-txt"><b>${esc(r.name)}${title}</b><span class="plate-xp"><i style="width:${Math.round(r.pct * 100)}%"></i></span><small class="mono">${next ? `${r.into}/${r.need} XP → ${esc(next)}` : `${r.xp} XP · 최고 계급`}</small></span>`;
    plate.title = `총 ${r.xp} XP`;
  };
  // Signed in: the commander's own on-chain portrait; otherwise the local one (editable in 전적).
  let chainPfp: string | null = null, chainFor: string | null = null;
  session.onChange((st) => {
    if (st.state !== 'in' || !st.playerId) { chainPfp = null; chainFor = null; paintPlate(); return; }
    if (chainFor === st.playerId) return;
    chainFor = st.playerId;
    void guildApi.player(st.playerId).then((p) => { chainPfp = p?.pfp || null; paintPlate(); }).catch(() => null);
  });
  career.onChange(paintPlate);
  onPfp(paintPlate);
  paintPlate();

  const snd = root.querySelector<HTMLButtonElement>('#snd')!;
  const paintSnd = () => {
    snd.innerHTML = I(sfx.muted ? '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6"/>' : '<path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>');
    snd.setAttribute('aria-pressed', String(!sfx.muted));
    snd.title = sfx.muted ? '소리 켜기 (M)' : '소리 끄기 (M)';
  };
  snd.addEventListener('click', () => sfx.toggle());
  const mus = root.querySelector<HTMLButtonElement>('#mus')!;
  const paintMus = () => {
    mus.innerHTML = I(music.on ? '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' : '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>');
    mus.setAttribute('aria-pressed', String(music.on));
    mus.title = music.on ? '음악 끄기 (J)' : '음악 켜기 (J)';
  };
  mus.addEventListener('click', () => music.toggle());
  music.onChange(paintMus);
  paintMus();
  sfx.onChange(paintSnd);
  paintSnd();
  /* 알림 기록: everything the corner toasts said, newest first. */
  const bell = root.querySelector<HTMLButtonElement>('#bell')!;
  let logOpen = false;
  const paintBell = () => {
    bell.innerHTML = I('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>') + (notes.unread ? `<span class="bell-n">${Math.min(99, notes.unread)}</span>` : '');
    bell.setAttribute('aria-label', notes.unread ? `알림 기록 · 새 알림 ${notes.unread}건` : '알림 기록');
    document.getElementById('note-log')?.remove();
    bell.setAttribute('aria-expanded', String(logOpen));
    if (!logOpen) return;
    const panel = document.createElement('div');
    panel.id = 'note-log';
    panel.className = 'note-log';
    panel.setAttribute('role', 'log');
    panel.innerHTML = `<div class="card-head"><h2>알림 기록</h2></div>` + (notes.list.length
      ? `<ol>${notes.list.map((n) => `<li class="${n.tone}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small class="mono">${new Date(n.at).toLocaleTimeString('ko-KR')}</small></li>`).join('')}</ol>`
      : '<p class="empty">아직 알림이 없습니다.</p>');
    document.body.appendChild(panel);
  };
  bell.addEventListener('click', () => { logOpen = !logOpen; if (logOpen) notes.seen(); paintBell(); });
  document.addEventListener('click', (e) => { if (logOpen && !(e.target as Element).closest('#note-log, #bell')) { logOpen = false; paintBell(); } });
  document.addEventListener('keydown', (e) => { if (logOpen && e.key === 'Escape') { logOpen = false; paintBell(); } });
  notes.onChange(paintBell);
  paintBell();
  root.querySelector('#kbd')!.addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })));

  const demoBar = root.querySelector<HTMLElement>('#demo-bar')!;
  const paintDemo = () => {
    // A signed-in commander is on the real chain: the demo base stays out of sight.
    const ev = demo.event, bm = demo.on ? demo.black : null;
    demoBar.innerHTML = demo.on && session.status.state !== 'in' ? `<div class="demo-bar"><b>데모 함교</b>${ev ? `<span class="ev-chip ${ev.tone}" title="${esc(ev.text)}">${esc(ev.name)} · ${ev.left}블록</span>` : ''}${bm?.offers.length ? `<a class="ev-chip hwang" href="${href('/market')}" title="거래소에서 한 번씩만 파는 거래">밀수선 입항 · ${bm.left}블록</a>` : ''}<span>가상의 기지가 실시간으로 돌아갑니다. 실제 체인과 무관합니다.</span><a class="btn primary" href="${href('/start')}" style="min-height:32px">진짜 사령관으로 입대</a><button class="btn ghost" style="min-height:32px" type="button" id="demo-off">데모 종료</button></div>` : '';
    demoBar.querySelector('#demo-off')?.addEventListener('click', () => { demo.stop(); location.assign(href('/')); });
  };
  demo.onChange(paintDemo);
  session.onChange(paintDemo);
  paintDemo();
  // The soundtrack carries the empire's weight (demo base only).
  const tune = () => music.setPower(demo.on && session.status.state !== 'in' ? demo.hegemonyTier : 0);
  demo.onChange(tune); session.onChange(tune); tune();

  // The empire's pulse: every few blocks, what came in floats up from the alpha tile.
  // Only what the blocks made counts: a loan, a hire or a new era moves the baseline, not the float.
  let lastAlpha = demo.state.alpha, seen = demo.state.alpha, beats = 0, inBlock = false;
  demo.onChange(() => { if (!inBlock) lastAlpha += demo.state.alpha - seen; seen = demo.state.alpha; });
  demo.onBlock(() => {
    inBlock = true; queueMicrotask(() => { inBlock = false; });
    seen = demo.state.alpha;
    if (!demo.on || session.status.state === 'in') { lastAlpha = demo.state.alpha; return; }
    if (++beats % 5) return;
    const gain = demo.state.alpha - lastAlpha;
    lastAlpha = demo.state.alpha;
    const tile = [...document.querySelectorAll<HTMLElement>('#tiles .tile')].find((t) => t.querySelector('small')?.textContent?.includes('알파'));
    if (tile && Math.abs(gain) >= 0.05) float(tile, `${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(2)} α`, gain >= 0 ? 'var(--hwang)' : 'var(--jeok-hi)');
  });

  const who = root.querySelector<HTMLElement>('#who')!;
  // 내 정보 (profile, where the recovery phrase is revealed) whenever this browser holds a commander;
  // a dot marks a phrase never looked at.
  const paintWho = () => {
    const s = session.status;
    const me = wallet.commander;
    career.use(s.state === 'in' ? s.playerId : demo.on ? 'demo' : null);
    const profile = me ? `<a class="btn ghost" href="${href('/profile')}" style="min-height:36px;position:relative">${s.state === 'in' ? `<span class="mono c-cheong">● ${esc(s.playerId)}</span>` : '내 정보'}${wallet.backedUp ? '' : '<span title="복구 문구를 아직 확인하지 않았습니다" style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:var(--hwang)"></span>'}</a>` : '';
    who.innerHTML = s.state === 'in'
      ? profile
      : `${profile}<a class="btn ghost" href="${href('/login')}" style="min-height:36px">로그인</a>${me ? '' : `<a class="btn primary" href="${href('/start')}" style="min-height:36px">지금 시작</a>`}`;
  };
  session.onChange(paintWho);
  wallet.onChange(paintWho);
  demo.onChange(paintWho);
  onRoute(paintWho);

  const foot = root.querySelector<HTMLElement>('#foot')!;
  const paint = () => {
    const used = fallbacksUsed();
    const reqs = REQUIREMENTS.filter((r) => used.includes(r.id));
    foot.innerHTML = `<span>구조체.com · Guild API ${esc(TRANSPORT === 'relay' ? '(개발 릴레이)' : '(직접 연결)')}</span>`
      + (reqs.length ? `<span>대체 경로 사용 중: ${reqs.map((r) => `<span class="planned" title="${esc(r.title + ' — ' + r.endpoint)}">${esc(r.id)}</span>`).join(' ')}</span>` : '')
      + `<span><kbd>?</kbd> 단축키 · <kbd>M</kbd> 소리</span>`
      + `<span style="margin-left:auto">이용약관 · <b style="color:var(--white)">개인정보처리방침</b> · [상호명] · 사업자등록번호 [000-00-00000]</span>`;
  };
  paint();
  onFallback(paint);
}

export interface HudTile { label: string; value: string; tone?: string; href?: string; num?: number; fmt?: (v: number) => string; delta?: string; deltaTone?: string; alert?: boolean }
/** The resource counters in the top bar (filled by the screen that has the data). Numbers roll. */
export function setTiles(tiles: HudTile[]) {
  const el = document.getElementById('tiles');
  if (!el) return;
  // Rebuild only when the set of tiles changes; labels like '전력 · 37%' update in place so counters keep rolling.
  const sig = tiles.map((t, i) => `${i}:${t.href ?? ''}`).join('|');
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    el.innerHTML = tiles.map((t, i) => {
      const inner = `<small data-l="${i}"></small><span class="tile-v"><strong data-i="${i}"></strong><em data-d="${i}"></em></span>`;
      return t.href ? `<a class="tile" href="${href(t.href)}">${inner}</a>` : `<div class="tile">${inner}</div>`;
    }).join('');
  }
  tiles.forEach((t, i) => {
    const s = el.querySelector<HTMLElement>(`strong[data-i="${i}"]`), d = el.querySelector<HTMLElement>(`em[data-d="${i}"]`);
    if (!s || !d) return;
    const l = el.querySelector<HTMLElement>(`small[data-l="${i}"]`);
    if (l) l.textContent = t.label;
    s.style.color = t.tone || 'var(--white)';
    if (t.num != null && t.fmt) roll(s, t.num, t.fmt); else s.textContent = t.value;
    d.textContent = t.delta ?? '';
    d.style.color = t.deltaTone ?? 'var(--cheong)';
    s.closest('.tile')?.classList.toggle('alert', !!t.alert);
  });
}
