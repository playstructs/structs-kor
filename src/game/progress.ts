/* Career: rank, XP and the campaign of objectives. XP is earned in this client (objectives claimed,
 * simulator battles won) and kept per commander in this browser; the objectives themselves are
 * checked against live game state, so they can't be faked by clicking. */
import { banner, notify } from './fx';
import { sfx } from './sfx';
import type { Dashboard } from '../api/planned';
import { demo } from './demo';

export const RANKS = ['이병', '일병', '상병', '병장', '하사', '중사', '상사', '소위', '중위', '대위', '소령', '중령', '대령', '준장', '소장', '중장', '대장', '원수'] as const;
/** Cumulative XP needed to hold rank i. */
export const threshold = (i: number) => (i <= 0 ? 0 : Math.round(60 * Math.pow(i, 1.75)));
/** What each rank unlocks, said on promotion (flavour; the chain has no ranks). */
const PERKS: Record<number, string> = {
  3: '함교 위협 레이더 해금', 7: '장교 진급 · 일일 교전 랭킹 표시', 10: '전력망 워게임 고급 분석', 11: '대위 이상 · 길드 작전 지휘', 13: '장성 진급 · 금빛 휘장', 17: '은하 원수',
};

export interface Stats { simWins: number; simStars: number; simBattles: number; dailyPlays: number; shotsHit: number; kills: number; contracts: number; research: number; gauntlets: number; perfect: number }
interface Saved { xp: number; claimed: string[]; stats: Stats }
const blank = (): Saved => ({ xp: 0, claimed: [], stats: { simWins: 0, simStars: 0, simBattles: 0, dailyPlays: 0, shotsHit: 0, kills: 0, contracts: 0, research: 0, gauntlets: 0, perfect: 0 } });

let who = 'guest';
const key = () => `structs-kor.career.${who}`;
function load(): Saved {
  try { const v = JSON.parse(localStorage.getItem(key()) || 'null'); return v ? { ...blank(), ...v, stats: { ...blank().stats, ...v.stats } } : blank(); } catch { return blank(); }
}
let s = load();
const save = () => { try { localStorage.setItem(key(), JSON.stringify(s)); } catch { /* storage refused */ } };
const fns = new Set<() => void>();
const emit = () => { for (const f of fns) f(); };

export function rankOf(xp: number) {
  let i = 0;
  while (i < RANKS.length - 1 && xp >= threshold(i + 1)) i++;
  const lo = threshold(i), hi = threshold(i + 1);
  return { i, name: RANKS[i], xp, into: xp - lo, need: hi - lo, pct: i === RANKS.length - 1 ? 1 : (xp - lo) / (hi - lo) };
}

export const career = {
  /** Whose career this is: 'guest', 'demo' or a player id. */
  get who() { return who; },
  get xp() { return s.xp; },
  get rank() { return rankOf(s.xp); },
  get stats() { return s.stats; },
  claimed: (id: string) => s.claimed.includes(id),
  onChange(f: () => void) { fns.add(f); return () => fns.delete(f); },
  /** Switch to a commander's career (guest until someone signs in). */
  use(id: string | null) { const next = id || 'guest'; if (next === who) return; who = next; s = load(); emit(); },
  award(xp: number, why: string) {
    if (xp <= 0) return;
    const before = rankOf(s.xp).i;
    s.xp += xp; save();
    const after = rankOf(s.xp);
    notify(`+${xp} XP`, why, 'hwang', 'coin');
    if (after.i > before) {
      // A promotion also pays the demo base: 5 α a rank (each rank pays once per career).
      const bonus = demo.on ? Array.from({ length: after.i - before }, (_, k) => 5 * (before + k + 1)).reduce((a, x) => a + x, 0) : 0;
      if (bonus) demo.grant(bonus, `${after.name} 진급 상여`);
      setTimeout(() => {
        sfx.play('levelup');
        banner({ kicker: '진급', title: after.name, sub: `${PERKS[after.i] ?? `${RANKS[before]} → ${after.name}`}${bonus ? ` · 상여 +${bonus} α` : ''}`, tone: 'gold', ms: 3200 });
      }, 400);
    }
    emit();
  },
  bump(k: keyof Stats, by = 1) { s.stats[k] += by; save(); emit(); },
  claim(id: string) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m || s.claimed.includes(id)) return;
    s.claimed.push(id); save();
    career.award(m.xp, `작전 완료 · ${m.title}`);
  },
};

/* ── Objectives ─────────────────────────────────────────────────────────── */

export interface Ctx { dash: Dashboard | null; backedUp: boolean; tutorial: boolean; signedIn: boolean }
export interface Mission { id: string; title: string; hint: string; xp: number; href?: string; check: (c: Ctx, st: Stats) => [number, number] }

const has = (d: Dashboard | null, type: number, online = false) => (d?.structs ?? []).some((x) => x.type === type && !(x.status & 32) && (!online || (x.status & 4) !== 0));
const count = (d: Dashboard | null) => (d?.structs ?? []).filter((x) => !(x.status & 32)).length;
const g = (v: unknown) => Number(v ?? 0) / 1e6;

export const MISSIONS: Mission[] = [
  { id: 'tutorial', title: '전투 훈련 수료', hint: '훈련소에서 기본 전투를 익히세요', xp: 60, href: '/tutorial', check: (c) => [c.tutorial ? 1 : 0, 1] },
  { id: 'sim1', title: '첫 모의전 승리', hint: '시뮬레이터에서 컴퓨터 함대를 꺾으세요', xp: 80, href: '/sim', check: (_, st) => [Math.min(1, st.simWins), 1] },
  { id: 'enlist', title: '사령관 입대', hint: '지갑을 만들고 길드에 등록하세요', xp: 100, href: '/start', check: (c) => [c.signedIn ? 1 : 0, 1] },
  { id: 'backup', title: '복구 문구 확보', hint: '내 정보에서 복구 문구를 확인하세요', xp: 50, href: '/profile', check: (c) => [c.backedUp ? 1 : 0, 1] },
  { id: 'miner', title: '광석 추출기 가동', hint: '지상 또는 수상 슬롯에 추출기를 세우세요', xp: 120, href: '/console', check: (c) => [has(c.dash, 14, true) ? 1 : 0, 1] },
  { id: 'refinery', title: '정제소 가동', hint: '광석은 약탈되지만 알파는 안전합니다', xp: 150, href: '/console', check: (c) => [has(c.dash, 15, true) ? 1 : 0, 1] },
  { id: 'stars3', title: '3성 완벽 승리', hint: '손실을 줄이고 60블록 안에 끝내세요', xp: 200, href: '/sim', check: (_, st) => [st.simStars >= 3 ? 1 : 0, 1] },
  { id: 'base6', title: '기지 6기 확장', hint: '행성과 함대에 구조체 6기', xp: 180, href: '/console', check: (c) => [Math.min(6, count(c.dash)), 6] },
  { id: 'alpha10', title: '알파 매터 10 g 비축', hint: '정제한 알파는 전력이 되고 거래됩니다', xp: 160, href: '/market', check: (c) => [Math.min(10, Math.floor(g(c.dash?.player.alpha))), 10] },
  { id: 'grid', title: '안정적인 전력망', hint: '구조체를 돌리며 사용률 80% 이하', xp: 120, href: '/energy', check: (c) => {
    const p = c.dash?.power; if (!p || !count(c.dash)) return [0, 1];
    return [Number(p.total_load) / Math.max(1, Number(p.total_capacity)) <= 0.8 ? 1 : 0, 1];
  } },
  { id: 'defense', title: '행성 방어포 배치', hint: '습격에 대비해 방어포를 세우세요', xp: 150, href: '/console', check: (c) => [has(c.dash, 19) ? 1 : 0, 1] },
  { id: 'sim10', title: '모의전 10승', hint: '전술을 다듬으세요', xp: 300, href: '/sim', check: (_, st) => [Math.min(10, st.simWins), 10] },
  { id: 'kills50', title: '격파 50기', hint: '모의전 누적 격파', xp: 350, href: '/sim', check: (_, st) => [Math.min(50, st.kills), 50] },
  { id: 'guild', title: '길드 가입', hint: '길드에 들어가 이점을 받으세요', xp: 70, href: '/guild', check: (c) => [c.signedIn || (demo.on && demo.guild) ? 1 : 0, 1] },
  { id: 'research3', title: '연구 3단계', hint: '연구소에서 알파로 기지를 강화하세요', xp: 150, href: '/research', check: (_, st) => [Math.min(3, st.research), 3] },
  { id: 'gauntlet', title: '연전 제패', hint: '5연전을 끝까지 살아남으세요', xp: 400, href: '/sim', check: (_, st) => [Math.min(1, st.gauntlets), 1] },
  { id: 'daily', title: '일일 교전 참가', hint: '모든 사령관과 같은 시드로 겨루세요', xp: 90, href: '/sim', check: (_, st) => [Math.min(1, st.dailyPlays), 1] },
];

export interface MissionState extends Mission { done: number; of: number; ready: boolean; claimed: boolean }
export function missions(c: Ctx): MissionState[] {
  return MISSIONS.map((m) => {
    const [done, of] = m.check(c, s.stats);
    return { ...m, done, of, ready: done >= of && !s.claimed.includes(m.id), claimed: s.claimed.includes(m.id) };
  });
}
/** The few objectives worth showing now: claimable first, then the closest to done. */
export function activeMissions(c: Ctx, n = 4): MissionState[] {
  return missions(c).filter((m) => !m.claimed).sort((a, b) => Number(b.ready) - Number(a.ready) || b.done / b.of - a.done / a.of).slice(0, n);
}
export const tutorialDone = () => { try { return !!localStorage.getItem('structs-kor.tutorial'); } catch { return false; } };
