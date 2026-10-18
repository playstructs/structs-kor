/* 일일 임무: three orders a day, picked by the date (everyone gets the same ones), measured as
 * progress since the day began, 40 XP each and a bonus for all three. Resets at local midnight. */
import { career } from './progress';
import { demo } from './demo';
import { hash32, mulberry } from '../core/util';

interface Order { id: string; title: string; target: number; demoOnly?: boolean; value: () => number }
const ORDERS: Order[] = [
  { id: 'wins', title: '모의전 2승', target: 2, value: () => career.stats.simWins },
  { id: 'kills', title: '적 구조체 10기 격파', target: 10, value: () => career.stats.kills },
  { id: 'battles', title: '전투 3회 출격', target: 3, value: () => career.stats.simBattles },
  { id: 'repel', title: '습격 1회 격퇴', target: 1, demoOnly: true, value: () => (demo.on ? demo.state.raidsRepelled : 0) },
  { id: 'trade', title: '전력 판매로 2 α 벌기', target: 2, demoOnly: true, value: () => (demo.on ? demo.state.earned : 0) },
  { id: 'research', title: '연구 1단계 완료', target: 1, demoOnly: true, value: () => career.stats.research },
  { id: 'stars', title: '모의전에서 별 3개 받기', target: 1, value: () => career.stats.perfect },
  { id: 'decide', title: '결단 2회 내리기', target: 2, demoOnly: true, value: () => (demo.on ? demo.state.decided ?? 0 : 0) },
  { id: 'bounty', title: '현상금 1회 수령', target: 1, demoOnly: true, value: () => (demo.on ? demo.state.bountiesClaimed ?? 0 : 0) },
  { id: 'tribute', title: '공물 5 α 받기', target: 5, demoOnly: true, value: () => (demo.on ? demo.tributeTotal : 0) },
];
export const DAILY_XP = 40, DAILY_BONUS = 100;

interface Day { date: string; base: Record<string, number>; picks: string[]; claimed: string[]; bonus: boolean }
const key = () => `structs-kor.daily.${career.who}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function load(): Day {
  let d: Day | null = null;
  try { d = JSON.parse(localStorage.getItem(key()) || 'null'); } catch { /* fine */ }
  if (d && d.date === today()) return d;
  // A new day: three orders by the date, from the ones this commander can actually do.
  const pool = ORDERS.filter((o) => demo.on || !o.demoOnly);
  const r = mulberry(hash32('daily:' + today()));
  const picks: string[] = [];
  while (picks.length < 3 && picks.length < pool.length) { const o = pool[Math.floor(r() * pool.length)]; if (!picks.includes(o.id)) picks.push(o.id); }
  const fresh: Day = { date: today(), base: Object.fromEntries(ORDERS.map((o) => [o.id, o.value()])), picks, claimed: [], bonus: false };
  save(fresh);
  return fresh;
}
const save = (d: Day) => { try { localStorage.setItem(key(), JSON.stringify(d)); } catch { /* fine */ } };

export interface DailyState { id: string; title: string; done: number; target: number; ready: boolean; claimed: boolean }
export function dailyOrders(): { orders: DailyState[]; bonusReady: boolean; bonusClaimed: boolean; resetsIn: string } {
  const d = load();
  const orders = d.picks.map((id) => {
    const o = ORDERS.find((x) => x.id === id)!;
    const done = Math.max(0, Math.min(o.target, o.value() - (d.base[id] ?? 0)));
    return { id, title: o.title, done, target: o.target, ready: done >= o.target && !d.claimed.includes(id), claimed: d.claimed.includes(id) };
  });
  const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
  const mins = Math.max(0, Math.round((midnight.getTime() - Date.now()) / 60000));
  return { orders, bonusReady: orders.every((o) => o.claimed) && !d.bonus, bonusClaimed: d.bonus, resetsIn: `${Math.floor(mins / 60)}시간 ${mins % 60}분` };
}
export function claimDaily(id: string) {
  const d = load();
  if (d.claimed.includes(id) || !dailyOrders().orders.find((o) => o.id === id)?.ready) return;
  d.claimed.push(id); save(d);
  career.award(DAILY_XP, '일일 임무 완료');
}
export function claimDailyBonus() {
  const d = load();
  if (d.bonus || !d.picks.every((id) => d.claimed.includes(id))) return;
  d.bonus = true; save(d);
  career.award(DAILY_BONUS, '일일 임무 전부 완료');
}
