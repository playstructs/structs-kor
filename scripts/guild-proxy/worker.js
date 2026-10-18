/* A same-site relay for the Guild API, for a static build on 구조체.com.
 *
 * Why: the guild signs players in with a session cookie set by beta.playstructs.com. Seen from
 * 구조체.com that cookie is third-party, and Safari (all of iOS), Firefox strict and Brave refuse
 * to send it back, so sign-in "works" and then every members-only read says "login required".
 * Served from api.구조체.com instead, the same cookie is same-site and every browser keeps it.
 * (When the guild ships token login, REQ-AUTH-1, this relay is no longer needed.)
 *
 * Deploy as a Cloudflare Worker on api.xn--2e0b952cv5c.com (the zone must be on Cloudflare, or put
 * the same logic behind any reverse proxy), then build the site with
 *   VITE_GUILD_API=https://api.xn--2e0b952cv5c.com/api
 * (a repository variable for .github/workflows/pages.yml). */
const UPSTREAM = 'https://beta.playstructs.com';
const SITE = ['https://xn--2e0b952cv5c.com', 'https://www.xn--2e0b952cv5c.com'];

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    const allow = SITE.includes(origin) ? origin : SITE[0];
    const cors = { 'access-control-allow-origin': allow, 'access-control-allow-credentials': 'true', vary: 'origin' };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': req.headers.get('access-control-request-headers') || 'content-type, authorization', 'access-control-max-age': '600' } });
    }
    if (!url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    const up = new Request(UPSTREAM + url.pathname + url.search, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body, redirect: 'manual' });
    up.headers.delete('origin');
    up.headers.set('host', new URL(UPSTREAM).host);
    const res = await fetch(up);
    const out = new Response(res.body, res);
    // The guild's cookie, re-issued for this host: no Domain (host-only), still Secure, SameSite=Lax
    // is enough now that the page and this relay are the same site.
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    out.headers.delete('set-cookie');
    for (const c of cookies) out.headers.append('set-cookie', c.replace(/;\s*domain=[^;]*/gi, '').replace(/;\s*samesite=[^;]*/gi, '') + '; SameSite=Lax');
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
