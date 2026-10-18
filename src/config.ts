/* Where the page sends its calls.
 *
 *   relay  (pnpm dev): same-origin paths under /relay/*, carried by the Vite dev server
 *          (vite.config.ts) to the real guild. Cookies and CORS just work on localhost.
 *   direct (production build): straight to the guild's own URLs. The guild must allow this site's
 *          origin (CORS with credentials) — see docs/guild-api-requirements.md, REQ-AUTH-1.
 *
 * VITE_TRANSPORT overrides the default either way. */

// Outside Vite (node tests) there is no import.meta.env: fall back to the defaults below.
const env = (import.meta.env ?? {}) as ImportMetaEnv;
export type Transport = 'relay' | 'direct';
export const TRANSPORT: Transport = (env.VITE_TRANSPORT as Transport) || (env.DEV ? 'relay' : 'direct');

const strip = (u: string) => u.replace(/\/+$/, '');

export const GUILD_ID: string = env.VITE_GUILD_ID || '0-5';

const DIRECT = {
  guildApi: strip(env.VITE_GUILD_API || 'https://beta.playstructs.com/api'),
  grass: env.VITE_GRASS_URL || 'wss://beta.playstructs.com:1443',
  matrix: strip(env.VITE_MATRIX_URL || 'https://matrix.beta.playstructs.com'),
  lcd: strip(env.VITE_LCD_URL || 'https://public.testnet.structs.network'),
};

function wsOrigin() {
  if (typeof location === 'undefined') return 'ws://localhost:5180';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
}

export const endpoints = TRANSPORT === 'relay'
  ? { guildApi: '/relay/guild', grass: wsOrigin() + '/relay/grass', matrix: '/relay/matrix', lcd: '/relay/lcd' }
  : DIRECT;

export const SITE_URL = strip(env.VITE_SITE_URL || 'https://xn--2e0b952cv5c.com');
