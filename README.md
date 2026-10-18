# 구조체 STRUCTS — Korean client

A static web/desktop client for Structs in Korean. It reads the game through the **Guild API**, takes live updates from **GRASS** (NATS over WebSocket), chats over the guild's **Matrix**, and signs moves in the browser. There is no server of its own.

```bash
pnpm install
pnpm dev        # http://localhost:5180, through the dev relay
pnpm build      # dist/ — upload anywhere static
pnpm test       # game-layer tests (economy, campaign, animation plan, proof hashing, chain messages, replays)
pnpm balance 40 # campaign win rates with the hard AI flying your side
pnpm soak 6000  # demo economy over 6000 blocks with a scripted player
```

Dev only: open any page with `?mock=1` to sign in as a fixture commander against a pretend Guild API (`src/api/mock.ts`; planned routes 404 so the fallbacks run). `?mock=0` turns it off. Production builds never include it.

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

## Search and sharing

- `src/seo.ts` holds every screen's title and description. The build writes one HTML file per screen (`console.html` → `/console`) with its own title, description, canonical, Open Graph/Twitter tags and JSON-LD (`WebSite`, `VideoGame`, `WebPage`), plus `sitemap.xml` and a fully permissive `robots.txt`; all absolute URLs use `VITE_SITE_URL`. In the browser the same tags follow the router.
- `public/og.png` (1200×630) is rendered from `scripts/og/og.html`: `node scripts/og/render.mjs` (headless Chrome). App icons: `python3 scripts/og/icons.py`. Manifest: `public/site.webmanifest`.

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
| `/replicants` | Replicants, replication, standing orders (demo: hire a watch officer, mechanic or trader with alpha to run the base for a wage) | REQ-REP-*, `/auth/signup` per HD index |
| `/sim` | Battle simulator (local copy of structsd combat) | REQ-SIM-1 for the daily ladder |
| `/chat` | Comms (Matrix); on the demo, the guild channel (guildmates react to raids, the Void Fleet and the guild race, and answer you) and a log of every rival transmission | `/auth/matrix` → homeserver `/sync` |
| `/tutorial` | Combat Training (tutorial-attempt-1 flow, in Korean) on the battle board | REQ-TUT-1 to save completion |
| `/research` | 연구소 (demo base) | — |
| `/galaxy` | 은하 지도: demo rivals, or the guild's top commanders with fleet launch | `/leaderboard/player`, `/player/:id`, `/planet/count`, `MsgFleetMove` |
| `/campaign` | 작전: ten missions, played in `/sim?mission=` | — (local) |
| `/guild` | 길드: real roster and bank, or demo NPC guilds | `/guild/:id`, `/guild/:id/roster`, `/guild-bank` |
| `/codex` | 교본: every system on one page, its numbers read from the game's own constants, each linked to where it's played (X) | — (local) |
| `/record` | 전적: the 제국 연대기 (empire chronicle: titles, vassals, rebellions, World Engine stages, eras, bounties, kept across eras); portrait, rank, medals, objectives | — (local) |

## Proof of work in the browser (`src/pow`)

Signed-in commanders can finish builds, mining, refining and raids from the bridge. The guild's `work/player/:id` lists what's owed; `engine.ts` hashes each on Web Workers (`sha.ts` and `hash.worker.ts` from structs-xyz `src/pow`, checked against `@noble/hashes` in `pnpm test`) and, with auto-submit on and the wallet unlocked, sends `MsgStructBuildComplete` / `MsgStructOreMinerComplete` / `MsgStructOreRefineryComplete` / `MsgPlanetRaidComplete` the block the proof qualifies (`CalculateDifficulty(age, range)` leading hex zeros).

Starting the work is signed in the browser too: the bridge's build menu sends `MsgStructBuildInitiate`, and the galaxy map's 출격 sends `MsgFleetMove` (behind a confirmation) so the raid begins on arrival; both then appear as work rows the engine proves. During a raid on your planet the raiding fleet's structs appear on the bridge board, and a selected struct can fire on them (`MsgStructAttack`, confirmed), or be ordered to guard another (`MsgStructDefenseSet`). Dev: `?mockraid=1` adds a raid to the mock.

**Checking real mode without risk:** 내 정보 (`/profile`) has a 체인 점검: it signs a power order for one of your structs exactly as a real move would and asks the chain's LCD to *simulate* it (`/cosmos/tx/v1beta1/simulate`). Nothing is broadcast, no sequence or fee is used; a pass proves the transaction decodes, the account and sequence line up and the message's own checks pass on the live chain. Simulation skips signature verification, so the signature itself is only proven by a real broadcast.

## The game layer (`src/game`)

| | |
|---|---|
| `map/board.ts`, `map/art.ts` | The battle board: the game's planet/fleet map as a DOM grid of 128 px pixel tiles, with the official Lottie attack, impact, shake, evade and destroy animations played through the game's serial event queue (structs-webapp `MapComponent`/`AnimationEventFactory`, by way of structs-universe `raidview.js`). Used by the bridge, the simulator and the landing page. |
| `demo.ts`, `director.ts` | 데모 함교: a pretend base that runs in the browser (mining → refining → alpha, power capacity and brownouts, construction, power sales with market impact, periodic raids) so anyone can play before they enlist. Clearly labelled; never touches the chain. |
| `progress.ts` | Rank (이병 → 원수), XP and objectives checked against live state. Kept per commander in this browser. |
| `/research` (`screens/research.ts`) | 연구소: alpha buys permanent upgrades for the demo base (mining, refining, power draw, trade margin, shield, gunnery, ore bunker); the deeper ones unlock with rank. |
| Rivals | Four AI commanders grow alongside the demo base; the bridge ranks everyone by net worth, raids come from them, and `/sim?raid=<id>` strikes back with your own demo fleet (damage carries home, loot is unrefined ore). |
| Persistence | One tab runs the clock (a heartbeat in `localStorage`) and the others follow its saves, so two open tabs never overwrite each other. The demo base lives in `localStorage` and keeps producing while you're away: on return up to an hour of missed blocks replays, raids are settled in summary, and a 귀환 보고 shows what was made and stolen. |
| 월드 엔진 | The demo's endgame: three stages bought with alpha (300 / 900 / 2400), each a permanent perk, the last a finale. Tuned with `pnpm soak` to land after several hours of play. Once it runs, 새 시대 starts the galaxy over around a stronger base: production +15% per era for good, research, doctrine and guild kept, rivals growing 20% faster per era. |
| 통신 | `comms.ts`: each rival commander has a voice (붉은 연합 loud, 검은 별 길드 cold, 해적 87호 pirate slang, 청룡 상단 a polite merchant); their portrait and a typed-out line arrive when they raid, are beaten back, win, rebel, submit or post a bounty. |
| 교리 | Doctrines on `/research`: 산업 (mining and refining +20%, half the overclock wear), 전쟁 (raid loot +30%, bounties +50%) or 상업 (power sales +12%, tribute +25%). One at a time; the first is free, switching costs 40 g. |
| 대응 태세 | While a raid approaches, choose 요격 (intercept: +30% chance of extra damage, but you take more) or 참호 (entrench: shield blocks 1.6× as often, guns a little weaker). The first three raids of a new base are small and spaced out. |
| 지휘관 능력 | Three active powers on the bridge, unlocked by rank, each with a cooldown: 긴급 정제 (7: refine 25 blocks' worth at once), 방어막 과충전 (8: shield +40% when a raid is coming), 총동원 (9: every gun fires in base defence for 20 blocks, during a raid). |
| 베테랑 | Kills your demo ships score in raids stay with them: ★ at 3, ★★ at 8 (+1 damage defending the base), ★★★ at 15. Veterans can be named; names show in their panel, promotions and the debrief's MVP card (the unit with the most kills and damage). |
| 은하 지도 조작 | The galaxy map zooms (wheel, + / −) and pans (drag); 0 resets. A first-visit tour explains it (replay from ?). |
| 동맹 | Pay 15 g for a 200-block alliance with a rival (not 붉은 연합): it never raids you and two of its ships join your raids (and your odds); spying on it ends the deal. |
| 거점 | Three outposts on the galaxy map (광물 소행성대 mining +15%, 중계 기지 sale price +5%, 요새 위성 shield +1/block; each +40 power). Claim with a 12 g sortie (odds: your warships against the garrison and any holder's fleet), fortify for 10 g a level, and hold them: every 160 blocks a rival tries to take one. |
| 복귀 보상 | Coming back on consecutive days pays 2 α × the streak (up to 20 α), with a banner and a chronicle line; the title screen's save slot shows the streak and the latest milestone. |
| 전투 보고 | After each defence of the base the bridge shows an after-action report (stance, shield blocks, hits taken, ore lost, kills per ship, promotions) for 60 blocks. Kills in home defence now count toward veterancy too, with a promotion banner. |
| 투자 | Stake alpha in a rival house from the galaxy panel (up to 200 g each; 붉은 연합 refuses): it pays 0.1% of the stake a block out of that house's treasury (half while sabotaged) and counts toward your worth. Robbing a house you hold costs 25% of the stake; selling returns 90%. |
| 원한 | Every raid you win against a house adds a grudge (max 5, one fades every 100 blocks); each point makes that house 25% likelier to be the one that raids you. Shown on the galaxy panel. |
| 연합 전선 | Past 55% hegemony, 35% of raids come as a two-house coalition with two more escorts (still capped at six); breaking one costs both houses a ship. First coalition is written in the chronicle; the advisor warns. |
| 보복 | Break a raid and its owner is exposed for 40 blocks: a counter-raid inside the window takes 1.5× the usual share of their ore (once, win or lose). The galaxy button, advisor and a notification say so. |
| 개장 | Refit a fleet hull from the bridge inspector: extra armour (+2 hull), gun upgrade (+1 base-defence damage) or evasion thrusters (+20%p dodge). One module per hull, lost with it; armour above the type's cap survives a launched raid. |
| 전황 예측 | While a raid approaches, the alarm shows the win odds for each stance: the base's own raid rules played 40 times on a throwaway copy of the save (events and saves muted, memoized per block). The advisor picks the stance from it. |
| 암시장 | A smuggler docks on the exchange every ~180–240 blocks for 30 blocks with three of five one-off deals at rolled prices: shield charger, bribe to delay the next raid 60 blocks, dump up to 40 ore at 0.9 α each, reset ability cooldowns, field repairs. |
| 의뢰 게시판 | A contract board on the exchange, refreshed every 120 blocks: deliveries buy ore at 10–25% over its refined value, at once; defence contracts pay for two raids repelled within 150 blocks. |
| 대출 | 청룡 상단 credit on the exchange: borrow 20 or 50 g, repay 20% more within 200 blocks (automatically at term, or early). Default and the house seizes ore at twice the shortfall and sends its fleet; no new era while a loan is open. |
| 공작 | Covert operations from a rival's galaxy panel: 사보타주 (8 g, 70%: its growth halves for 100 blocks) or 금고 털기 (5 g, 55%: steal 15% of its ore). Caught, and any pact breaks and its fleet comes for you. |
| 공허 함대 | Every 300 blocks the Void Fleet appears for 60 (purple on the galaxy map). Intercept it in the simulator (`/sim?raid=void`) for 30 α (+10 per earlier kill); ignored, it falls on you (half your ore, structs damaged) or a rival (fleet −2, ore halved). |
| 현상금 | Every 110 blocks a rival posts a bounty on another (◆ on the map); win a raid on the target within 80 blocks and the patron pays it on top of the loot. |
| 과부하 운전 | Overclock (V on a selected struct, drawn hot with an OC tag on the board): an extractor or refinery makes ×1.6 for ×1.8 the power, a generator gives ×1.5; each overclocked machine has a 3% chance a block to lose a point of health, and breaks at zero. |
| 참모 보고 | `advisor.ts`: the demo bridge's advisor reads the base and the galaxy and names the three most urgent moves (incoming raid on exposed ore, idle refinery, brownout risk, a selling window, a vassal near rebellion, a rival ripe to subjugate or raid), each linked to the screen that acts on it. |
| Rival wars | Every 40 blocks one rival raids another (its own random stream): the winner takes ore, the loser a ship. Strikes flash across the galaxy map and land on its 은하 전황 wire; vassals are under your protection. |
| 패권 지수 | The demo's measure of power: your share of all the galaxy's worth (vassals count as yours), shown on the bridge standings and the galaxy map. Crossing 25 / 40 / 55 / 70% earns a title (지역 강자 → 은하 황제) and XP. |
| 결단 | Every few minutes the demo bridge offers a decision with a price on each side (smugglers, non-aggression pacts, a bulk ore buyer, mercenaries, ultimatums); 1/2 answer it, and it lapses if ignored. |
| `daily.ts` | 일일 임무: three orders a day picked by the date, measured from the day's start; XP each and a bonus for all three. |
| Notification log | Every corner toast is kept; the HUD bell shows the unread count and the last 40. |
| `music.ts` | A generated soundtrack (pad + pentatonic arpeggio; a driving pulse during raids and battles). On the demo base, peacetime grows with your hegemony title: a heartbeat, then a bass line, then a brighter top line. J toggles it; M silences everything. |
| `/galaxy` | 은하 지도: the demo galaxy on four spiral arms (structs-xyz `galaxyLayout`), rivals sized by power, raids drawn as live routes; scouting (1 g) reveals exactly the fleet a raid will meet. A rival raided three times can be made a vassal (복속; one, plus one per hegemony title): it pays a share of its growth as tribute every block and stops raiding, but rebels as its fleet regrows unless you pay to disarm it. |
| `/campaign` | 작전: ten scripted missions (`src/game/campaign.ts`): seven against 붉은 연합, each teaching one tactic (firing, guarding, battlegrounds, defenders first, combined arms, stealth, flagship moves), then one against each other house (해적 87호's swarm, 검은 별 길드's guarded fortress, 청룡 상단's four-front finale; tuned with `pnpm balance`); unlock in order, stars and first-clear XP. Played in the simulator via `/sim?mission=<id>`. |
| `/guild` | 길드: on the demo, a 600-block 길드 전 (guild race) between the three NPC guilds (donations, repelled raids and bounties score for yours; the winner's members get 20 α); the real guild (roster with portraits, bank, info) when signed in; on the demo base, three NPC guilds with their own perks, alpha donations and levels that lift everyone's mining. |
| `/record` | 전적: commander portrait (editable for guests; on-chain `pfp` when signed in), rank ladder, career numbers, medals and every objective. The HUD's rank plate opens it. |
| `sfx.ts`, `fx.ts`, `keys.ts`, `attract.ts` | Synthesised sound (M mutes), rolling counters, banners, shake; hotkeys (`?` lists them); the title screen's live AI-vs-AI battle. |

The simulator adds a fleet editor on a point budget, a five-round 연전 (gauntlet: survivors carry their damage, each win offers a reinforcement — from structs-xyz `sim/fleets.ts`) and 1×/2×/4× speed. In battle a selected unit can fire, guard an ally (D), move the flagship to another battlefield (M) or toggle stealth (S), all as chain messages on the local chain. Every battle records its orders: the debrief replays it on the board, and a share link (`/sim?replay=…`, structs-xyz's replay codec plus starting charge) plays it for anyone — the seeded chain reproduces it exactly (checked in `pnpm test`).

## Where things came from

- **Keys, vault, proto encoding, NATS client and the combat simulator:** structs-xyz (`src/wallet`, `src/grass/nats.ts`, `src/sim`, `src/data`).
- **Tutorial script:** structs-webapp `tutorial-attempt-1`.
- **Commander portraits** (`public/img/pfp`, 72×72 layers; rules from structs-universe `frontend/pfp.js`).
- **Struct pixel art, map tiles, focus rings and Lottie animations** (`public/img/structs`, `public/img/tiles`, `public/img/focus`, `public/lottie`): the official Structs art, via structs-universe `frontend/` and structs-webapp `src/public/` (both Apache-2.0, © Slow Ninja Inc). lottie-web is MIT.
- **Team colours:** structs-webapp `main.css`.
- **Designs:** the "Structs Korea" design canvas.
