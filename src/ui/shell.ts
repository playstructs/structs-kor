/* The frame around every screen: top bar, side rail, footer. */
import { TRANSPORT } from '../config';
import { session } from '../api/session';
import { REQUIREMENTS, fallbacksUsed, onFallback } from '../api/requirements';
import { onRoute, href } from '../router';
import { esc } from './dom';
import { wallet } from '../wallet/wallet';

export const LOGO = `<svg class="pix" width="30" height="30" viewBox="0 0 9 9" aria-hidden="true"><rect width="9" height="9" fill="#133546"/><rect x="1" y="1" width="3" height="3" fill="#43CDB6"/><rect x="5" y="1" width="3" height="3" fill="#EE7D69"/><rect x="1" y="5" width="3" height="3" fill="#EBAA49"/><rect x="5" y="5" width="3" height="3" fill="#C5D7D9"/></svg>`;

const I = (d: string) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${d}</svg>`;
const NAV: { path: string; label: string; icon: string }[] = [
  { path: '/console', label: '행성', icon: I('<circle cx="12" cy="12" r="8"/><path d="M2 12h20"/>') },
  { path: '/replicants', label: '레플리칸트', icon: I('<rect x="3" y="6" width="8" height="8"/><rect x="13" y="10" width="8" height="8"/><path d="M7 14v4h6"/>') },
  { path: '/energy', label: '에너지', icon: I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>') },
  { path: '/market', label: '거래소', icon: I('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>') },
  { path: '/sim', label: '시뮬', icon: I('<rect x="3" y="4" width="18" height="12"/><path d="M10 8l4 2-4 2zM8 20h8"/>') },
  { path: '/chat', label: '통신', icon: I('<path d="M4 5h16v11H9l-5 4z"/>') },
  { path: '/tutorial', label: '훈련', icon: I('<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/>') },
];

export function shell(root: HTMLElement) {
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <a class="brand" href="${href('/')}">${LOGO}<b>구조체</b><span>STRUCTS</span></a>
      <div class="tiles" id="tiles"></div>
      <div id="who" style="display:flex;gap:8px;align-items:center"></div>
    </header>
    <div class="dc-strip"></div>
    <div class="body">
      <nav class="rail" id="rail" aria-label="주 메뉴">
        ${NAV.map((n) => `<a href="${href(n.path)}" data-path="${n.path}">${n.icon}${n.label}</a>`).join('')}
      </nav>
      <main class="main" id="outlet" tabindex="-1"></main>
    </div>
    <footer id="foot" style="padding:12px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--text-faint);display:flex;flex-wrap:wrap;gap:12px"></footer>
  </div>`;

  const rail = root.querySelector<HTMLElement>('#rail')!;
  onRoute((p) => {
    rail.style.display = p === '/' || p === '/login' || p === '/start' ? 'none' : '';
    for (const a of rail.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('on', a.dataset.path === p);
  });

  const who = root.querySelector<HTMLElement>('#who')!;
  // 내 정보 (profile, where the recovery phrase is revealed) whenever this browser holds a commander;
  // a dot marks a phrase never looked at.
  const paintWho = () => {
    const s = session.status;
    const me = wallet.commander;
    const profile = me ? `<a class="btn ghost" href="${href('/profile')}" style="min-height:36px;position:relative">${s.state === 'in' ? `<span class="mono c-cheong">● ${esc(s.playerId)}</span>` : '내 정보'}${wallet.backedUp ? '' : '<span title="복구 문구를 아직 확인하지 않았습니다" style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:var(--hwang)"></span>'}</a>` : '';
    who.innerHTML = s.state === 'in'
      ? profile
      : `${profile}<a class="btn ghost" href="${href('/login')}" style="min-height:36px">로그인</a>${me ? '' : `<a class="btn primary" href="${href('/start')}" style="min-height:36px">지금 시작</a>`}`;
  };
  session.onChange(paintWho);
  wallet.onChange(paintWho);
  onRoute(paintWho);

  const foot = root.querySelector<HTMLElement>('#foot')!;
  const paint = () => {
    const used = fallbacksUsed();
    const reqs = REQUIREMENTS.filter((r) => used.includes(r.id));
    foot.innerHTML = `<span>구조체.com · Guild API ${esc(TRANSPORT === 'relay' ? '(개발 릴레이)' : '(직접 연결)')}</span>`
      + (reqs.length ? `<span>대체 경로 사용 중: ${reqs.map((r) => `<span class="planned" title="${esc(r.title + ' — ' + r.endpoint)}">${esc(r.id)}</span>`).join(' ')}</span>` : '')
      + `<span style="margin-left:auto">이용약관 · <b style="color:var(--white)">개인정보처리방침</b> · [상호명] · 사업자등록번호 [000-00-00000]</span>`;
  };
  paint();
  onFallback(paint);
}

/** The resource tiles in the top bar (filled by the console once it has data). */
export function setTiles(tiles: { label: string; value: string; tone?: string; href?: string }[]) {
  const el = document.getElementById('tiles');
  if (!el) return;
  el.innerHTML = tiles.map((t) => {
    const inner = `<small>${esc(t.label)}</small><strong style="color:${t.tone || 'var(--white)'}">${esc(t.value)}</strong>`;
    return t.href ? `<a class="tile" href="${href(t.href)}">${inner}</a>` : `<div class="tile">${inner}</div>`;
  }).join('');
}
