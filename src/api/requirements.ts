/* The Guild API endpoints this site is built against but the guild doesn't serve yet.
 * One entry per requirement in docs/guild-api-requirements.md (same ids). The client calls each one
 * first; when the guild answers 404/405/501 it remembers that for the visit and uses `fallback`.
 * The dev footer lists which fallbacks this page used, so the cost of each gap is visible. */

export interface Requirement { id: string; title: string; endpoint: string; fallback: string }

export const REQUIREMENTS: Requirement[] = [
  { id: 'REQ-AUTH-1', title: '토큰 로그인 (서드파티 쿠키 없이)', endpoint: 'POST /api/auth/token', fallback: 'POST /api/auth/login + 세션 쿠키' },
  { id: 'REQ-PUB-1', title: '공개 요약 통계', endpoint: 'GET /api/public/summary', fallback: '로그인 후 count 엔드포인트 6개' },
  { id: 'REQ-PUB-2', title: '공개 랭킹', endpoint: 'GET /api/public/leaderboard/{kind}', fallback: 'GET /api/leaderboard/{kind} (로그인 필요)' },
  { id: 'REQ-PUB-3', title: '공개 길드 목록', endpoint: 'GET /api/public/guild/directory', fallback: 'GET /api/guild/directory (로그인 필요)' },
  { id: 'REQ-AGG-1', title: '플레이어 대시보드 묶음 조회', endpoint: 'GET /api/player/{id}/dashboard', fallback: '병렬 8회 호출' },
  { id: 'REQ-EN-1', title: '플레이어 에너지 묶음 조회 (할당 용량·차단 순서 포함)', endpoint: 'GET /api/player/{id}/energy', fallback: 'power + infusion + allocation + objects 4회+' },
  { id: 'REQ-EN-2', title: '정전 시뮬레이션', endpoint: 'GET /api/player/{id}/power/what-if', fallback: '클라이언트 계산' },
  { id: 'REQ-MKT-1', title: '전력 시장 통계 (24시간 변동)', endpoint: 'GET /api/provider/market/stats', fallback: '변동률 없음' },
  { id: 'REQ-MKT-2', title: '계약 견적', endpoint: 'GET /api/provider/{id}/quote', fallback: '클라이언트 계산' },
  { id: 'REQ-REP-1', title: '레플리칸트 목록', endpoint: 'GET /api/player/{id}/replicants', fallback: '지갑 HD 주소 파생 + 주소별 조회' },
  { id: 'REQ-REP-2', title: '주소 일괄 → 플레이어 조회', endpoint: 'GET /api/player-address/resolve', fallback: '주소마다 1회 호출' },
  { id: 'REQ-CHAT-1', title: '게임 객체 → Matrix 방 매핑', endpoint: 'GET /api/matrix/rooms', fallback: '#planet-{id} 이름 규칙' },
  { id: 'REQ-SIM-1', title: '일일 교전 · 기록', endpoint: 'GET /api/sim/daily, GET /api/sim/daily/ladder, POST /api/sim/result', fallback: '날짜 기반 로컬 시드 · 기록 없음' },
  { id: 'REQ-TX-1', title: '계정 번호·시퀀스', endpoint: 'GET /api/account/{address}', fallback: 'LCD /cosmos/auth/v1beta1/accounts' },
  { id: 'REQ-TX-2', title: '트랜잭션 전파', endpoint: 'POST /api/tx/broadcast', fallback: 'LCD /cosmos/tx/v1beta1/txs' },
  { id: 'REQ-TX-3', title: '트랜잭션 결과', endpoint: 'GET /api/tx/{hash}', fallback: 'LCD /cosmos/tx/v1beta1/txs/{hash}' },
  { id: 'REQ-TUT-1', title: '튜토리얼 진행 저장 (tutorial 브랜치 병합)', endpoint: 'PUT /api/player/mini-game/progress', fallback: 'localStorage' },
  { id: 'REQ-WAL-1', title: '지갑 잔액 (알파·길드 토큰)', endpoint: 'GET /api/account/{address}/balances', fallback: 'LCD /cosmos/bank/v1beta1/balances' },
  { id: 'REQ-GLD-1', title: '길드 가입 신청·초대 목록', endpoint: 'GET /api/guild/membership/applications', fallback: 'LCD /structs/guild_membership_application' },
  { id: 'REQ-I18N-1', title: '구조체 유형 한국어', endpoint: 'GET /api/struct/type?locale=ko', fallback: '클라이언트 번역표' },
];

const used = new Set<string>();
const missing = new Set<string>();
const fns = new Set<() => void>();
export const fellBack = (id: string) => { if (!used.has(id)) { used.add(id); for (const f of fns) f(); } };
export const fallbacksUsed = () => [...used];
export const onFallback = (f: () => void) => { fns.add(f); return () => fns.delete(f); };
export const isMissing = (id: string) => missing.has(id);
export const markMissing = (id: string) => missing.add(id);
