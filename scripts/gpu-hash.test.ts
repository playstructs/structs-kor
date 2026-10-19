/* The GPU hasher's job packing (src/pow/gpu.ts) against the CPU hasher (src/pow/sha.ts). The shader's
 * arithmetic is replayed here word for word: its digits written into the packed tail, the tail
 * compressed from the midstate. Whatever nonce it picks must hash exactly as the chain will. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packJob, nonceFor, GPU_DIGITS, SHADER } from '../src/pow/gpu';
import { makeJob, setNonce, tryNonce, compress, leadingZeros, digestHex } from '../src/pow/sha';

/** What one shader invocation computes, in TypeScript. */
function shaderHash(prefix: string, high: number, low: number) {
  const g = packJob(makeJob(prefix), high);
  const t = g.words.slice(8, 40);
  let n = low;
  for (let k = 0; k < GPU_DIGITS; k++) {
    const pos = g.digitAt + GPU_DIGITS - 1 - k;
    t[pos >> 2] = (t[pos >> 2] | ((48 + (n % 10)) << ((3 - (pos % 4)) * 8))) >>> 0;
    n = Math.floor(n / 10);
  }
  const bytes = new Uint8Array(128), dv = new DataView(bytes.buffer);
  for (let i = 0; i < 32; i++) dv.setUint32(i * 4, t[i]);
  const st = new Int32Array(g.words.slice(0, 8));
  compress(st, bytes, 0);
  if (g.blocks === 2) compress(st, bytes, 64);
  return { zeros: leadingZeros(st), hex: digestHex(st) };
}
function cpuHash(prefix: string, nonce: string) {
  const j = makeJob(prefix), out = new Int32Array(8);
  setNonce(j, Number(nonce));
  return { zeros: tryNonce(j, out), hex: digestHex(out) };
}

test('gpu: packed jobs hash every nonce exactly as the CPU (and the chain) does', () => {
  const prefixes = [
    '5-12BUILD3007073NONCE',                                        // one tail block
    '9-4@2-7RAID3001000NONCE',
    '5-513985MINE3169767NONCE',
    '5-1REFINE1NONCE',
    '5-123456789012345678901234567890BUILD31697670000000000NONCE',  // tail spills into a second block
    'x'.repeat(64 - 13 - 9) + 'NONCE',                              // padding right at the block edge
  ];
  for (const p of prefixes) {
    for (const [high, low] of [[0, 0], [1234, 56789], [9999, 999_999_999], [42, 7], [5000, 100_000_000]]) {
      const nonce = nonceFor(high, low);
      assert.equal(nonce.length, 13);
      assert.deepEqual(shaderHash(p, high, low), cpuHash(p, nonce), `${p} ${nonce}`);
    }
  }
});

test('gpu: the shader writes as many digits as the packing leaves empty', () => {
  assert.match(SHADER, new RegExp(`k < ${GPU_DIGITS}u`));
  assert.match(SHADER, new RegExp(`job.digitAt \\+ ${GPU_DIGITS - 1}u - k`));
  assert.match(SHADER, /atomicMax\(&best, \(z << 24u\) \| id\)/);
});
