/* Daily challenge, link grammar and hotkeys: `pnpm test`. Pure logic only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chain, type Msg } from '../src/sim/chain';
import { Ai } from '../src/sim/ai';
import { CPU, YOU, chainSetup, dailyScenario } from '../src/sim/fleets';
import { DAILY_CHARGE, decodeDaily, encodeDaily, kstDay, msToNextDaily, nameKo, playDaily, playable, shareText, verifyDaily, dailyNo, type Order } from '../src/sim/daily';
import { parse, path, appUrl, shareable } from '../src/core/links';
import { keyOf } from '../src/game/keyof';

/** Fly a day the way the battle screen does with autopilot on, and keep your orders. */
function flyDay(day: string): { orders: Order[]; winner: string } {
  const d = dailyScenario(day);
  const c = new Chain(chainSetup(d.units, d.seed, { player: DAILY_CHARGE, computer: DAILY_CHARGE }).setup);
  const me = new Ai(YOU.id, 'hard', d.seed + ':you'), them = new Ai(CPU.id, d.difficulty, d.seed);
  const orders: Order[] = [];
  let quiet = 0, blocks = 0;
  for (;;) {
    const m: Msg | null = me.decide(c);
    if (m) { orders.push({ height: c.height + 1, msg: m }); c.submit(YOU.id, m); }
    const t = them.decide(c); if (t) c.submit(CPU.id, t);
    const b = c.produceBlock(); blocks++; quiet++;
    if (b.txs.some((x) => x.ok && x.events.some((e) => e.category === 'struct_attack'))) quiet = 0;
    const f = c.fleetsAtBattle();
    if (f.length < 2) return { orders, winner: f.includes(YOU.fleetId) ? 'player' : f.includes(CPU.fleetId) ? 'computer' : 'draw' };
    if (blocks > 400 || quiet > 40) return { orders, winner: 'decision' };
  }
}

const NOW = Date.parse('2026-10-20T03:00:00Z');

test('the daily turns over at midnight KST', () => {
  assert.equal(kstDay(Date.parse('2026-10-18T14:59:59Z')), '2026-10-18');
  assert.equal(kstDay(Date.parse('2026-10-18T15:00:00Z')), '2026-10-19');
  assert.equal(msToNextDaily(Date.parse('2026-10-18T14:59:00Z')), 60_000);
  assert.equal(dailyNo('2026-10-18'), 1);
  assert.ok(playable('2026-10-19', NOW) && !playable('2026-10-21', NOW) && !playable('2026-10-17', NOW));
});

test('every daily has a Korean operation name', () => {
  for (let i = 0; i < 40; i++) {
    const day = new Date(Date.parse('2026-10-18') + i * 86400e3).toISOString().slice(0, 10);
    assert.doesNotMatch(nameKo(dailyScenario(day)), /Operation/, day);
  }
});

test('a daily code replays to the same battle the player fought', () => {
  for (const day of ['2026-10-18', '2026-10-19', '2026-10-20']) {
    const flown = flyDay(day);
    const r = playDaily(day, flown.orders)!;
    if (flown.winner !== 'decision') assert.equal(r.winner, flown.winner, day);
    const code = encodeDaily({ day, name: '청룡사령관', orders: flown.orders });
    assert.ok(code.length < 1600, `code ${code.length} chars`);
    const back = decodeDaily(code)!;
    assert.equal(back.day, day);
    assert.equal(back.name, '청룡사령관');
    assert.deepEqual(back.orders, flown.orders);
    const v = verifyDaily(code, NOW)!;
    assert.equal(v.score, r.score);
    assert.equal(v.stars, r.stars);
    const text = shareText(r, dailyScenario(day), 'https://x.test/daily/' + day + '/' + code);
    assert.match(text, /^구조체 일일 교전 #\d+/);
    assert.equal([...text.split('\n')[2]].length, r.mine.length);
  }
});

test('forged and broken daily codes are rejected', () => {
  const day = '2026-10-19';
  const { orders } = flyDay(day);
  const good = encodeDaily({ day, name: 'A', orders });
  assert.equal(decodeDaily(good.slice(0, -3)), null);
  assert.equal(decodeDaily('D' + good.slice(2)), null);
  assert.equal(decodeDaily('Dnope!'), null);
  // An order for a block after the battle ended is an order nobody could have sent.
  const late = encodeDaily({ day, name: 'A', orders: [...orders, { height: 1000 + 401 * 2, msg: orders[0].msg }] });
  assert.equal(verifyDaily(late, NOW), null);
  // Tomorrow's daily can't be played yet.
  assert.equal(verifyDaily(encodeDaily({ day: '2026-10-21', name: '', orders: [] }), NOW), null);
  // A long call sign is cut at a whole syllable.
  assert.equal(decodeDaily(encodeDaily({ day, name: '가나다라마바사아자차카타파하가나다라', orders: [] }))!.name, '가나다라마바사아자차');
});

test('link grammar: web, query forms and the desktop scheme agree', () => {
  const code = 'DAQABAAA';
  assert.deepEqual(parse('/daily'), { view: 'daily' });
  assert.deepEqual(parse('https://x.test/structs-kor/daily/2026-10-18/' + code, '/structs-kor'), { view: 'daily', day: '2026-10-18', code });
  assert.deepEqual(parse('structs-kor://daily/2026-10-18/' + code), { view: 'daily', day: '2026-10-18', code });
  assert.deepEqual(parse('/daily/2026-10-18/<script>'), { view: 'daily', day: '2026-10-18' });
  assert.deepEqual(parse('/sim?replay=Rabcdef'), { view: 'replay', code: 'Rabcdef' });
  assert.deepEqual(parse('/sim/Rabcdef'), { view: 'replay', code: 'Rabcdef' });
  assert.deepEqual(parse('/sim?daily=2026-10-18'), { view: 'daily', day: '2026-10-18' });
  assert.deepEqual(parse('/galaxy'), { view: 'screen', path: '/galaxy' });
  assert.equal(parse('/daily/yesterday'), null);
  const l = parse('/daily/2026-10-18/' + code)!;
  assert.equal(path(l), '/daily/2026-10-18/' + code);
  assert.equal(appUrl(l), 'structs-kor://daily/2026-10-18/' + code);
  assert.deepEqual(parse(appUrl(l)), l);
  assert.ok(shareable(l) && !shareable(parse('/daily')) && !shareable(parse('/console')));
});

test('hotkeys work with 한글 input on', () => {
  assert.equal(keyOf({ key: 'ㅋ', code: 'KeyZ' }), 'z');        // macOS, 두벌식
  assert.equal(keyOf({ key: 'Process', code: 'KeyB' }), 'b');   // Windows IME
  assert.equal(keyOf({ key: 'Z', code: 'KeyZ' }), 'z');
  assert.equal(keyOf({ key: 'a', code: 'KeyQ' }), 'a');         // AZERTY keeps its own letters
  assert.equal(keyOf({ key: '?', code: 'Slash' }), '?');
  assert.equal(keyOf({ key: '!', code: 'Digit1' }), '!');
  assert.equal(keyOf({ key: 'Escape', code: 'Escape' }), 'Escape');
});
