// Which guild this page plays through, and where that guild's services are.
//
// structs-webapp is served by its guild and finds everything on that host:
// the guild API at /api, GRASS and the chain node beside it. This page can be
// served from anywhere and hosts none of them, so before webapp's entry runs
// it works the guild out from the chain:
//
//   ?guild=<id>, else the saved player's own guild, else the guild last used
//   here, else the default guild;
//
// then reads that guild's guild.json (the endpoint the guild set on chain)
// for its API, GRASS and chain websocket. A guild that can't be reached falls
// back to what was last read for it, then to any guild on chain that
// publishes an API. Requests carry a bearer token from the guild's
// /auth/token, since a session cookie would be third-party here.
const CONFIG = __KO_CONFIG__;
const STORAGE_KEY = 'ko.guild';
const TIMEOUT_MS = 8000;

const current = {id: null, api: '', grass: '', chainWs: ''};
const switchListeners = [];
let token = null;

async function getJson(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.json();
}

const chain = path => getJson(CONFIG.lcd.replace(/\/+$/, '') + path);

/** @return {{last?: string, guilds: Object<string, object>}} */
function stored() {
  try {
    return {guilds: {}, ...JSON.parse(localStorage.getItem(STORAGE_KEY))};
  } catch {
    return {guilds: {}};
  }
}

function remember(services) {
  try {
    const saved = stored();
    saved.last = services.id;
    saved.guilds[services.id] = services;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Private windows and blocked storage only lose the shortcut.
  }
}

/** The guild's services as its guild.json lists them. */
async function readServices(guildId) {
  const {Guild} = await chain(`/structs/guild/${encodeURIComponent(guildId)}`);
  const {guild} = await getJson(Guild.endpoint);
  const services = guild?.services ?? {};
  if (!services.guild_api) {
    throw new Error(`guild ${guildId} publishes no guild API`);
  }
  return {
    id: guildId,
    api: services.guild_api.replace(/\/+$/, ''),
    grass: services.grass_nats_websocket ?? '',
    // webapp's RPC client adds /websocket itself.
    chainWs: (services.client_websocket ?? '').replace(/\/websocket\/?$/, ''),
  };
}

async function resolve(guildId) {
  try {
    const services = await readServices(guildId);
    remember(services);
    return services;
  } catch (error) {
    console.warn(`[ko] guild ${guildId} unavailable: ${error.message}`);
    return stored().guilds[guildId] ?? null;
  }
}

/** @return {Promise<string[]>} every guild on chain */
async function guildIds() {
  try {
    const {Guild = []} = await chain('/structs/guild?pagination.limit=500');
    return Guild.map(guild => guild.id);
  } catch (error) {
    console.warn(`[ko] guild list unavailable: ${error.message}`);
    return [];
  }
}

async function playerGuildId(playerId) {
  const {Player} = await chain(`/structs/player/${encodeURIComponent(playerId)}`);
  return Player?.guildId || null;
}

function savedPlayerId() {
  try {
    return JSON.parse(localStorage.getItem('gameState'))?.thisPlayerId ?? null;
  } catch {
    return null;
  }
}

function apply(services) {
  current.id = services.id;
  current.api = CONFIG.api || services.api;
  current.grass = CONFIG.grass || services.grass || CONFIG.fallback.grass;
  current.chainWs = CONFIG.chainWs || services.chainWs || CONFIG.fallback.chainWs;
}

async function choose() {
  const candidates = [];
  const asked = new URLSearchParams(location.search).get('guild');
  if (asked) {
    candidates.push(asked);
  }
  const playerId = savedPlayerId();
  if (playerId) {
    try {
      candidates.push(await playerGuildId(playerId));
    } catch (error) {
      console.warn(`[ko] guild of player ${playerId} unknown: ${error.message}`);
    }
  }
  candidates.push(stored().last, CONFIG.guildId);

  const tried = new Set();
  const first = async guildIds => {
    for (const guildId of guildIds) {
      if (!guildId || tried.has(guildId)) continue;
      tried.add(guildId);
      const services = await resolve(guildId);
      if (services) return services;
    }
    return null;
  };
  // The rest of the guilds on chain are asked for only once the likely ones fail.
  return await first(candidates)
    ?? await first(await guildIds())
    ?? {id: CONFIG.guildId, api: CONFIG.fallback.api, grass: '', chainWs: ''};
}

const ready = (async () => {
  if (CONFIG.api) {
    // A fixed guild API (a local guild in development): nothing to find.
    apply({id: null, api: CONFIG.api, grass: '', chainWs: ''});
    return;
  }
  apply(await choose());
  console.info(`[ko] playing through guild ${current.id} at ${current.api}`);
})().catch(error => {
  console.warn('[ko] guild could not be chosen:', error);
  apply({id: CONFIG.guildId, api: CONFIG.fallback.api, grass: '', chainWs: ''});
});

/**
 * Switches to another guild for the rest of the visit, and for the next one.
 *
 * @return {Promise<boolean>} whether the guild changed
 */
async function use(guildId) {
  if (CONFIG.api || !guildId || guildId === current.id) {
    return false;
  }
  const services = await resolve(guildId);
  if (!services) {
    return false;
  }
  token = null;
  apply(services);
  console.info(`[ko] switched to guild ${current.id} at ${current.api}`);
  for (const listener of switchListeners) {
    await listener(current.id);
  }
  return true;
}

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

  /** @param {function(string): Promise<void>|void} listener called after each switch */
  onSwitch(listener) {
    switchListeners.push(listener);
  },

  use,

  /**
   * Follows a signing address to its player's guild.
   *
   * @return {Promise<boolean>} whether the guild changed
   */
  async followAddress(address) {
    try {
      const {playerId} = await chain(`/structs/address/${encodeURIComponent(address)}`);
      return playerId ? await use(await playerGuildId(playerId)) : false;
    } catch (error) {
      console.warn(`[ko] guild of ${address} unknown: ${error.message}`);
      return false;
    }
  },

  /**
   * Makes a guild request on this guild and, if it isn't found here, on each
   * other guild until one has it; that guild becomes the current one.
   *
   * @param {function(): Promise<*>} request reads guild.api when it runs
   * @param {function(*): boolean} found
   * @return {Promise<*>} the answer that was found, else this guild's
   */
  async findOnGuilds(request, found) {
    const here = await request();
    if (found(here) || CONFIG.api) {
      return here;
    }
    const home = {...current};
    for (const guildId of await guildIds()) {
      if (guildId === home.id) continue;
      const services = await resolve(guildId);
      if (!services) continue;
      current.api = services.api;
      try {
        const answer = await request();
        if (found(answer)) {
          Object.assign(current, home);
          await use(guildId);
          return answer;
        }
      } catch (error) {
        console.debug(`[ko] guild ${guildId}: ${error.message}`);
      } finally {
        if (current.id === home.id) Object.assign(current, home);
      }
    }
    return here;
  },
});
