/* Medals: earned from career stats and the demo base, announced the moment they're won, listed in
 * the service record. Which ones were already announced is kept per career in this browser. */
import { career } from './progress';
import { demo } from './demo';
import { banner } from './fx';
import { sfx } from './sfx';
import { tutorialDone } from './progress';

export interface Medal { id: string; icon: number; name: string; how: string; earned: () => boolean }
export const MEDALS: Medal[] = [
  { id: 'win1', icon: 3, name: '첫 승리', how: '모의전 1승', earned: () => career.stats.simWins >= 1 },
  { id: 'stars3', icon: 2, name: '완벽주의자', how: '3성 승리', earned: () => career.stats.simStars >= 3 },
  { id: 'gauntlet', icon: 1, name: '연전 제패', how: '5연전 완주', earned: () => career.stats.gauntlets >= 1 },
  { id: 'kills50', icon: 12, name: '격추왕', how: '누적 격파 50기', earned: () => career.stats.kills >= 50 },
  { id: 'wall', icon: 19, name: '철벽', how: '습격 5회 격퇴', earned: () => demo.on && demo.state.raidsRepelled >= 5 },
  { id: 'scholar', icon: 15, name: '연구자', how: '연구 5단계', earned: () => career.stats.research >= 5 },
  { id: 'merchant', icon: 17, name: '상인', how: '전력 판매 계약', earned: () => demo.on && demo.state.earned > 0 },
  { id: 'overlord', icon: 1, name: '패왕', how: '경쟁 세력 2곳 복속', earned: () => demo.on && demo.rivals().filter((r) => r.vassal != null).length >= 2 },
  { id: 'architect', icon: 20, name: '건설자', how: '월드 엔진 완공', earned: () => demo.on && (demo.engine.done || demo.era >= 1) },
  { id: 'hunter', icon: 8, name: '현상금 사냥꾼', how: '현상금 3회 수령', earned: () => demo.on && (demo.state.bountiesClaimed ?? 0) >= 3 },
  { id: 'emperor', icon: 1, name: '은하 황제', how: '패권 지수 70% 돌파', earned: () => demo.on && demo.hegemonyTier >= 4 },
  { id: 'tributary', icon: 17, name: '조공의 주인', how: '누적 공물 100 α', earned: () => demo.on && demo.tributeTotal >= 100 },
  { id: 'voidbane', icon: 2, name: '공허 사냥꾼', how: '공허 함대 격파', earned: () => demo.on && (demo.state.voidKills ?? 0) >= 1 },
  { id: 'era2', icon: 20, name: '새 시대', how: '제2시대 개막', earned: () => demo.on && demo.era >= 1 },
  { id: 'creed', icon: 15, name: '신념', how: '교리 채택', earned: () => demo.on && !!demo.doctrine },
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
demo.onBlock(checkMedals);
