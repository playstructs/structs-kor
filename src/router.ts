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
export function onRoute(f: (path: string) => void) { changeFns.push(f); }

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (p: string) => base + p;
export const current = () => (location.pathname.slice(base.length) || '/').replace(/\/+$/, '') || '/';

export function go(path: string, replace = false) {
  if (replace) history.replaceState(null, '', href(path)); else history.pushState(null, '', href(path));
  void render();
}

export async function render() {
  const outlet = document.getElementById('outlet')!;
  const path = current();
  const load = routes.get(path) || routes.get('/404')!;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = undefined;
  for (const f of changeFns) f(path);
  const { default: screen } = await load();
  outlet.scrollTop = 0;
  window.scrollTo(0, 0);
  cleanup = await screen.render(outlet, new URLSearchParams(location.search));
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
  void render();
}
