/* 통신: rival commanders speak. A short transmission with their portrait slides in when they act
 * (a raid launched or broken, a rebellion, a surrender, a bounty). Each has a voice of their own. */
import { portraitHtml, seededPfp } from './portrait';
import { sfx } from './sfx';
import { reduced } from './fx';

export type Moment = 'raid' | 'repelled' | 'won' | 'rebel' | 'submit' | 'bounty';
const VOICE: Record<string, Partial<Record<Moment, string[]>>> = {
  '1-666': { // 붉은 연합: loud, aggressive
    raid: ['광석 냄새가 여기까지 나는군. 전부 내놔라.', '붉은 연합이 간다. 방어막이나 단단히 해 둬.'],
    repelled: ['이번엔 운이 좋았다. 다음엔 두 배로 온다.', '함선 하나쯤이야. 기억해 두지.'],
    won: ['고맙다, 광석은 잘 쓰마.', '그 정도 방어로 행성을 지킨다고?'],
    rebel: ['붉은 연합은 누구에게도 무릎 꿇지 않는다!'],
    submit: ['…좋다. 이번만은 네 깃발 아래 서지.'],
    bounty: ['검은 별 놈들을 박살 내 주면 섭섭지 않게 쳐 주지.'],
  },
  '1-313': { // 검은 별 길드: cold, calculating
    raid: ['계산은 끝났다. 너의 정제소가 가장 약하다.', '저항은 비효율적이다.'],
    repelled: ['변수가 하나 늘었군. 다시 계산한다.', '흥미롭군. 수정하겠다.'],
    won: ['예측대로다.', '광석 수거 완료. 감사한다.'],
    rebel: ['조건이 바뀌었다. 계약은 종료다.'],
    submit: ['합리적인 선택이다. 공물은 정확히 보내겠다.'],
    bounty: ['청룡 상단은 너무 커졌다. 균형을 맞춰 주면 보상하지.'],
  },
  '1-87': { // 해적 87호: pirate slang
    raid: ['크하하! 털어 먹기 좋은 행성 발견!', '돛 올려라, 녀석들! 광석 파티다!'],
    repelled: ['에잇, 퇴각! 퇴각이다!', '다음엔 더 큰 배로 온다, 두고 봐!'],
    won: ['배가 터지게 실었다! 고맙수다, 사령관!', '크하하, 잘 먹고 간다!'],
    rebel: ['해적은 원래 주인이 없는 법이지!'],
    submit: ['헤헤, 대장님 말이 곧 법입죠…'],
    bounty: ['붉은 놈들 금고 좀 털어 주쇼. 뒷돈은 두둑이 챙겨 드리지.'],
  },
  '1-1004': { // 청룡 상단: polite merchant menace
    raid: ['장사에는 원가가 필요하지요. 오늘은 귀하의 광석이 원가입니다.', '불편을 끼쳐 드려 송구합니다. 곧 끝납니다.'],
    repelled: ['훌륭한 방어였습니다. 다음 분기에 다시 협의하지요.', '손실은 장부에 적어 두겠습니다.'],
    won: ['거래 감사합니다. 영수증은 생략하지요.'],
    rebel: ['계약 조건을 재검토한 결과, 해지하겠습니다.'],
    submit: ['현명하신 판단입니다. 상단은 약속을 지킵니다.'],
    bounty: ['해적 87호가 항로를 어지럽힙니다. 정리해 주시면 후히 사례하지요.'],
  },
};
const NAMES: Record<string, string> = { '1-666': '붉은 연합', '1-313': '검은 별 길드', '1-87': '해적 87호', '1-1004': '청룡 상단' };

/* The channel log: every transmission and guild message, kept in this browser (newest first). */
export interface Line { at: number; from: string; who: string; text: string; kind: 'rival' | 'guild' | 'me' }
const LOG = 'structs-kor.comms';
export const commsLog = (): Line[] => { try { return JSON.parse(localStorage.getItem(LOG) || '[]'); } catch { return []; } };
const logFns = new Set<() => void>();
export const onComms = (f: () => void) => { logFns.add(f); return () => logFns.delete(f); };
export function record(l: Omit<Line, 'at'>) {
  const all = [{ ...l, at: Date.now() }, ...commsLog()].slice(0, 60);
  try { localStorage.setItem(LOG, JSON.stringify(all)); } catch { /* fine */ }
  for (const f of logFns) f();
}

/* Guild channel chatter: guildmates react to what happens, and answer you. */
const CHATTER: Record<string, string[]> = {
  victory: ['나이스 방어!', '역시 우리 사령관님', '그 함대 다시는 안 오겠네요 ㅋㅋ', '격퇴 축하합니다 🫡'],
  defeat: ['아… 광석 다 털렸네요', '다음엔 정제 먼저 돌려요', '방어포 하나 더 세우는 게 어때요?'],
  void: ['공허 함대 떴다!! 다들 함대 점검', '저거 우리 쪽으로 오면 끝인데…', '누가 요격 좀…'],
  race: ['우승이다!!! 🏆', '이번 시즌 우리가 먹었네요', '기부해 준 분들 감사합니다'],
  reply: ['ㅇㅋ 확인', '좋아요, 저도 거들게요', '지금 정제소 풀가동 중입니다', '길드 금고에 조금 넣었어요', '은하 지도 보니 해적들이 약해졌던데요', '현상금 나오면 같이 가요'],
};
export function guildSay(members: string[], moment: keyof typeof CHATTER, delay = 1200) {
  if (!members.length) return;
  const who = members[Math.floor(Math.random() * members.length)];
  const pool = CHATTER[moment];
  setTimeout(() => record({ from: 'guild', who, text: pool[Math.floor(Math.random() * pool.length)], kind: 'guild' }), delay);
}

let lastAt = 0;
/** Play a line from `who` for this moment (no-op for strangers or lines it lacks). */
export function transmit(who: string, m: Moment) {
  const pool = VOICE[who]?.[m];
  if (!pool || Date.now() - lastAt < 1500) return;
  lastAt = Date.now();
  const line = pool[Math.floor(Math.random() * pool.length)];
  record({ from: who, who: NAMES[who] ?? who, text: line, kind: 'rival' });
  document.querySelector('.comms')?.remove();
  const el = document.createElement('div');
  el.className = `comms ${m === 'submit' || m === 'repelled' ? 'calm' : 'hot'}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${portraitHtml(seededPfp(who), 64)}<div><span class="label">통신 수신 · ${NAMES[who] ?? who}</span><p></p></div>`;
  const p = el.querySelector('p')!;
  document.body.appendChild(el);
  sfx.play('tick');
  // Typed out, a character at a time, like a comms line.
  if (reduced()) p.textContent = `“${line}”`;
  else { let i = 0; const t = setInterval(() => { p.textContent = `“${line.slice(0, ++i)}${i < line.length ? '' : '”'}`; if (i >= line.length) clearInterval(t); }, 28); }
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200 + line.length * 28);
}
