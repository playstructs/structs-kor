/* Path routing for a static site: every screen is a real path (/console, /energy). Hosts serve the
 * shell for unknown paths (scripts/spa-fallback.mjs), and same-origin <a href> clicks are taken over. */

export interface Screen {
  /** Render into `root`. Return a cleanup (timers, sockets) for when the route changes. */
  render(root: HTMLElement, params: URLSearchParams): void | (() => void) | Promise<void | (() => void)>;
}

type Loader = () => Promise<{ default: Screen }>;
const routes = new Map<string, Loader>();
let cleanup: (() => void) | void = undefined;
let changeFns: ((path: string) => void)[] = [];

export function route(path: string, load: Loader) { routes.set(path, load); }
/** Fetch a screen's code ahead of time (idle moments, hovered links), so going there is instant. */
export function prefetch(path: string) { void routes.get(path)?.().catch(() => null); }
export function onRoute(f: (path: string) => void) { changeFns.push(f); }

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (p: string) => base + p;
export const current = () => (location.pathname.slice(base.length) || '/').replace(/\/+$/, '') || '/';

export function go(path: string, replace = false) {
  if (replace) history.replaceState(null, '', href(path)); else history.pushState(null, '', href(path));
  void render();
}

let renderToken = 0;
export async function render() {
  const outlet = document.getElementById('outlet')!;
  const path = current();
  const load = routes.get(path) || routes.get('/404')!;
  const token = ++renderToken;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = undefined;
  for (const f of changeFns) f(path);
  // A screen still downloading after a beat shows that it's coming (no dead click).
  const slow = setTimeout(() => { if (token === renderToken) outlet.classList.add('loading'); }, 150);
  let screen: Screen;
  try {
    screen = (await load()).default;
  } catch (e) {
    // The screen's code didn't arrive (offline, or a newer deploy replaced it): say so and offer a reload.
    console.error(e);
    if (token !== renderToken) return;
    clearTimeout(slow); outlet.classList.remove('loading');
    outlet.innerHTML = '<section class="card game-panel" style="max-width:520px;margin:40px auto"><h2>화면을 불러오지 못했습니다</h2><p class="note">연결이 끊겼거나 새 버전이 배포되었습니다.</p><button class="btn primary" type="button" onclick="location.reload()">새로고침</button></section>';
    return;
  } finally {
    if (token === renderToken) { clearTimeout(slow); outlet.classList.remove('loading'); }
  }
  if (token !== renderToken) return;
  // Each screen gets its own host: once it is replaced, the old screen's late repaints land on a
  // detached element (its root.isConnected guards then really stop it).
  const host = document.createElement('div');
  host.className = 'screen';
  outlet.replaceChildren(host);
  outlet.scrollTop = 0;
  window.scrollTo(0, 0);
  const done = await screen.render(host, new URLSearchParams(location.search));
  // A render that finished after the player moved on: tidy it up at once.
  if (token !== renderToken) { try { done?.(); } catch (e) { console.error(e); } return; }
  cleanup = done;
}

export function startRouter() {
  window.addEventListener('popstate', () => void render());
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(base) || url.hash && url.pathname === location.pathname) return;
    e.preventDefault();
    history.pushState(null, '', url.pathname + url.search);
    void render();
  });
  // Pointing at (or tabbing to) a link starts fetching its screen.
  const warm = (e: Event) => {
    const a = (e.target as HTMLElement)?.closest?.('a');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin && url.pathname.startsWith(base)) prefetch((url.pathname.slice(base.length) || '/').replace(/\/+$/, '') || '/');
  };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('focusin', warm);
  void render();
}
