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
  struct_health: '내구도 변화', raid_status: '습격', struct_block_ore_mine_complete: '채굴', struct_block_ore_refine_complete: '정제', struct_block_build_complete: '건설 완료',
  allocation_cut: '할당 차단', research: '연구', away: '부재 중 생산', event: '은하 소식', guild: '길드', engine: '월드 엔진', infusion: '주입', agreement_open: '계약 체결', fleet_arrive: '함대 도착', fleet_depart: '함대 출발', fleet_advance: '함대 전진',
};
export const activityLabel = (c: string) => ACTIVITY[c] ?? c.replace(/_/g, ' ');

export const WORK: Record<string, string> = { BUILD: '건설', MINE: '채굴', REFINE: '정제', RAID: '습격' };

/** Orders as a player names them (the chain's message types stay out of the UI). */
export const ORDER_KO: Record<string, string> = {
  MsgStructBuildInitiate: '착공', MsgStructBuildComplete: '공사 완료', MsgStructOreMinerComplete: '채굴', MsgStructOreRefineryComplete: '정제',
  MsgPlanetRaidComplete: '습격 완료', MsgPlanetExplore: '행성 탐사', MsgFleetMove: '함대 이동', MsgStructAttack: '공격',
  MsgStructDefenseSet: '방어 지정', MsgStructDefenseClear: '방어 해제', MsgStructActivate: '가동', MsgStructDeactivate: '정지',
  MsgStructStealthActivate: '은신', MsgStructStealthDeactivate: '은신 해제', MsgPlayerSend: '송금', MsgReactorInfuse: '리액터 주입',
  MsgReactorDefuse: '리액터 회수', MsgAgreementOpen: '전력 계약', MsgAgreementClose: '계약 해지', MsgAgreementDurationIncrease: '계약 연장',
  MsgProviderCreate: '공급자 등록', MsgProviderDelete: '공급자 삭제', MsgGuildMembershipRequest: '가입 신청', MsgPlayerUpdateName: '이름 변경',
  MsgPlayerUpdatePfp: '초상화 변경', MsgPlanetUpdateName: '행성 이름 변경', MsgAllocationCreate: '할당 생성', MsgAllocationDelete: '할당 삭제',
  MsgGuildBankMint: '토큰 발행', MsgGuildBankRedeem: '토큰 상환', MsgGuildBankConvert: '토큰 교환', MsgSubstationPlayerConnect: '변전소 연결',
};
export const orderName = (msg: string) => ORDER_KO[msg] ?? msg.replace(/^Msg/, '');
