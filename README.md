# 구조체 — Structs in Korean

The [structs-webapp](https://github.com/playstructs/structs-webapp) game
client, in Korean. structs-webapp is a git submodule (`structs-webapp/`, branch
`0.22.0-migration`) and its client is built as it is: its own JavaScript, page,
styles and art, with its webpack configuration as the starting point. What this
repository adds is the Korean overlay in [`ko/`](ko/README.md), applied while
webpack reads webapp's sources. Nothing in the submodule is edited, so a newer
structs-webapp builds with the same overlay.

Only the client side is used. The PHP side of structs-webapp (the guild API) is
whatever guild the page talks to.

## Setup

```bash
git clone --recurse-submodules <this repository>
npm install          # also installs structs-webapp/src's own dependencies
npm run dev          # http://localhost:5180
```

`npm run dev` relays `/api` to a guild (by default beta.playstructs.com, the
guild structs-webapp's beta serves), keeping the guild's session cookie on
localhost, and connects to that guild's GRASS feed and chain node.

| Variable | Default with `npm run dev` | Default for `npm run build` |
|---|---|---|
| `KO_GUILD_ORIGIN` | `https://beta.playstructs.com` (the `/api` relay) | — |
| `KO_GRASS_URL` | `wss://beta.playstructs.com:1443` | webapp's own: `ws://<page host>:1443` |
| `KO_CHAIN_WS` | `wss://public.testnet.structs.network:26657` | webapp's own: `ws://<page host>:26657` |

## Building and serving

```bash
npm run build        # dist/
```

`dist/` is a static site: `index.html` (webapp's game page), the bundles in
`js/` and webapp's `css/`, `img/`, `lottie/` and fonts. Like structs-webapp, the
page expects the guild API at `/api` on its own origin (its session cookie is
first-party), so serve `dist/` from the guild's host or behind a reverse proxy
that sends `/api` to the guild.

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
