/* The link grammar: one path for the web and the desktop app.
 *
 *   https://<site>/daily/2026-10-18/D…     what people share
 *   structs-kor://daily/2026-10-18/D…      what the desktop app answers
 *
 * The same idea as structs-app's src/links.js. The desktop scheme is structs-kor://, not structs://,
 * because Structs Desktop already answers structs:// and with both installed the OS would pick one
 * at random.
 *
 * Pure: no DOM. The desktop app parses deep links with this same file. */

export const APP_SCHEME = 'structs-kor';

export type Link =
  | { view: 'home' }
  /** Any one-word screen: /console, /galaxy… (the router decides whether it exists). */
  | { view: 'screen'; path: string }
  /** The daily challenge: today's, a past day's, or someone's result for that day. */
  | { view: 'daily'; day?: string; code?: string }
  /** A simulator replay (the simulator's R… code). */
  | { view: 'replay'; code: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_CODE = /^D[A-Za-z0-9_-]{4,4000}$/;
const REPLAY_CODE = /^R[A-Za-z0-9_-]{4,200000}$/;
const SCREEN = /^[a-z][a-z0-9-]{0,31}$/;

const decode = (p: string) => { try { return decodeURIComponent(p); } catch { return ''; } };

/**
 * A URL, a structs-kor:// link or a path → a link, or null. `base` is the site's path prefix
 * (`/structs-kor` on github.io), stripped from web URLs. The query forms the simulator always took
 * (/sim?replay=R…, /sim?daily=2026-10-18) parse to the same links.
 */
export function parse(input: string, base = ''): Link | null {
  let s = String(input || '').trim();
  const app = new RegExp('^' + APP_SCHEME + ':/{0,2}', 'i');
  const fromApp = app.test(s);
  s = s.replace(app, '/').replace(/^https?:\/\/[^/?#]+/i, '');
  const [pathPart, query = ''] = s.split('#')[0].split('?');
  let path = pathPart || '/';
  const b = base.replace(/\/+$/, '');
  if (!fromApp && b && (path === b || path.startsWith(b + '/'))) path = path.slice(b.length) || '/';
  const parts = path.split('/').filter(Boolean).map(decode);
  const q = new URLSearchParams(query);
  if (!parts.length) return { view: 'home' };
  const head = parts[0].toLowerCase();

  if (head === 'daily') {
    if (parts.length === 1) return { view: 'daily' };
    if (!DAY.test(parts[1]) || parts.length > 3) return null;
    if (parts.length === 2) return { view: 'daily', day: parts[1] };
    // A code that isn't even shaped like one still leaves a good day.
    return DAILY_CODE.test(parts[2]) ? { view: 'daily', day: parts[1], code: parts[2] } : { view: 'daily', day: parts[1] };
  }
  if (head === 'sim') {
    if (parts.length === 2 && REPLAY_CODE.test(parts[1])) return { view: 'replay', code: parts[1] };
    if (parts.length > 1) return null;
    const r = q.get('replay'), d = q.get('daily');
    if (r && REPLAY_CODE.test(r)) return { view: 'replay', code: r };
    if (d && DAY.test(d)) return { view: 'daily', day: d };
    return { view: 'screen', path: '/sim' };
  }
  if (parts.length === 1 && SCREEN.test(head)) return { view: 'screen', path: '/' + head };
  return null;
}

/** The canonical path: /, /console, /daily, /daily/<day>, /daily/<day>/<code>, /sim/<code>. */
export function path(link: Link): string {
  switch (link.view) {
    case 'home': return '/';
    case 'screen': return link.path;
    case 'replay': return '/sim/' + link.code;
    case 'daily': return '/daily' + (link.day ? '/' + link.day + (link.code ? '/' + link.code : '') : '');
  }
}

/** The page on the web: `site` is the absolute site root (VITE_SITE_URL, with its base path). */
export const webUrl = (link: Link, site: string) => site.replace(/\/+$/, '') + path(link);

/** The desktop app's deep link for the same thing. */
export const appUrl = (link: Link) => APP_SCHEME + ':/' + path(link);

/** Links worth handing to the desktop app: things people share, not plain screens. */
export const shareable = (link: Link | null): boolean => !!link && (link.view === 'replay' || (link.view === 'daily' && !!link.code));
