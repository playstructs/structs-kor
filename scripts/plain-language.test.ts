/* The chain stays out of sight: players read game words, and orders send without asking.
 * Developer pages (diag, stats), the demo (retiring) and code comments are exempt. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { playerMessage } from '../src/api/errors';

const EXEMPT = /src\/(screens\/(diag|stats|research|exchange-demo)|game\/demo|api|wallet|sim|pow|grass|chat\/matrix)\b/;
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});
/** Source with comments removed, so notes for developers don't count. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ui = files('src').filter((p) => !EXEMPT.test(p.replace(/\\/g, '/')));

test('no chain or crypto vocabulary in what players read', () => {
  const words = ['체인', '서명', '트랜잭션', '작업 증명', '블록체인', '복구 문구', '가스 ', 'ualpha ='];
  const hits = ui.flatMap((p) => words.filter((w) => code(p).includes(w)).map((w) => `${p}: "${w}"`));
  assert.deepEqual(hits, []);
});

test('orders send without a confirmation prompt (only wiping the account from the browser asks)', () => {
  const prompts = ui.flatMap((p) => [...code(p).matchAll(/\bconfirm\(|await ask\(/g)].map(() => p));
  const allowed = new Set(['src/screens/profile.ts', 'src/screens/chat.ts', 'src/screens/console.ts']); // wallet wipe; chat rooms; demo era (retiring)
  assert.deepEqual(prompts.filter((p) => !allowed.has(p.replace(/\\/g, '/'))), []);
});

test('chain errors read as game messages', () => {
  assert.equal(playerMessage('account sequence mismatch, expected 12, got 11: incorrect account sequence'), '명령이 겹쳤습니다. 잠시 후 다시 시도하세요.');
  assert.equal(playerMessage('insufficient funds: 3ualpha is smaller than 5ualpha'), '알파가 부족합니다.');
  assert.match(playerMessage('slot already occupied'), /슬롯/);
  assert.equal(playerMessage('이미 사용 중인 슬롯입니다'), '이미 사용 중인 슬롯입니다', 'the client\'s own Korean messages pass through');
  assert.match(playerMessage('something entirely new happened'), /^명령이 처리되지 않았습니다 \(/);
  assert.equal(playerMessage(''), '명령이 처리되지 않았습니다.');
});
