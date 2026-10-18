/* The twenty playtest profiles: ten player types, and ten feature specialists for the deep dive. Each one is a kind of player the game has to work for, written once
 * and used by every layer of the harness:
 *   - sim:     `policy` names the decision function in sim/policies.ts that plays the demo base
 *              headless for thousands of blocks; `expect` holds the outcomes that persona must see.
 *   - browser: `device`, `input`, `network`, `motion` and `journey` drive a real browser profile
 *              (its own persistent storage under playtest/.profiles/<id>) through the live site.
 *   - ai:      `voice` and `goals` brief a Claude playtester who plays as that person and writes
 *              the review a human playtester would.
 * Add a profile here and every layer picks it up. */

export type PolicyId =
  | 'newcomer' | 'industrialist' | 'warlord' | 'trader' | 'turtle'
  | 'diplomat' | 'completionist' | 'speedrunner' | 'accessibility' | 'chaos';

export type Device = 'desktop' | 'laptop' | 'tablet' | 'mobile';
export type Input = 'mouse' | 'keyboard' | 'touch';
export type Network = 'fiber' | 'cable' | '4g' | '3g';

export interface Expect {
  /** Share of seeds allowed to end in a death spiral (no income, no alpha, for 300+ blocks). */
  maxSpiralRate: number;
  /** Median net worth at the end must reach at least this. */
  minMedianWorth?: number;
  /** Median raids lost may not exceed this share of raids faced. */
  maxLossShare?: number;
  /** Milestones this persona must reach in at least `rate` of seeds, by block `by`. */
  milestones?: { id: Milestone; by: number; rate: number }[];
  /** Share of this persona's orders the game may refuse before it counts as friction. */
  maxRejectRate?: number;
}

export type Milestone =
  | 'refineryOnline' | 'firstResearch' | 'firstRepel' | 'firstRaidWon' | 'firstVassal'
  | 'tier1' | 'tier2' | 'tier3' | 'engine1' | 'engine2' | 'engine3' | 'newEra' | 'rank5' | 'rank10';

export interface Profile {
  id: string;
  /** Display name: Korean handle and an English gloss. */
  name: string;
  ko: string;
  archetype: string;
  /** Who this is, in one paragraph: what they want and how they play. */
  bio: string;
  /** How much they know: 0 never played a strategy game, 1 genre veteran. */
  skill: number;
  /** How long they keep trying a confusing screen before giving up, in actions. */
  patience: number;
  /** Actions per minute in the browser (paces clicks and keys). */
  apm: number;
  device: Device;
  input: Input;
  network: Network;
  /** prefers-reduced-motion. */
  motion: 'full' | 'reduced';
  /** Extra text zoom (1 = none); the low-vision profile plays at 2. */
  zoom: number;
  policy: PolicyId;
  /** Screens and moves the browser layer walks, in order (see browser/journeys.ts). */
  journey: string[];
  /** What they come for, for the AI playtester. */
  goals: string[];
  /** How they talk and what bothers them, for the AI playtester. */
  voice: string;
  /** The questions this persona exists to answer. */
  questions: string[];
  expect: Expect;
  /** Feature ids (features.ts) this persona owns in a deep dive; it explores freely beyond them. */
  slice: string[];
  /** Plays a signed-in account in the deep dive (enlists when the run allows it). */
  account?: boolean;
  /** Left out of the headless simulation (specialists reuse an existing policy's play). */
  sim?: false;
}

export const PROFILES: Profile[] = [
  {
    id: 'newcomer', name: 'Minji (first-timer)', ko: '민지 · 신병', archetype: 'Casual mobile newcomer',
    bio: 'Found the game from a shared link on her phone during a commute. Has never played an RTS or a crypto game. Reads Korean UI fluently, skims long text, taps whatever glows. Plays in 5-minute bursts and comes back the next day.',
    skill: 0.1, patience: 6, apm: 12, device: 'mobile', input: 'touch', network: '4g', motion: 'full', zoom: 1,
    policy: 'newcomer',
    journey: ['title', 'demo', 'tour', 'bridge-idle', 'tap-glowing', 'away-1h', 'return-report', 'tutorial'],
    goals: ['Understand what the game is within a minute', 'Not lose everything while away', 'Feel progress each session'],
    voice: 'Short, honest reactions in Korean or English. Gets annoyed by jargon (kW, alpha, ambit) that is never explained, tiny tap targets, and anything that punishes her for being away.',
    questions: ['Can someone who does almost nothing still progress?', 'Does the first session explain itself?', 'Is coming back after an absence rewarding or punishing?'],
    expect: { maxSpiralRate: 0.05, maxLossShare: 0.6, milestones: [{ id: 'refineryOnline', by: 300, rate: 0.5 }], maxRejectRate: 0.5 },
    slice: ['title', 'demo-bridge', 'tutorial', 'away-report', 'advisor', 'daily-orders'],
  },
  {
    id: 'industrialist', name: 'Dohyun (optimizer)', ko: '도현 · 산업가', archetype: 'Economy min-maxer',
    bio: 'Factorio and Anno veteran. Wants every machine running at capacity, reads every number, overclocks everything, keeps a spreadsheet. Avoids combat unless it pays.',
    skill: 0.9, patience: 30, apm: 60, device: 'desktop', input: 'mouse', network: 'fiber', motion: 'full', zoom: 1,
    policy: 'industrialist',
    journey: ['title', 'demo', 'bridge-build', 'energy', 'overclock', 'research', 'doctrine-industry', 'market-sell', 'codex'],
    goals: ['Find the optimal build order', 'Verify the numbers in the codex match what happens', 'Reach the World Engine'],
    voice: 'Precise and numerical. Reports any number that does not add up, any rate the UI hides, and any upgrade that is strictly dominated.',
    questions: ['Is the economy curve smooth or does it plateau?', 'Is overclocking worth its wear?', 'Do codex numbers match behaviour?'],
    expect: { maxSpiralRate: 0, milestones: [{ id: 'firstResearch', by: 200, rate: 0.9 }, { id: 'engine1', by: 6000, rate: 0.5 }], maxRejectRate: 0.35 },
    slice: ['demo-bridge', 'overclock', 'research', 'doctrine', 'energy-grid', 'infuse', 'exchange-demo', 'world-engine'],
  },
  {
    id: 'warlord', name: 'Junho (warlord)', ko: '준호 · 군벌', archetype: 'Aggressive PvP raider',
    bio: 'StarCraft ladder player. Builds fleet first, raids anything weaker, chooses intercept, wants to subjugate every house. Judges the game by how good combat feels.',
    skill: 0.8, patience: 15, apm: 120, device: 'desktop', input: 'keyboard', network: 'cable', motion: 'full', zoom: 1,
    policy: 'warlord',
    journey: ['title', 'demo', 'doctrine-war', 'galaxy', 'scout', 'raid', 'sim-battle', 'stance-intercept', 'campaign'],
    goals: ['Win raids and make vassals', 'Master the simulator', 'Find out whether aggression is always right'],
    voice: 'Blunt, competitive. Calls out unfair odds, slow animations he cannot skip, and forecasts that lie.',
    questions: ['Is constant raiding a dominant strategy?', 'Do vassals snowball?', 'Are forecast odds honest?'],
    expect: { maxSpiralRate: 0.05, milestones: [{ id: 'firstRaidWon', by: 600, rate: 0.8 }, { id: 'firstVassal', by: 3000, rate: 0.4 }], maxRejectRate: 0.4 },
    slice: ['scout', 'counter-raid', 'vassals', 'raid-stance', 'abilities', 'sim-single', 'campaign'],
  },
  {
    id: 'trader', name: 'Seoyeon (trader)', ko: '서연 · 상인', archetype: 'Market speculator',
    bio: 'Day-trades for fun. Buys low, sells power high, takes every contract, borrows when the yield beats the rate, invests in rival houses, haunts the black market.',
    skill: 0.7, patience: 20, apm: 45, device: 'laptop', input: 'mouse', network: 'cable', motion: 'full', zoom: 1,
    policy: 'trader',
    journey: ['title', 'demo', 'doctrine-trade', 'market-sell', 'market-buy', 'jobs', 'loan', 'invest', 'black-market'],
    goals: ['Make alpha without fighting', 'Exploit price swings', 'Test whether loans and investments are worth it'],
    voice: 'Thinks in ROI. Complains when a price is not shown before committing, or when a fee is hidden.',
    questions: ['Can a pure trader keep up?', 'Are loans ever a trap?', 'Is there an arbitrage loop?'],
    expect: { maxSpiralRate: 0.05, maxRejectRate: 0.45 },
    slice: ['exchange-demo', 'jobs', 'black-market', 'loans', 'invest'],
  },
  {
    id: 'turtle', name: 'Hyejin (turtle)', ko: '혜진 · 거북이', archetype: 'Defensive builder',
    bio: 'Plays tower-defence and city builders. Hates losing what she built. Entrenches every raid, maxes shields, fortifies outposts, refits for evasion. Rarely attacks.',
    skill: 0.5, patience: 25, apm: 25, device: 'tablet', input: 'touch', network: 'fiber', motion: 'reduced', zoom: 1,
    policy: 'turtle',
    journey: ['title', 'demo', 'research-shield', 'stance-entrench', 'overshield', 'refit', 'outposts', 'record'],
    goals: ['Never lose a raid', 'Build a fortress', 'Grow without fighting'],
    voice: 'Patient and thorough. Notices when defence feels pointless, when reduced-motion is ignored, and tablet layout problems.',
    questions: ['Is pure defence viable?', 'Does entrench actually hold?', 'Does reduced motion work?'],
    expect: { maxSpiralRate: 0.02, maxLossShare: 0.35, milestones: [{ id: 'firstRepel', by: 400, rate: 0.8 }], maxRejectRate: 0.4 },
    slice: ['raid-stance', 'abilities', 'refit-veterans', 'outposts', 'after-action'],
  },
  {
    id: 'diplomat', name: 'Taeyang (diplomat)', ko: '태양 · 외교관', archetype: 'Social / guild player',
    bio: 'Plays for the people. Joins a guild on day one, donates, forms alliances, signs pacts, answers every decision, reads every chat line. Comes back after long absences.',
    skill: 0.5, patience: 20, apm: 20, device: 'laptop', input: 'mouse', network: 'cable', motion: 'full', zoom: 1,
    policy: 'diplomat',
    journey: ['title', 'demo', 'guild-join', 'donate', 'chat', 'decision', 'alliance', 'away-8h', 'return-report'],
    goals: ['Belong to a guild', 'Win through alliances', 'Feel the world is alive'],
    voice: 'Warm and story-focused. Cares about rival personalities, chat flavour and whether choices matter.',
    questions: ['Do social systems pay off?', 'Do decisions feel meaningful?', 'Is the long-absence catch-up fair?'],
    expect: { maxSpiralRate: 0.05, maxRejectRate: 0.45 },
    slice: ['guild-demo', 'alliance', 'decisions', 'chat', 'away-report'],
  },
  {
    id: 'completionist', name: 'Jiwoo (completionist)', ko: '지우 · 완성주의자', archetype: 'Achievement hunter',
    bio: 'Wants every medal, every star, every objective, every codex entry, then a new era. Plays every system at least once and notices anything that cannot be completed.',
    skill: 0.7, patience: 40, apm: 40, device: 'desktop', input: 'mouse', network: 'fiber', motion: 'full', zoom: 1,
    policy: 'completionist',
    journey: ['title', 'demo', 'every-screen', 'campaign', 'sim-battle', 'research', 'record', 'codex', 'daily'],
    goals: ['Touch every system', 'Finish the campaign', 'Reach a new era'],
    voice: 'Methodical checklist voice. Flags dead ends, unreachable medals, and screens that never explain themselves.',
    questions: ['Is every system reachable?', 'How long until the World Engine and a new era?', 'Are there dead ends?'],
    expect: { maxSpiralRate: 0, milestones: [{ id: 'engine3', by: 12000, rate: 0.3 }], maxRejectRate: 0.5 },
    slice: ['record', 'chronicle', 'codex', 'daily-orders', 'world-engine', 'campaign'],
  },
  {
    id: 'speedrunner', name: 'Hyunwoo (speedrunner)', ko: '현우 · 스피드러너', archetype: 'Speedrunner / exploit seeker',
    bio: 'Routes the fastest path to the World Engine. Keyboard only, skips every tour, opens multiple tabs, tries the cheapest sequence of buys. Will find the degenerate strategy if there is one.',
    skill: 1, patience: 8, apm: 200, device: 'desktop', input: 'keyboard', network: 'fiber', motion: 'reduced', zoom: 1,
    policy: 'speedrunner',
    journey: ['title', 'demo', 'skip-tour', 'hotkeys', 'multi-tab', 'research', 'engine'],
    goals: ['Fastest World Engine', 'Find degenerate strategies', 'Test hotkeys and multi-tab'],
    voice: 'Terse. Counts blocks. Reports anything that is unskippable, any hotkey that does not work, any sequence that breaks the economy.',
    questions: ['What is the fastest route to the World Engine?', 'Is there a degenerate loop?', 'Do two tabs ever corrupt the save?'],
    expect: { maxSpiralRate: 0, milestones: [{ id: 'engine1', by: 5000, rate: 0.6 }], maxRejectRate: 0.3 },
    slice: ['hotkeys', 'research', 'world-engine', 'overclock'],
  },
  {
    id: 'accessibility', name: 'Sujin (low vision, keyboard)', ko: '수진 · 접근성', archetype: 'Accessibility player',
    bio: 'Low vision, plays at 200% zoom with a screen reader for menus, keyboard only, reduced motion on. Patient but will not use a mouse. Represents every player who cannot rely on sight or pointer.',
    skill: 0.6, patience: 30, apm: 15, device: 'laptop', input: 'keyboard', network: 'cable', motion: 'reduced', zoom: 2,
    policy: 'accessibility',
    journey: ['title', 'keyboard-demo', 'keyboard-bridge', 'keys-help', 'keyboard-menu', 'a11y-audit', 'zoom-audit'],
    goals: ['Play without a mouse', 'Hear every important change announced', 'Read everything at 200%'],
    voice: 'Specific about barriers: unlabeled buttons, focus lost after a re-render, colour-only signals, text that clips at 200%, motion that ignores the setting.',
    questions: ['Can the whole demo loop be played by keyboard?', 'Do controls have names?', 'Does the layout survive 200% zoom?'],
    expect: { maxSpiralRate: 0.05, maxRejectRate: 0.5 },
    slice: ['hotkeys', 'title', 'demo-bridge', 'login-screens', 'audio'],
  },
  {
    id: 'chaos', name: 'Chaos monkey', ko: '혼돈 · QA 원숭이', archetype: 'Adversarial QA / fuzzer',
    bio: 'Not a person: a fuzzer that mashes every control, sends negative, huge and NaN amounts, double-clicks submits, corrupts local storage, toggles offline, resizes mid-animation and opens tabs. Finds the crashes nobody else will.',
    skill: 0, patience: 1000, apm: 600, device: 'desktop', input: 'mouse', network: '3g', motion: 'full', zoom: 1,
    policy: 'chaos',
    journey: ['title', 'demo', 'monkey', 'bad-input', 'corrupt-storage', 'offline', 'resize', 'multi-tab', 'monkey'],
    goals: ['Crash the client', 'Corrupt the save', 'Break an invariant'],
    voice: 'A bug report: steps, expected, actual, severity.',
    questions: ['Does any input crash or corrupt state?', 'Does the save survive corruption and multiple tabs?', 'Do invalid amounts get refused?'],
    expect: { maxSpiralRate: 1, maxRejectRate: 1 },
    slice: ['login-screens', 'exchange-demo', 'chat-phrase-guard', 'notifications'],
  },
  // ── Feature specialists: signed-in accounts that deep-dive one area each (deep-dive AI mode). ──
  {
    id: 'pow-engineer', name: 'Minseo (PoW engineer)', ko: '민서 · 작업증명 기술자', archetype: 'Signed-in bridge and proof of work',
    bio: 'Backend engineer who wants to see the real chain loop: builds, mining, refining and raid completions proven in the browser and submitted. Watches hash rates and difficulty.',
    skill: 0.9, patience: 40, apm: 40, device: 'desktop', input: 'mouse', network: 'fiber', motion: 'full', zoom: 1, policy: 'industrialist', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Prove work for every kind of job', 'Understand difficulty and timing', 'See a submitted proof land on chain'],
    voice: 'Engineer: precise, wants to see state transitions and error messages that mean something.',
    questions: ['Does the PoW queue explain each job?', 'Do proofs finish and submit?', 'What happens when a proof fails?'],
    expect: { maxSpiralRate: 1 },
    slice: ['bridge-live', 'pow-panel', 'pow-autosubmit', 'build-real', 'struct-power', 'threat-radar'],
  },
  {
    id: 'grid-operator', name: 'Jaehyun (grid operator)', ko: '재현 · 전력망 운영자', archetype: 'Energy and power market',
    bio: 'Runs a real power business in-game: infusions, providers, agreements, the guild bank. Reads every rate and penalty.',
    skill: 0.8, patience: 35, apm: 30, device: 'laptop', input: 'mouse', network: 'cable', motion: 'full', zoom: 1, policy: 'trader', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Understand capacity and load', 'Sell power through a provider', 'Read the guild bank'],
    voice: 'Business-minded; flags any rate, penalty or duration shown without units or explanation.',
    questions: ['Is the power market usable by a new account?', 'Are agreement terms clear before signing?'],
    expect: { maxSpiralRate: 1 },
    slice: ['energy-grid', 'brownout', 'struct-power', 'market-providers', 'market-agreements', 'market-provide', 'guild-bank'],
  },
  {
    id: 'replicator', name: 'Yuna (squad commander)', ko: '유나 · 레플리칸트 지휘관', archetype: 'Replicants and automation',
    bio: 'Wants a squad of automated accounts running standing orders while she sleeps.',
    skill: 0.7, patience: 30, apm: 25, device: 'desktop', input: 'mouse', network: 'fiber', motion: 'full', zoom: 1, policy: 'diplomat', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['See the squad', 'Set standing orders', 'Understand what replication costs'],
    voice: 'Practical; annoyed by screens that crash or load forever.',
    questions: ['Does the replicants screen load for a brand-new account?', 'Are standing orders understandable?'],
    expect: { maxSpiralRate: 1 },
    slice: ['replicants', 'replicate', 'standing-orders'],
  },
  {
    id: 'admiral', name: 'Sungmin (admiral)', ko: '성민 · 함대 제독', archetype: 'Galaxy and fleet operations',
    bio: 'Plans fleet movements across the real galaxy; studies other commanders before striking.',
    skill: 0.85, patience: 30, apm: 50, device: 'desktop', input: 'keyboard', network: 'cable', motion: 'full', zoom: 1, policy: 'warlord', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Read the galaxy and top commanders', 'Understand the fleet launch flow', 'Defend a raid'],
    voice: 'Strategic; wants to know exactly what a chain action will do before confirming.',
    questions: ['Is the launch confirmation clear about what gets signed?', 'Can a new commander find targets?'],
    expect: { maxSpiralRate: 1 },
    slice: ['galaxy-map', 'galaxy-leaders', 'fleet-launch', 'raid-defense', 'threat-radar'],
  },
  {
    id: 'guild-officer', name: 'Haneul (guild officer)', ko: '하늘 · 길드 간부', archetype: 'Guild and comms',
    bio: 'Recruits and coordinates; lives in chat and the roster.',
    skill: 0.6, patience: 25, apm: 30, device: 'laptop', input: 'mouse', network: 'cable', motion: 'full', zoom: 1, policy: 'diplomat', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Find guildmates', 'Chat with the guild', 'Read the bank'],
    voice: 'Social; cares whether the guild feels alive and whether chat works for a new member.',
    questions: ['Can a new member chat right away?', 'Does the roster show the new member?'],
    expect: { maxSpiralRate: 1 },
    slice: ['guild-real', 'guild-bank', 'chat', 'chat-phrase-guard', 'notifications'],
  },
  {
    id: 'security-auditor', name: 'Doyoon (security auditor)', ko: '도윤 · 보안 감사관', archetype: 'Account safety and wallet UX',
    bio: 'Audits how the game handles keys: where the phrase lives, what is signed, what the chain check proves. Never handles a real secret.',
    skill: 0.9, patience: 40, apm: 20, device: 'laptop', input: 'keyboard', network: 'cable', motion: 'full', zoom: 1, policy: 'accessibility', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Check every signature is explained', 'Verify the chain check only simulates', 'Confirm the phrase is protected'],
    voice: 'Careful and exact; reports unclear signing prompts and anything that could leak a secret.',
    questions: ['Is every signature prompt explicit?', 'Is the phrase reveal well guarded?'],
    expect: { maxSpiralRate: 1 },
    slice: ['profile', 'chain-check', 'phrase-guard', 'login-screens', 'enlist'],
  },
  {
    id: 'drill-sergeant', name: 'Eunji (drill sergeant)', ko: '은지 · 교관', archetype: 'Tutorial and campaign',
    bio: 'Judges how the game teaches: the tutorial, then all ten campaign missions in order.',
    skill: 0.6, patience: 30, apm: 35, device: 'tablet', input: 'touch', network: '4g', motion: 'full', zoom: 1, policy: 'completionist', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Finish the tutorial', 'Clear as many missions as possible', 'Judge each lesson'],
    voice: 'Teacher; notes every step where the lesson was unclear or the next action hidden.',
    questions: ['Does each mission teach its tactic?', 'Where do players get stuck?'],
    expect: { maxSpiralRate: 1 },
    slice: ['tutorial', 'campaign', 'sim-single'],
  },
  {
    id: 'sim-analyst', name: 'Jisoo (sim analyst)', ko: '지수 · 전투 분석가', archetype: 'Battle simulator modes',
    bio: 'Plays every simulator mode, edits fleets, checks replays reproduce and share links open.',
    skill: 0.9, patience: 40, apm: 60, device: 'desktop', input: 'keyboard', network: 'fiber', motion: 'full', zoom: 1, policy: 'warlord', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Play single, daily and gauntlet', 'Verify replays and share links', 'Try every in-battle order'],
    voice: 'Analytical; wants deterministic replays and honest odds.',
    questions: ['Do replays reproduce the battle?', 'Do share links open for someone else?'],
    expect: { maxSpiralRate: 1 },
    slice: ['sim-single', 'sim-daily', 'sim-gauntlet', 'sim-replay'],
  },
  {
    id: 'archivist', name: 'Seojun (archivist)', ko: '서준 · 기록관', archetype: 'Codex, records and polish',
    bio: 'Reads the codex cover to cover, checks the service record and medals, tries every hotkey and sound toggle.',
    skill: 0.6, patience: 35, apm: 25, device: 'mobile', input: 'touch', network: '4g', motion: 'reduced', zoom: 1, policy: 'completionist', sim: false, account: true,
    journey: ['title', 'enlist', 'account-tour', 'feature-slice'],
    goals: ['Find every explained system', 'Check records and medals', 'Judge the polish'],
    voice: 'Detail-oriented; notices typos, untranslated text and inconsistent numbers.',
    questions: ['Does the codex match the game?', 'Is the record screen complete for a signed-in account?'],
    expect: { maxSpiralRate: 1 },
    slice: ['codex', 'record', 'portrait', 'hotkeys', 'audio', 'notifications'],
  },
  {
    id: 'demo-strategist', name: 'Ara (demo strategist)', ko: '아라 · 데모 전략가', archetype: 'Every demo-only system',
    bio: 'Plays the demo base deep: research, doctrines, the World Engine, the smuggler, contracts, loans, covert ops, outposts, alliances, the Void Fleet, bounties, veterans and decisions.',
    skill: 0.85, patience: 40, apm: 45, device: 'desktop', input: 'mouse', network: 'fiber', motion: 'full', zoom: 1, policy: 'completionist', sim: false,
    journey: ['title', 'demo', 'feature-slice'],
    goals: ['Touch every demo system', 'Find dead ends', 'Judge whether each system matters'],
    voice: 'Systems designer; reports systems that never come up, cost too much, or do nothing visible.',
    questions: ['Is every demo system reachable within a session?', 'Which systems feel pointless?'],
    expect: { maxSpiralRate: 1 },
    slice: ['demo-bridge', 'demo-staff', 'research', 'doctrine', 'world-engine', 'black-market', 'jobs', 'loans', 'covert', 'outposts', 'alliance', 'void-fleet', 'bounties', 'refit-veterans', 'decisions', 'invest', 'after-action', 'guild-demo', 'chronicle'],
  },
];

export const profile = (id: string) => {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown profile ${id} (have: ${PROFILES.map((x) => x.id).join(', ')})`);
  return p;
};

/** `all`, or a comma list of ids. */
export const pick = (arg: string | undefined) => (!arg || arg === 'all' ? PROFILES : arg.split(',').map((x) => profile(x.trim())));
