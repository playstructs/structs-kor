/* 데모 함교: a pretend base that runs in this browser, so anyone can play the economy before they
 * enlist. It follows Structs' rules where it can — extractors mine ore, refineries turn it into
 * alpha matter, unrefined ore can be raided, alpha infused into a reactor becomes capacity
 * (1 g ⇒ 1 kW), online structs draw power and go dark when load exceeds capacity — at a faster,
 * friendlier scale. Nothing here touches the chain. Clearly labelled wherever it shows. */
import type { Dashboard } from '../api/planned';
import type { StructRow, ActivityRow, PlayerRow } from '../api/guild';
import type { AttackDetail, ShotRow } from '../sim/chain';
import { TYPES_BY_ID, type Ambit } from '../data/catalogue';
import { rngFor } from '../core/util';
import { STRUCT_TYPE } from '../i18n/ko';
import { fits, unitId, type Unit } from '../sim/fleets';

const KEY = 'structs-kor.demo';
const BLOCK_MS = 4000;
const ONLINE = 4, DESTROYED = 32, BUILT = 1;
export const DEMO_ID = '1-0';
const PLANET = '2-118';

export interface DemoStruct { id: string; type: number; ambit: Ambit; slot: number; cat: 'planet' | 'fleet'; online: boolean; hp: number; max: number; building: number | null; buildBlocks: number; protects: string | null; /** Overclocked: more output, more power, wear. */ oc?: boolean; /** Kills scored in raids (veterancy). */ kills?: number; /** The name its commander gave it (veterans only). */ name?: string; /** Refit module (개장), lost with the hull. */ mod?: RefitId }
function creditInner(byId: Record<string, number>): { id: string; type: number; rank: number; name?: string }[] {
  const up: { id: string; type: number; rank: number; name?: string }[] = [];
  for (const x of s.structs) {
    const k = byId[x.id]; if (!k) continue;
    const before = vetRank(x.kills); x.kills = (x.kills ?? 0) + k;
    if (vetRank(x.kills) > before) up.push({ id: x.id, type: x.type, rank: vetRank(x.kills), name: x.name });
  }
  return up;
}
/** Veteran rank from kills: ★ at 3, ★★ at 8, ★★★ at 15. */
export const vetRank = (kills = 0) => (kills >= 15 ? 3 : kills >= 8 ? 2 : kills >= 3 ? 1 : 0);
export type Stance = 'intercept' | 'entrench';
/** 전투 보고: the last defence of the base, as the bridge shows it afterwards. */
export interface RaidReport { h: number; won: boolean; name: string; stance?: Stance; kills: { id: string; type: number; n: number; name?: string }[]; blocked: number; hits: number; seized: number; promoted: { id: string; type: number; rank: number; name?: string }[] }
export interface DemoRaid { fleetId: string; owner: string; name: string; eta: number; structs: DemoStruct[]; seized: number; startedAt: number; /** Chosen while it approaches. */ stance?: Stance; /** A coalition's second house (연합 전선). */ partner?: string; /** Tally for the after-action report. */ tally?: { kills: Record<string, number>; blocked: number; hits: number } }
interface Contract { id: string; kw: number; rate: number; left: number; buyer: string; dir?: 'buy' | 'sell' }

/* ── Galactic events: the weather of the economy. One at a time, a few dozen blocks each. ── */
export type EventId = 'flare' | 'boom' | 'crash' | 'shortage' | 'pirates' | 'meteor' | 'summit';
export const EVENTS: Record<EventId, { name: string; text: string; tone: 'jeok' | 'hwang' | 'cheong' }> = {
  flare: { name: '태양 플레어', text: '발전 용량 −25% · 전력을 사두거나 판매량을 줄이세요', tone: 'jeok' },
  boom: { name: '광맥 노출', text: '채굴 속도 ×2 · 정제소를 풀가동하세요', tone: 'cheong' },
  crash: { name: '전력 시장 붕괴', text: '전력 가격 급락 · 사기에 좋은 때', tone: 'hwang' },
  shortage: { name: '전력 품귀', text: '전력 가격 급등 · 팔기에 좋은 때', tone: 'hwang' },
  pirates: { name: '해적 창궐', text: '습격이 더 잦고 빨라집니다 · 함대를 갖추세요', tone: 'jeok' },
  meteor: { name: '유성우', text: '방어막이 50% 아래면 행성 구조체가 손상됩니다 · 방어막을 채우세요', tone: 'jeok' },
  summit: { name: '은하 정상회담', text: '공물 +50% · 감시 강화로 공작 성공률 −20%p', tone: 'cheong' },
};
/* ── Research: alpha buys permanent edges; the deeper ones wait for rank. ── */
export interface Tech { id: TechId; name: string; desc: (lv: number) => string; max: number; cost: number[]; rank: number; icon: number }
export type TechId = 'mine' | 'refine' | 'grid' | 'shield' | 'guns' | 'trade' | 'bunker' | 'spy' | 'fort' | 'diplo';
export const TECH: Tech[] = [
  { id: 'mine', name: '채굴 드릴 개량', desc: (l) => `채굴 속도 +${l * 25}%`, max: 3, cost: [4, 18, 60], rank: 0, icon: 14 },
  { id: 'refine', name: '정제 촉매', desc: (l) => `정제 속도 +${l * 25}%`, max: 3, cost: [5, 20, 70], rank: 0, icon: 15 },
  { id: 'grid', name: '초전도 배선', desc: (l) => `구조체 전력 소비 −${l * 12}%`, max: 3, cost: [8, 26, 80], rank: 1, icon: 20 },
  { id: 'trade', name: '시장 분석', desc: (l) => `전력 판매가 +${l * 8}%`, max: 2, cost: [15, 50], rank: 3, icon: 17 },
  { id: 'shield', name: '궤도 방어막 증폭', desc: (l) => `보호막 회복 +${l}/블록 · 차단률 +${l * 30}%`, max: 3, cost: [15, 45, 110], rank: 4, icon: 16 },
  { id: 'guns', name: '함포 조준 체계', desc: (l) => `방어 사격 추가 피해 확률 ${l * 25}%`, max: 3, cost: [20, 55, 130], rank: 5, icon: 19 },
  { id: 'bunker', name: '광석 은닉고', desc: (l) => `약탈당하는 광석 −${l * 25}%`, max: 2, cost: [25, 80], rank: 6, icon: 18 },
  // 패권: the arts of empire, for officers.
  { id: 'spy', name: '첩보망', desc: (l) => `공작 성공률 +${l * 8}%p`, max: 2, cost: [30, 90], rank: 7, icon: 6 },
  { id: 'fort', name: '거점 공병', desc: (l) => `거점 공략·방어에 전함 ${l * 2}척 몫`, max: 2, cost: [35, 100], rank: 8, icon: 10 },
  { id: 'diplo', name: '제국 관료제', desc: (l) => `공물 +${l * 15}% · 반란 확률 −${l * 30}%`, max: 2, cost: [40, 120], rank: 9, icon: 1 },
];

export interface Rival { id: string; name: string; tag: string; alpha: number; ore: number; fleet: number; growth: number; raided: number; /** Height it bent the knee, while it pays tribute. */ vassal?: number | null; /** Sabotaged: growth halved until this height. */ sabotaged?: number; /** No covert operation against it before this height. */ opUntil?: number; /** 원한: raids you won against it, fading one every GRUDGE.fade blocks. */ grudge?: number }
/* ── Temperament: how each rival behaves, not just how it talks. `raid` weights who comes for you. ── */
/** 원한: a house you raid wants it back. Each won raid adds one (up to `max`); each point makes it
 * `per` likelier to be the one that comes for you. One fades every `fade` blocks. */
export const GRUDGE = { max: 5, per: 0.25, fade: 100 };
export const TEMPER: Record<string, { name: string; raid: number; note: string }> = {
  '1-666': { name: '호전적', raid: 3, note: '가장 자주 습격해 옵니다' },
  '1-313': { name: '계산적', raid: 2, note: '강할 때만 움직입니다' },
  '1-87': { name: '약탈자', raid: 3, note: '광석 냄새를 맡으면 옵니다' },
  '1-1004': { name: '상인', raid: 1, note: '좀처럼 싸우지 않고 현상금으로 남을 부립니다' },
};
/* ── Dominion: a rival broken by enough raids can be made a vassal. It pays a share of its growth
 * every block and stops raiding you, but as its fleet regrows it may rebel. Disarming it (alpha)
 * keeps it loyal. ── */
export const DOMINION = { raidsToSubjugate: 3, cost: 10, tribute: 0.3, disarmCost: 10, rebelFleet: 6 };
/** How many vassals a commander can hold: one, plus one per hegemony title. */
const vassalCap = () => 1 + (s.hegemonyTier ?? 0);
/** A vassal's expected tribute a block: its average growth (era included) × the share. */
const tributeOf = (r: Rival) => r.growth * 0.7 * (1 + 0.2 * (s.era ?? 0)) * DOMINION.tribute * (doc('trade') ? 1.25 : 1) * (1 + 0.15 * lv('diplo')) * (s.event?.id === 'summit' ? 1.5 : 1);
const RIVALS = (): Rival[] => [
  { id: '1-666', name: '붉은 연합', tag: 'RED', alpha: 18, ore: 40, fleet: 4, growth: 0.32, raided: 0 },
  { id: '1-313', name: '검은 별 길드', tag: 'BLK', alpha: 34, ore: 25, fleet: 6, growth: 0.45, raided: 0 },
  { id: '1-87', name: '해적 87호', tag: 'PIR', alpha: 6, ore: 60, fleet: 3, growth: 0.2, raided: 0 },
  { id: '1-1004', name: '청룡 상단', tag: 'AZR', alpha: 55, ore: 12, fleet: 8, growth: 0.6, raided: 0 },
];

/* ── Guilds: pick a banner, pool alpha, share the perks. ── */
export type GuildId = 'blue' | 'gold' | 'iron';
export interface GuildDef { id: GuildId; name: string; tag: string; motto: string; perk: string; members: string[] }
export const GUILDS: GuildDef[] = [
  { id: 'blue', name: '푸른 방패단', tag: 'BLU', motto: '지키는 자가 이긴다', perk: '보호막 회복 +1/블록 · 약탈 피해 −15%', members: ['한솔', 'Mira', '도윤', 'Kestrel', '서하'] },
  { id: 'gold', name: '황금 상단', tag: 'GLD', motto: '전력은 흐르고 알파는 남는다', perk: '판매가 +5% · 구매 수수료 5% → 2%', members: ['재원', 'Oro', '가람', 'Ledger', '유나'] },
  { id: 'iron', name: '철혈단', tag: 'IRN', motto: '먼저 쏘고 나중에 계산한다', perk: '습격 노획 +25% · 방어 사격 추가 피해 +10%', members: ['강철', 'Vex', '무열', 'Ronin', '태오'] },
];
/** Cumulative guild XP per level (1 g donated = 1 XP; members chip in every block). */
export const GUILD_LEVELS = [0, 20, 60, 140, 280, 500];

/* ── The endgame: raise a World Engine, stage by stage. Each stage pays off for good. ── */
export const ENGINE = [
  { name: '기반 공사', cost: 300, perk: '발전 용량 +5 kW' },
  { name: '코어 점화', cost: 900, perk: '정제 속도 +50%' },
  { name: '월드 엔진 가동', cost: 2400, perk: '세력 +1000 · 은하의 패권' },
];

export interface AwayReport { blocks: number; ore: number; alpha: number; earned: number; raids: number; stolen: number; repelled: number; rebels?: string[]; loan?: string }
let awayLoan: string | undefined;
let awayRebels: string[] = [];

interface State {
  engine?: { stage: number; paid: number };
  guild?: { id: GuildId; xp: number; donated: number; joinedAt: number } | null;
  event?: { id: EventId; left: number } | null;
  savedAt?: number;
  rivals?: Rival[];
  /** Tribute collected, all time; and a rebel whose fleet sails next. */
  tribute?: number; rebel?: string | null;
  /** The open 결단 card, and non-aggression pacts (rival → last block). */
  decision?: { id: DecisionId; rival: string; left: number; luck?: number } | null; pacts?: Record<string, number>; decided?: number; hegemonyTier?: number;
  doctrine?: DoctrineId | null;
  /** Highest hegemony title ever held (XP is paid only for new heights). */
  hegemonyBest?: number;
  /** New eras begun (prestige): each lifts production for good, and the rivals with it. */
  era?: number;
  /** Bounties collected, all time (survives new eras). */
  bountiesClaimed?: number;
  /** 보복: the rival whose raid you just broke is exposed until `until`. */
  revenge?: { rival: string; until: number } | null;
  /** 전투 보고: the last defence of the base. */
  report?: RaidReport | null;
  /** 연합 전선: coalition raids drawn so far. */
  coalitions?: number;
  /** Running totals: counter-raids won, refits fitted. */
  revengeWins?: number; refits?: number; coalitionWins?: number;
  /** 암시장: the smuggler's next visit, its stay and deals, and deals made all time. */
  black?: { next: number; until: number; offers: BlackOffer[]; deals?: number };
  /** 의뢰 게시판: offers on the board, when it refreshes, and the job in hand. */
  jobs?: { offers: Job[]; next: number; active?: Job & { until: number; count: number; taken?: number } | null; done?: number };
  /** Commander abilities: the block each is ready again; and total mobilisation's end. */
  cd?: Partial<Record<AbilityId, number>>; rallyUntil?: number;
  /** An alliance: the rival, and the block it lapses. */
  ally?: { id: string; until: number } | null;
  /** Outposts: who holds each (DEMO_ID for you), and your garrison level there. */
  outposts?: Record<OutpostId, { owner: string | null; garrison: number }>; nextContest?: number;
  /** Days in a row the commander came back (local dates), and the last one seen. */
  streak?: { day: string; n: number; paidAt?: number };
  /** A loan from 청룡 상단: what's owed and the block it falls due. */
  loan?: { owed: number; due: number } | null; loanBan?: number;
  /** Covert operations attempted (seeds each roll). */
  ops?: number;
  /** Hired replicants (demo automation) and what they've done. */
  reps?: Partial<Record<RepId, boolean>>; repLog?: { h: number; text: string }[];
  /** 길드 전: this season's scores (season = 600 blocks) and how many your guild has won. */
  race?: { start: number; pts: Record<GuildId, number> }; raceWins?: number;
  /** 공허 함대: a threat to the whole galaxy, here until `until`; and how many were broken. */
  boss?: { until: number; n: number; engaged?: number } | null; nextBoss?: number; voidKills?: number;
  /** 제국 연대기: the milestones of every era, oldest first (kept across eras). */
  chronicle?: Chronicle[];
  /** A rival's price on another's head: paid if you win a raid on the target before `until`. */
  bounty?: { target: string; patron: string; reward: number; until: number } | null;
  /** Every 10 blocks: my share and each rival's worth, for the power chart. */
  powerHist?: { h: number; me: number; r: Record<string, number> }[];
  /** Rival-on-rival wars: the latest (for the map) and the news wire. */
  war?: { from: string; to: string; won: boolean; at: number } | null; news?: { h: number; text: string }[]; nextDecision?: number; offered?: number;
  tech?: Partial<Record<TechId, number>>;
  height: number; ore: number; alpha: number; infusedKw: number; vein: number; shield: number;
  structs: DemoStruct[]; raid: DemoRaid | null; nextRaid: number; contracts: Contract[];
  log: ActivityRow[]; seq: number; raidsRepelled: number; raidsLost: number; earned: number; priceHist: number[];
}

/** Per-block economy, demo scale. */
/* ── 교리 (doctrine): the commander's creed. One at a time; the first is free, a change costs alpha. ── */
export type DoctrineId = 'industry' | 'war' | 'trade';
export const DOCTRINES: { id: DoctrineId; name: string; motto: string; perks: string[]; icon: number }[] = [
  { id: 'industry', name: '산업 교리', motto: '광맥이 곧 국력이다', perks: ['채굴·정제 +20%', '과부하 손상 위험 절반'], icon: 15 },
  { id: 'war', name: '전쟁 교리', motto: '약탈은 가장 빠른 무역이다', perks: ['습격 노획 +30%', '현상금 +50%'], icon: 3 },
  { id: 'trade', name: '상업 교리', motto: '전력은 흐르고 제국은 산다', perks: ['전력 판매가 +12%', '공물 +25%'], icon: 17 },
];
export const DOCTRINE_SWITCH = 40;
const doc = (id: DoctrineId) => s.doctrine === id;
/** Bonuses on power sold, applied as each block is paid (so they follow the doctrine and guild you hold now). */
const sellBonus = () => 1 + (inGuild('gold') ? 0.05 : 0) + (doc('trade') ? 0.12 : 0) + (holds('relay') ? 0.05 : 0);
export const RATE = { maxDealKw: 4, marketDepthKw: 10, mine: 0.6, refine: 0.35, alphaPerOre: 1, baseKw: 3, genKw: 2, raidEvery: 30, raidEta: 6, price: 0.042 };
const lv = (t: TechId) => s.tech?.[t] ?? 0;
const rivalWorth = (r: Rival) => r.alpha + r.ore * 0.6 + r.fleet * 4;
const rivals = () => { s.rivals ??= RIVALS(); for (const r of s.rivals) r.fleet = Math.min(r.fleet, 10); return s.rivals; };
const kwOf = (type: number) => (TYPES_BY_ID[type]?.passiveDraw ?? 0) / 1e6 * 1.2 * (1 - 0.12 * lv('grid')); // mW → kW, nudged so power matters
const ev = (id: EventId) => s.event?.id === id;
const inGuild = (id: GuildId) => s.guild?.id === id;
const guildLevel = () => { if (!s.guild) return 0; let l = 0; while (l < GUILD_LEVELS.length - 1 && s.guild.xp >= GUILD_LEVELS[l + 1]) l++; return l + 1; };
/** Every guild level adds 3% to mining, whatever the banner. */
const guildMine = () => 1 + 0.03 * guildLevel();
const eraBoost = () => 1 + 0.15 * (s.era ?? 0);
const mineRate = () => eraBoost() * RATE.mine * (1 + 0.25 * lv('mine')) * (ev('boom') ? 2 : 1) * guildMine() * (doc('industry') ? 1.2 : 1) * (holds('asteroid') ? 1.15 : 1);
const engineStage = () => s.engine?.stage ?? 0;
const refineRate = () => eraBoost() * RATE.refine * (1 + 0.25 * lv('refine')) * (engineStage() >= 2 ? 1.5 : 1) * (doc('industry') ? 1.2 : 1);

function fresh(): State {
  const S = (id: string, type: number, ambit: Ambit, slot: number, cat: 'planet' | 'fleet', online = true): DemoStruct =>
    ({ id, type, ambit, slot, cat, online, hp: TYPES_BY_ID[type].maxHealth, max: TYPES_BY_ID[type].maxHealth, building: null, buildBlocks: 0, protects: null });
  return {
    height: 1_482_200, ore: 12, alpha: 4.5, infusedKw: 0, vein: 18_400, shield: 72,
    structs: [
      S('5-901', 1, 'space', 0, 'fleet'), S('5-902', 3, 'space', 0, 'fleet'), S('5-903', 12, 'water', 0, 'fleet'), S('5-904', 9, 'land', 1, 'fleet'),
      S('5-910', 14, 'land', 0, 'planet'), S('5-911', 15, 'land', 1, 'planet', false), S('5-912', 20, 'air', 0, 'planet'), S('5-913', 16, 'space', 0, 'planet'),
    ],
    raid: null, nextRaid: 18, contracts: [], log: [], seq: 0, raidsRepelled: 0, raidsLost: 0, earned: 0, chronicle: [],
    priceHist: Array.from({ length: 40 }, (_, i) => RATE.price * (0.8 + 0.25 * Math.sin(i / 5) + i / 160)),
  };
}

// The base persists in this browser across visits; it keeps producing while you are away.
let on = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
let s: State = (() => { try { return JSON.parse(localStorage.getItem(KEY + '.state') || 'null') ?? fresh(); } catch { return fresh(); } })();
let catching = false;

/* Several tabs, one base: the tab holding a fresh heartbeat runs the blocks; every tab adopts the
 * others' saves as they land, so a move made anywhere shows everywhere and nothing is overwritten. */
const TAB = Math.random().toString(36).slice(2);
const LEAD = KEY + '.leader';
const hidden = () => typeof document !== 'undefined' && document.hidden;
/** Is this tab the one that runs the clock? A visible tab takes over from a hidden one (so alarms and
 * battle animations play where the player is looking); otherwise a fresh heartbeat holds. */
function leading(): boolean {
  try {
    const cur = JSON.parse(localStorage.getItem(LEAD) || 'null') as { id: string; at: number; hidden?: boolean } | null;
    const fresh = cur && Date.now() - cur.at < BLOCK_MS * 2.5;
    if (cur && cur.id !== TAB && fresh && !(cur.hidden && !hidden())) return false;
    localStorage.setItem(LEAD, JSON.stringify({ id: TAB, at: Date.now(), hidden: hidden() }));
    return true;
  } catch { return true; }
}
/** Take the stored base if it's newer than ours (another tab saved since, or we were frozen). */
function adoptStored(): boolean {
  if (busy) return false;
  try {
    const raw = localStorage.getItem(KEY + '.state');
    if (!raw) return false;
    const st = JSON.parse(raw) as State;
    if ((st.savedAt ?? 0) <= (s.savedAt ?? 0)) return false;
    s = st;
    return true;
  } catch { return false; }
}
let wasLeader = false;
/* Coming back on consecutive days pays: 2 α a day of the streak, up to 20. */
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function checkStreak() {
  const today = dayKey(), y = new Date(); y.setDate(y.getDate() - 1);
  const st = s.streak;
  if (st?.day === today) return;
  const n = st?.day === dayKey(y) ? st.n + 1 : 1;
  // A day on the calendar must also be a stretch of play: winding the clock forward pays nothing.
  const played = s.height - (st?.paidAt ?? 0) >= 200;
  s.streak = { day: today, n, paidAt: played && n >= 2 ? s.height : st?.paidAt };
  if (n >= 2 && played) {
    const g = Math.min(20, 2 * n);
    s.alpha += g;
    chronicle('cheong', `연속 ${n}일 복귀 · +${g} α`);
    emit('streak', `${n}|${g}`);
  }
}
/** One beat of the clock in this tab: lead (catching up on whatever the last leader missed) or follow. */
function beat() {
  const lead = leading();
  if (lead && !wasLeader) {
    adoptStored();
    const r = catchUp();
    if (r) { if (awayFns.size) for (const f of awayFns) f(r); else pendingReport = r; }
    checkStreak();
  }
  wasLeader = lead;
  if (lead) block();
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    // The demo ended in another tab: end it here too (and don't write the old base back).
    if (e.key === KEY && e.newValue == null && on) { on = false; if (timer) clearInterval(timer); timer = null; wasLeader = false; s = fresh(); for (const f of changeFns) f(); return; }
    // Started in another tab: join it.
    if (e.key === KEY && e.newValue === '1' && !on) { on = true; adoptStored(); demo.run(); for (const f of changeFns) f(); return; }
    if (e.key !== KEY + '.state' || !e.newValue || !on) return;
    let st: State;
    try { st = JSON.parse(e.newValue); } catch { return; }
    // A save from behind us (a tab that hadn't caught up) would replay blocks: keep ours.
    if (st.height < s.height) return;
    const newBlock = st.height !== s.height;
    s = st;
    if (newBlock) for (const f of blockFns) f();
    for (const f of changeFns) f();
  });
  // Back from the page cache: we missed every save while frozen.
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted && on && adoptStored()) for (const f of changeFns) f(); });
  document.addEventListener('visibilitychange', () => { if (on && timer) beat(); });
}
/* Saves from before the chronicle: write what they already show, once. */
function backfillChronicle() {
  if (s.chronicle) return;
  s.chronicle = [];
  const at = (text: string, tone: Chronicle['tone'] = 'hwang') => s.chronicle!.push({ era: s.era ?? 0, h: s.height, tone, text });
  if (s.doctrine) at(`${DOCTRINES.find((d) => d.id === s.doctrine)!.name}를 따르기로 했다`, 'cheong');
  for (let i = 0; i < (s.engine?.stage ?? 0); i++) at(`월드 엔진 · ${ENGINE[i].name} 완료`);
  for (let i = 0; i < (s.hegemonyTier ?? 0); i++) at(`칭호 「${HEGEMONY[i].title}」 · 패권 ${Math.round(HEGEMONY[i].at * 100)}%`);
  for (const r of s.rivals ?? []) if (r.vassal != null) at(`${r.name}이(가) 무릎을 꿇었다`);
}
const awayFns = new Set<(r: AwayReport) => void>();
let pendingReport: AwayReport | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const changeFns = new Set<() => void>();
const blockFns = new Set<() => void>();
const attackFns = new Set<(d: AttackDetail) => void>();
const eventFns = new Set<(kind: string, text: string) => void>();
const persist = () => { if (catching || forecasting) return; s.savedAt = Date.now(); try { localStorage.setItem(KEY + '.state', JSON.stringify(s)); } catch { /* storage refused */ } };
/* One random stream per block: every draw within a block is a fresh number (re-seeding per call made
 * successive draws identical: the event roll that passed "< 0.09" always picked event 0). */
let rngBlock = -1, rngStream: () => number = () => 0;
let forecastRng: (() => number) | null = null, forecasting = false;
const rnd = () => {
  if (forecastRng) return forecastRng();
  if (rngBlock !== s.height) { rngBlock = s.height; rngStream = rngFor(`demo:${s.height}:${s.seq}`); }
  return rngStream();
};

export interface Chronicle { era: number; h: number; tone: 'cheong' | 'hwang' | 'jeok'; text: string }
/** Write a line into the empire's chronicle (not while replaying missed blocks: those are summarised). */
function chronicle(tone: Chronicle['tone'], text: string) {
  backfillChronicle();
  s.chronicle = [...(s.chronicle ?? []), { era: s.era ?? 0, h: s.height, tone, text }].slice(-80);
}
function log(category: string, detail = '') {
  s.log.unshift({ time: new Date().toISOString(), seq: ++s.seq, planet_id: PLANET, block_height: s.height, category, detail });
  s.log = s.log.slice(0, 30);
}
const emit = (kind: string, text: string) => { if (!catching && !forecasting) for (const f of eventFns) f(kind, text); };

/* ── Power ── */
/* ── Overclock: extractors, refineries and generators can be pushed past spec. More output for
 * much more power (or, for a generator, more power out), and every block a chance of wear. ── */
export const OC = { out: 1.6, gen: 1.5, power: 1.8, wear: 0.03, types: [14, 15, 20] };
const ocf = (x: DemoStruct, f: number) => (x.oc ? f : 1);
function capacityKw() {
  const own = (RATE.baseKw + (engineStage() >= 1 ? 5 : 0) + s.infusedKw + s.structs.filter((x) => x.type === 20 && x.online && x.building == null && x.hp > 0).reduce((a, x) => a + RATE.genKw * ocf(x, OC.gen), 0)) * (ev('flare') ? 0.75 : 1);
  return own + s.contracts.filter((c) => c.dir === 'buy').reduce((a, c) => a + c.kw, 0);
}
function structsKw() { return s.structs.filter((x) => (x.online || x.building != null) && x.hp > 0).reduce((a, x) => a + kwOf(x.type) * (x.type === 20 ? 1 : ocf(x, OC.power)), 0); }
/** Capacity you generate yourself (bought power can't be resold). */
function ownKw() { return capacityKw() - s.contracts.filter((c) => c.dir === 'buy').reduce((a, c) => a + c.kw, 0); }
function soldKw() { return s.contracts.filter((c) => c.dir !== 'buy').reduce((a, c) => a + c.kw, 0); }

/* ── The block ── */
/* While a block or a raid settlement is running, the base must not be swapped for another tab's save
 * mid-way (listeners it fires, like a promotion paying a bonus, would otherwise do that). */
let busy = 0;
function block() { busy++; try { blockInner(); } finally { busy--; } }
function blockInner() {
  s.height++;
  const live = (t: number) => s.structs.filter((x) => x.type === t && x.online && x.building == null && x.hp > 0);
  // Brownout: the chain cuts allocations oldest first, then structs can't stay online.
  let sells: Contract | undefined;
  while (structsKw() + soldKw() > capacityKw() && (sells = s.contracts.find((x) => x.dir !== 'buy'))) { const c = sells; s.contracts = s.contracts.filter((x) => x !== c); log('allocation_cut', `${c.buyer} ${c.kw} kW`); emit('jeok', `정전 · 계약 ${c.id} 차단`); }
  if (structsKw() > capacityKw()) {
    const victim = [...s.structs].reverse().find((x) => x.online && x.building == null && x.type !== 20 && x.type !== 1);
    if (victim) { victim.online = false; log('struct_status', `${victim.id} 오프라인`); emit('jeok', `전력 부족 · ${TYPES_BY_ID[victim.type].type} 정지`); }
  }
  // Construction.
  for (const x of s.structs) if (x.building != null) {
    x.building = Math.min(1, x.building + 1 / x.buildBlocks);
    if (x.building >= 1) { x.building = null; x.online = true; log('struct_block_build_complete', x.id); emit('cheong', `건설 완료 · ${TYPES_BY_ID[x.type].type}`); }
  }
  // Mining and refining.
  const mined = Math.min(s.vein, live(14).reduce((a, x) => a + mineRate() * ocf(x, OC.out), 0));
  s.vein -= mined; s.ore += mined;
  const refined = Math.min(s.ore, live(15).reduce((a, x) => a + refineRate() * ocf(x, OC.out), 0));
  // Overclocked machines wear (their own random stream, so the economy's draws don't move).
  // A machine that is off (or wrecked) isn't running hot.
  for (const x of s.structs) if (x.oc && (!x.online || x.hp <= 0)) x.oc = false;
  if (!catching) for (const x of s.structs) if (x.oc && x.online && x.building == null && x.hp > 0 && rngFor(`oc:${s.height}:${x.id}`)() < OC.wear * (doc('industry') ? 0.5 : 1)) {
    x.hp--;
    if (x.hp <= 0) { x.online = false; x.oc = false; log('struct_status', `${x.id} 과부하 파괴`); emit('jeok', `과부하 · ${TYPES_BY_ID[x.type].type} 파괴`); }
    else emit('jeok', `과부하 손상 · ${TYPES_BY_ID[x.type].type} 내구도 ${x.hp}/${x.max}`);
  }
  s.ore -= refined; s.alpha += refined * RATE.alphaPerOre;
  if (mined && s.height % 3 === 0) log('struct_block_ore_mine_complete', `+${mined.toFixed(1)}`);
  if (refined && s.height % 3 === 1) log('struct_block_ore_refine_complete', `+${refined.toFixed(2)} g`);
  // Contracts pay every block.
  for (const c of s.contracts) {
    if (c.dir === 'buy') {
      // Bought power is paid per block; an empty wallet ends the contract.
      if (s.alpha >= c.kw * c.rate) { s.alpha -= c.kw * c.rate; c.left--; } else { c.left = 0; log('allocation_cut', `구매 ${c.kw} kW 해지`); emit('jeok', `알파 부족 · 전력 구매 계약 ${c.id} 해지`); }
    } else { const pay = c.kw * c.rate * sellBonus(); s.alpha += pay; s.earned += pay; c.left--; }
  }
  s.contracts = s.contracts.filter((c) => c.left > 0);
  // Shield regenerates while a shield generator stands.
  if (live(16).length) s.shield = Math.min(100, s.shield + 1.5 + lv('shield') + (inGuild('blue') ? 1 : 0) + (holds('bastion') ? 1 : 0));
  // Guildmates chip in a little every block.
  if (s.guild) s.guild.xp += 0.08;
  // Market drifts.
  const last = s.priceHist[s.priceHist.length - 1];
  // Random walk, pulled back toward the base price; every sold kW in the book weighs on it.
  const target = RATE.price * (ev('crash') ? 0.45 : ev('shortage') ? 1.7 : 1) * (1 - 0.04 * soldKw());
  const pull = (target - last) * (s.event ? 0.18 : 0.08);
  // The weather changes.
  // A meteor shower: anything on the planet takes a hit now and then unless the shield holds.
  if (!catching && ev('meteor') && s.shield < 50) {
    const r = rngFor(`meteor:${s.height}`);
    if (r() < 0.12) {
      const pool = s.structs.filter((x) => x.cat === 'planet' && x.hp > 0 && x.building == null);
      const hit = pool[Math.floor(r() * pool.length)];
      if (hit) { hit.hp = Math.max(0, hit.hp - 1); if (hit.hp <= 0) { hit.online = false; hit.oc = false; } emit('jeok', `유성 충돌 · ${STRUCT_TYPE[hit.type] ?? '구조체'} 내구도 ${hit.hp}/${hit.max}`); }
    }
  }
  if (s.event) { if (--s.event.left <= 0) { emit('cheong', `${EVENTS[s.event.id].name} 종료`); s.event = null; } }
  else if (s.height % 7 === 0 && rnd() < 0.09) {
    const ids = Object.keys(EVENTS) as EventId[];
    const id = ids[Math.floor(rnd() * ids.length)];
    s.event = { id, left: 20 + Math.floor(rnd() * 25) };
    log('event', EVENTS[id].name);
    emit('event', `${EVENTS[id].name} · ${EVENTS[id].text}`);
  }
  s.priceHist.push(Math.max(0.008, last * (1 + (rnd() - 0.5) * 0.06) + pull));
  s.priceHist = s.priceHist.slice(-60);
  for (const r of rivals()) {
    const gain = r.growth * (0.4 + rnd() * 0.6) * (1 + 0.2 * (s.era ?? 0)) * ((r.sabotaged ?? 0) > s.height ? 0.5 : 1);
    r.alpha += gain; r.ore += r.growth * 0.6;
    if (s.height % 150 === 0 && r.fleet < 10) r.fleet++;
    if (r.grudge && s.height % GRUDGE.fade === 0) r.grudge--;
    if (r.vassal == null) continue;
    // A vassal's tribute comes out of its own growth, every block.
    const t = gain * DOMINION.tribute * (doc('trade') ? 1.25 : 1) * (1 + 0.15 * lv('diplo')) * (ev('summit') ? 1.5 : 1);
    r.alpha -= t; s.alpha += t; s.tribute = (s.tribute ?? 0) + t;
    // A rearmed vassal remembers it was beaten by force.
    // Its own random stream: whether a vassal exists mustn't shift the economy's draws.
    if (r.fleet >= DOMINION.rebelFleet && rngFor(`rebel:${s.height}:${r.id}`)() < 0.003 * (r.fleet - DOMINION.rebelFleet + 1) * (1 - 0.3 * lv('diplo'))) {
      r.vassal = null; r.raided = 0; s.rebel = r.id; s.nextRaid = Math.min(s.nextRaid, 3);
      if (catching) awayRebels.push(r.name);
      log('raid_status', `${r.name} 반란`);
      chronicle('jeok', `${r.name}이(가) 반란을 일으켰다`);
      emit('alarm', `${r.name} 반란! 공물을 끊고 함대를 띄웠습니다`);
    }
  }
  warStep();
  samplePower();
  repsStep();
  loanStep();
  allyStep();
  if (catching) return;
  // A tab left open across midnight counts the new day too.
  if (s.streak && s.streak.day !== dayKey()) checkStreak();
  contestStep();
  jobsStep();
  blackStep();
  raceStep();
  bossStep();
  bountyStep();
  hegemonyStep();
  decisionStep();
  raidStep();
  persist();
  if (forecasting) return;
  for (const f of blockFns) f();
  for (const f of changeFns) f();
}

/** Replay the blocks missed while the tab was closed (at most an hour's worth). Raids that came
 * meanwhile are settled in summary: a standing fleet turns most away, unrefined ore pays for the rest. */
function catchUp(): AwayReport | null {
  const n = Math.min(900, Math.floor((Date.now() - (s.savedAt ?? Date.now())) / BLOCK_MS));
  if (n < 8 || s.raid) return null;
  const before = { ore: s.ore, alpha: s.alpha, earned: s.earned };
  catching = true; awayRebels = [];
  const r: AwayReport = { blocks: n, ore: 0, alpha: 0, earned: 0, raids: 0, stolen: 0, repelled: 0 };
  try {
    for (let i = 0; i < n; i++) {
      block();
      if (--s.nextRaid <= 0) {
        s.rebel = null; // settled here, in summary
        r.raids++;
        const fleet = s.structs.filter((x) => x.cat === 'fleet' && x.hp > 0);
        // A new base's first raids are small here too.
        const odds = Math.min(0.9, 0.2 + fleet.length * 0.15 + lv('guns') * 0.05 + (rookie() ? 0.4 : 0));
        if (rnd() < odds) { r.repelled++; s.raidsRepelled++; jobRepelled(); }
        else { const take = Math.floor(s.ore * (1 - 0.25 * lv('bunker'))); r.stolen += take; s.ore -= take; s.raidsLost++; s.shield = 0; }
        s.nextRaid = raidGap() + RATE.raidEta;
      }
    }
  } finally { catching = false; }
  r.ore = s.ore - before.ore; r.alpha = s.alpha - before.alpha; r.earned = s.earned - before.earned; r.rebels = awayRebels; r.loan = awayLoan; awayLoan = undefined;
  log('away', `${n}블록`);
  persist();
  return r;
}

/* ── 결단: every few minutes the bridge is offered a choice with a price on each side. Picked by
 * block height (not the economy's RNG), open for a while, gone if ignored. ── */
/* ── Rival wars: the galaxy doesn't wait for you. Every so often one rival raids another; the
 * winner takes ore, the loser loses a ship. A beaten rival is a chance; a winning one a threat.
 * Vassals are under your protection: an attack on one is beaten off by your name alone.
 * Its own random stream, so the economy's draws stay as they were. ── */
export const WAR = { every: 40 };
/* ── Bounties: one rival pays you to hit another. Posted every so often; claimed by winning a
 * raid on the target before it lapses. ── */
export const BOUNTY = { every: 110, lasts: 80 };
function bountyStep() {
  if (s.bounty && s.height > s.bounty.until) { s.bounty = null; emit('cheong', '현상금 만료'); }
  if (s.bounty || s.height % BOUNTY.every !== 55) return;
  const r = rngFor(`bounty:${s.height}`);
  const free = rivals().filter((x) => x.vassal == null && !((s.pacts?.[x.id] ?? 0) > s.height) && x.id !== allyId());
  if (free.length < 2) return;
  const target = free.sort((a, b) => rivalWorth(b) - rivalWorth(a))[Math.floor(r() * Math.min(2, free.length))];
  const patrons = rivals().filter((x) => x !== target);
  // The merchant house prefers paying others to fight.
  const merchant = patrons.find((x) => x.id === '1-1004');
  const patron = merchant && r() < 0.5 ? merchant : patrons[Math.floor(r() * patrons.length)];
  const reward = Math.round(6 + target.fleet * 1.5 + r() * 6);
  s.bounty = { target: target.id, patron: patron.id, reward, until: s.height + BOUNTY.lasts };
  log('event', `현상금 · ${target.name} ${reward} α`);
  emit('news', `${patron.name}이(가) ${target.name}에게 현상금 ${reward} α를 걸었습니다 · ${BOUNTY.lasts}블록 안에 약탈하세요`);
}
function warStep() {
  if (s.height % WAR.every !== WAR.every / 2) return;
  const r = rngFor(`war:${s.height}`);
  const free = rivals().filter((x) => x.vassal == null);
  if (free.length < 1) return;
  const a = free[Math.floor(r() * free.length)];
  const targets = rivals().filter((x) => x !== a);
  const d = targets[Math.floor(r() * targets.length)];
  if (!d) return;
  let text: string, won: boolean;
  if (d.vassal != null) {
    won = false; a.fleet = Math.max(2, a.fleet - 1);
    text = `${a.name}이(가) 내 속국 ${d.name}을(를) 노렸으나 물러났습니다 · ${a.name} 함대 −1`;
  } else {
    won = a.fleet * (0.6 + r() * 0.8) > d.fleet * (0.6 + r() * 0.8);
    if (won) { const take = Math.floor(d.ore * 0.4); d.ore -= take; a.ore += take; d.fleet = Math.max(2, d.fleet - 1); text = `${a.name}, ${d.name} 약탈 · 광석 ${take} · ${d.name} 함대 −1`; }
    else { a.fleet = Math.max(2, a.fleet - 1); text = `${d.name}, ${a.name}의 습격 격퇴 · ${a.name} 함대 −1`; }
  }
  s.war = { from: a.id, to: d.id, won, at: s.height };
  s.news = [{ h: s.height, text }, ...(s.news ?? [])].slice(0, 8);
  emit('news', text);
}

/* ── 레플리칸트 (demo): agents hired with alpha that keep standing orders on the base, every block,
 * for a small upkeep. The idle game's automation, and a choice of where alpha goes. ── */
export type RepId = 'mechanic' | 'trader' | 'warden';
export const REPS: { id: RepId; name: string; role: string; order: string; hire: number; upkeep: number }[] = [
  { id: 'warden', name: 'Kestrel', role: '감시병', order: '꺼진 추출기·정제소·발전기를 전력이 되는 대로 다시 켭니다', hire: 12, upkeep: 0.01 },
  { id: 'mechanic', name: 'Orrin', role: '정비사', order: '습격이 없을 때 가장 많이 다친 구조체를 수리합니다 (금고의 1/3 이하일 때만)', hire: 20, upkeep: 0.02 },
  { id: 'trader', name: 'Lumen', role: '중개인', order: '전력 가격이 평균보다 10% 높으면 여유 전력을 40블록 계약으로 팝니다', hire: 25, upkeep: 0.02 },
];
function repNote(text: string) { s.repLog = [{ h: s.height, text }, ...(s.repLog ?? [])].slice(0, 12); }
function repsStep() {
  const on = (id: RepId) => !!s.reps?.[id];
  // Upkeep first: an empty treasury lets them go.
  for (const r of REPS) if (on(r.id)) { if (s.alpha < r.upkeep) { s.reps![r.id] = false; repNote(`${r.role} ${r.name} 해고 · 급여 부족`); emit('jeok', `급여를 못 받은 ${r.role} ${r.name}이(가) 떠났습니다`); } else s.alpha -= r.upkeep; }
  if (on('warden')) for (const x of s.structs) if ([14, 15, 20].includes(x.type) && !x.online && x.hp > 0 && x.building == null && (x.type === 20 || structsKw() + soldKw() + kwOf(x.type) * ocf(x, OC.power) <= capacityKw())) { x.online = true; repNote(`${STRUCT_TYPE[x.type] ?? TYPES_BY_ID[x.type].type} 재가동`); }
  if (on('mechanic') && !s.raid && s.height % 5 === 0) {
    const worst = [...s.structs].filter((x) => x.hp < x.max).sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
    if (worst) { const cost = (worst.hp <= 0 ? worst.max : worst.max - worst.hp) * 0.5; if (cost <= s.alpha / 3) { s.alpha -= cost; worst.hp = worst.max; worst.oc = false; if (worst.type === 20 || structsKw() + soldKw() + kwOf(worst.type) <= capacityKw()) worst.online = true; repNote(`${STRUCT_TYPE[worst.type] ?? TYPES_BY_ID[worst.type].type} 수리 −${cost.toFixed(1)} α`); } }
  }
  if (on('trader') && s.height % 5 === 0) {
    const h = s.priceHist, avg = h.slice(-30).reduce((a, x) => a + x, 0) / Math.min(30, h.length), spare = Math.max(0, ownKw() - structsKw() - soldKw());
    const kw = Math.min(RATE.maxDealKw, Math.floor(spare * 10) / 10, RATE.marketDepthKw - soldKw());
    if (h[h.length - 1] > avg * 1.1 && kw >= 0.5) { demo.sell(kw, 40); repNote(`전력 ${kw} kW 판매 계약`); }
  }
}

/* ── 공작 (covert operations): pay alpha for a chance. Caught, and the rival comes for you. Each
 * attempt rolls on its own stream (by height, rival and count), so trying again is a fresh roll. ── */
export type OpId = 'sabotage' | 'heist';
export const OPS: Record<OpId, { name: string; cost: number; odds: number; what: string }> = {
  sabotage: { name: '사보타주', cost: 8, odds: 0.7, what: '100블록 동안 성장 절반' },
  heist: { name: '금고 털기', cost: 5, odds: 0.55, what: '비축 광석 15% 탈취' },
};
/** A covert operation's real odds now (첩보망 included): shown and rolled from the same number. */
export const opOdds = (op: OpId) => Math.max(0.05, Math.min(0.95, OPS[op].odds + 0.08 * lv('spy') - (s.event?.id === 'summit' ? 0.2 : 0)));
function covert(id: string, op: OpId): { ok: boolean; text: string } | string {
  adoptStored();
  const r = rivals().find((x) => x.id === id);
  if (!r) return '세력을 찾을 수 없습니다';
  if (r.vassal != null) return '속국에는 공작을 하지 않습니다';
  const o = OPS[op];
  if ((r.opUntil ?? 0) > s.height) return `${r.name}의 경계가 높습니다 · ${r.opUntil! - s.height}블록 뒤에`;
  if (op === 'sabotage' && (r.sabotaged ?? 0) > s.height) return '이미 사보타주가 진행 중입니다';
  if (s.alpha < o.cost) return `공작 자금 ${o.cost} g 필요`;
  // Spying on an ally ends the alliance (only once the op is really under way).
  if (allyId() === id) { s.ally = null; chronicle('jeok', `${r.name}과(와)의 동맹을 깨고 공작을 벌였다`); }
  s.alpha -= o.cost;
  s.ops = (s.ops ?? 0) + 1;
  const hit = rngFor(`op:${s.height}:${id}:${s.ops}`)() < opOdds(op);
  // Either way, the target tightens its guard for a while (longer if it caught you).
  r.opUntil = s.height + (hit ? 30 : 90);
  let text: string;
  if (hit) {
    if (op === 'sabotage') { r.sabotaged = s.height + 100; text = `${r.name} 사보타주 성공 · 100블록 동안 성장 절반`; }
    else { const take = Math.floor(r.ore * 0.15); r.ore -= take; s.ore += take; text = `${r.name} 금고 털기 성공 · 광석 +${take}`; }
  } else {
    // Caught: any pact is void, and they strike back soon.
    if (s.pacts?.[id]) delete s.pacts[id];
    s.rebel = id; s.nextRaid = Math.min(s.nextRaid, 5);
    text = `${r.name} 공작 발각! 보복 함대가 곧 옵니다`;
    chronicle('jeok', `${r.name}에 대한 ${o.name} 발각`);
  }
  log('event', `공작 · ${text}`);
  persist(); for (const f of changeFns) f();
  return { ok: hit, text };
}

/* ── 거점 (outposts): three neutral sites, each worth holding. Claim one with a fleet sortie (the
 * odds follow your warships against its garrison), fortify it, and hold it: every so often a rival
 * tries to take one of yours, against your warships and garrison. Rolls on their own streams. ── */
export type OutpostId = 'asteroid' | 'relay' | 'bastion';
export const OUTPOSTS: { id: OutpostId; name: string; perk: string; index: number; garrison: number }[] = [
  { id: 'asteroid', name: '광물 소행성대', perk: '채굴 +15%', index: 640, garrison: 2 },
  { id: 'relay', name: '중계 기지', perk: '전력 판매가 +5%', index: 980, garrison: 3 },
  { id: 'bastion', name: '요새 위성', perk: '방어막 발생기 회복 +1/블록', index: 300, garrison: 4 },
];
export const OUTPOST = { claim: 12, fortify: 10, maxGarrison: 3, contestEvery: 160 };
function outposts() {
  s.outposts ??= { asteroid: { owner: null, garrison: 0 }, relay: { owner: '1-1004', garrison: 1 }, bastion: { owner: '1-313', garrison: 1 } };
  return s.outposts;
}
const holds = (id: OutpostId) => s.outposts?.[id]?.owner === DEMO_ID;
const warships = () => s.structs.filter((x) => x.cat === 'fleet' && x.type !== 1 && x.hp > 0 && x.building == null).length;
/** The chance a sortie on this outpost succeeds now. */
function claimOdds(id: OutpostId) {
  const o = outposts()[id], def = OUTPOSTS.find((x) => x.id === id)!;
  const holder = o.owner && o.owner !== DEMO_ID ? rivals().find((r) => r.id === o.owner) : null;
  const guard = def.garrison + o.garrison * 2 + (holder ? holder.fleet / 2 : 0);
  if (!warships()) return 0; // engineers can't sail without ships
  const mine = warships() + 2 * lv('fort');
  return Math.max(0.05, Math.min(0.95, mine / (mine + guard)));
}
function contestStep() {
  s.nextContest ??= s.height + OUTPOST.contestEvery;
  if (s.height < s.nextContest) return;
  s.nextContest = s.height + OUTPOST.contestEvery;
  const mine = OUTPOSTS.filter((d) => holds(d.id));
  const free = rivals().filter((x) => x.vassal == null && !((s.pacts?.[x.id] ?? 0) > s.height) && x.id !== allyId());
  if (!free.length) return;
  const r = rngFor(`contest:${s.height}`);
  // An unclaimed site doesn't wait for you: now and then a rival plants its flag.
  const neutral = OUTPOSTS.filter((d) => !outposts()[d.id].owner);
  if (neutral.length && r() < 0.35) {
    const site = neutral[Math.floor(r() * neutral.length)], taker = free[Math.floor(r() * free.length)];
    outposts()[site.id] = { owner: taker.id, garrison: 1 };
    emit('news', `${taker.name}이(가) 중립 거점 ${site.name}을(를) 장악했습니다`);
    return;
  }
  if (!mine.length) return;
  const target = mine[Math.floor(r() * mine.length)], attacker = free[Math.floor(r() * free.length)];
  const o = outposts()[target.id];
  const def = warships() + 2 * lv('fort') + o.garrison * 2 + target.garrison;
  const hold = def / (def + attacker.fleet);
  if (r() < hold) { emit('cheong', `${attacker.name}의 ${target.name} 공격을 막아 냈습니다`); return; }
  o.owner = attacker.id; o.garrison = 0;
  chronicle('jeok', `${attacker.name}에게 ${target.name}을(를) 빼앗겼다`);
  emit('alarm', `${target.name} 함락! ${attacker.name}이(가) 거점을 빼앗았습니다`);
}

/* ── 동맹 (alliance): pay a rival for a term of friendship. An ally never raids you and sends ships
 * to fight beside yours when you raid; spying on it ends the deal. 붉은 연합 allies with no one. ── */
export const ALLY = { cost: 15, term: 200, ships: [[3, 'space'], [5, 'air']] as [number, Ambit][] };
/** Your fleet plus your ally's ships, in the slots you've left free (for raids and their odds). */
export function withAllies(mine: Unit[]): Unit[] {
  if (!allyId()) return mine;
  const out = [...mine];
  for (const [type, ambit] of ALLY.ships) {
    const slot = [0, 1, 2, 3].find((sl) => !out.some((u) => u.side === 'player' && u.ambit === ambit && u.slot === sl && u.type !== 1));
    if (slot != null && fits(type, ambit)) out.push({ id: unitId('player', type, ambit, slot), side: 'player', type, ambit, slot, protects: null });
  }
  return out;
}
const allyId = () => (s.ally && s.ally.until > s.height ? s.ally.id : null);
function allyStep() {
  if (s.ally && s.height >= s.ally.until) {
    const r = rivals().find((x) => x.id === s.ally!.id);
    s.ally = null;
    emit('cheong', `${r?.name ?? '동맹'}과(와)의 동맹이 만료되었습니다`);
  }
}

/* ── 지휘관 능력: active powers with cooldowns, unlocked by rank. ── */
export type AbilityId = 'surge' | 'overshield' | 'rally';
/** What emergency refining can turn into alpha right now: 25 blocks of every running refinery. */
const surgeCap = () => s.structs.filter((x) => x.type === 15 && x.online && x.building == null && x.hp > 0).reduce((a, x) => a + refineRate() * ocf(x, OC.out), 0) * 25;
export const ABILITIES: { id: AbilityId; name: string; what: string; cooldown: number; rank: number; key: string }[] = [
  { id: 'surge', name: '긴급 정제', what: '정제소 25블록치를 즉시 정제', cooldown: 60, rank: 3, key: '7' },
  { id: 'overshield', name: '방어막 과충전', what: '방어막 +40%', cooldown: 90, rank: 4, key: '8' },
  { id: 'rally', name: '총동원', what: '20블록 동안 모든 함포가 방어 사격', cooldown: 150, rank: 7, key: '9' },
];

/* ── 의뢰 게시판 (contract board): rival houses post jobs. Deliveries pay a premium for ore now (a
 * safe way to clear a pile before a raid); defence contracts pay for raids repelled in time. ── */
export interface Job { id: string; kind: 'deliver' | 'defend'; who: string; need: number; reward: number }
export const JOBS = { every: 120, defendFor: 150 };
function jobsStep() {
  s.jobs ??= { offers: [], next: s.height };
  const j = s.jobs;
  if (j.active && s.height > j.active.until) { emit('jeok', `의뢰 실패 · 기한이 지났습니다`); j.active = null; }
  if (s.height < j.next) return;
  j.next = s.height + JOBS.every;
  const r = rngFor(`jobs:${s.height}`), rs = rivals();
  j.offers = [0, 1, 2].map((i): Job => {
    const who = rs[Math.floor(r() * rs.length)].id;
    if (i < 2) { const need = 20 + Math.floor(r() * 6) * 10; return { id: `J${s.height}-${i}`, kind: 'deliver', who, need, reward: Math.round(need * (1.1 + r() * 0.15) * 10) / 10 }; }
    return { id: `J${s.height}-${i}`, kind: 'defend', who, need: 2, reward: 20 + Math.floor(r() * 3) * 5 };
  });
}
/* ── 개장 (refits): one module per fleet hull, bought with alpha, for the defence of the base. A new
 * module replaces the old one (paid again); a destroyed hull loses its module with it. ── */
export type RefitId = 'armor' | 'guns' | 'evade';
export const REFITS: Record<RefitId, { name: string; what: string; cost: number }> = {
  armor: { name: '증가 장갑', what: '최대 내구도 +2', cost: 8 },
  guns: { name: '포 개량', what: '기지 방어 사격 피해 +1', cost: 10 },
  evade: { name: '회피 추진기', what: '기지 방어 피격 회피 +20%p', cost: 8 },
};

/** 연합 전선: past this hegemony, some raids come under two banners with two more escorts. */
export const COALITION = { at: 0.55, chance: 0.35, extra: 2 };
/** 보복 출격: hit back at a raider you just broke, within the window, for more of its ore. */
export const REVENGE = { window: 40, bonus: 1.5 };

/* ── 암시장 (black market): a smuggler docks now and then for a few blocks with three one-off deals.
 * Prices are rolled per visit; each deal sells once. Nothing here undercuts the contract board. ── */
export type BlackId = 'shield' | 'bribe' | 'scrap' | 'cool' | 'patch';
export interface BlackOffer { id: BlackId; price: number }
export const BLACK = { every: 180, stays: 30, scrapRate: 0.9, scrapMax: 40, bribe: 60 };
export const BLACK_DEALS: Record<BlackId, { name: string; what: string }> = {
  shield: { name: '방어막 충전기', what: '방어막 즉시 100%' },
  bribe: { name: '습격 정보 매수', what: `다음 습격 ${BLACK.bribe}블록 지연` },
  scrap: { name: '광석 처분', what: `광석 최대 ${BLACK.scrapMax} 단위를 개당 ${BLACK.scrapRate} α에 즉시 매각` },
  cool: { name: '밀수 부품', what: '지휘관 능력 재사용 대기 초기화' },
  patch: { name: '응급 수리반', what: '손상된 구조체 전부 수리 (파괴된 것 제외)' },
};
function blackStep() {
  s.black ??= { next: s.height + 60, until: 0, offers: [] };
  const b = s.black;
  if (b.offers.length && s.height > b.until) { b.offers = []; emit('info', '밀수선이 떠났습니다'); }
  if (s.height < b.next) return;
  const r = rngFor(`black:${s.height}`);
  b.next = s.height + BLACK.every + Math.floor(r() * 60);
  b.until = s.height + BLACK.stays;
  const pool: BlackId[] = ['shield', 'bribe', 'scrap', 'cool', 'patch'];
  for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]]; }
  const base: Record<BlackId, number> = { shield: 5, bribe: 9, scrap: 0, cool: 10, patch: 4 };
  b.offers = pool.slice(0, 3).map((id) => ({ id, price: Math.round(base[id] * (0.7 + r() * 0.7) * 10) / 10 }));
  emit('black', `밀수선 입항 · ${BLACK.stays}블록 동안 거래 가능 (거래소)`);
}
/** A raid beaten: counts for a defence contract if it fell within the term and began after taking it. */
function jobRepelled(startedAt?: number) {
  const a = s.jobs?.active;
  if (!a || a.kind !== 'defend' || s.height > a.until) return;
  if (startedAt != null && startedAt < (a.taken ?? 0)) return;
  if (++a.count >= a.need) { s.alpha += a.reward; s.jobs!.done = (s.jobs!.done ?? 0) + 1; chronicle('cheong', `방어 의뢰 완수 · +${a.reward} α`); emit('bounty', `${rivals().find((x) => x.id === a.who)?.name ?? '의뢰인'} 방어 의뢰 보수 ${a.reward} α`); s.jobs!.active = null; }
}

/* ── 대출 (credit): 청룡 상단 lends against your future. 20% on top, due in 200 blocks, repaid
 * from the treasury when it falls due. Can't pay, and the house takes ore and sends its fleet. ── */
export const LOAN = { max: 50, rate: 0.2, term: 200 };
function loanStep() {
  const l = s.loan;
  if (!l || s.height < l.due) return;
  const lender = rivals().find((x) => x.id === '1-1004');
  if (s.alpha >= l.owed) {
    s.alpha -= l.owed; if (lender) lender.alpha += l.owed;
    if (catching) awayLoan = `대출 상환 −${l.owed.toFixed(1)} α`;
    emit('cheong', `청룡 상단 대출 상환 · −${l.owed.toFixed(1)} α`);
  } else {
    // Default: whatever alpha there is, then ore at twice the shortfall; and the house is angry.
    const short = l.owed - s.alpha; if (lender) lender.alpha += s.alpha; s.alpha = 0;
    const seized = Math.min(Math.floor(s.ore), Math.ceil(short * 2)); s.ore -= seized;
    // A defaulter is cut off for a long while, and the house remembers: even a vassal breaks its oath.
    s.loanBan = s.height + 600;
    if (lender) { if (lender.vassal != null) { lender.vassal = null; lender.raided = 0; } if (s.pacts?.[lender.id]) delete s.pacts[lender.id]; s.rebel = lender.id; s.nextRaid = Math.min(s.nextRaid, 5); }
    chronicle('jeok', `청룡 상단 대출 불이행 · 광석 ${seized} 압류`);
    if (catching) awayLoan = `대출 불이행 · 광석 ${seized} 압류`;
    emit('alarm', `대출 불이행! 청룡 상단이 광석 ${seized} 단위를 압류하고 함대를 보냅니다`);
  }
  s.loan = null;
}

/* ── 길드 전 (the guild race): the three guilds compete in seasons. Every guild's members chip in a
 * little each block; you add your guild's points by donating, repelling raids and claiming bounties.
 * When a season ends, the winning guild's members are paid. Its own random stream. ── */
export const RACE = { season: 600, prize: 20 };
function raceAdd(pts: number) { if (s.guild && s.race) s.race.pts[s.guild.id] = (s.race.pts[s.guild.id] ?? 0) + pts; }
function raceStep() {
  s.race ??= { start: s.height, pts: { blue: 0, gold: 0, iron: 0 } };
  const r = rngFor(`race:${s.height}`);
  // Steady chipping in, and now and then a big push from a guild's own members (the race stays open).
  for (const g of ['blue', 'gold', 'iron'] as GuildId[]) s.race.pts[g] += 0.5 + r() * 0.5 + (r() < 0.02 ? 20 : 0);
  if (s.height - s.race.start < RACE.season) return;
  const order = (Object.entries(s.race.pts) as [GuildId, number][]).sort((a, b) => b[1] - a[1]);
  const [winner] = order[0];
  const name = GUILDS.find((g) => g.id === winner)!.name;
  // Only members who were in for the whole season share the prize (no switching in at the end).
  if (s.guild?.id === winner && s.guild.joinedAt <= s.race.start) {
    s.alpha += RACE.prize; s.raceWins = (s.raceWins ?? 0) + 1;
    chronicle('hwang', `길드 전 우승 · ${name} · +${RACE.prize} α`);
    emit('race', `${name} 우승! 길드원 보상 +${RACE.prize} α`);
  } else emit('news', `길드 전 종료 · ${name} 우승${s.guild ? ` · ${GUILDS.find((g) => g.id === s.guild!.id)!.name} ${order.findIndex(([g]) => g === s.guild!.id) + 1}위` : ''}`);
  s.race = { start: s.height, pts: { blue: 0, gold: 0, iron: 0 } };
}

/* ── 공허 함대 (the Void Fleet): every few hundred blocks a fleet from beyond the rim drifts in and
 * stays a while. Break it in the simulator for a war chest; leave it, and when it moves on it falls on
 * someone, you or a rival. Its own random stream. ── */
export const VOID = { every: 300, stays: 60, reward: 30, fleet: 9 };
function bossStep() {
  // Locked in battle with you, it stays (for a while) until the fight is settled.
  if (s.boss?.engaged && s.height <= s.boss.engaged) return;
  if (s.boss && s.height > s.boss.until) {
    const r = rngFor(`void:${s.height}`);
    const targets: (Rival | null)[] = [null, ...rivals().filter((x) => x.vassal == null)];
    const hit = targets[Math.floor(r() * targets.length)];
    if (!hit) {
      const take = Math.floor(s.ore * 0.5); s.ore -= take; s.shield = 0;
      for (const x of s.structs.filter((y) => y.cat === 'planet' && y.hp > 0).slice(0, 2)) x.hp = Math.max(1, x.hp - 2);
      chronicle('jeok', `공허 함대가 기지를 덮쳤다 · 광석 ${take} 소실`);
      emit('alarm', `공허 함대 강습! 광석 ${take} 소실 · 구조체 손상`);
    } else {
      hit.fleet = Math.max(2, hit.fleet - 2); hit.ore = Math.floor(hit.ore * 0.5);
      emit('news', `공허 함대가 ${hit.name}을(를) 휩쓸고 지나갔습니다 · 함대 −2 · 지금이 기회입니다`);
    }
    s.boss = null; s.nextBoss = s.height + VOID.every;
    return;
  }
  s.nextBoss ??= s.height + 150;
  if (s.boss || s.raid || s.height < s.nextBoss) return;
  s.boss = { until: s.height + VOID.stays, n: (s.voidKills ?? 0) };
  log('event', '공허 함대 출현');
  emit('void', `${VOID.stays}블록 안에 요격하지 않으면 누군가를 덮칩니다`);
}

/* ── 패권 지수: your share of all the power in the galaxy (vassals count as yours). Crossing each
 * line for the first time is a title and a reward. ── */
export const HEGEMONY = [
  { at: 0.25, title: '지역 강자', xp: 150 },
  { at: 0.4, title: '성계 패자', xp: 300 },
  { at: 0.55, title: '은하 제후', xp: 600 },
  { at: 0.7, title: '은하 황제', xp: 1200 },
];
function hegemony() {
  // Your power already counts a quarter of each vassal; a vassal is still a power of its own.
  const vassals = rivals().filter((r) => r.vassal != null).reduce((a, r) => a + rivalWorth(r), 0);
  const mine = demo.netWorth() + vassals * 0.25;
  const rest = rivals().filter((r) => r.vassal == null).reduce((a, r) => a + rivalWorth(r), 0) + vassals * 0.5;
  return mine / Math.max(1, mine + rest);
}
/** Every 10 blocks, everyone's worth for the power chart (also while catching up: no RNG here). */
function samplePower() {
  if (s.height % 10 !== 0) return;
  const r: Record<string, number> = {};
  for (const x of rivals()) r[x.id] = Math.round(rivalWorth(x));
  s.powerHist = [...(s.powerHist ?? []), { h: s.height, me: Math.round(demo.netWorth()), r }].slice(-72);
}
function hegemonyStep() {
  const h = hegemony(), t = s.hegemonyTier ?? 0;
  if (t < HEGEMONY.length && h >= HEGEMONY[t].at) {
    s.hegemonyTier = t + 1;
    log('event', `패권 · ${HEGEMONY[t].title}`);
    // Titles come back every era; the XP only for a height never reached before.
    const fresh = t + 1 > (s.hegemonyBest ?? 0);
    if (fresh) s.hegemonyBest = t + 1;
    emit('hegemony', `${t}|${fresh ? 1 : 0}`);
    chronicle('hwang', `칭호 「${HEGEMONY[t].title}」 · 패권 ${Math.round(HEGEMONY[t].at * 100)}%`);
  }
}
export type DecisionId = 'smuggler' | 'pact' | 'orebuyer' | 'mercs' | 'ultimatum';
export interface Choice { label: string; effect: string; ok?: boolean }
export const DECISION = { every: 75, open: 25 };
/** An ultimatum lands when strength × luck clears 1.4; luck (0.8–1.2) is drawn when the card opens. */
const ultOdds = (r: Rival) => Math.max(0, Math.min(1, (1.2 - 1.4 / (netWorthOf() / Math.max(1, rivalWorth(r)))) / 0.4));
function choicesOf(id: DecisionId, r: Rival): { title: string; text: string; choices: Choice[] } {
  const odds = ultOdds(r), strong = odds >= 0.5;
  switch (id) {
    case 'smuggler': return { title: '밀수선 접근', text: '정체불명의 화물선이 광석을 싸게 넘기겠답니다. 출처는 묻지 말라는군요.',
      choices: [{ label: '매입', effect: '−6 α · 광석 +30 · 다음 습격이 8블록 빨라짐', ok: s.alpha >= 6 }, { label: '돌려보내기', effect: '아무 일도 없음' }] };
    case 'pact': return { title: `${r.name}의 불가침 제안`, text: `${r.name}이(가) 120블록 동안 서로 공격하지 말자고 합니다. 대가로 알파 8 g을 요구합니다.`,
      choices: [{ label: '조약 체결', effect: `−8 α · ${r.name} 120블록 습격 없음`, ok: s.alpha >= 8 }, { label: '거절', effect: '이 세력의 다음 습격이 앞당겨짐' }] };
    case 'orebuyer': return { title: '광석 대량 매입 제안', text: '청룡 상단 중개인이 비축 광석을 지금 전부 사겠답니다. 정제보다 싸지만, 약탈당할 광석이 사라집니다.',
      choices: [{ label: '전량 매도', effect: `광석 ${Math.floor(s.ore)} → +${(s.ore * 0.75).toFixed(1)} α (정제가의 75%)`, ok: s.ore >= 1 }, { label: '보유', effect: '정제를 계속함' }] };
    case 'mercs': return { title: '용병 함장', text: '떠돌이 함장이 궤도 방어막을 채워 주겠답니다. 다음 습격 전에 쓸 만합니다.',
      choices: [{ label: '고용', effect: '−5 α · 방어막 100%', ok: s.alpha >= 5 && s.shield < 100 }, { label: '사양', effect: '아무 일도 없음' }] };
    case 'ultimatum': return { title: `${r.name}에게 최후통첩`, text: strong ? `우리 세력이 ${r.name}을(를) 압도합니다. 공물을 요구할 수 있습니다.` : `${r.name}은(는) 만만치 않습니다. 요구하면 반발할 수 있습니다.`,
      choices: [{ label: '공물 요구', effect: `성공 확률 ${Math.round(odds * 100)}% · 성공 +${Math.min(12, r.alpha * 0.3).toFixed(1)} α · 실패 시 곧 습격` }, { label: '보류', effect: '아무 일도 없음' }] };
  }
}
/** Your full power (the same score the standings use), against a rival's. */
function netWorthOf() { return demo.netWorth(); }
function decisionStep() {
  if (s.decision) { if (--s.decision.left <= 0) { s.decision = null; emit('cheong', '결단의 기회가 지나갔습니다'); } return; }
  // Not mid-raid: a missed slot waits for the fight to end.
  s.nextDecision ??= s.height + 20;
  if (s.raid || s.height < s.nextDecision) return;
  s.nextDecision = s.height + DECISION.every;
  const ids: DecisionId[] = ['orebuyer', 'pact', 'mercs', 'smuggler', 'ultimatum'];
  const n = (s.offered = (s.offered ?? 0) + 1);
  const free = rivals().filter((x) => x.vassal == null && !((s.pacts?.[x.id] ?? 0) > s.height) && x.id !== allyId());
  if (!free.length) ids.splice(ids.indexOf('pact'), 1), ids.splice(ids.indexOf('ultimatum'), 1);
  const id = ids[n % ids.length];
  const r = free[n % Math.max(1, free.length)] ?? rivals()[0];
  s.decision = { id, rival: r.id, left: DECISION.open, luck: 0.8 + rngFor(`ult:${n}`)() * 0.4 };
  emit('decision', choicesOf(id, r).title);
}
function decide(i: number): string | null {
  adoptStored();
  const d = s.decision;
  if (!d) return '열린 결단이 없습니다';
  const r = rivals().find((x) => x.id === d.rival) ?? rivals()[0];
  // The world moved on: a rival made a vassal (or bound by a pact) since the card opened.
  if ((d.id === 'pact' || d.id === 'ultimatum') && (r.vassal != null || (s.pacts?.[r.id] ?? 0) > s.height)) {
    s.decision = null; persist(); for (const f of changeFns) f();
    return `${r.name}의 상황이 바뀌어 결단이 무효가 되었습니다`;
  }
  const c = choicesOf(d.id, r).choices[i];
  if (!c) return '없는 선택지입니다';
  if (c.ok === false) return '조건이 맞지 않습니다';
  let note = '';
  if (i === 0) switch (d.id) {
    case 'smuggler': s.alpha -= 6; s.ore += 30; s.nextRaid = Math.max(1, s.nextRaid - 8); note = '광석 +30'; break;
    case 'pact': s.alpha -= 8; s.pacts = { ...s.pacts, [r.id]: s.height + 120 }; note = `${r.name} 불가침 체결`; break;
    case 'orebuyer': { const a = s.ore * 0.75; s.alpha += a; note = `광석 ${Math.floor(s.ore)} 매도 +${a.toFixed(1)} α`; s.ore = 0; break; }
    case 'mercs': s.alpha -= 5; s.shield = 100; note = '방어막 100%'; break;
    case 'ultimatum': {
      const ratio = netWorthOf() / Math.max(1, rivalWorth(r));
      // Strength decides, with the luck fixed when the card opened (waiting doesn't help).
      if (ratio * (d.luck ?? 1) > 1.4) { const a = Math.min(12, r.alpha * 0.3); r.alpha -= a; s.alpha += a; note = `${r.name} 공물 +${a.toFixed(1)} α`; }
      else { s.rebel = r.id; s.nextRaid = Math.min(s.nextRaid, 4); note = `${r.name} 거절 · 함대 출격`; }
      break;
    }
  } else if (d.id === 'pact') { s.rebel = r.id; s.nextRaid = Math.min(s.nextRaid, 10); note = `${r.name} 제안 거절`; }
  else note = '보류';
  s.decision = null; s.decided = (s.decided ?? 0) + 1;
  log('event', `결단 · ${note}`);
  persist(); for (const f of changeFns) f();
  return null;
}

/* ── Raids: a fleet appears, closes in, and fights the base until one side breaks. ── */
/** A new commander's grace: the first three raids are small and come further apart. */
const rookie = () => s.raidsRepelled + s.raidsLost < 3;
const raidGap = () => (rookie() ? RATE.raidEvery + 15 : RATE.raidEvery);
/** Close a defence: credit the kills (veterancy counts at home too) and file the report. */
function fileReport(r: DemoRaid, won: boolean) {
  const tl = r.tally ?? { kills: {}, blocked: 0, hits: 0 };
  const promoted = creditInner(tl.kills);
  s.report = { h: s.height, won, name: r.name, stance: r.stance, blocked: tl.blocked, hits: tl.hits, seized: r.seized, promoted,
    kills: Object.entries(tl.kills).map(([id, n]) => { const x = s.structs.find((y) => y.id === id); return { id, type: x?.type ?? 0, n, name: x?.name }; }).sort((a, z) => z.n - a.n) };
  if (promoted.length) emit('promote', promoted.map((x) => `${x.name ? `「${x.name}」` : STRUCT_TYPE[x.type] ?? TYPES_BY_ID[x.type].type} ${'★'.repeat(x.rank)}`).join(' · '));
}
/** Who may come for you next, and how heavily each is weighted: vassals, pacts and allies don't;
 * temperament, grudges and a calculating rival's sums do. (A rebel, when there is one, comes first.) */
function raidWeights(): [Rival, number][] {
  const free = rivals().filter((x) => x.vassal == null && !((s.pacts?.[x.id] ?? 0) > s.height) && x.id !== allyId());
  return free.map((x) => [x, (TEMPER[x.id]?.raid ?? 2) * (1 + GRUDGE.per * (x.grudge ?? 0)) * (x.id === '1-313' && rivalWorth(x) < demo.netWorth() ? 0.3 : 1) * (x.id === '1-87' && s.ore > 50 ? 1.5 : 1)]);
}
function raidStep() {
  if (!s.raid) {
    if ((s.nextRaid -= ev('pirates') ? 2 : 1) > 0) return;
    const ws = raidWeights(), free = ws.map(([x]) => x);
    const weight = (x: Rival) => ws.find(([y]) => y === x)![1];
    const total = free.reduce((a, x) => a + weight(x), 0);
    let roll = rnd() * total, pick = free[free.length - 1];
    for (const x of free) { roll -= weight(x); if (roll <= 0) { pick = x; break; } }
    const rv = (s.rebel && free.find((x) => x.id === s.rebel)) || pick;
    s.rebel = null;
    // The galaxy closes ranks against an empire: a second house joins the raid (no RNG drawn before then).
    const others = rv ? free.filter((x) => x.id !== rv.id) : [];
    const partner = rv && others.length && hegemony() >= COALITION.at && rnd() < COALITION.chance ? others[Math.floor(rnd() * others.length)] : null;
    if (partner && !s.coalitions) chronicle('jeok', `은하가 당신에게 맞서 연합했다 · ${rv!.name}·${partner.name}`);
    if (partner) s.coalitions = (s.coalitions ?? 0) + 1;
    const [name, owner] = rv ? [partner ? `${rv.name}·${partner.name} 연합` : rv.name, rv.id] : ['떠돌이 해적', '1-9'];
    const fid = `9-${300 + Math.floor(rnd() * 600)}`;
    const R = (i: number, type: number, ambit: Ambit, slot: number): DemoStruct => ({ id: `5-r${s.height}${i}`, type, ambit, slot, cat: 'fleet', online: true, hp: TYPES_BY_ID[type].maxHealth, max: TYPES_BY_ID[type].maxHealth, building: null, buildBlocks: 0, protects: null });
    // The first raids are a lesson, not a beating: one escort each until three have come and gone.
    const size = Math.min(6, (rookie() ? 1 : 2 + Math.min(4, Math.floor(Math.max(0, s.raidsRepelled - 3) / 3))) + (partner ? COALITION.extra : 0));
    const pool: [number, Ambit][] = [[3, 'space'], [5, 'air'], [9, 'land'], [12, 'water'], [8, 'land'], [4, 'space']];
    s.raid = { fleetId: fid, owner, name, eta: RATE.raidEta, seized: 0, startedAt: s.height, structs: [R(0, 1, 'space', 0), ...pool.slice(0, size).map(([t, a], i) => R(i + 1, t, a, i % 2))], partner: partner?.id };
    log('fleet_depart', `${fid} → ${PLANET}`);
    emit('alarm', `${partner ? '연합 전선 · ' : ''}${name} 함대 ${fid} 접근 중 · ${RATE.raidEta}블록 후 도착`);
    return;
  }
  const r = s.raid;
  if (r.eta > 0) {
    r.eta--;
    if (r.eta === 0) {
      log('fleet_arrive', r.fleetId); log('raid_status', 'ongoing'); emit('alarm', `${r.name} 습격 개시!`);
      // Your guild answers the alarm: shield support, more from a bigger guild.
      if (s.guild) { const lv = guildLevel(), before = s.shield; s.shield = Math.min(100, s.shield + 8 * lv); const got = Math.round(s.shield - before); if (got > 0) emit('guildhelp', `${GUILDS.find((g) => g.id === s.guild!.id)!.name} 방어막 지원 +${got}%`); }
    }
    return;
  }
  // One volley each way per block.
  const mineAlive = s.structs.filter((x) => x.hp > 0 && x.building == null);
  const theirs = r.structs.filter((x) => x.hp > 0);
  if (theirs.length && mineAlive.length) {
    const a = theirs[Math.floor(rnd() * theirs.length)];
    // 참호: the shield takes more of the blows. 요격: you meet them in the open, and so do their guns.
    const shieldUp = s.shield > 0 && rnd() < (s.shield / 140) * (1 + 0.3 * lv('shield')) * (r.stance === 'entrench' ? 1.6 : 1);
    const t = mineAlive.filter((x) => x.cat === 'planet').concat(mineAlive)[Math.floor(rnd() * mineAlive.length)];
    const hpBefore = t.hp;
    r.tally ??= { kills: {}, blocked: 0, hits: 0 };
    if (shieldUp) { s.shield = Math.max(0, s.shield - 12); attack(a, t, 0, false, true); r.tally.blocked++; }
    else attack(a, t, 1 + (rnd() < (r.stance === 'intercept' ? 0.4 : r.stance === 'entrench' ? 0.15 : 0.3) ? 1 : 0), rnd() < 0.12 + (t.mod === 'evade' ? 0.2 : 0));
    if (!shieldUp && t.hp < hpBefore) r.tally!.hits++;
  }
  // The best guns fire first: veterans, then defence cannons.
  const shooters = s.structs.filter((x) => x.hp > 0 && x.online && x.building == null && (x.cat === 'fleet' || x.type === 19))
    .sort((a, z) => vetRank(z.kills) - vetRank(a.kills) || Number(z.type === 19) - Number(a.type === 19));
  // 총동원: every gun fires while it lasts.
  for (const d of shooters.slice(0, (s.rallyUntil ?? 0) >= s.height ? shooters.length : 2)) {
    const left = r.structs.filter((x) => x.hp > 0);
    if (!left.length) break;
    const tgt = left.find((x) => x.type !== 1) ?? left[0];
    const was = tgt.hp;
    // Veterans (★★ and up) hit harder.
    attack(d, tgt, (d.type === 19 ? 2 : 1) + (vetRank(d.kills) >= 2 ? 1 : 0) + (d.mod === 'guns' ? 1 : 0) + (rnd() < 0.25 * lv('guns') + (inGuild('iron') ? 0.1 : 0) + (r.stance === 'intercept' ? 0.3 : 0) - (r.stance === 'entrench' ? 0.1 : 0) ? 1 : 0), rnd() < 0.15);
    if (was > 0 && tgt.hp <= 0) { r.tally ??= { kills: {}, blocked: 0, hits: 0 }; r.tally.kills[d.id] = (r.tally.kills[d.id] ?? 0) + 1; }
  }
  const cmdDown = r.structs.find((x) => x.type === 1)!.hp <= 0;
  if (cmdDown || r.structs.every((x) => x.hp <= 0)) {
    fileReport(r, true);
    s.raid = null; s.raidsRepelled++; s.nextRaid = raidGap(); raceAdd(15); jobRepelled(r.startedAt);
    // A broken raid costs its owner a ship.
    const owner = rivals().find((x) => x.id === r.owner);
    if (owner) owner.fleet = Math.max(2, owner.fleet - 1);
    const ally2 = r.partner ? rivals().find((x) => x.id === r.partner) : null;
    if (ally2) ally2.fleet = Math.max(2, ally2.fleet - 1);
    if (r.partner) { s.coalitionWins = (s.coalitionWins ?? 0) + 1; if (s.coalitionWins === 1) chronicle('hwang', `연합 함대를 꺾었다 · ${r.name}`); }
    log('raid_status', 'attackerDefeated');
    emit('victory', `${r.name} 함대 격퇴!`);
    if (owner) { s.revenge = { rival: owner.id, until: s.height + REVENGE.window }; emit('revenge', `${owner.name} 함대가 무너졌습니다 · ${REVENGE.window}블록 안에 반격하면 노획 +${Math.round((REVENGE.bonus - 1) * 100)}%`); }
    if ([1, 10, 25, 50, 100].includes(s.raidsRepelled)) chronicle('cheong', `습격 ${s.raidsRepelled}회째 격퇴 · ${r.name}`);
    return;
  }
  if (s.height - r.startedAt > RATE.raidEta + 8 || !s.structs.some((x) => x.cat === 'fleet' && x.hp > 0)) {
    // The raiders break through and take every gram of unrefined ore.
    r.seized = Math.floor(s.ore * (1 - 0.25 * lv('bunker')) * (inGuild('blue') ? 0.85 : 1)); s.ore -= r.seized; s.shield = 0;
    fileReport(r, false);
    s.raid = null; s.raidsLost++; s.nextRaid = raidGap();
    log('raid_status', 'raidSuccessful');
    emit('defeat', `습격 성공 · 광석 ${r.seized} 약탈당함`);
  }
}

function attack(a: DemoStruct, t: DemoStruct, dmg: number, evaded: boolean, shield = false) {
  const before = t.hp;
  if (!evaded && !shield) t.hp = Math.max(0, t.hp - dmg);
  const shot: ShotRow = {
    targetStructId: t.id, targetStructTypeId: t.type, targetStructType: TYPES_BY_ID[t.type].type, targetStructOperatingAmbit: t.ambit, targetStructSlot: t.slot,
    targetPlayerId: s.raid?.structs.includes(t) ? s.raid.owner : DEMO_ID, targetHealthBefore: before, targetHealthAfter: t.hp, targetDestroyed: t.hp === 0 && before > 0, targetHealthMax: t.max,
    eventAttackDefenderCounterDetail: [], evaded: evaded || shield, evadedCause: shield ? 'signalJamming' : evaded ? 'defensiveManeuver' : undefined,
  };
  const d: AttackDetail = {
    attackerPlayerId: s.raid?.structs.includes(a) ? s.raid.owner : DEMO_ID, attackerStructId: a.id, attackerStructTypeId: a.type, attackerStructType: TYPES_BY_ID[a.type].type,
    attackerStructOperatingAmbit: a.ambit, attackerStructSlot: a.slot, weaponSystem: 'primaryWeapon', weaponControl: 'guided', activeWeaponry: 'guidedWeaponry',
    attackerHealthBefore: a.hp, attackerHealthMax: a.max, eventAttackShotDetail: [shot],
  };
  log('struct_attack', `${a.id} → ${t.id}`);
  if (t.hp === 0 && before > 0) t.online = false;
  if (!forecastRng) for (const f of attackFns) f(d);
}

/** 전황 예측: play the raid out many times on a copy of the base (same rules, its own dice) and count
 * the wins for each stance. Nothing real is touched: the copy is thrown away, events and saves muted. */
export type Forecast = Record<'none' | Stance, number>;
let forecastMemo: { key: string; f: Forecast } | null = null;
function raidForecast(n = 40): Forecast | null {
  if (!s.raid) return null;
  const key = `${s.height}:${s.seq}:${s.shield}:${s.structs.map((x) => x.hp).join('')}:${s.raid.structs.map((x) => x.hp).join('')}`;
  if (forecastMemo?.key === key) return forecastMemo.f;
  const real = s, fid = s.raid.fleetId;
  const f: Forecast = { none: 0, intercept: 0, entrench: 0 };
  forecasting = true;
  try {
    for (const st of ['none', 'intercept', 'entrench'] as const) {
      let won = 0;
      for (let i = 0; i < n; i++) {
        s = structuredClone(real);
        // Whole blocks, as the clock would run them (shield regen, repairs, the lot), with this stance.
        if (s.raid!.eta > 0) s.raid!.stance = st === 'none' ? undefined : st;
        forecastRng = rngFor(`forecast:${key}:${st}:${i}`);
        for (let b = 0; b < 40 && s.raid?.fleetId === fid; b++) blockInner();
        if (s.raidsRepelled > real.raidsRepelled) won++;
      }
      f[st] = won / n;
    }
  } finally { s = real; forecasting = false; forecastRng = null; }
  forecastMemo = { key, f };
  return f;
}

/* ── What the screens read ── */
function structRows(): StructRow[] {
  return s.structs.map((x) => ({
    id: x.id, type: x.type, owner: DEMO_ID, location_type: x.cat === 'planet' ? 'planet' : 'fleet', location_id: x.cat === 'planet' ? PLANET : '9-1',
    operating_ambit: x.ambit, slot: x.slot, is_destroyed: x.hp <= 0, health: x.hp, status: (x.building == null ? BUILT : 0) | (x.online && x.building == null ? ONLINE : 0) | (x.hp <= 0 ? DESTROYED : 0),
    protected_struct_id: x.protects, defending_struct_ids: [], fuel: 0,
  }));
}
function player(): PlayerRow {
  const mw = (kw: number) => Math.round(kw * 1e6);
  return {
    id: DEMO_ID, primary_address: 'structs1demo', guild_id: '0-5', substation_id: '4-7', planet_id: PLANET, fleet_id: '9-1', username: '데모 사령관', pfp: '',
    guild_name: '푸른 길드', tag: 'BLU', alpha: Math.round(s.alpha * 1e6), ore: Math.floor(s.ore), load: mw(soldKw()), structs_load: mw(structsKw()), capacity: mw(capacityKw()), connection_capacity: 0,
  };
}

export const demo = {
  get on() { return on; },
  start() { on = true; adoptStored(); try { localStorage.setItem(KEY, '1'); } catch { /* fine */ } persist(); demo.run(); for (const f of changeFns) f(); },
  stop() { on = false; if (timer) clearInterval(timer); timer = null; try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '.state'); localStorage.removeItem(LEAD); } catch { /* fine */ } s = fresh(); for (const f of changeFns) f(); },
  run() {
    if (!on || timer) return;
    // Only the leading tab advances the clock; the others follow its saves (and take over if it closes).
    wasLeader = leading();
    // Catch up first (its clock is the last save), then count the day.
    if (wasLeader) { const r = catchUp(); if (r) { if (awayFns.size) for (const f of awayFns) f(r); else pendingReport = r; } checkStreak(); }
    timer = setInterval(beat, BLOCK_MS);
  },
  /** The "while you were away" report, delivered once to the first listener that asks. */
  onAway(f: (r: AwayReport) => void) { awayFns.add(f); if (pendingReport) { f(pendingReport); pendingReport = null; } return () => awayFns.delete(f); },
  reset() { s = fresh(); persist(); for (const f of changeFns) f(); },
  /** Advance one block now (tests, and anything that must not wait for the timer). */
  step() { block(); },
  onChange(f: () => void) { changeFns.add(f); return () => changeFns.delete(f); },
  onBlock(f: () => void) { blockFns.add(f); return () => blockFns.delete(f); },
  onAttack(f: (d: AttackDetail) => void) { attackFns.add(f); return () => attackFns.delete(f); },
  onEvent(f: (kind: string, text: string) => void) { eventFns.add(f); return () => eventFns.delete(f); },
  BLOCK_MS,

  get state() { return s; },
  get raid() { return s.raid; },
  capacityKw, structsKw, soldKw,
  /** What can still be sold: spare capacity, and never more than you generate yourself. */
  // Your own generation must carry your structs and your sales: bought power never frees any up for resale.
  sellableKw: () => Math.max(0, ownKw() - structsKw() - soldKw()),
  rates() {
    const live = (t: number, f: number) => s.structs.filter((x) => x.type === t && x.online && x.building == null && x.hp > 0).reduce((a, x) => a + ocf(x, f), 0);
    const mine = live(14, OC.out) * mineRate(), refine = Math.min(live(15, OC.out) * refineRate(), s.ore + mine);
    const tribute = rivals().filter((r) => r.vassal != null).reduce((a, r) => a + tributeOf(r), 0);
    return { ore: mine - refine, alpha: refine * RATE.alphaPerOre + s.contracts.reduce((a, c) => a + c.kw * c.rate * (c.dir === 'buy' ? 0 : sellBonus()), 0) + tribute, refineCap: live(15, OC.out) * refineRate(), mine, tribute };
  },
  player,
  dashboard(): Dashboard {
    const p = player();
    const cap = Number(p.capacity), load = Number(p.load) + Number(p.structs_load);
    return {
      player: p,
      power: { player_id: DEMO_ID, username: p.username, capacity: cap, connection_capacity: 0, load: p.load, structs_load: p.structs_load, total_load: load, total_capacity: cap, margin: cap - load, connection_capacity_is_player_share: true },
      planet: { id: PLANET, owner: DEMO_ID, name: '한빛 IV', space_slots: 4, air_slots: 4, land_slots: 4, water_slots: 4, undiscovered_ore: Math.floor(s.vein) },
      shield_health: Math.round(s.shield),
      active_raid: s.raid && s.raid.eta === 0 ? { planet_id: PLANET, fleet_id: s.raid.fleetId, status: 'ongoing', updated_at: '', fleet_owner: s.raid.owner } : null,
      fleet: { id: '9-1', owner: DEMO_ID, location_type: 'planet', location_id: PLANET, status: 'onStation', command_struct: '5-901' },
      structs: structRows(),
      work: s.structs.filter((x) => x.building != null).map((x) => ({ object_id: x.id, player_id: DEMO_ID, target_id: PLANET, category: 'BUILD' as const, block_start: s.height, difficulty_target: TYPES_BY_ID[x.type].buildDifficulty })),
      activity: s.log,
      height: s.height,
    };
  },
  buildProgress: (id: string) => s.structs.find((x) => x.id === id)?.building ?? null,

  /* ── Orders ── */
  build(type: number, ambit: Ambit, slot: number, cat: 'planet' | 'fleet'): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const t = TYPES_BY_ID[type];
    if (!t) return '알 수 없는 구조체';
    // The command ship rides with the fleet but holds no slot (as in battle).
    const inSlot = (x: DemoStruct) => x.ambit === ambit && x.slot === slot && x.cat === cat && x.type !== 1;
    if (s.structs.some((x) => inSlot(x) && x.hp > 0)) return '이미 사용 중인 슬롯입니다';
    if (structsKw() + soldKw() + kwOf(type) > capacityKw()) return `전력이 부족합니다 (${kwOf(type).toFixed(2)} kW 필요)`;
    const id = `5-${920 + s.seq}`;
    // Rebuilding a fallen veteran's hull in its own slot keeps its record and name.
    const fallen = s.structs.find((x) => inSlot(x) && x.hp <= 0 && x.type === type);
    s.structs = s.structs.filter((x) => !inSlot(x));
    s.structs.push({ id, type, ambit, slot, cat, online: false, hp: t.maxHealth, max: t.maxHealth, building: 0, buildBlocks: Math.max(3, Math.round(t.buildDifficulty / 140)), protects: null, kills: fallen?.kills, name: fallen?.name });
    log('struct_block_build_start', id);
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Push a machine past spec, or ease it back. */
  overclock(id: string): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const x = s.structs.find((y) => y.id === id);
    if (!x || !OC.types.includes(x.type)) return '과부하 운전은 추출기·정제소·발전기만 가능합니다';
    if (x.hp <= 0 || x.building != null) return '가동 중인 구조체만 가능합니다';
    if (!x.oc && x.type !== 20 && structsKw() + soldKw() + kwOf(x.type) * (OC.power - 1) > capacityKw()) return `전력이 부족합니다 (+${(kwOf(x.type) * (OC.power - 1)).toFixed(2)} kW 필요)`;
    if (x.oc && x.type === 20 && x.online && structsKw() + soldKw() > capacityKw() - RATE.genKw * (OC.gen - 1)) return '해제하면 전력이 부족합니다 · 먼저 판매를 줄이거나 구조체를 끄세요';
    x.oc = !x.oc;
    log('struct_status', `${x.id} ${x.oc ? '과부하 운전' : '정상 운전'}`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  toggle(id: string): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const x = s.structs.find((y) => y.id === id);
    if (!x || x.building != null || x.hp <= 0) return '조작할 수 없습니다';
    if (!x.online && structsKw() + soldKw() + kwOf(x.type) * (x.type === 20 ? 1 : ocf(x, OC.power)) > capacityKw()) return '전력이 부족합니다';
    x.online = !x.online;
    log('struct_status', `${id} ${x.online ? '가동' : '정지'}`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  repair(id: string): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const x = s.structs.find((y) => y.id === id);
    if (!x || x.hp >= x.max) return '수리할 필요가 없습니다';
    const cost = (x.hp <= 0 ? x.max : x.max - x.hp) * 0.5;
    if (s.alpha < cost) return `알파 ${cost.toFixed(1)} g 필요`;
    s.alpha -= cost; x.hp = x.max; x.oc = false;
    // Back online only if the grid can carry it (otherwise it waits, repaired, for the player).
    x.online = x.type === 20 || x.online || structsKw() + soldKw() + kwOf(x.type) <= capacityKw();
    log('struct_health', `${id} 수리`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  repairCost: (id: string) => { const x = s.structs.find((y) => y.id === id); return x ? (x.hp <= 0 ? x.max : x.max - x.hp) * 0.5 : 0; },
  infuse(g: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (!Number.isFinite(g) || g <= 0 || s.alpha < g) return '알파가 부족합니다';
    s.alpha -= g; s.infusedKw += g;
    log('infusion', `${g} g → ${g} kW`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  sell(kw: number, blocks: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (structsKw() + soldKw() + kw > ownKw()) return '판매할 여유 전력이 없습니다 (구매한 전력은 되팔 수 없습니다)';
    // The market is only so deep: buyers take a few kW per contract and so much in all.
    if (kw > RATE.maxDealKw) return `한 계약은 최대 ${RATE.maxDealKw} kW입니다`;
    if (soldKw() + kw > RATE.marketDepthKw) return `시장 수요는 ${RATE.marketDepthKw} kW가 한계입니다`;
    const price = s.priceHist[s.priceHist.length - 1];
    s.contracts.push({ id: `11-${200 + s.seq}`, kw, rate: price * (1 + 0.08 * lv('trade')), left: blocks, buyer: ['3-15', '1-77', '3-88'][s.seq % 3] });
    // Market impact: a big sale moves the price against the next one.
    s.priceHist.push(Math.max(0.008, price * (1 - Math.min(0.3, 0.025 * kw))));
    log('agreement_open', `${kw} kW × ${blocks}`);
    persist(); if (!catching) for (const f of changeFns) f();
    return null;
  },
  get contracts() { return s.contracts; },
  /** The season so far: guilds by points, blocks left, and your guild's place. */
  get reps() { return REPS.map((r) => ({ ...r, on: !!s.reps?.[r.id] })); },
  get repLog() { return s.repLog ?? []; },
  /** Hire (pay once) or dismiss a replicant. */
  hire(id: RepId): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const r = REPS.find((x) => x.id === id)!;
    if (s.reps?.[id]) { s.reps[id] = false; repNote(`${r.role} ${r.name} 해고`); persist(); for (const f of changeFns) f(); return null; }
    if (s.alpha < r.hire) return `계약금 ${r.hire} g 필요`;
    s.alpha -= r.hire; s.reps = { ...s.reps, [id]: true };
    repNote(`${r.role} ${r.name} 고용`);
    chronicle('cheong', `레플리칸트 ${r.role} ${r.name}을(를) 고용했다`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  covert,
  /** Choose how to meet the incoming raid (only while it approaches). */
  setStance(st: Stance): string | null {
    adoptStored();
    if (!s.raid) return '다가오는 습격이 없습니다';
    if (s.raid.eta === 0) return '이미 교전 중입니다';
    s.raid.stance = st;
    persist(); for (const f of changeFns) f();
    return null;
  },
  raidForecast,
  /** The likeliest next raider while none is on its way (null otherwise): name, chance, blocks to go. */
  nextRaider() {
    if (s.raid) return null;
    const ws = raidWeights();
    const rebel = s.rebel ? ws.find(([x]) => x.id === s.rebel) : undefined;
    const total = ws.reduce((a, [, w]) => a + w, 0);
    const [x, w] = rebel ?? [...ws].sort((a, z) => z[1] - a[1])[0] ?? [];
    return x ? { id: x.id, name: x.name, p: rebel ? 1 : w! / Math.max(1e-9, total), in: Math.max(0, s.nextRaid) } : null;
  },
  /** The last defence's report while it's fresh (60 blocks), unless dismissed. */
  get report() { const p = s.report; return p && s.height - p.h <= 60 ? p : null; },
  dismissReport() { s.report = null; persist(); for (const f of changeFns) f(); },
  /** The rival open to a counter-raid, and for how long. */
  get revenge() { const v = s.revenge; return v && s.height <= v.until ? { rival: v.rival, left: v.until - s.height, name: rivals().find((x) => x.id === v.rival)?.name ?? v.rival } : null; },
  get black() { const b = s.black; return b && b.offers.length && s.height <= b.until ? { offers: b.offers, left: b.until - s.height, deals: b.deals ?? 0 } : { offers: [] as BlackOffer[], left: 0, next: Math.max(0, (b?.next ?? s.height) - s.height), deals: b?.deals ?? 0 }; },
  /** Why a black-market deal can't be bought now (null = it can). */
  blackBlocked(id: BlackId): string | null {
    const o = s.black?.offers.find((x) => x.id === id);
    if (!o || s.height > (s.black?.until ?? 0)) return '밀수선이 없습니다';
    if (s.alpha < o.price) return `알파 ${o.price} 필요`;
    if (id === 'shield' && s.shield >= 100) return '방어막이 이미 가득합니다';
    if (id === 'bribe' && s.raid) return '이미 습격이 오고 있습니다';
    if (id === 'scrap' && s.ore < 1) return '팔 광석이 없습니다';
    if (id === 'cool' && !Object.values(s.cd ?? {}).some((v) => v > s.height)) return '재사용 대기 중인 능력이 없습니다';
    if (id === 'patch' && !s.structs.some((x) => x.hp > 0 && x.hp < x.max)) return '손상된 구조체가 없습니다';
    return null;
  },
  buyBlack(id: BlackId): string | null {
    adoptStored();
    const why = demo.blackBlocked(id); if (why) return why;
    const b = s.black!, o = b.offers.find((x) => x.id === id)!;
    s.alpha -= o.price;
    let note = '';
    if (id === 'shield') { s.shield = 100; note = '방어막 100%'; }
    else if (id === 'bribe') { s.nextRaid += BLACK.bribe; note = `다음 습격 ${s.nextRaid}블록 뒤`; }
    else if (id === 'scrap') { const n = Math.min(BLACK.scrapMax, Math.floor(s.ore)); s.ore -= n; const got = Math.round(n * BLACK.scrapRate * 10) / 10; s.alpha += got; note = `광석 ${n} → +${got} α`; }
    else if (id === 'cool') { s.cd = {}; note = '능력 재사용 가능'; }
    else { for (const x of s.structs) if (x.hp > 0 && x.hp < x.max) x.hp = x.max; note = '구조체 수리 완료'; }
    b.offers = b.offers.filter((x) => x.id !== id); b.deals = (b.deals ?? 0) + 1;
    chronicle('hwang', `암시장 · ${BLACK_DEALS[id].name} · ${note}`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  get jobs() { const j = s.jobs; return j ? { offers: j.offers, active: j.active ? { ...j.active, left: Math.max(0, j.active.until - s.height) } : null, next: Math.max(0, j.next - s.height), done: j.done ?? 0 } : null; },
  /** Take a job: a delivery is settled at once; a defence contract starts its clock. */
  takeJob(id: string): string | null {
    adoptStored();
    const j = s.jobs, o = j?.offers.find((x) => x.id === id);
    if (!j || !o) return '없는 의뢰입니다';
    if (o.kind === 'deliver') {
      if (s.ore < o.need) return `광석 ${o.need} 단위 필요 (보유 ${Math.floor(s.ore)})`;
      s.ore -= o.need; s.alpha += o.reward; j.done = (j.done ?? 0) + 1;
      chronicle('cheong', `납품 의뢰 · 광석 ${o.need} → +${o.reward} α`);
    } else {
      if (j.active) return '이미 진행 중인 방어 의뢰가 있습니다';
      // Only raids that start after you sign count (no signing for a fight already won).
      j.active = { ...o, until: s.height + JOBS.defendFor, count: 0, taken: s.height + 1 };
    }
    j.offers = j.offers.filter((x) => x.id !== id);
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Blocks until an ability is ready (0 = now). */
  abilityLeft: (id: AbilityId) => Math.max(0, (s.cd?.[id] ?? 0) - s.height),
  get rallying() { return Math.max(0, (s.rallyUntil ?? 0) - s.height); },
  surgeCap,
  /** Use a commander ability (`rank` is the commander's rank index). */
  useAbility(id: AbilityId, rank: number): string | null {
    adoptStored();
    const a = ABILITIES.find((x) => x.id === id)!;
    if (rank < a.rank) return '계급이 부족합니다';
    const left = Math.max(0, (s.cd?.[id] ?? 0) - s.height);
    if (left) return `${a.name} 재사용까지 ${left}블록`;
    if (id === 'surge') {
      const cap = surgeCap();
      const amt = Math.min(s.ore, cap);
      if (amt <= 0) return '정제할 광석이나 가동 중인 정제소가 없습니다';
      s.ore -= amt; s.alpha += amt * RATE.alphaPerOre;
    } else if (id === 'overshield') {
      if (!s.raid) return '다가오는 습격이 없습니다';
      if (s.shield >= 100) return '방어막이 이미 가득합니다';
      s.shield = Math.min(100, s.shield + 40);
    } else { if (!s.raid || s.raid.eta > 0) return '습격 함대가 도착한 뒤에 쓰세요'; s.rallyUntil = s.height + 20; }
    s.cd = { ...s.cd, [id]: s.height + a.cooldown };
    log('event', `능력 · ${a.name}`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Why this hull can't take that refit now (null = it can). */
  refitBlocked(id: string, mod: RefitId): string | null {
    const x = s.structs.find((y) => y.id === id);
    if (!x || x.cat !== 'fleet') return '함대 함선만 개장할 수 있습니다';
    if (x.hp <= 0) return '파괴된 함선은 개장할 수 없습니다';
    if (x.building != null) return '건조가 끝나야 개장할 수 있습니다';
    if (x.mod === mod) return '이미 장착했습니다';
    if (s.alpha < REFITS[mod].cost) return `알파 ${REFITS[mod].cost} 필요`;
    return null;
  },
  refit(id: string, mod: RefitId): string | null {
    adoptStored();
    const why = demo.refitBlocked(id, mod); if (why) return why;
    const x = s.structs.find((y) => y.id === id)!;
    s.alpha -= REFITS[mod].cost;
    if (x.mod === 'armor') { x.max -= 2; x.hp = Math.min(x.hp, x.max); }
    x.mod = mod;
    if (mod === 'armor') { x.max += 2; x.hp += 2; }
    s.refits = (s.refits ?? 0) + 1;
    log('event', `개장 · ${TYPES_BY_ID[x.type].type} · ${REFITS[mod].name}`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Name a veteran ship (1–12 characters; empty clears it). */
  nameShip(id: string, name: string): string | null {
    adoptStored();
    const x = s.structs.find((y) => y.id === id);
    if (!x || vetRank(x.kills) < 1) return '베테랑 함선만 이름을 붙일 수 있습니다';
    const n = name.trim().slice(0, 12);
    x.name = n || undefined;
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Credit kills from a raid to the ships that scored them; returns the promotions (name, new rank). */
  creditKills(byId: Record<string, number>) {
    adoptStored();
    const up = creditInner(byId);
    persist(); for (const f of changeFns) f();
    return up;
  },
  get ally() { const id = allyId(); return id ? { id, left: s.ally!.until - s.height, name: rivals().find((r) => r.id === id)?.name ?? id } : null; },
  /** Buy an alliance with a rival for ALLY.term blocks. */
  formAlliance(id: string): string | null {
    adoptStored();
    const r = rivals().find((x) => x.id === id);
    if (!r) return '세력을 찾을 수 없습니다';
    if (r.vassal != null) return '속국과는 동맹을 맺지 않습니다 · 이미 당신의 것입니다';
    if (id === '1-666') return '붉은 연합은 누구와도 손잡지 않습니다';
    if (allyId()) return '이미 동맹이 있습니다';
    if (s.raid?.owner === id) return '지금 당신을 습격 중인 세력입니다';
    if (s.alpha < ALLY.cost) return `동맹 예물 ${ALLY.cost} g 필요`;
    s.alpha -= ALLY.cost; s.ally = { id, until: s.height + ALLY.term };
    if (s.bounty?.target === id) s.bounty = null; // no price on a friend's head
    chronicle('cheong', `${r.name}과(와) 동맹을 맺었다`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  get outposts() {
    const o = outposts(), strongest = Math.max(1, ...rivals().filter((r) => r.vassal == null && !((s.pacts?.[r.id] ?? 0) > s.height) && r.id !== allyId()).map((r) => r.fleet));
    // For a site you hold, `odds` is its chance to hold against the strongest free rival's attempt.
    return OUTPOSTS.map((d) => { const mine = o[d.id].owner === DEMO_ID, guard = warships() + 2 * lv('fort') + o[d.id].garrison * 2 + d.garrison; return { ...d, ...o[d.id], mine, odds: mine ? guard / (guard + strongest) : claimOdds(d.id) }; });
  },
  /** Send the fleet at an outpost: pay the sortie, roll against its defenders. */
  claimOutpost(id: OutpostId): { ok: boolean; text: string } | string {
    adoptStored();
    const o = outposts()[id], d = OUTPOSTS.find((x) => x.id === id)!;
    if (o.owner === DEMO_ID) return '이미 장악한 거점입니다';
    if (!warships()) return '출격할 전함이 없습니다';
    if (s.alpha < OUTPOST.claim) return `출격 비용 ${OUTPOST.claim} g 필요`;
    s.alpha -= OUTPOST.claim;
    // Taking a site from a pact partner or a vassal is an act of war, as a raid would be.
    const holder = o.owner && o.owner !== DEMO_ID ? rivals().find((r) => r.id === o.owner) : null;
    if (holder && holder.vassal != null) { holder.vassal = null; holder.raided = 0; chronicle('jeok', `${holder.name}의 거점을 노려 복속이 깨졌다`); }
    if (holder && (s.pacts?.[holder.id] ?? 0) > s.height) { delete s.pacts![holder.id]; s.rebel = holder.id; s.nextRaid = Math.min(s.nextRaid, 6); }
    const odds = claimOdds(id);
    s.ops = (s.ops ?? 0) + 1;
    const ok = rngFor(`claim:${s.height}:${id}:${s.ops}`)() < odds;
    let text: string;
    if (ok) { const was = o.owner; o.owner = DEMO_ID; o.garrison = 0; text = `${d.name} 장악 · ${d.perk}`; chronicle('hwang', `${d.name} 장악${was ? ` (${rivals().find((r) => r.id === was)?.name ?? '세력'}에게서)` : ''}`); }
    else {
      // A failed sortie costs a ship's worth of damage.
      const ship = s.structs.find((x) => x.cat === 'fleet' && x.type !== 1 && x.hp > 0 && x.building == null);
      if (ship) { ship.hp = Math.max(0, ship.hp - 2); if (ship.hp <= 0) { ship.online = false; ship.oc = false; } }
      text = `${d.name} 공략 실패 · 함선 손상`;
    }
    log('event', text);
    persist(); for (const f of changeFns) f();
    return { ok, text };
  },
  /** Fortify an outpost you hold. */
  fortify(id: OutpostId): string | null {
    adoptStored();
    const o = outposts()[id];
    if (o.owner !== DEMO_ID) return '장악한 거점만 요새화할 수 있습니다';
    if (o.garrison >= OUTPOST.maxGarrison) return '수비대가 최대입니다';
    if (s.alpha < OUTPOST.fortify) return `알파 ${OUTPOST.fortify} g 필요`;
    s.alpha -= OUTPOST.fortify; o.garrison++;
    persist(); for (const f of changeFns) f();
    return null;
  },
  get loan() { return s.loan ? { ...s.loan, left: Math.max(0, s.loan.due - s.height) } : null; },
  /** Borrow from 청룡 상단 (one loan at a time; not from a house you've made a vassal of… it won't lend). */
  borrow(g: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (s.loan) return '이미 갚을 대출이 있습니다';
    if ((s.loanBan ?? 0) > s.height) return `불이행 기록 · ${s.loanBan! - s.height}블록 뒤에 다시 빌릴 수 있습니다`;
    if (!Number.isFinite(g)) return '금액이 올바르지 않습니다';
    if (g <= 0 || g > LOAN.max) return `한 번에 최대 ${LOAN.max} g까지 빌릴 수 있습니다`;
    const lender = rivals().find((x) => x.id === '1-1004');
    if (lender?.vassal != null) return '속국은 돈을 빌려주지 않습니다';
    s.alpha += g; s.loan = { owed: Math.round(g * (1 + LOAN.rate) * 10) / 10, due: s.height + LOAN.term };
    log('event', `대출 ${g} g`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Pay the loan back early (in full). */
  repay(): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const l = s.loan;
    if (!l) return '갚을 대출이 없습니다';
    if (s.alpha < l.owed) return `상환에 ${l.owed.toFixed(1)} g 필요`;
    s.alpha -= l.owed; s.loan = null;
    const lender = rivals().find((x) => x.id === '1-1004'); if (lender) lender.alpha += l.owed;
    log('event', '대출 조기 상환');
    persist(); for (const f of changeFns) f();
    return null;
  },
  get race() {
    const r = s.race; if (!r) return null;
    const order = (Object.entries(r.pts) as [GuildId, number][]).sort((a, b) => b[1] - a[1]);
    return { order, left: Math.max(0, RACE.season - (s.height - r.start)), wins: s.raceWins ?? 0 };
  },
  get guild() { return s.guild ? { ...GUILDS.find((g) => g.id === s.guild!.id)!, xp: s.guild.xp, donated: s.guild.donated, level: guildLevel() } : null; },
  /** Join (or switch to) a guild. Switching costs the XP you built with the old one. */
  joinGuild(id: GuildId): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (s.guild?.id === id) return '이미 가입한 길드입니다';
    if (s.guild && s.alpha < 5) return '길드를 옮기려면 알파 5 g가 필요합니다';
    if (s.guild) s.alpha -= 5;
    s.guild = { id, xp: 0, donated: 0, joinedAt: s.height };
    log('guild', `${GUILDS.find((g) => g.id === id)!.name} 가입`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  donate(g: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (!s.guild) return '먼저 길드에 가입하세요';
    if (g <= 0 || s.alpha < g) return '알파가 부족합니다';
    const before = guildLevel();
    s.alpha -= g; s.guild.xp += g; s.guild.donated += g; raceAdd(g * 4);
    log('guild', `기부 ${g} g`);
    if (guildLevel() > before) emit('cheong', `길드 레벨 ${guildLevel()} 달성 · 채굴 +${3 * guildLevel()}%`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  guildAsk: () => (inGuild('gold') ? 1.02 : 1.05),
  get engine() { const st = engineStage(); return { stage: st, paid: s.engine?.paid ?? 0, next: ENGINE[st] ?? null, done: st >= ENGINE.length }; },
  /** Pour alpha into the World Engine; a stage completes when its cost is met. */
  buildEngine(g: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const st = engineStage();
    if (st >= ENGINE.length) return '월드 엔진이 이미 가동 중입니다';
    if (g <= 0) return '금액을 확인하세요';
    s.engine ??= { stage: 0, paid: 0 };
    const need = ENGINE.slice(0, st + 1).reduce((a, x) => a + x.cost, 0) - s.engine.paid;
    // Only what the stage still needs is charged.
    const pay = Math.min(g, need);
    if (s.alpha < pay) return '알파가 부족합니다';
    s.alpha -= pay; s.engine.paid += pay;
    if (pay >= need) {
      s.engine.stage++;
      log('engine', ENGINE[st].name);
      chronicle('hwang', `월드 엔진 · ${ENGINE[st].name} 완료`);
      emit(s.engine.stage >= ENGINE.length ? 'engine' : 'cheong', s.engine.stage >= ENGINE.length ? '월드 엔진 가동! 은하가 당신의 이름을 압니다' : `월드 엔진 · ${ENGINE[st].name} 완료 · ${ENGINE[st].perk}`);
    }
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** The open 결단, with its choices priced for now. */
  get decision() {
    const d = s.decision;
    if (!d) return null;
    const r = rivals().find((x) => x.id === d.rival) ?? rivals()[0];
    return { ...choicesOf(d.id, r), id: d.id, left: d.left };
  },
  decide,
  hegemony,
  get era() { return s.era ?? 0; },
  get streak() { return s.streak?.n ?? 0; },
  /** An interception under way holds the Void Fleet in place while the battle is fought. */
  holdBoss() { if (s.boss) { s.boss.engaged = s.height + 300; persist(); } },
  /** The Void Fleet while it's here, as a raid target the simulator understands. */
  get boss(): (Rival & { left: number; reward: number }) | null {
    if (!s.boss || (s.height > s.boss.until && !(s.boss.engaged && s.height <= s.boss.engaged))) return null;
    return { id: 'void', name: '공허 함대', tag: 'VOID', alpha: 0, ore: 0, fleet: Math.min(10, VOID.fleet + s.boss.n), growth: 0, raided: s.boss.n, left: Math.max(0, s.boss.until - s.height), reward: VOID.reward + 10 * s.boss.n };
  },
  get chronicle() { backfillChronicle(); return s.chronicle ?? []; },
  /** Begin a new era: once the World Engine runs, the galaxy starts over around a stronger base.
   * Kept: era (production +15% each), doctrine, guild, research, outposts, hired replicants, the
   * streak, the chronicle and running totals. Rivals grow 20% faster per era. */
  newEra(): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (engineStage() < ENGINE.length) return '월드 엔진을 완공해야 새 시대를 열 수 있습니다';
    if (s.raid) return '습격을 막아 낸 뒤에 새 시대를 열 수 있습니다';
    if (s.loan) return '청룡 상단 대출을 먼저 갚아야 새 시대를 열 수 있습니다';
    // Running totals survive too (daily orders and medals count from them).
    const keep = { era: (s.era ?? 0) + 1, jobs: s.jobs ? { offers: [], next: s.height, done: s.jobs.done, active: s.jobs.active } : undefined, black: s.black ? { next: s.black.next, until: 0, offers: [], deals: s.black.deals } : undefined, revengeWins: s.revengeWins, refits: s.refits, coalitions: s.coalitions, coalitionWins: s.coalitionWins, cd: s.cd, ally: s.ally, outposts: s.outposts, streak: s.streak, reps: s.reps, voidKills: s.voidKills, race: s.race, raceWins: s.raceWins, chronicle: s.chronicle, decided: s.decided, raidsRepelled: s.raidsRepelled, earned: s.earned, bountiesClaimed: s.bountiesClaimed, tribute: s.tribute, hegemonyBest: Math.max(s.hegemonyBest ?? 0, s.hegemonyTier ?? 0), doctrine: s.doctrine, guild: s.guild, tech: s.tech, height: s.height };
    s = fresh();
    Object.assign(s, keep);
    log('event', `제${keep.era + 1}시대 개막`);
    emit('era', String(keep.era));
    chronicle('hwang', `제${keep.era + 1}시대가 열렸다 · 생산 +${15 * keep.era}%`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  get doctrine() { return s.doctrine ?? null; },
  /** Take up a doctrine (free the first time). */
  adopt(id: DoctrineId): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (s.doctrine === id) return '이미 따르는 교리입니다';
    if (s.doctrine && s.alpha < DOCTRINE_SWITCH) return `교리 전환에 알파 ${DOCTRINE_SWITCH} g 필요`;
    if (s.doctrine) s.alpha -= DOCTRINE_SWITCH;
    s.doctrine = id;
    log('event', `교리 · ${DOCTRINES.find((d) => d.id === id)!.name}`);
    chronicle('cheong', `${DOCTRINES.find((d) => d.id === id)!.name}를 따르기로 했다`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  get bounty() { return s.bounty && s.height <= s.bounty.until ? { ...s.bounty, left: s.bounty.until - s.height } : null; },
  get powerHist() { return s.powerHist ?? []; },
  get war() { return s.war && s.height - s.war.at < 12 ? s.war : null; },
  get news() { return s.news ?? []; },
  get hegemonyTier() { return s.hegemonyTier ?? 0; },
  pactLeft: (id: string) => Math.max(0, (s.pacts?.[id] ?? 0) - s.height),
  get event() { return s.event ? { ...EVENTS[s.event.id], id: s.event.id, left: s.event.left } : null; },
  /** Buy power from the market: capacity now, alpha every block, at the ask (price + 5%). */
  buy(kw: number, blocks: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (kw <= 0 || blocks <= 0) return '수량을 확인하세요';
    const rate = s.priceHist[s.priceHist.length - 1] * (inGuild('gold') ? 1.02 : 1.05);
    if (s.alpha < kw * rate * 3) return '알파가 부족합니다 (최소 3블록치)';
    s.contracts.push({ id: `11-${300 + s.seq}`, kw, rate, left: blocks, buyer: ['3-15', '1-77', '3-88'][s.seq % 3], dir: 'buy' });
    // Demand lifts the price for the next buyer.
    s.priceHist.push(s.priceHist[s.priceHist.length - 1] * (1 + Math.min(0.3, 0.02 * kw)));
    log('agreement_open', `구매 ${kw} kW × ${blocks}`);
    persist(); for (const f of changeFns) f();
    return null;
  },

  /* ── Power standings and counter-raids ── */
  rivals,
  /** What a base is worth: alpha, ore at refinery value, standing structs, research. */
  netWorth() {
    const structs = s.structs.filter((x) => x.hp > 0 && x.building == null).reduce((a, x) => a + (TYPES_BY_ID[x.type]?.buildDifficulty ?? 0) / 100, 0);
    const tech = Object.values(s.tech ?? {}).reduce((a, l) => a + (l ?? 0) * 6, 0);
    const dominion = rivals().filter((r) => r.vassal != null).reduce((a, r) => a + rivalWorth(r) * 0.25, 0);
    const sites = OUTPOSTS.filter((d) => holds(d.id)).length * 40;
    return s.alpha + s.ore * 0.6 + structs + tech + dominion + sites + (s.engine?.paid ?? 0) + (engineStage() >= 3 ? 1000 : 0);
  },
  /** Alpha a block from vassals, now (their average growth × the tribute share). */
  vassalCap,
  tributeOf,
  sellBonus,
  /** What the posted bounty pays you now (the war doctrine adds half). */
  bountyPayout: () => (s.bounty ? Math.round(s.bounty.reward * (doc('war') ? 1.5 : 1)) : 0),
  get tributeTotal() { return s.tribute ?? 0; },
  /** 0 (about to rebel) … 1 (disarmed): how far a vassal's fleet is from rising again. */
  loyalty: (r: Rival) => Math.max(0, Math.min(1, (DOMINION.rebelFleet - r.fleet) / (DOMINION.rebelFleet - 2))),
  /** Make a thrice-raided rival a vassal. */
  subjugate(id: string): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const r = rivals().find((x) => x.id === id);
    if (!r) return '세력을 찾을 수 없습니다';
    if (r.vassal != null) return '이미 복속한 세력입니다';
    if (s.raid?.owner === id) return '이 세력의 함대가 습격 중입니다. 먼저 격퇴하세요';
    if (r.raided < DOMINION.raidsToSubjugate) return `약탈 ${DOMINION.raidsToSubjugate}회 후에 복속을 요구할 수 있습니다`;
    if (rivals().filter((x) => x.vassal != null).length >= vassalCap()) return `속국은 ${vassalCap()}곳까지 · 패권 칭호를 올리면 늘어납니다`;
    if (s.alpha < DOMINION.cost) return `주둔군 알파 ${DOMINION.cost} g 필요`;
    // The terms of surrender: the fleet is cut down to a garrison's worth.
    s.alpha -= DOMINION.cost; r.vassal = s.height; r.fleet = Math.min(r.fleet, 4);
    chronicle('hwang', `${r.name}이(가) 무릎을 꿇었다`);
    log('raid_status', `${r.name} 복속`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  /** Scrap one of a vassal's ships: loyalty bought with alpha. */
  disarm(id: string): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const r = rivals().find((x) => x.id === id);
    if (!r || r.vassal == null) return '복속한 세력만 무장 해제할 수 있습니다';
    if (r.fleet <= 2) return '더 해체할 함선이 없습니다';
    if (s.alpha < DOMINION.disarmCost) return `알파 ${DOMINION.disarmCost} g 필요`;
    s.alpha -= DOMINION.disarmCost; r.fleet--;
    persist(); for (const f of changeFns) f();
    return null;
  },
  rivalWorth,
  /** The demo fleet as simulator units (player side), with the map back to demo struct ids. */
  fleetUnits(): { units: Unit[]; ids: Record<string, string> } {
    const ids: Record<string, string> = {};
    const units: Unit[] = s.structs.filter((x) => x.cat === 'fleet' && x.hp > 0 && x.building == null).map((x) => {
      const id = 'player-' + (x.type === 1 ? 'cmd' : `${x.ambit}-${x.slot}`);
      ids[id] = x.id;
      return { id, side: 'player', type: x.type, ambit: x.ambit, slot: x.slot, protects: null, health: x.hp };
    });
    return { units, ids };
  },
  /** Settle a counter-raid: the fleet comes home as hurt as it fought; a win loots the rival. */
  settleRaid(rivalId: string, won: boolean, hp: Record<string, number>, kills: Record<string, number> = {}): { ore: number; alpha: number; promoted?: ReturnType<typeof creditInner> } {
    adoptStored(); // another tab may have moved on: act on the newest base
    // Held still while settling: the bounty, grant and promotion it sets off must not swap the base.
    busy++;
    try {
    const promoted = creditInner(kills);
    for (const x of s.structs) if (x.id in hp) {
      // The battle engine caps a hull at its type's maximum; armour above that rides along and
      // comes home with a ship that survives.
      const extra = Math.max(0, x.hp - TYPES_BY_ID[x.type].maxHealth);
      x.hp = hp[x.id] > 0 ? Math.min(x.max, hp[x.id] + extra) : 0; if (x.hp <= 0) x.online = false;
    }
    if (rivalId === 'void') {
      if (!won || !s.boss) { if (s.boss) s.boss.engaged = undefined; persist(); for (const f of changeFns) f(); return { ore: 0, alpha: 0, promoted }; }
      const g = VOID.reward + 10 * s.boss.n;
      s.alpha += g; s.voidKills = (s.voidKills ?? 0) + 1; s.boss = null; s.nextBoss = s.height + VOID.every;
      chronicle('hwang', `공허 함대 격파 · 전리품 +${g} α`);
      log('raid_status', `공허 함대 격파 +${g} α`);
      persist(); for (const f of changeFns) f();
      return { ore: 0, alpha: g, promoted };
    }
    const r = rivals().find((y) => y.id === rivalId);
    let loot = { ore: 0, alpha: 0 };
    // Raiding your own vassal tears up the treaty and starts the count again; raiding under a pact
    // breaks the pact, and they will answer.
    if (r?.vassal != null) { r.vassal = null; r.raided = 0; log('raid_status', `${r.name} 복속 파기`); }
    if (r && (s.pacts?.[r.id] ?? 0) > s.height) { delete s.pacts![r.id]; s.rebel = r.id; s.nextRaid = Math.min(s.nextRaid, 6); log('raid_status', `${r.name} 불가침 파기`); }
    if (won && r && s.bounty?.target === r.id && s.height <= s.bounty.until) {
      const b = s.bounty; s.bounty = null;
      b.reward = Math.round(b.reward * (doc('war') ? 1.5 : 1));
      s.alpha += b.reward; s.bountiesClaimed = (s.bountiesClaimed ?? 0) + 1; raceAdd(25);
      chronicle('cheong', `현상금 ${b.reward} α 수령 · ${r.name} 약탈`);
      const patron = rivals().find((x) => x.id === b.patron);
      log('raid_status', `현상금 +${b.reward} α`);
      emit('bounty', `${patron?.name ?? '의뢰인'}이(가) 현상금 ${b.reward} α를 지급했습니다`);
    }
    // A counter-raid inside the window takes more; win or lose, the opening is spent.
    const rev = !!r && s.revenge?.rival === r.id && s.height <= s.revenge.until;
    if (rev) s.revenge = null;
    if (won && r) {
      loot = { ore: Math.min(Math.floor(r.ore), Math.floor(r.ore * 0.6 * (inGuild('iron') ? 1.25 : 1) * (doc('war') ? 1.3 : 1) * (rev ? REVENGE.bonus : 1))), alpha: 0 };
      if (rev) { chronicle('cheong', `보복 성공 · ${r.name} 약탈 ${loot.ore}`); s.revengeWins = (s.revengeWins ?? 0) + 1; }
      r.ore -= loot.ore; r.fleet = Math.max(2, r.fleet - 1); r.raided++; r.grudge = Math.min(GRUDGE.max, (r.grudge ?? 0) + 1);
      s.ore += loot.ore;
      log('raid_status', `${r.name} 약탈 +${loot.ore}`);
    } else log('raid_status', `${r?.name ?? rivalId} 습격 실패`);
    persist(); for (const f of changeFns) f();
    return { ...loot, promoted };
      } finally { busy--; }
  },
  level: (t: TechId) => lv(t),
  /** Alpha won outside the base (a campaign clear): straight into the treasury, written in the chronicle. */
  grant(g: number, why: string) {
    adoptStored(); // another tab may have moved on: act on the newest base
    s.alpha += g;
    chronicle('cheong', `${why} · +${g} α`);
    log('event', `${why} +${g} α`);
    persist(); for (const f of changeFns) f();
  },
  /** Pay alpha for something outside the base (scouting); false when short. */
  spend(g: number): boolean {
    adoptStored(); // another tab may have moved on: act on the newest base
    if (s.alpha < g) return false;
    s.alpha -= g;
    persist(); for (const f of changeFns) f();
    return true;
  },
  /** Buy the next level of a technology. `rank` is the commander's rank index. */
  research(t: TechId, rank: number): string | null {
    adoptStored(); // another tab may have moved on: act on the newest base
    const tech = TECH.find((x) => x.id === t)!;
    const l = lv(t);
    if (l >= tech.max) return '이미 최고 단계입니다';
    if (rank < tech.rank) return `계급이 부족합니다`;
    const c = tech.cost[l];
    if (s.alpha < c) return `알파 ${c} g 필요`;
    s.alpha -= c;
    s.tech = { ...s.tech, [t]: l + 1 };
    log('research', `${tech.name} ${l + 1}단계`);
    persist(); for (const f of changeFns) f();
    return null;
  },
  get price() { return s.priceHist[s.priceHist.length - 1]; },
  get priceHist() { return s.priceHist; },
};

// Dev only: a handle for driving the demo from the console (raids on demand while testing).
if (import.meta.env?.DEV) (window as unknown as { __demo: typeof demo }).__demo = demo;
