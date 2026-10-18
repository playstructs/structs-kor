/* Power-market units and the chat client's sign-in guards: `pnpm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perKwDay, chainRate, MIN_PER_KW_DAY } from '../src/api/rates';
import { Matrix } from '../src/chat/matrix';
import { guildApi } from '../src/api/guild';
import { wallet } from '../src/wallet/wallet';

test('market: a chain rate reads as whole units per kW·day', () => {
  // 1 µα per mW·block = 1e6 mW/kW × 14,400 blocks/day = 1.44e10 µα = 14,400 α per kW·day.
  assert.equal(perKwDay(1) / 1e6, 14_400);
  assert.equal(MIN_PER_KW_DAY, 14_400);
  assert.equal(perKwDay('2') / 1e6, 28_800);
});

test('market: an ask the chain can hold lists unchanged', () => {
  assert.deepEqual(chainRate(28_800), { amount: '2', listed: 28_800, changed: false });
  assert.deepEqual(chainRate(14_400 * 7), { amount: '7', listed: 100_800, changed: false });
});

test('market: an ask below the chain minimum is flagged with the price it really lists at', () => {
  const r = chainRate(10);
  assert.equal(r.amount, '1');
  assert.equal(r.listed, 14_400);
  assert.equal(r.changed, true, 'the seller must be told 10 α/kW·day becomes 14,400');
  assert.equal(chainRate(0).amount, '1');
  assert.equal(chainRate(20_000).changed, true, '20,000 rounds to 1 µ/mW·block = 14,400');
});

test('chat: calls made without a session fail with a message, not a TypeError', async () => {
  const m = new Matrix();
  await assert.rejects(m.join('#guild:example'), (e: Error) => !(e instanceof TypeError) && /로그인하지 않았습니다/.test(e.message));
  await assert.rejects(m.send('!room:example', 'hi'), (e: Error) => !(e instanceof TypeError));
  assert.equal(await m.read('!room:example', '$event'), null, 'read receipts stay quiet');
});

test('chat: a sign-in the guild answers with nothing is refused and leaves no session', async () => {
  const restore = { ts: guildApi.timestamp, login: guildApi.matrixLogin, key: wallet.key, sign: wallet.signMessage };
  Object.assign(guildApi, { timestamp: async () => ({ unix_timestamp: 1 }), matrixLogin: async () => null });
  Object.assign(wallet, { key: () => ({ address: 'structs1test' }), signMessage: () => ({ address: 'structs1test', pubkey: 'ab', signature: 'cd' }) });
  try {
    const m = new Matrix();
    await assert.rejects(m.signIn(), (e: Error) => !(e instanceof TypeError) && /로그인 정보/.test(e.message));
    assert.equal(m.grant, null);
    await assert.rejects(m.join('#guild:example'), /로그인하지 않았습니다/);
  } finally {
    Object.assign(guildApi, { timestamp: restore.ts, matrixLogin: restore.login });
    Object.assign(wallet, { key: restore.key, signMessage: restore.sign });
  }
});
