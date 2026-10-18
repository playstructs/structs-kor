/* A real new commander's first steps: how long a build takes, and the numbers the bridge shows. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateBlocks, blocksUntil } from '../src/pow/work';

test('build estimate: hashing shortens the wait, and it never exceeds the bar reaching zero', () => {
  const frigate = 450;
  const never = Math.ceil(Math.pow(frigate, 64 / 63));
  assert.equal(estimateBlocks(frigate, 0), never, 'with no hashing the proof qualifies when the bar hits zero');
  const fast = estimateBlocks(frigate, 2.3e6);
  assert.ok(fast > 150 && fast < 300, `a frigate at 2.3 MH/s takes about 230 blocks (got ${fast})`);
  assert.ok(estimateBlocks(frigate, 2e7) < fast, 'more hashing is faster');
  assert.ok(estimateBlocks(2880, 2.3e6) > fast, 'harder builds take longer');
  // Consistent with the chain's bar: at the estimated age the expected best proof already qualifies.
  const zeros = Math.floor(Math.log(2.3e6 * fast * 6) / Math.log(16));
  assert.equal(blocksUntil({ range: frigate, blockStart: 0 }, zeros, fast), 0);
});
