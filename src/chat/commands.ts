/* 통신 commands and keys: slash commands, Tab completion and the game-icon reactions.
 * After structs-universe chat-commands.js / chat-complete.js / chat-reactions.js. An unknown
 * command is never sent as chat; `//` sends a leading slash. Pure: no DOM. */

export interface Command { name: string; args: string; help: string; aliases?: string[] }
export const COMMANDS: Command[] = [
  { name: 'help', args: '', help: '명령어와 단축키 목록' },
  { name: 'me', args: '<행동>', help: '행동 문장으로 보내기 (예: /me 방어막을 올린다)' },
  { name: 'msg', args: '<플레이어> [메시지]', help: '다이렉트 메시지 열기', aliases: ['dm', 'w'] },
  { name: 'group', args: '<플레이어> <플레이어>…', help: '여러 명과 그룹 대화 만들기' },
  { name: 'join', args: '<#대화방>', help: '대화방 참여' },
  { name: 'leave', args: '', help: '지금 대화방에서 나가기' },
  { name: 'topic', args: '', help: '대화방 주제 보기' },
  { name: 'who', args: '', help: '이 방의 참여자' },
  { name: 'whois', args: '<플레이어|ID>', help: '객체 카드 보기' },
  { name: 'share', args: '<ID>', help: '객체를 카드로 공유 (예: /share 2-14)' },
  { name: 'pay', args: '<플레이어> [g]', help: '알파 보내기 (서명 전에 검토)', aliases: ['send'] },
  { name: 'rent', args: '<공급자 ID>', help: '전력 임대 창 열기' },
  { name: 'sim', args: '[플레이어]', help: '전투 시뮬레이터로 도전' },
  { name: 'base', args: '', help: '내 기지 현황을 상황 카드로 공유' },
  { name: 'search', args: '<검색어>', help: '메시지 검색', aliases: ['find'] },
];

export type Parsed =
  | { kind: 'text'; body: string }
  | { kind: 'cmd'; name: string; args: string[]; rest: string }
  | { kind: 'unknown'; name: string };

export function parse(input: string): Parsed {
  const t = input.trim();
  if (t.startsWith('//')) return { kind: 'text', body: t.slice(1) };
  if (!t.startsWith('/')) return { kind: 'text', body: input };
  const m = t.slice(1).match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return { kind: 'unknown', name: '' };
  const word = m[1].toLowerCase();
  const c = COMMANDS.find((x) => x.name === word || x.aliases?.includes(word));
  if (!c) return { kind: 'unknown', name: word };
  return { kind: 'cmd', name: c.name, args: m[2].split(/\s+/).filter(Boolean), rest: m[2] };
}

/** "은하수", "1-7", "7", "@1-7" → a player id, given who is around. */
export function playerArg(arg: string, people: { id: string; name: string }[]): string | null {
  const a = arg.replace(/^@/, '').trim();
  if (/^1-\d{1,9}$/.test(a)) return a;
  if (/^\d{1,9}$/.test(a)) return '1-' + a;
  const lc = a.toLowerCase();
  return people.find((p) => p.name.toLowerCase() === lc)?.id ?? people.find((p) => p.name.toLowerCase().startsWith(lc))?.id ?? null;
}

/* ── Completion: the word before the caret. ── */
export interface Completion { start: number; end: number; options: string[] }
export function complete(text: string, caret: number, names: string[], ids: string[]): Completion | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)(\S+)$/);
  if (!m) return null;
  const word = m[2], start = caret - word.length;
  let options: string[] = [];
  if (start === 0 && word.startsWith('/')) options = COMMANDS.map((c) => '/' + c.name).filter((c) => c.startsWith(word.toLowerCase()));
  else if (/^\d{1,2}-\d*$/.test(word)) options = ids.filter((i) => i.startsWith(word) && i !== word);
  else if (word.startsWith('@')) options = names.filter((n) => n.toLowerCase().startsWith(word.slice(1).toLowerCase())).map((n) => '@' + n);
  else options = names.filter((n) => n.length > word.length && n.toLowerCase().startsWith(word.toLowerCase()));
  return options.length ? { start, end: caret, options: [...new Set(options)].slice(0, 12) } : null;
}

/* ── Reactions: the game's icons as :shortcodes:, plus a few everyday ones. ── */
export const REACTIONS: { key: string; icon?: string; label: string }[] = [
  { key: ':okay:', icon: 'icon-okay', label: '좋아' }, { key: ':defend:', icon: 'icon-defend', label: '방어' },
  { key: ':raid:', icon: 'icon-raid', label: '습격' }, { key: ':alert:', icon: 'icon-alert', label: '경보' },
  { key: ':mine:', icon: 'icon-mine', label: '채굴' }, { key: ':detected:', icon: 'icon-detected', label: '포착' },
  { key: ':blocked:', icon: 'icon-blocked', label: '불가' }, { key: ':wreckage:', icon: 'icon-wreckage', label: '격파' },
  { key: '👍', label: '최고' }, { key: 'ㅋㅋ', label: 'ㅋㅋ' }, { key: '🔥', label: '불타오른다' }, { key: '🙏', label: '부탁' },
];
export const reactionOf = (key: string) => REACTIONS.find((r) => r.key === key);
