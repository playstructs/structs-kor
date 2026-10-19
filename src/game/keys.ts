/* Hotkeys. Screens push a scope (their own keys win); the rest navigate. `?` lists them all. */
import { go } from '../router';
import { sfx } from './sfx';
import { music } from './music';
import { keyOf } from './keyof';

/** A key handler; returning false means "not mine" and lets the key fall through. */
type Fn = (e: KeyboardEvent) => unknown;
const scopes: Record<string, Fn>[] = [];

export const NAV_KEYS: { key: string; path: string; label: string }[] = [
  { key: 'c', path: '/console', label: '지휘 함교' },
  { key: 'p', path: '/galaxy', label: '은하 지도' },
  { key: 'g', path: '/energy', label: '전력망' },
  { key: 't', path: '/market', label: '거래소' },
  { key: 'b', path: '/sim', label: '전투 시뮬' },
  { key: 'v', path: '/daily', label: '일일 교전' },
  { key: 'o', path: '/campaign', label: '작전' },
  { key: 'y', path: '/guild', label: '길드' },
  { key: 'n', path: '/replicants', label: '레플리칸트' },
  { key: 'k', path: '/chat', label: '통신' },
  { key: 'u', path: '/stats', label: '은하 통계' },
  { key: 'w', path: '/war', label: '작전 상황실' },
  { key: 'h', path: '/tutorial', label: '훈련소' },
  { key: 'x', path: '/codex', label: '교본' },
];

export const keys = {
  /** Claim keys while a screen is up; returns the release. */
  scope(map: Record<string, Fn>) { scopes.push(map); return () => { const i = scopes.indexOf(map); if (i >= 0) scopes.splice(i, 1); }; },
};

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t instanceof HTMLInputElement && t.type === 'range'));

function help() {
  const old = document.getElementById('keys-help');
  if (old) { old.remove(); return; }
  const el = document.createElement('div');
  el.id = 'keys-help';
  el.className = 'keys-help';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '단축키');
  const local = scopes.length ? Object.keys(scopes[scopes.length - 1]).filter((k) => k.length <= 6) : [];
  el.innerHTML = `<div class="keys-in"><h2>단축키</h2><div class="keys-grid">${NAV_KEYS.map((k) => `<kbd>${k.key.toUpperCase()}</kbd><span>${k.label}</span>`).join('')}<kbd>F10</kbd><span>메뉴</span><kbd>Esc</kbd><span>선택 해제 · 창 닫기</span><kbd>M</kbd><span>소리 켜기/끄기</span><kbd>J</kbd><span>음악 켜기/끄기</span><kbd>?</kbd><span>이 도움말</span></div>${local.length ? `<p>이 화면: ${local.map((k) => `<kbd>${k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k}</kbd>`).join(' ')}</p>` : ''}<div style="display:flex;gap:8px;justify-content:flex-end">${location.pathname.endsWith('/console') || (location.pathname.endsWith('/galaxy') && document.querySelector('.gx-node.home') && document.querySelector('.hegemony')) ? '<button class="btn gold" type="button" data-tour>안내 다시 보기</button>' : ''}<button class="btn ghost" type="button">닫기</button></div></div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-tour]')) { el.remove(); void import('./tour').then((m) => (location.pathname.endsWith('/galaxy') ? m.runTour('galaxy', m.GALAXY_TOUR) : m.runTour('bridge', m.BRIDGE_TOUR))); return; }
    if (e.target === el || t.closest('button')) el.remove();
  });
  document.body.appendChild(el);
  el.querySelector('button')?.focus();
}

/* Enter that confirms a 한글 syllable must not also submit the form (Safari sends it with
   isComposing false but keyCode 229), or chat sends a half-typed message. */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229) && e.target instanceof HTMLElement && e.target.closest('form')) e.preventDefault();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
  // Esc in a text box gives the keyboard back to the game (chat used to keep it until you clicked away).
  if (typing(e.target)) { if (e.key === 'Escape' && !e.defaultPrevented) (e.target as HTMLElement).blur(); return; }
  const k = keyOf(e);
  // A held key fires once (arrows may repeat to move the board cursor): no auto-fire, no re-sent orders.
  if (e.repeat && !k.startsWith('Arrow')) return;
  // Enter and Space on a focused control press that control; screen hotkeys must not also fire.
  if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLElement && e.target.closest('button, a[href], select, summary, [role="button"]')) return;
  // An open help overlay owns Escape, whatever screen is underneath.
  if (k === 'Escape' && document.getElementById('keys-help')) { document.getElementById('keys-help')!.remove(); return; }
  for (let i = scopes.length - 1; i >= 0; i--) {
    const f = scopes[i][k] ?? scopes[i][e.key];
    if (f && f(e) !== false) { e.preventDefault(); return; }
  }
  // In a menu window, Esc closes it back to the bridge (the screen's own Esc, above, wins first).
  if (k === 'Escape') { if (document.documentElement.dataset.mode === 'window') go('/console'); return; }
  if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); help(); return; }
  if (k === 'm') { sfx.toggle(); return; }
  if (k === 'j') { music.toggle(); return; }
  const nav = NAV_KEYS.find((n) => n.key === k);
  if (nav) { e.preventDefault(); sfx.play('click'); go(nav.path); }
});
