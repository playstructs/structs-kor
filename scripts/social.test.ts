/* Social layer, chat commands and the palette: `pnpm test`. Pure logic only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsIn, isRefId, linkIds } from '../src/social/ids';
import { encodeSituation, decodeSituation, type Situation } from '../src/social/situation-code';
import { parse, playerArg, complete, reactionOf } from '../src/chat/commands';
import { chosung, matches } from '../src/core/hangul';
import { parseGrams } from '../src/core/units';

test('ids are bounded on both sides and only card-worthy kinds count', () => {
  assert.deepEqual(idsIn('hitting 2-15361 with 5-2184, ask 1-61 — not 1-1945x or 6-1'), ['2-15361', '5-2184', '1-61']);
  assert.deepEqual(idsIn('1-194 and 1-1945 are different'), ['1-194', '1-1945']);
  assert.deepEqual(idsIn('a2-14 2-14b 12-3-4 v1-2'), []);
  assert.deepEqual(idsIn('2-14 2-14 2-14'), ['2-14']);
  assert.deepEqual(idsIn('2-14에 함대 9-9가 왔고, 1-7님(0-5)도 봤어요'), ['2-14', '9-9', '1-7', '0-5']);
  assert.deepEqual(idsIn('1-1 1-2 1-3 1-4', 2), ['1-1', '1-2']);
  assert.ok(isRefId('10-3') && isRefId('0-5') && !isRefId('6-77') && !isRefId('7-1') && !isRefId('2-'));
});

test('linkIds escapes first and chips only real ids', () => {
  const out = linkIds('&lt;b&gt; 2-14 &amp; 6-1', '/base');
  assert.match(out, /<a class="ref-chip planet" href="\/base\/o\/2-14"/);
  assert.match(out, /<span class="mono">6-1<\/span>/);
  assert.ok(!out.includes('<b>'));
});

test('a situation survives its link, Hangul and all', () => {
  const s: Situation = { t: 'raid', title: '테스트 행성 습격 중 — 지원 요청', sub: '습격자 1-9', lines: [['행성', '2-14'], ['방어막', '64']], ids: ['2-14', '1-9'], go: '/o/2-14', tone: 'jeok', by: '테스트 사령관', at: 1_790_000_000_000 };
  const code = encodeSituation(s);
  assert.match(code, /^S[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeSituation(code), s);
});

test('a hostile situation link is tamed, not trusted', () => {
  const enc = (o: unknown) => 'S' + Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(decodeSituation('Snot-a-code!'), null);
  assert.equal(decodeSituation(enc({ t: 'evil', title: 'x', lines: [], at: 1 })), null);
  const s = decodeSituation(enc({ t: 'alert', title: 'x'.repeat(500), lines: [['a', 'b'], 'junk', ['c']], ids: ['2-14', '<script>', 3], go: 'javascript:alert(1)', at: 'soon' }))!;
  assert.equal(s.title.length, 80);
  assert.deepEqual(s.lines, [['a', 'b']]);
  assert.deepEqual(s.ids, ['2-14']);
  assert.equal(s.go, undefined);
  assert.equal(s.at, 0);
  assert.equal(decodeSituation(enc({ t: 'base', title: 't', lines: [], go: 'https://evil.example', at: 1 }))!.go, undefined);
});

test('slash commands: known, aliased, unknown, escaped', () => {
  assert.deepEqual(parse('안녕하세요'), { kind: 'text', body: '안녕하세요' });
  assert.deepEqual(parse('//shrug'), { kind: 'text', body: '/shrug' });
  assert.deepEqual(parse('/w 1-7 hi there'), { kind: 'cmd', name: 'msg', args: ['1-7', 'hi', 'there'], rest: '1-7 hi there' });
  assert.deepEqual(parse('/ME 방어막을 올린다'), { kind: 'cmd', name: 'me', args: ['방어막을', '올린다'], rest: '방어막을 올린다' });
  assert.deepEqual(parse('/explode'), { kind: 'unknown', name: 'explode' });
});

test('player arguments resolve ids, bare numbers and names', () => {
  const people = [{ id: '1-7', name: '은하수' }, { id: '1-13', name: 'nova' }];
  assert.equal(playerArg('1-42', people), '1-42');
  assert.equal(playerArg('42', people), '1-42');
  assert.equal(playerArg('@은하수', people), '1-7');
  assert.equal(playerArg('NO', people), '1-13');
  assert.equal(playerArg('nobody', people), null);
});

test('Tab completes commands, id stems and names', () => {
  assert.deepEqual(complete('/he', 3, [], [])?.options, ['/help']);
  assert.deepEqual(complete('hit 2-1', 7, [], ['2-14', '2-150', '5-3'])?.options, ['2-14', '2-150']);
  assert.deepEqual(complete('hey @은', 6, ['은하수', 'nova'], [])?.options, ['@은하수']);
  const c = complete('ask no', 6, ['은하수', 'nova'], [])!;
  assert.equal(c.start, 4); assert.deepEqual(c.options, ['nova']);
  assert.equal(complete('', 0, ['a'], []), null);
});

test('reactions know the game icons', () => {
  assert.equal(reactionOf(':raid:')?.icon, 'icon-raid');
  assert.equal(reactionOf('🙂'), undefined);
});

test('palette matching: prefix, substring and 초성', () => {
  assert.equal(chosung('거래소'), 'ㄱㄹㅅ');
  assert.equal(matches('거래소', 'ㄱㄹㅅ'), 2);
  assert.equal(matches('거래소', '거래'), 3);
  assert.equal(matches('은하 통계', '통계'), 2);
  assert.equal(matches('Galaxy', 'gal'), 3);
  assert.equal(matches('거래소', 'ㅎ'), 0);
});

test('amounts parse the way players type them', () => {
  assert.equal(parseGrams('12'), 12);
  assert.equal(parseGrams('1.5k'), 1500);
  assert.equal(parseGrams('1,200 g'), 1200);
  assert.equal(parseGrams('300mg'), 0.3);
  assert.equal(parseGrams('0'), null);
  assert.equal(parseGrams('-3'), null);
  assert.equal(parseGrams('lots'), null);
});

test('messages: links linked, ids chipped, nothing injected', async () => {
  const { messageText } = await import('../src/social/text');
  const out = messageText('see https://playstructs.com/docs. also javascript:alert(1) and https://beta.playstructs.com/planet/2-15361 then 1-61 <b>', '');
  assert.match(out, /<a class="cm-link" href="https:\/\/playstructs.com\/docs" target="_blank" rel="noopener noreferrer">https:\/\/playstructs.com\/docs<\/a>\./);
  assert.match(out, /href="https:\/\/beta.playstructs.com\/planet\/2-15361"/);
  assert.ok(!out.includes('href="javascript'));
  assert.match(out, /data-ref-id="1-61"/);
  assert.equal((out.match(/data-ref-id="2-15361"/g) ?? []).length, 0, 'an id inside a URL stays part of the URL');
  assert.ok(out.includes('&lt;b&gt;'));
  assert.equal(messageText('look https://x.kr/o/2-14', '').trim(), 'look');
});

test('service record: one leg of each ledger pair, raids won from seized rows, tiers', async () => {
  const { foldLedger, tierOf, ribbons } = await import('../src/social/record');
  const c = foldLedger([
    { action: 'seized', denom: 'ore', amount_p: '40' }, { action: 'seized', denom: 'ore', amount_p: '0' },
    { action: 'refined', denom: 'ualpha', amount_p: '4000000' }, { action: 'received', denom: 'ualpha', amount_p: '4000000' },
    { action: 'infused', denom: 'ualpha', amount_p: '4000000' }, { action: 'infused', denom: 'ualpha.infused', amount_p: '4000000' },
  ]);
  assert.deepEqual(c, { ore_seized: 40, raids_won: 2, alpha_refined: 4, alpha_infused: 4 });
  assert.deepEqual(tierOf(null, [1, 5]), { tier: 0, next: null });
  assert.deepEqual(tierOf(0, [1, 5]), { tier: 0, next: 1 });
  assert.deepEqual(tierOf(7, [1, 5]), { tier: 2, next: null });
  const r = ribbons({ raids_won: 20 });
  assert.equal(r.find((x) => x.key === 'raids_won')!.tier, 3);
  assert.equal(r.find((x) => x.key === 'ore_mined')!.value, null, 'unknown stays unknown, not zero');
});

test('board codes round-trip and refuse what a stranger could slip in', async () => {
  const { encodeBoard, decodeBoard } = await import('../src/social/boardcode');
  const b = { name: '레이더 보드', cards: [{ k: 'raids' as const, w: 1 as const }, { k: 'obj' as const, id: '2-14', w: 2 as const }] };
  assert.deepEqual(decodeBoard(encodeBoard(b)), b);
  const enc = (o: unknown) => 'B' + Buffer.from(JSON.stringify(o)).toString('base64url');
  const d = decodeBoard(enc({ name: 'x'.repeat(99), cards: [{ k: 'constructor', w: 1 }, { k: '__proto__' }, { k: 'obj', id: '<img>' }, { k: 'feed', w: 9 }] }))!;
  assert.equal(d.name.length, 20);
  assert.deepEqual(d.cards, [{ k: 'feed', w: 2 }]);
  assert.equal(decodeBoard(enc({ cards: [{ k: 'nope' }] })), null);
  assert.equal(decodeBoard('not a code'), null);
});

test('a situation cannot smuggle markup through tone, nor leave the site through go', async () => {
  const { situationHtml } = await import('../src/social/share').catch(() => ({ situationHtml: null as null | ((s: Situation, b?: string) => string) }));
  const enc = (o: unknown) => 'S' + Buffer.from(JSON.stringify(o)).toString('base64url');
  const s = decodeSituation(enc({ t: 'raid', title: 'x', lines: [], tone: '"><img src=x onerror=alert(1)>', go: '//evil.example/x', at: 1 }))!;
  assert.equal(s.tone, undefined);
  assert.equal(s.go, undefined);
  assert.equal(decodeSituation(enc({ t: 'raid', title: 'x', lines: [], tone: 'hwang', go: '/o/2-14', at: 1 }))!.go, '/o/2-14');
  if (situationHtml) assert.ok(!situationHtml({ ...s, tone: '"><b>' as never }, '').includes('"><b>'));
});

test('sending alpha encodes: MsgPlayerSend takes a list of coins', async () => {
  const { validateMsg, typeUrlOf } = await import('../src/wallet/encode');
  const value = { creator: 'structs1abc', from_address: 'structs1abc', to_address: 'structs1def', amount: [{ denom: 'ualpha', amount: '5000000' }] };
  assert.deepEqual(validateMsg({ typeUrl: typeUrlOf('MsgPlayerSend'), value }), []);
});

test('sign-in holds other guild requests, lets its own through, and waits for the wire to go quiet', async () => {
  const order: string[] = [];
  let release: () => void = () => undefined;
  const slow = new Promise<void>((r) => { release = r; });
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    const path = String(url).split('/').pop()!;
    order.push('send ' + path);
    if (path === 'slow') await slow;
    return new Response(JSON.stringify({ success: true, errors: [], data: path }), { headers: { 'content-type': 'application/json' } });
  };
  const { call, holdRequestsUntil, signinInit, quiet } = await import('../src/api/http');
  const inFlight = call('slow');
  let quietDone = false;
  const q = quiet(2000).then(() => { quietDone = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(quietDone, false, 'a request on the wire keeps it from being quiet');
  release(); await inFlight; await q;
  assert.equal(quietDone, true);
  let finish: () => void = () => undefined;
  const signin = holdRequestsUntil(new Promise<void>((r) => { finish = r; }));
  const held = call('player').then(() => order.push('done player'));
  await call('timestamp', signinInit()).then(() => order.push('done timestamp'));
  assert.ok(!order.includes('send player'), 'held while signing in');
  finish(); await signin; await held;
  assert.deepEqual(order.slice(-3), ['done timestamp', 'send player', 'done player']);
});
