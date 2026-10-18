# Guild API requirements from 구조체 (Structs Korea)

**From:** the structs-kor web/desktop client · **For:** the Guild API team (structs-webapp) · **Date:** 2026-10-17

## Why this exists

구조체 is a static site: no server of its own. Every read goes to the Guild API, every live update to GRASS, chat to the guild's Matrix homeserver. We would like it to talk to **nothing but the guild**: no structsd LCD/RPC from players' browsers.

The client is already built against the endpoints below. Each one is called first and, when the guild answers 404/405/501, the client remembers that for the visit and rebuilds the same shape from today's routes (`src/api/planned.ts`, ids in `src/api/requirements.ts`; the dev footer lists every fallback a page used). **Shipping any of these needs no client release**: the site picks it up on the next page load.

What we verified against `https://beta.playstructs.com/api` on 2026-10-17:

- Everything except `/auth/*`, `/guild/this`, `/timestamp`, `/setting` answers `401 Login required` without a session.
- The live deployment reflects the request `Origin` with `Access-Control-Allow-Credentials: true` (no CORS config exists in the repo, so this comes from the proxy in front).
- `POST /auth/matrix` is live (not in the repo).
- `PUT /player/mini-game/progress` (tutorial branch) answers 405: not deployed.

## Priorities

| Pri | Id | Ask | Today's cost without it |
|---|---|---|---|
| P0 | REQ-AUTH-1 | Bearer-token login | Production sign-in breaks in Safari and Firefox (third-party cookies blocked) |
| P0 | REQ-AUTH-2 | CORS allowlist for our domains | Site cannot call the guild from production at all |
| P0 | REQ-PUB-1/2/3 | Public summary, leaderboard, guild directory | Landing page shows no live numbers to visitors |
| P0 | REQ-TUT-1 | Ship the tutorial branch's mini-game routes | Tutorial completion stays in one browser |
| P1 | REQ-AGG-1 | Player dashboard aggregate | 9 calls per console load, plus re-reads on every GRASS event |
| P1 | REQ-EN-1 | Player energy aggregate with allocation power and cascade order | 4 + N calls, and allocation power is not available at all |
| P1 | REQ-REP-1/2 | Replicant list; batch address → player | 12+ calls per replicants page |
| P1 | REQ-TX-1/2/3 | Account, broadcast, tx result | Players' browsers must reach structsd LCD |
| P2 | REQ-EN-2 | Brownout what-if | Client-side guess of cascade |
| P2 | REQ-MKT-1/2 | Market stats (24 h change), quote | No price movement shown; client-side quote |
| P2 | REQ-CHAT-1 | Game object → Matrix room | Room names guessed from a naming convention |
| P2 | REQ-SIM-1 | Daily engagement + ladder | Daily seeded locally, no ladder |
| P2 | REQ-I18N-1/2 | Korean struct names; Hangul usernames | Client translation table; usernames may reject Hangul |
| P2 | REQ-PERF-1/2 | ETag/Cache-Control; `meta.height` everywhere | Re-downloads static tables; can't reconcile with GRASS |

All shapes below follow the existing envelope `{success, errors, data, meta?}`; amounts keep the `_p` full-precision convention from `/api/denom`; power is in milliwatts.

---

## P0 — Access

### REQ-AUTH-1 · Bearer-token login

The guild session is a PHP cookie. From 구조체.com the guild is a third-party origin, so Safari (ITP) and Firefox (ETP) drop the cookie and every members-only call fails after a successful login. (Our dev relay hides this by making the guild same-origin.)

`POST /api/auth/token`, body identical to `/auth/login` (`{address, signature, pubkey, guild_id, unix_timestamp}`, same `LOGIN_GUILD{g}ADDRESS{a}DATETIME{ts}` message, same 600 s window).

```json
{ "success": true, "data": { "access_token": "…", "token_type": "Bearer", "expires_in": 3600, "player_id": "1-404" } }
```

Accept `Authorization: Bearer <token>` on every route that accepts the session today. `GET /api/auth/logout` with the header revokes it.

*Acceptance:* a browser with third-party cookies blocked can sign in from another origin and read `/api/block`.

### REQ-AUTH-2 · CORS for our origins

Allow, with credentials and an `OPTIONS` preflight answer (the client sends `Content-Type: application/json` and `Authorization`), these origins: `https://xn--2e0b952cv5c.com` (구조체.com, proposed main), `https://xn--2e0b952c.com`, `.net`, `.io`, `.co`, `https://xn--3f5bzt.com`, `.net`, `http://localhost:5180` for development, and the desktop app's own origins: `tauri://localhost` (macOS, Linux) and `http://tauri.localhost` (Windows). Please put this in the repo (it is currently only in the deployment's proxy), so every guild that runs the webapp gets it.

### REQ-PUB-1 · Public summary

No auth. Cacheable for 60 s.

`GET /api/public/summary`

```json
{ "guild_name": "SN Corp", "players": 1234, "active_players": 210, "planets": 980, "structs": 15400, "guilds": 14, "height": 1820455 }
```

Today: six members-only count routes, so visitors see nothing.

### REQ-PUB-2 · Public leaderboard

`GET /api/public/leaderboard/{player|guild}?limit=10`: the same rows as `/api/leaderboard/{kind}`, no auth, cached 120 s.

### REQ-PUB-3 · Public guild directory

`GET /api/public/guild/directory`: the same rows as `/api/guild/directory`, no auth.

### REQ-TUT-1 · Ship the tutorial branch routes

Merge `tutorial-attempt-1`'s `PUT /api/player/mini-game/progress` and `GET /api/player/{id}/mini-game/{interface_name}` to main and deploy. The client saves Combat Training completion as `{interface_name: "tutorial", game_name: "combat_training", score: 1}`. Today: live answers 405.

---

## P1 — Fewer round trips

### REQ-AGG-1 · Player dashboard

`GET /api/player/{player_id}/dashboard`. One read for the command console, re-fetched (throttled) on GRASS events for this player and planet.

```json
{
  "player": { "…": "same as GET /player/{id}" },
  "power": { "…": "same as GET /player/{id}/power" },
  "planet": { "…": "same as GET /planet/{id}" },
  "shield_health": 92,
  "active_raid": null,
  "fleet": { "…": "same as GET /fleet/player/{id}" },
  "structs": [ "…same as GET /struct/player/{id}" ],
  "work": [ "…same as GET /work/player/{id}" ],
  "activity": [ "…GET /planet-activity/player/{id}/page/1?limit=20&order=desc" ],
  "height": 1820455
}
```

Today: 9 calls (player, then 8 in parallel).

### REQ-EN-1 · Player energy

`GET /api/player/{player_id}/energy`

```json
{
  "power": { "…": "same as GET /player/{id}/power" },
  "infusions": [ "…GET /infusion/list/player/{id}" ],
  "allocations_out": [ { "id": "6-12", "allocation_type": "automated", "source_id": "1-404", "destination_id": "4-9", "created_at": "…", "power": "12000000", "power_p": "12000000", "cascade_rank": 1 } ],
  "allocations_in": [ { "id": "6-3", "source_id": "4-9", "power": "4000000" } ],
  "substation": { "id": "4-9", "name": "…", "connection_count": 37, "connection_capacity": "4120000" }
}
```

Two things nobody can get today:

- **Allocation power.** No allocation route returns how much each allocation carries. The client tries `/api/objects` and shows "—" when the field is absent.
- **`cascade_rank`.** The order in which GridCascade would destroy this source's allocations on a brownout. We assume `created_at` ascending; the indexer knows the real keeper order.

### REQ-REP-1 · Replicants

Replicants are extra players derived from the commander's recovery phrase (HD index ≥ 1). The guild can't see the HD link, but each replicant grants the commander permissions (`MsgPermissionGrantOnObject`, 33554431).

`GET /api/player/{commander_id}/replicants`: players that granted the commander permissions on themselves.

```json
[ { "player_id": "1-512", "address": "structs1…", "username": "Vesper-1", "alpha": "…", "ore": "…", "planet_id": "2-77", "capacity": "…", "load": "…", "structs_online": 4, "last_action_block_height": 1820400, "permissions": 33554431 } ]
```

### REQ-REP-2 · Batch address → player

`GET /api/player-address/resolve?addresses=a,b,c` (≤ 200) → `{ "structs1…": "1-512", "structs1…": null }`. Public, like the single-address route. Today: one call per address.

### REQ-TX-1/2/3 · Transactions through the guild

The official webapp broadcasts over structsd RPC (`:26657`). We would rather a player's browser only ever talk to its guild.

- `GET /api/account/{address}` → `{ account_number, sequence }`
- `POST /api/tx/broadcast` `{ tx_bytes: base64 }` → `{ txhash, code, codespace, raw_log }` (BROADCAST_MODE_SYNC; relay as-is, no signing)
- `GET /api/tx/{hash}` → `{ txhash, height, code, raw_log, gas_used }` or `null`

Today: the client falls back to the LCD (`/cosmos/auth/v1beta1/accounts`, `/cosmos/tx/v1beta1/txs`).

---

## P2 — Better screens

### REQ-EN-2 · Brownout what-if

`GET /api/player/{id}/power/what-if?capacity_delta=-12000000` (mW) → `{ "cut": ["6-12", "6-15"], "offline": false, "structs_to_stop": ["5-88"] }`, computed with the keeper's cascade order. Today: the client approximates it from REQ-EN-1 data.

### REQ-MKT-1 · Market stats

`GET /api/provider/market/stats?bucket=1d` → `[ { provider_id, rate_change_24h_pct, volume_24h, utilization } ]`. The Korean exchange shows ▲ red / ▼ blue 24 h movement (Korean market convention); today that column is empty.

### REQ-MKT-2 · Agreement quote

`GET /api/provider/{id}/quote?capacity=<mW>&duration=<blocks>` → `{ total, denom, valid, errors[] }`: escrow total (`capacity × rate × duration`) and whether the provider's limits and access policy allow this player. Today: computed client-side without the access-policy check.

### REQ-CHAT-1 · Game object → room

`GET /api/matrix/rooms?object_ids=2-14,9-3` → `{ "2-14": "#planet-2-14:matrix.…" }`, so "open chat" on a planet or fleet doesn't depend on a naming convention.

### REQ-SIM-1 · Daily engagement

- `GET /api/sim/daily` → `{ date, seed, code }`
- `GET /api/sim/daily/ladder?date=` → `[ { player_id, username, stars, blocks } ]`
- `POST /api/sim/result`, signed `{ date, code, result }`

Today: seeded locally from the date, with no shared ladder.

### REQ-I18N-1 · Korean struct names

`GET /api/struct/type?locale=ko`: adds `name_localized` and `description_localized`. Today: a client table (`src/i18n/ko.ts`).

### REQ-I18N-2 · Hangul usernames

Please confirm the username validation (3–20 chars) accepts Hangul (`\p{L}`), and add Korean entries to `/api/banned-word/all`.

### REQ-PERF-1 · Caching headers

`ETag` and `Cache-Control` on `/struct/type`, `/setting`, `/guild/this`, `/denom`, and the public routes. The SPA is static and can keep these for hours.

### REQ-PERF-2 · `meta.height` on every read

`meta.height` on every read, aggregates included, so the client can drop GRASS events older than what it already shows.
