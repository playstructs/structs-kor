/* 작전 (campaign): ten scripted engagements, each a lesson in Structs combat, unlocked in order.
 * Fleets are hand-placed (validated against the struct catalogue); progress lives in this browser. */
import { unitId, fits, type Unit } from '../sim/fleets';
import type { Difficulty } from '../sim/ai';
import type { Ambit } from '../data/catalogue';

type Spec = [type: number, ambit: Ambit, slot: number, protects?: [Ambit, number] | 'cmd'];
export interface Mission { id: string; no: number; title: string; place: string; brief: string; lesson: string; you: Spec[]; them: Spec[]; cmdYou: Ambit; cmdThem: Ambit; difficulty: Difficulty; xp: number; charge: number; icon: number }

export const MISSIONS: Mission[] = [
  { id: 'm1', no: 1, title: '첫 출격', place: '개척 궤도 · 2-14 외곽', icon: 3,
    brief: '해적 초계선 두 척이 채굴 기지 궤도를 맴돌고 있습니다. 스타파이터 편대로 몰아내세요.',
    lesson: '내 유닛을 누르고, 깜빡이는 적을 누르면 다음 블록에 발사합니다.',
    cmdYou: 'space', cmdThem: 'space', difficulty: 'easy', xp: 60, charge: 12,
    you: [[3, 'space', 0], [3, 'space', 1]], them: [[4, 'space', 0], [4, 'space', 1]] },
  { id: 'm2', no: 2, title: '방패', place: '고도 12km · 한빛 IV 상공', icon: 2,
    brief: '스텔스 폭격기가 지휘함을 노립니다. 전함으로 지휘함을 지키며 버티세요.',
    lesson: '유닛 선택 → D → 지킬 아군. 방어자는 공격을 막고 반격합니다.',
    cmdYou: 'space', cmdThem: 'air', difficulty: 'easy', xp: 90, charge: 12,
    you: [[2, 'space', 0], [3, 'space', 1], [7, 'air', 0]], them: [[6, 'air', 1], [6, 'air', 2], [5, 'air', 3, 'cmd']] },
  { id: 'm3', no: 3, title: '심해의 그림자', place: '수상 전장 · 남쪽 해구', icon: 13,
    brief: '잠수함이 보급로를 끊었습니다. 구축함과 순양함으로 수면 아래를 쓸어버리세요.',
    lesson: '무기마다 닿는 전장이 다릅니다. 수상 표적에는 수상 무기를 쓰세요.',
    cmdYou: 'water', cmdThem: 'water', difficulty: 'easy', xp: 120, charge: 14,
    you: [[12, 'water', 0], [11, 'water', 1], [13, 'water', 2]], them: [[13, 'water', 0], [13, 'water', 1], [12, 'water', 2], [11, 'water', 3]] },
  { id: 'm4', no: 4, title: '포위망', place: '지상 전장 · 대륙 협곡', icon: 8,
    brief: '수적으로 열세입니다. 자주포의 간접 사격과 SAM으로 포위망을 뚫으세요.',
    lesson: '방어자를 먼저 제거하면 반격을 피할 수 있습니다. 적의 방어 표시를 확인하세요.',
    cmdYou: 'land', cmdThem: 'land', difficulty: 'hard', xp: 160, charge: 15,
    you: [[8, 'land', 0], [9, 'land', 1], [10, 'land', 2], [5, 'air', 0]],
    them: [[9, 'land', 0, 'cmd'], [9, 'land', 1], [8, 'land', 2], [10, 'land', 3], [6, 'air', 0], [5, 'air', 1], [7, 'air', 2]] },
  { id: 'm5', no: 5, title: '붉은 연합 기함', place: '심우주 · 붉은 연합 본대', icon: 1,
    brief: '붉은 연합의 기함이 직접 나섰습니다. 전 전장에서 동시에 압박해 기함을 침몰시키세요.',
    lesson: '전함·폭격기·순양함을 엮어 적 방어자를 갈라놓으세요. 자동 조종으로는 어렵습니다.',
    cmdYou: 'space', cmdThem: 'space', difficulty: 'hard', xp: 300, charge: 16,
    you: [[2, 'space', 0], [3, 'space', 1], [6, 'air', 0], [7, 'air', 1], [9, 'land', 0], [11, 'water', 0]],
    them: [[2, 'space', 0, 'cmd'], [2, 'space', 1], [4, 'space', 2], [6, 'air', 0], [7, 'air', 1], [10, 'land', 0], [8, 'land', 1], [12, 'water', 0], [13, 'water', 1]] },
  { id: 'm6', no: 6, title: '그림자 작전', place: '남쪽 해구 · 붉은 연합 보급선', icon: 13,
    brief: '보급 함대가 대공 화력으로 무장했습니다. 잠수함과 스텔스 폭격기를 숨긴 채 접근해 보급선을 끊으세요.',
    lesson: '유닛 선택 → S로 은신. 숨은 유닛은 같은 전장의 적만 노릴 수 있고, 공격하면 모습이 드러납니다.',
    cmdYou: 'water', cmdThem: 'land', difficulty: 'easy', xp: 220, charge: 16,
    you: [[13, 'water', 0], [13, 'water', 1], [6, 'air', 0], [6, 'air', 1], [9, 'land', 0], [8, 'land', 1]],
    them: [[10, 'land', 0, 'cmd'], [10, 'land', 1], [9, 'land', 2], [12, 'water', 0], [11, 'water', 1], [7, 'air', 0]] },
  { id: 'm7', no: 7, title: '기함 기동', place: '성층권 · 붉은 연합 사령부', icon: 1,
    brief: '사령부가 당신의 지휘함을 노려 화력을 집중합니다. 지휘함을 다른 전장으로 옮겨 포화를 피하며 반격하세요.',
    lesson: '지휘함 선택 → M → 빛나는 전장. 지휘함만 전장을 옮길 수 있고, 충전이 듭니다.',
    cmdYou: 'air', cmdThem: 'space', difficulty: 'hard', xp: 400, charge: 18,
    you: [[2, 'space', 0], [3, 'space', 1], [7, 'air', 0], [5, 'air', 1], [8, 'land', 0], [11, 'water', 0]],
    them: [[2, 'space', 0, 'cmd'], [3, 'space', 1], [4, 'space', 2], [5, 'air', 0], [7, 'air', 1], [6, 'air', 2], [10, 'land', 0], [12, 'water', 0]] },
  /* The other houses: each fights the way its commander talks. */
  { id: 'm8', no: 8, title: '해적 소탕', place: '소행성대 · 해적 87호 은신처', icon: 4,
    brief: '해적 87호가 작고 빠른 배를 떼로 띄웠습니다. 하나씩 집중 사격해 수를 줄이고, 연쇄 격파로 기세를 잡으세요.',
    lesson: '한 표적에 화력을 모으세요. 6블록 안에 이어 격파하면 연쇄 격파 보너스가 붙습니다.',
    cmdYou: 'space', cmdThem: 'space', difficulty: 'hard', xp: 260, charge: 14,
    you: [[3, 'space', 0], [5, 'air', 0], [11, 'water', 0]],
    them: [[4, 'space', 0], [4, 'space', 1], [4, 'space', 2], [4, 'space', 3, 'cmd'], [5, 'air', 0], [5, 'air', 1], [6, 'air', 2], [13, 'water', 0], [13, 'water', 1], [12, 'water', 2]] },
  { id: 'm9', no: 9, title: '계산된 함정', place: '검은 별 길드 · 방어 성채', icon: 10,
    brief: '검은 별 길드는 모든 배를 겹겹이 지킵니다. 방어자를 먼저 걷어내지 않으면 반격에 녹아내립니다.',
    lesson: '보조 무기(2)로 바꾸면 닿는 전장이 달라집니다. 방어 표시(DEF)가 붙은 적부터 노리세요.',
    cmdYou: 'space', cmdThem: 'space', difficulty: 'difficult', xp: 420, charge: 16,
    you: [[2, 'space', 0], [3, 'space', 1], [6, 'air', 0], [6, 'air', 1], [8, 'land', 0], [12, 'water', 0]],
    them: [[2, 'space', 0, 'cmd'], [4, 'space', 1, ['space', 0]], [9, 'land', 0], [10, 'land', 1, ['land', 0]], [7, 'air', 0, 'cmd']] },
  { id: 'm10', no: 10, title: '청룡의 금고', place: '청룡 상단 · 중앙 금고 궤도', icon: 2,
    brief: '청룡 상단은 돈으로 산 함대를 모든 전장에 깔았습니다. 네 전장을 모두 지휘해 금고를 지키는 기함을 무너뜨리세요.',
    lesson: '지금까지의 모든 것: 집중 사격, 방어, 은신, 지휘함 기동. 자동 조종으로는 이기기 어렵습니다.',
    cmdYou: 'space', cmdThem: 'space', difficulty: 'hard', xp: 600, charge: 20,
    you: [[2, 'space', 0], [3, 'space', 1], [7, 'air', 0], [6, 'air', 1], [9, 'land', 0], [8, 'land', 1], [11, 'water', 0], [13, 'water', 1]],
    them: [[2, 'space', 0, 'cmd'], [4, 'space', 1], [5, 'air', 0], [7, 'air', 1], [9, 'land', 0], [10, 'land', 1], [12, 'water', 0]] },
];

function build(side: 'player' | 'computer', cmd: Ambit, specs: Spec[]): Unit[] {
  const cmdUnit: Unit = { id: unitId(side, 1, cmd, 0), side, type: 1, ambit: cmd, slot: 0, protects: null };
  const units = specs.map(([type, ambit, slot]) => {
    if (!fits(type, ambit)) throw new Error(`campaign: type ${type} cannot sit in ${ambit}`);
    return { id: unitId(side, type, ambit, slot), side, type, ambit, slot, protects: null } as Unit;
  });
  specs.forEach(([, , , p], i) => {
    if (!p) return;
    units[i].protects = p === 'cmd' ? cmdUnit.id : units.find((u) => u.ambit === p[0] && u.slot === p[1])?.id ?? null;
  });
  return [cmdUnit, ...units];
}
export const missionUnits = (m: Mission): Unit[] => [...build('player', m.cmdYou, m.you), ...build('computer', m.cmdThem, m.them)];

/* ── Progress ── */
const KEY = 'structs-kor.campaign';
export function progress(): Record<string, number> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
/** Record a clear; returns true on the first clear. */
export function recordClear(id: string, stars: number): boolean {
  const p = progress(), first = !(id in p);
  p[id] = Math.max(p[id] ?? 0, stars);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* fine */ }
  return first;
}
export const unlocked = (m: Mission) => m.no === 1 || MISSIONS[m.no - 2].id in progress();
