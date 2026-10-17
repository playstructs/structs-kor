/* Game words in Korean. Struct type ids follow structs-ai/knowledge/entities/struct-types.md. */

export const AMBIT: Record<string, string> = { space: '우주', air: '공중', land: '지상', water: '수상' };
export const AMBITS = ['space', 'air', 'land', 'water'] as const;

export const STRUCT_TYPE: Record<number, string> = {
  1: 'CMD 함선', 2: '전함', 3: '스타파이터', 4: '프리깃',
  5: '추격 전투기', 6: '스텔스 폭격기', 7: '고고도 요격기',
  8: '자주포', 9: '탱크', 10: 'SAM 발사대',
  11: '순양함', 12: '구축함', 13: '잠수함',
  14: '광석 추출기', 15: '정제소', 16: '궤도 방어막 생성기', 17: '재밍 위성', 18: '광석 벙커',
  19: '행성 방어포', 20: '필드 발전기', 21: '대륙 발전소', 22: '월드 엔진',
};

/** Id prefix → entity (e.g. "3-15" is a reactor). */
export const ENTITY: Record<string, string> = {
  '0': '길드', '1': '플레이어', '2': '행성', '3': '리액터', '4': '변전소', '5': '구조체', '6': '할당',
  '7': '주입', '8': '주소', '9': '함대', '10': '공급자', '11': '계약',
};
export const entityOf = (id: string) => ENTITY[id.split('-')[0]] ?? '객체';

export const ALLOCATION_TYPE: Record<string, string> = { static: '정적', dynamic: '동적', automated: '자동', 'provider-agreement': '공급 계약', providerAgreement: '공급 계약' };

export const ACTIVITY: Record<string, string> = {
  struct_attack: '공격', struct_defense_add: '방어 지정', struct_defense_remove: '방어 해제', struct_status: '구조체 상태',
  struct_move: '구조체 이동', struct_block_build_start: '건설 시작', struct_block_ore_mine_start: '채굴 시작', struct_block_ore_refine_start: '정제 시작',
  struct_health: '내구도 변화', raid_status: '습격', fleet_arrive: '함대 도착', fleet_depart: '함대 출발', fleet_advance: '함대 전진',
};
export const activityLabel = (c: string) => ACTIVITY[c] ?? c.replace(/_/g, ' ');

export const WORK: Record<string, string> = { BUILD: '건설', MINE: '채굴', REFINE: '정제', RAID: '습격' };
