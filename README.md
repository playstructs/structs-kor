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

The site is 우주상사's (`우상`, guild `0-12`), the Korean players' own guild.
Its id is fixed in `webpack.config.js` (`GUILD_ID`) and never looked up.
Webapp normally asks its guild API which guild it is (`/guild/this`), but
우주상사 shares SN Corp's API, so the page asks for `/guild/0-12` instead.

Before webapp's code starts, the page reads `0-12`'s `guild.json` (the endpoint
the guild set on chain, `https://구조체.com/guild.json`, which this site serves
from [`ko/public/guild.json`](ko/public/guild.json)) for its `guild_api`,
`grass_nats_websocket` and `client_websocket` (`ko/runtime/guild.js`). If it
can't be read, it uses what it last read, then the fallback in
`webpack.config.js`. Requests carry a bearer token from the guild's
`/api/auth/token` (the same signed login as `/api/auth/login`), since a guild's
session cookie would be third-party here.

Account recovery asks the chain which guild the key's player is in before it
calls the guild API, since a shared API may log in another guild's player. A
player of another guild is moved here first: the key signs
`MsgGuildMembershipJoin` for this guild (allowed when its join minimum is 0),
and recovery goes on once the chain shows the move and the guild API knows the
player. Recovery stops instead when the player owns their guild, the guild asks
a join minimum, or the chain can't be read (`ko/runtime/recovery.js`).

| Variable (build time) | Default | |
|---|---|---|
| `KO_LCD_URL` | `https://public.testnet.structs.network` | the chain node the guild is read from |
| `KO_GUILD_API` | — | a fixed guild API (a local guild in development), skipping guild.json |
| `KO_GRASS_URL`, `KO_CHAIN_WS` | — | override what the guild publishes |

### On chain

| | |
|---|---|
| Guild | `0-12` 우주상사, owned by founder player `1-14674` (`structs14n84fae09c5gkgp0hhtvekmy8hgcttce3mdj9d`) |
| Primary reactor | `3-5` LuckyStar |
| Entry substation | `4-23`, fed by allocation `6-73` from the guild's own stake |
| Joining | open: join minimum 0, invite bypass permissioned |
| Endpoint | `https://xn--2e0b952cv5c.com/guild.json` (구조체.com) |
| Sign-up (TSA) | player `1-14675` (`structs184whazg53m84xv479zrlqjlcgqkpqq6c99mv4m`), the host's proxy-join signer: 512 (GuildMembership) on `0-12`, 1024 (SubstationConnection) on `4-23` |
| Bank denom | `ramyeon` / `myeon` (in guild.json) |

The guild's motto, "상사 말씀은 언제나 옳습니다." ("The boss is always right"),
replaces SN Corp's "We know better." under its badge in sign-up, and 우주상사
replaces SN Corp wherever sign-up and the tutorial name the company.

## Building and serving

```bash
npm run build        # dist/
```

`dist/` is a static site: `index.html` (webapp's game page),
`sector-blitz/index.html` and one page per sector (the public Sector Blitz
leaderboard), the bundles in `js/` and webapp's `css/`, `img/`, `lottie/` and
fonts, plus `guild.json` and the guild's badge in `ko/img/`. It uses absolute
paths, so serve it from the root of 구조체.com; `guild.json` must be readable
cross-origin (`Access-Control-Allow-Origin: *`), since other clients read it.
GitHub Pages sends that header for every file.

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
