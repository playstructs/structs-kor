/* Medals: earned from career stats (simulator, tutorial and real raids beaten back), announced the moment they're won, listed in
 * the service record. Which ones were already announced is kept per career in this browser. */
import { career } from './progress';
import { banner } from './fx';
import { sfx } from './sfx';
import { tutorialDone } from './progress';

export interface Medal { id: string; icon: number; name: string; how: string; earned: () => boolean }
export const MEDALS: Medal[] = [
  { id: 'win1', icon: 3, name: '첫 승리', how: '모의전 1승', earned: () => career.stats.simWins >= 1 },
  { id: 'stars3', icon: 2, name: '완벽주의자', how: '3성 승리', earned: () => career.stats.simStars >= 3 },
  { id: 'gauntlet', icon: 1, name: '연전 제패', how: '5연전 완주', earned: () => career.stats.gauntlets >= 1 },
  { id: 'kills50', icon: 12, name: '격추왕', how: '누적 격파 50기', earned: () => career.stats.kills >= 50 },
  { id: 'guard1', icon: 19, name: '첫 방어', how: '행성 습격 격퇴', earned: () => career.stats.repelled >= 1 },
  { id: 'wall', icon: 19, name: '철벽', how: '습격 5회 격퇴', earned: () => career.stats.repelled >= 5 },
  { id: 'cadet', icon: 16, name: '훈련 수료', how: '전투 훈련 이수', earned: () => tutorialDone() },
];

const KEY = 'structs-kor.medals.announced';
const announced = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };

/** Announce any medal won since the last look. The first look only records what's already held. */
export function checkMedals() {
  const seen = announced();
  let first = false;
  try { first = !localStorage.getItem(KEY); } catch { return; }
  const fresh = MEDALS.filter((m) => m.earned() && !seen.has(m.id));
  if (!fresh.length) { if (first) try { localStorage.setItem(KEY, '[]'); } catch { /* fine */ } return; }
  for (const m of fresh) seen.add(m.id);
  try { localStorage.setItem(KEY, JSON.stringify([...seen])); } catch { /* fine */ }
  if (first) return;
  const m = fresh[0];
  setTimeout(() => { sfx.play('levelup'); banner({ kicker: '훈장 획득', title: m.name, sub: m.how, tone: 'gold', ms: 2600 }); }, 900);
}

career.onChange(checkMedals);
