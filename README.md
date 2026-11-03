# 구조체 — Structs in Korean

The [structs-webapp](https://github.com/playstructs/structs-webapp) game
client, in Korean. structs-webapp is a git submodule (`structs-webapp/`, following its
`main`) and its client is built as it is: its own JavaScript, page,
styles and art, with its webpack configuration as the starting point. What this
repository adds is the Korean overlay in [`ko/`](ko/README.md), applied while
webpack reads webapp's sources. Nothing in the submodule is edited, so a newer
structs-webapp builds with the same overlay.

Only the client side is used. This site hosts no guild API of its own: the page
talks straight to a guild's API, its GRASS feed and its chain node, wherever the
guild runs them.

## Setup

```bash
git clone --recurse-submodules <this repository>
npm install          # also installs structs-webapp/src's own dependencies
npm run dev          # http://localhost:5180
```

## Which guild

Before webapp's code starts, the page picks a guild using the chain's public
node (`ko/runtime/guild.js`):

1. `?guild=<id>` in the address,
2. else the guild of the player saved in this browser,
3. else the guild last used here,
4. else the default guild (`KO_GUILD_ID`, SN Corp `0-5`).

It reads that guild's `guild.json` (the endpoint the guild set on chain) for its
`guild_api`, `grass_nats_websocket` and `client_websocket`. If the guild can't
be reached, it uses what it last read for it, then any other guild on chain that
publishes an API. Requests carry a bearer token from the guild's
`/api/auth/token` (the same signed login as `/api/auth/login`), since a guild's
session cookie would be third-party here.

A player who recovers an account with a recovery key is moved to their own
guild as soon as the key names them. An activation code from another device is
looked up on the other guilds if the current one doesn't have it.

| Variable (build time) | Default | |
|---|---|---|
| `KO_GUILD_ID` | `0-5` | the guild for new players |
| `KO_LCD_URL` | `https://public.testnet.structs.network` | the chain node guilds are found on |
| `KO_GUILD_API` | — | a fixed guild API (a local guild), skipping the search |
| `KO_GRASS_URL`, `KO_CHAIN_WS` | — | override what the guild publishes |

## Building and serving

```bash
npm run build        # dist/
```

`dist/` is a static site: `index.html` (webapp's game page), the bundles in
`js/` and webapp's `css/`, `img/`, `lottie/` and fonts. Serve it from any
static host; it needs nothing on its own domain.

## Updating structs-webapp

```bash
git -C structs-webapp pull       # or check out another commit
npm --prefix structs-webapp/src ci
npm run audit:ko
```

The audit lists overlay entries whose English upstream changed (`stale`) and
new English a player would read (`untranslated`); `npm test` fails while any
remain. Fix them in `ko/strings/` (see [ko/README.md](ko/README.md)), then commit
the submodule pointer together with the overlay.

## Licences

structs-webapp is Apache-2.0 (Slow Ninja Inc). Galmuri, the Korean pixel font
that `ko/public/ko/ko.css` gives webapp's fonts for Hangul, is SIL OFL 1.1
(`ko/public/ko/fonts/Galmuri-OFL.md`).
