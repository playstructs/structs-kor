// The guild this page plays through, and where that guild's services are.
//
// structs-webapp is served by its guild and finds everything on that host:
// the guild API at /api, GRASS and the chain node beside it, and it asks the
// API which guild it is (/guild/this). This page is 우주상사's (0-12, fixed
// at build time as CONFIG.guildId) and hosts none of them. Its guild API is
// shared with other guilds, so the API's own guild is not this page's: the
// guild id is never looked up, only the guild's services are.
//
// Before webapp's entry runs, the page reads the guild's guild.json (the
// endpoint the guild set on chain) for its API, GRASS and chain websocket. If
// it can't be read, what was last read is used, then CONFIG.fallback.
// Requests carry a bearer token from the guild's /auth/token, since a session
// cookie would be third-party here.
const CONFIG = __KO_CONFIG__;
const STORAGE_KEY = 'ko.guild';
const TIMEOUT_MS = 8000;

const current = {id: CONFIG.guildId, api: '', grass: '', chainWs: ''};
let token = null;

async function getJson(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.json();
}

/** Reads the chain's public node (its REST API). */
export const chain = path => getJson(CONFIG.lcd.replace(/\/+$/, '') + path);

/** @return {object|null} the services last read for this guild */
function stored() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.id === CONFIG.guildId ? saved : null;
  } catch {
    return null;
  }
}

function remember(services) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(services));
  } catch {
    // Private windows and blocked storage only lose the shortcut.
  }
}

/** The guild's services as its guild.json lists them. */
async function readServices() {
  const {Guild} = await chain(`/structs/guild/${encodeURIComponent(CONFIG.guildId)}`);
  const {guild} = await getJson(Guild.endpoint);
  const services = guild?.services ?? {};
  if (!services.guild_api) {
    throw new Error(`guild ${CONFIG.guildId} publishes no guild API`);
  }
  return {
    id: CONFIG.guildId,
    api: services.guild_api.replace(/\/+$/, ''),
    grass: services.grass_nats_websocket ?? '',
    // webapp's RPC client adds /websocket itself.
    chainWs: (services.client_websocket ?? '').replace(/\/websocket\/?$/, ''),
  };
}

function apply(services) {
  current.api = CONFIG.api || services.api || CONFIG.fallback.api;
  current.grass = CONFIG.grass || services.grass || CONFIG.fallback.grass;
  current.chainWs = CONFIG.chainWs || services.chainWs || CONFIG.fallback.chainWs;
}

const ready = (async () => {
  if (CONFIG.api) {
    // A fixed guild API (a local guild in development): nothing to read.
    apply({});
    return;
  }
  let services;
  try {
    services = await readServices();
    remember(services);
  } catch (error) {
    console.warn(`[ko] guild ${CONFIG.guildId} unavailable: ${error.message}`);
    services = stored() ?? {};
  }
  apply(services);
  console.info(`[ko] playing through guild ${current.id} at ${current.api}`);
})().catch(error => {
  console.warn('[ko] guild services could not be read:', error);
  apply({});
});

export const guild = Object.freeze({
  ready,

  get id() { return current.id; },
  get api() { return current.api; },
  get grass() { return current.grass; },
  get chainWs() { return current.chainWs; },

  /** Headers that authenticate a guild API request. */
  headers() {
    return token ? {Authorization: `Bearer ${token}`} : {};
  },

  setToken(value) {
    token = value || null;
  },
});
