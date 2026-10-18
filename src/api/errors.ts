/* What a player reads when an order fails. The chain answers in SDK log lines ("account sequence
 * mismatch, expected 12, got 11: incorrect account sequence"); a commander should read what went
 * wrong in the game and what to do about it. Unknown errors keep a short tail of the original so a
 * bug report still has something to go on. */

const RULES: [RegExp, string][] = [
  [/sequence mismatch|incorrect account sequence/i, '명령이 겹쳤습니다. 잠시 후 다시 시도하세요.'],
  [/insufficient (funds|fee)|spendable balance|smaller than/i, '알파가 부족합니다.'],
  [/out of gas/i, '명령이 너무 복잡해 처리되지 못했습니다. 다시 시도하세요.'],
  [/(not enough|insufficient) (power|energy|capacity)|capacity exceeded|load.*capacity|power.*insufficient/i, '전력이 부족합니다. 전력망에서 용량을 늘리세요.'],
  [/charge|cooldown|not (yet )?ready/i, '아직 준비되지 않았습니다. 충전이 끝나면 다시 명령하세요.'],
  [/slot.*(occupied|taken|in use|not available)|already.*slot/i, '그 슬롯은 이미 사용 중입니다.'],
  [/(planet).*(not found|required|none|empty)|no planet/i, '아직 행성이 없습니다. 먼저 탐사하세요.'],
  [/fleet.*(not on station|away|moving|not at)/i, '함대가 행성에 없습니다. 함대가 돌아온 뒤에 명령하세요.'],
  [/command ship|command struct/i, '지휘함이 필요합니다.'],
  [/(struct).*(not found|does not exist|destroyed)/i, '대상 구조체가 없거나 파괴되었습니다.'],
  [/(player).*(halted|offline|not found)/i, '사령관이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.'],
  [/unauthori[sz]ed|permission|not allowed|not the owner/i, '이 명령을 내릴 권한이 없습니다.'],
  [/ambit/i, '그 구조체는 그 영역에 둘 수 없습니다.'],
  [/proof|difficulty|hash/i, '작업이 아직 끝나지 않았습니다.'],
  [/timeout|timed out|deadline/i, '응답이 늦습니다. 잠시 후 다시 시도하세요.'],
  [/fetch|network|connect/i, '서버에 연결할 수 없습니다. 연결을 확인하세요.'],
];

export function playerMessage(raw: string | undefined | null): string {
  const m = String(raw ?? '').trim();
  if (!m) return '명령이 처리되지 않았습니다.';
  // Already a sentence for players (the client's own Korean messages): leave it.
  if (/[가-힣]/.test(m) && !/[a-z]{4,}/i.test(m)) return m;
  for (const [re, text] of RULES) if (re.test(m)) return text;
  const tail = m.replace(/^.*?:\s*/, '').slice(0, 60);
  return `명령이 처리되지 않았습니다 (${tail})`;
}
