/* The feature checklist: every screen in the README's Screens table and every system in its
 * game-layer table, written once so every deep-dive agent knows what exists and the report can
 * show coverage (touched / passed / failed / blocked, and by whom).
 *
 *   mode     'account': needs a signed-in commander. 'demo': the browser-only demo base. 'any': either.
 *   expect   what must be on the page for the feature to count as present (CSS or /text/).
 *   open     a control to press first so the feature shows (a tab, a panel).
 *   act      a control that exercises it (the scripted dry-run agent presses it once).
 *   chain    pressing it signs a chain transaction: only with --chain-actions.
 *   guarded  the harness never lets an agent complete it (recovery phrase); presence only. */

export type FeatureMode = 'account' | 'demo' | 'any';
export interface Feature {
  id: string; area: string; name: string; path: string; mode: FeatureMode;
  expect: string; open?: string; act?: string; chain?: boolean; guarded?: boolean;
  /** What a tester should try, for the AI brief. */
  try: string;
}

const ALL: Feature[] = [
  // ── Onboarding and account ──
  { id: 'title', area: 'onboarding', name: 'Title screen with live battle', path: '/', mode: 'any', expect: '.title-menu a[href$="/start"], .title-menu a[href$="/console"]', try: 'Read the title screen; does it say what the game is? Does the live battle behind it run?' },
  { id: 'enlist', area: 'onboarding', name: 'Enlist (지금 시작 → /start)', path: '/start', mode: 'account', expect: '/입대|사령관/', try: 'The harness enlists you before you start; check the steps were clear and that you landed signed in.' },
  { id: 'login-screens', area: 'onboarding', name: 'Login: resume, import, unlock', path: '/login', mode: 'any', expect: '/환영|로그인|잠금/', try: 'Look at the returning-player options. Do not submit a recovery phrase or password.' },
  { id: 'profile', area: 'account', name: '내 정보 (account page)', path: '/profile', mode: 'account', expect: '/내 정보/', try: 'Read your account details: address, player id, guild.' },
  { id: 'chain-check', area: 'account', name: '체인 점검 (simulate a power order)', path: '/profile', mode: 'account', expect: '[data-act="check"]', act: '[data-act="check"]', try: 'Run the chain check. It only simulates; nothing is broadcast. Does the result explain itself?' },
  { id: 'phrase-guard', area: 'account', name: 'Recovery phrase reveal (guarded)', path: '/profile', mode: 'account', expect: '[data-act="reveal"]', guarded: true, try: 'Confirm the reveal control exists and warns you. The harness blocks revealing it; never try to read or copy the phrase.' },

  // ── Signed-in bridge and proof of work ──
  { id: 'bridge-live', area: 'bridge', name: 'Signed-in bridge: board, HUD, action bar', path: '/console', mode: 'account', expect: '.bd-cell[data-key]', try: 'Read your real planet and fleet on the board; select structs; read the action bar.' },
  { id: 'pow-panel', area: 'bridge', name: '작업 증명 (proof-of-work queue)', path: '/console', mode: 'account', open: '[data-act="intel"][data-k="pow"]', expect: '/작업 증명/', act: '[data-act="powToggle"]', try: 'Open the work queue; start hashing; watch progress for builds, mining, refining, raids.' },
  { id: 'pow-autosubmit', area: 'bridge', name: 'PoW auto-submit', path: '/console', mode: 'account', open: '[data-act="intel"][data-k="pow"]', expect: '[data-act="powAuto"]', chain: true, try: 'Turn on auto-submit only if chain actions are allowed in this run; otherwise just read what it would do.' },
  { id: 'build-real', area: 'bridge', name: 'Build a struct (MsgStructBuildInitiate)', path: '/console', mode: 'account', expect: '.bd-cell[data-key]', chain: true, try: 'Pick an empty slot and read the build options; build only if chain actions are allowed.' },
  { id: 'struct-power', area: 'bridge', name: 'Struct power switch', path: '/energy', mode: 'any', expect: '[data-act="power"]', try: 'Toggle a struct off and on; does the power readout follow?' },
  { id: 'raid-defense', area: 'bridge', name: 'Defend a raid: attack and guard (MsgStructAttack / DefenseSet)', path: '/console', mode: 'account', expect: '.bd-cell[data-key]', chain: true, try: 'If raiders are on your planet, arm 공격 or 방어 and read the confirmation; send only if chain actions are allowed.' },
  { id: 'threat-radar', area: 'bridge', name: '위협 레이더 and 세력 순위', path: '/console', mode: 'any', open: '[data-act="intel"][data-k="radar"]', expect: '/위협 레이더|세력 순위/', try: 'Read the threat radar and the standings.' },

  // ── Energy and market ──
  { id: 'energy-grid', area: 'energy', name: '전력망: capacity, load, margin', path: '/energy', mode: 'any', expect: '/전력망/', try: 'Read your grid; do the numbers add up?' },
  { id: 'brownout', area: 'energy', name: '정전 워게임 (brownout what-if)', path: '/energy', mode: 'any', expect: '[data-act="drop"]', act: '[data-act="drop"]', try: 'Drag the what-if slider; does it tell you what would switch off?' },
  { id: 'infuse', area: 'energy', name: 'Alpha infusion', path: '/energy', mode: 'demo', expect: '[data-act="infuse"]', act: '[data-act="infuse"]', try: 'Infuse alpha and check capacity rises.' },
  { id: 'market-providers', area: 'market', name: '전력 판매 목록 (providers)', path: '/market', mode: 'account', expect: '/전력 판매 목록|알파 거래소/', act: '[data-act="tab"]', try: 'Browse providers; read rates and terms.' },
  { id: 'market-agreements', area: 'market', name: '내 계약 (agreements)', path: '/market', mode: 'account', expect: '/내 계약|알파 거래소/', chain: true, try: 'Read your agreements; open or close one only if chain actions are allowed.' },
  { id: 'market-provide', area: 'market', name: '전력 판매하기 (become a provider)', path: '/market', mode: 'account', expect: '/전력 판매하기|알파 거래소/', chain: true, try: 'Read the provider form; create one only if chain actions are allowed.' },
  { id: 'guild-bank', area: 'market', name: '길드 중앙은행 (guild bank)', path: '/market', mode: 'account', expect: '/중앙은행|알파 거래소/', try: 'Read the guild bank: collateral, supply, ratio.' },
  { id: 'exchange-demo', area: 'market', name: 'Demo exchange: sell and buy power', path: '/market', mode: 'demo', expect: '[data-act="side"]', act: '[data-act="side"][data-v="sell"]', try: 'Sell spare power, then buy; watch price impact.' },
  { id: 'jobs', area: 'market', name: '의뢰 게시판 (contract board)', path: '/market', mode: 'demo', expect: '/의뢰 게시판/', act: '[data-act="job"]', try: 'Take a delivery or defence contract.' },
  { id: 'black-market', area: 'market', name: '암시장 (smuggler)', path: '/market', mode: 'demo', expect: '/암시장/', act: '[data-act="black"]', try: 'When the smuggler docks, buy a deal.' },
  { id: 'loans', area: 'market', name: '청룡 상단 대출 (loans)', path: '/market', mode: 'demo', expect: '/대출/', act: '[data-act="borrow"]', try: 'Borrow, then repay early.' },

  // ── Replicants ──
  { id: 'replicants', area: 'replicants', name: '레플리칸트 roster', path: '/replicants', mode: 'any', expect: '/레플리칸트|분대/', try: 'Read your squad; does the screen load without errors?' },
  { id: 'replicate', area: 'replicants', name: '복제 (replicate a new account)', path: '/replicants', mode: 'account', expect: '[data-act="replicate"]', chain: true, try: 'Read what replication does; replicate only if chain actions are allowed (it enlists another account).' },
  { id: 'standing-orders', area: 'replicants', name: '복무 규칙 (standing orders)', path: '/replicants', mode: 'any', expect: '/복무 규칙|근무 일지/', act: '[data-act="role"]', try: 'Set a role and standing orders; read the duty log.' },
  { id: 'demo-staff', area: 'replicants', name: 'Hire a watch officer, mechanic or trader (demo)', path: '/replicants', mode: 'demo', expect: '[data-act="hire"]', act: '[data-act="hire"]', try: 'Hire a staff member and watch them act.' },

  // ── Galaxy and fleet ──
  { id: 'galaxy-map', area: 'galaxy', name: '은하 지도: zoom, pan, tour', path: '/galaxy', mode: 'any', expect: '.gx-node', try: 'Zoom and pan; replay the tour from ?.' },
  { id: 'galaxy-leaders', area: 'galaxy', name: 'Top commanders and player intel', path: '/galaxy', mode: 'account', expect: '.gx-node', try: 'Pick a commander; read their intel.' },
  { id: 'fleet-launch', area: 'galaxy', name: '출격 (MsgFleetMove, confirmed)', path: '/galaxy', mode: 'account', expect: '/은하 지도/', chain: true, try: 'Read the launch control and its confirmation; launch only if chain actions are allowed.' },
  { id: 'scout', area: 'galaxy', name: 'Scout a rival (demo)', path: '/galaxy', mode: 'demo', expect: '.gx-node.rival', act: '.gx-node.rival', try: 'Scout a rival for 1 g; does the fleet shown match the raid?' },
  { id: 'counter-raid', area: 'galaxy', name: 'Counter-raid a rival in the simulator (demo)', path: '/galaxy', mode: 'demo', expect: '.gx-node.rival', try: 'Strike a rival; carry damage home.' },
  { id: 'vassals', area: 'galaxy', name: '복속 (vassals, tribute, rebellion)', path: '/galaxy', mode: 'demo', expect: '.gx-node', try: 'Make a thrice-raided rival a vassal; disarm it.' },
  { id: 'alliance', area: 'galaxy', name: '동맹 (alliances)', path: '/galaxy', mode: 'demo', expect: '.gx-node', try: 'Pay for an alliance and watch its ships join your raids.' },
  { id: 'outposts', area: 'galaxy', name: '거점 (outposts)', path: '/galaxy', mode: 'demo', expect: '.gx-node.site', act: '.gx-node.site', try: 'Claim and fortify an outpost.' },
  { id: 'invest', area: 'galaxy', name: '투자 (stakes in rival houses)', path: '/galaxy', mode: 'demo', expect: '.gx-node', try: 'Stake alpha in a house; sell it back.' },
  { id: 'covert', area: 'galaxy', name: '공작 (sabotage, heist)', path: '/galaxy', mode: 'demo', expect: '.gx-node', try: 'Run a covert operation and handle getting caught.' },
  { id: 'void-fleet', area: 'galaxy', name: '공허 함대 (Void Fleet)', path: '/galaxy', mode: 'demo', expect: '/은하 지도/', try: 'When it appears, intercept it in the simulator.' },
  { id: 'bounties', area: 'galaxy', name: '현상금 (bounties) and 보복 (revenge)', path: '/galaxy', mode: 'demo', expect: '/은하 전황|은하 지도/', try: 'Collect a bounty; strike back inside the revenge window.' },

  // ── Guild and comms ──
  { id: 'guild-real', area: 'guild', name: '길드: roster, bank, info (real guild)', path: '/guild', mode: 'account', expect: '/길드원|길드 정보/', try: 'Read the roster and guild info.' },
  { id: 'guild-demo', area: 'guild', name: 'NPC guilds, donations, 길드 전', path: '/guild', mode: 'demo', expect: '/길드/', act: '[data-act="join"]', try: 'Join, donate, follow the guild race.' },
  { id: 'chat', area: 'comms', name: '통신 (Matrix chat)', path: '/chat', mode: 'any', expect: '/통신/', try: 'Read channels; send a short friendly message.' },
  { id: 'chat-phrase-guard', area: 'comms', name: 'Chat blocks messages that look like a recovery phrase', path: '/chat', mode: 'any', expect: '/통신/', try: 'Do not test this with a real phrase. Note whether the warning exists.' },
  { id: 'notifications', area: 'comms', name: 'Notification log (HUD bell)', path: '/console', mode: 'any', expect: '/console|구조체/', try: 'Open the bell; read the last notifications.' },

  // ── Combat ──
  { id: 'tutorial', area: 'combat', name: '전투 훈련 (tutorial)', path: '/tutorial', mode: 'any', expect: '[data-act="next"], [data-act="phase"], [data-act="restart"]', act: '[data-act="next"]', try: 'Play the tutorial to the certificate.' },
  { id: 'sim-single', area: 'combat', name: 'Simulator: single battle', path: '/sim', mode: 'any', expect: '/교전 설정/', act: '[data-act="toDeploy"]', try: 'Set up, deploy, fight; try fire, guard (D), move (M), stealth (S), speeds.' },
  { id: 'sim-daily', area: 'combat', name: 'Simulator: 일일 교전 (daily)', path: '/sim', mode: 'any', expect: '/일일 교전/', try: 'Play the daily battle.' },
  { id: 'sim-gauntlet', area: 'combat', name: 'Simulator: 연전 (gauntlet)', path: '/sim', mode: 'any', expect: '/연전/', try: 'Play rounds of the gauntlet; take reinforcements.' },
  { id: 'sim-replay', area: 'combat', name: 'Replay and share link (?replay=)', path: '/sim', mode: 'any', expect: '/교전 설정/', try: 'After a battle, watch the replay and open the share link.' },
  { id: 'campaign', area: 'combat', name: '작전 (ten-mission campaign)', path: '/campaign', mode: 'any', expect: '/작전/', act: 'a[href*="mission="]', try: 'Play missions in order; read the stars and rewards.' },

  // ── Demo base systems ──
  { id: 'demo-bridge', area: 'demo', name: '데모 함교 (demo base)', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'Mine, refine, build; keep the grid out of brownout.' },
  { id: 'research', area: 'demo', name: '연구소 (research)', path: '/research', mode: 'demo', expect: '/연구소/', act: '[data-act="buy"]', try: 'Buy research; check its effect.' },
  { id: 'doctrine', area: 'demo', name: '교리 (doctrines)', path: '/research', mode: 'demo', expect: '/교리/', act: '[data-act="adopt"]', try: 'Adopt a doctrine; switch once.' },
  { id: 'world-engine', area: 'demo', name: '월드 엔진 and 새 시대', path: '/console', mode: 'demo', open: '[data-act="intel"][data-k="engine"]', expect: '/월드 엔진/', try: 'Pay into the World Engine; read what a new era resets.' },
  { id: 'raid-stance', area: 'demo', name: '대응 태세 (intercept / entrench) and forecast', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'When a raid approaches, read the odds per stance and choose.' },
  { id: 'abilities', area: 'demo', name: '지휘관 능력 (7–0)', path: '/console', mode: 'demo', expect: '/console|구조체/', try: 'Use an ability; read its cooldown.' },
  { id: 'overclock', area: 'demo', name: '과부하 운전 (overclock, V)', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'Overclock a machine; watch wear.' },
  { id: 'refit-veterans', area: 'demo', name: '개장 and 베테랑 (refits, named veterans)', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'Refit a hull; name a veteran.' },
  { id: 'decisions', area: 'demo', name: '결단 (decisions)', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'Answer a decision with 1 or 2.' },
  { id: 'advisor', area: 'demo', name: '참모 보고 (advisor)', path: '/console', mode: 'demo', expect: '/참모/', try: 'Follow the advisor; was it right?' },
  { id: 'after-action', area: 'demo', name: '전투 보고 (after-action report)', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'After a raid, read the report.' },
  { id: 'away-report', area: 'demo', name: '귀환 보고 and 복귀 보상', path: '/console', mode: 'demo', expect: '.bd-cell[data-key]', try: 'Come back after time away; read the report and streak.' },
  { id: 'daily-orders', area: 'demo', name: '일일 임무 (daily orders)', path: '/console', mode: 'any', open: '[data-act="opsToggle"]', expect: '/일일 임무/', try: 'Read today\'s three orders; finish one.' },

  // ── Reference and career ──
  { id: 'codex', area: 'reference', name: '교본 (codex)', path: '/codex', mode: 'any', expect: '/교본/', try: 'Check that a few numbers match what you saw in play.' },
  { id: 'record', area: 'career', name: '전적: rank, medals, objectives', path: '/record', mode: 'any', expect: '/훈장|작전 목표/', try: 'Read your rank and medals.' },
  { id: 'chronicle', area: 'career', name: '제국 연대기 (chronicle)', path: '/record', mode: 'demo', expect: '/제국 연대기/', try: 'Read the chronicle.' },
  { id: 'portrait', area: 'career', name: '초상화 (portrait editor)', path: '/record', mode: 'any', expect: '/초상화/', act: '[data-act="dice"]', try: 'Change your portrait.' },
  { id: 'hotkeys', area: 'reference', name: 'Hotkeys and ? help', path: '/console', mode: 'any', expect: '/console|구조체/', try: 'Press ? and try the navigation keys.' },
  { id: 'audio', area: 'reference', name: 'Sound (M) and music (J)', path: '/console', mode: 'any', expect: '/console|구조체/', try: 'Toggle sound and music.' },
];

/** The demo base is retired (src/game/retire.ts): its systems no longer have an entry point. Kept
 * here so the record of what was covered stays readable; they're out of every slice and the count. */
export const RETIRED = new Set(ALL.filter((f) => f.mode === 'demo').map((f) => f.id));
export const FEATURES: Feature[] = ALL.filter((f) => !RETIRED.has(f.id));

export const feature = (id: string) => FEATURES.find((f) => f.id === id);
export type FeatureStatus = 'untouched' | 'touched' | 'passed' | 'failed' | 'blocked' | 'guarded';
