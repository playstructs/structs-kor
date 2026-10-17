# 구조체 STRUCTS — Korean client

A static web/desktop client for Structs in Korean. It reads the game through the **Guild API**, takes live updates from **GRASS** (NATS over WebSocket), chats over the guild's **Matrix**, and signs moves in the browser. There is no server of its own.

```bash
pnpm install
pnpm dev        # http://localhost:5180, through the dev relay
pnpm build      # dist/ — upload anywhere static
```

## Environments

| | `pnpm dev` (relay) | production build (direct) |
|---|---|---|
| Guild API | `/relay/guild` → `RELAY_GUILD_ORIGIN/api` | `VITE_GUILD_API` |
| GRASS | `/relay/grass` (WebSocket) | `VITE_GRASS_URL` |
| Matrix | `/relay/matrix` | `VITE_MATRIX_URL` |
| Chain LCD (fallback only) | `/relay/lcd` | `VITE_LCD_URL` |

- **Dev relay.** The relay is the Vite dev server's proxy (`vite.config.ts`). Every call is same-origin, and the guild's session cookie is rewritten to stick on localhost, so members-only routes work with no CORS entry and no third-party cookies.
- **Production.** The page talks to the guild directly. The guild must allow this origin with credentials (REQ-AUTH-2), and cross-site sign-in needs a token (REQ-AUTH-1).
- **Overrides.** `VITE_TRANSPORT=relay|direct` overrides the default; see `.env.example`.

The build writes `404.html` and `_redirects`, so every screen path (`/console`, `/energy`…) serves the app shell on GitHub Pages, Netlify and Cloudflare Pages.

## Guild API first

- `src/api/guild.ts` holds the endpoints that exist today, from structs-webapp's controllers plus `/auth/matrix`.
- `src/api/planned.ts` holds the reads the site is built against but the guild doesn't serve yet. Each one calls the planned route first and, on 404/405/501, rebuilds the same shape from today's routes.
- The footer lists every fallback a page used.
- The requirements for the Guild API team are in [docs/guild-api-requirements.md](docs/guild-api-requirements.md) (ids match `src/api/requirements.ts`).
- Chain transactions try the guild first (REQ-TX) and fall back to the LCD (`src/api/actions.ts`).

## Screens

| Path | Screen | Data |
|---|---|---|
| `/` | Landing | REQ-PUB-* (public), else shown after sign-in |
| `/login` | Enlist, log in, unlock | `/auth/signup`, `/auth/login`, `/auth/player-address/…` |
| `/console` | Command console | REQ-AGG-1, GRASS `structs.grid.player.*`, `structs.planet.*` |
| `/energy` | Power grid, brownout what-if, struct power | REQ-EN-1/2, `MsgStructActivate`/`Deactivate` |
| `/market` | Energy exchange, contracts, provider, guild bank | `/provider/market`, `/agreement/owner/…/market`, `/guild-bank`, REQ-MKT-* |
| `/replicants` | Replicants, replication, standing orders | REQ-REP-*, `/auth/signup` per HD index |
| `/sim` | Battle simulator (local copy of structsd combat) | REQ-SIM-1 for the daily ladder |
| `/chat` | Comms (Matrix) | `/auth/matrix` → homeserver `/sync` |
| `/tutorial` | Combat Training (tutorial-attempt-1 flow, in Korean) | REQ-TUT-1 to save completion |

## Where things came from

- **Keys, vault, proto encoding, NATS client and the combat simulator:** structs-xyz (`src/wallet`, `src/grass/nats.ts`, `src/sim`, `src/data`).
- **Tutorial script:** structs-webapp `tutorial-attempt-1`.
- **Team colours:** structs-webapp `main.css`.
- **Designs:** the "Structs Korea" design canvas.
