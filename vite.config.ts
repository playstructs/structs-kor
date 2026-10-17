import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

/* The dev relay.
 *
 * In development the page never talks to a guild or the chain directly. Everything goes through
 * this dev server under /relay/*, which makes every call same-origin:
 *   - the Guild API's session cookie lands on localhost (we strip Secure/SameSite=None/Domain so
 *     every browser keeps it), so members-only routes work without third-party cookies;
 *   - no CORS allowlist entry is needed for http://localhost on the guild's side;
 *   - GRASS (NATS over WebSocket) and Matrix are proxied the same way.
 *
 * In production (vite build) the relay does not exist: src/config.ts points the page straight at
 * the guild's own URLs. See README.md › Environments. */

const strip = (cookie: string) =>
  cookie
    .replace(/;\s*Secure/gi, '')
    .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
    .replace(/;\s*Domain=[^;]+/gi, '');

function relay(target: string, prefix: string, rewriteTo: string, ws = false): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: true,
    ws,
    rewrite: (p) => p.replace(new RegExp('^' + prefix), rewriteTo),
    configure: (proxy) => {
      proxy.on('proxyRes', (res) => {
        const sc = res.headers['set-cookie'];
        if (sc) res.headers['set-cookie'] = sc.map(strip);
        // The relay is same-origin; the upstream's CORS answer is meaningless here.
        delete res.headers['access-control-allow-origin'];
        delete res.headers['access-control-allow-credentials'];
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const guild = env.RELAY_GUILD_ORIGIN || 'https://beta.playstructs.com';
  const grass = env.RELAY_GRASS_ORIGIN || 'wss://beta.playstructs.com:1443';
  const lcd = env.RELAY_LCD_ORIGIN || 'https://public.testnet.structs.network';
  const matrix = env.RELAY_MATRIX_ORIGIN || 'https://matrix.beta.playstructs.com';
  const proxy = {
    '/relay/guild': relay(guild, '/relay/guild', '/api'),
    '/relay/guild-json': relay(guild, '/relay/guild-json', '/guild.json'),
    '/relay/grass': relay(grass, '/relay/grass', '', true),
    '/relay/lcd': relay(lcd, '/relay/lcd', ''),
    '/relay/matrix': relay(matrix, '/relay/matrix', ''),
  };
  const headers = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };
  return {
    base: env.VITE_BASE || '/',
    build: { target: 'es2022' },
    server: { port: 5180, host: true, cors: false, headers, proxy },
    // `vite preview` serves the production build; it keeps the relay so a built copy can be tried
    // locally with VITE_TRANSPORT=relay (see README.md).
    preview: { port: 5181, cors: false, headers, proxy },
  };
});
