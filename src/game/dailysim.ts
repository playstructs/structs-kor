/* Your daily-challenge record, kept in this browser: your best result per day (and its code), how
 * many times you played, the call sign your codes carry, and the results friends have sent you.
 * Each friend's result was replayed before it got here. */
import type { DailyResult } from '../sim/daily';
import { dayBefore } from '../sim/daily';

export interface Entry { score: number; stars: number; winner: DailyResult['winner']; blocks: number; code: string; mine: boolean[]; theirs: boolean[] }
export interface Friend extends Entry { name: string }
interface State { name: string; days: Record<string, { plays: number; best?: Entry }>; friends: Record<string, Friend[]> }

const KEY = 'structs-kor.dailysim';
const fresh = (): State => ({ name: '', days: {}, friends: {} });
function load(): State {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && typeof s === 'object' && s.days ? { ...fresh(), ...s } : fresh(); } catch { return fresh(); }
}
let s = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: this visit only */ } };
const entry = (r: DailyResult, code: string): Entry => ({ score: r.score, stars: r.stars, winner: r.winner, blocks: r.blocks, code, mine: r.mine, theirs: r.theirs });

export const dailySim = {
  get name() { return s.name; },
  setName(n: string) { s.name = [...n.replace(/[\u0000-\u001f<>]/g, '').trim()].slice(0, 16).join(''); save(); },
  day: (day: string) => s.days[day] ?? { plays: 0 },
  /** Record a play; true when it's the day's new best. */
  record(r: DailyResult, code: string): boolean {
    const d = (s.days[r.day] ??= { plays: 0 });
    d.plays++;
    const best = !d.best || r.score > d.best.score;
    if (best) d.best = entry(r, code);
    save();
    return best;
  },
  /** Days in a row with a play, counting back from today (or from yesterday, before today's play). */
  streak(today: string): number {
    let day = s.days[today]?.plays ? today : dayBefore(today), n = 0;
    while (s.days[day]?.plays) { n++; day = dayBefore(day); }
    return n;
  },
  friends: (day: string) => (s.friends[day] ?? []).slice().sort((a, b) => b.score - a.score),
  /** Keep a friend's (already replayed) result; one per call sign, their best. */
  addFriend(day: string, name: string, r: DailyResult, code: string) {
    const list = (s.friends[day] ??= []);
    const who = name || '익명';
    const i = list.findIndex((f) => f.name === who);
    if (i >= 0 && list[i].score >= r.score) return;
    const f = { ...entry(r, code), name: who };
    if (i >= 0) list[i] = f; else list.push(f);
    s.friends[day] = list.sort((a, b) => b.score - a.score).slice(0, 50);
    save();
  },
};
