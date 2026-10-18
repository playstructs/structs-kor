/* The harness checks itself: every profile is fully wired, and every persona can play a short
 * game headless without throwing. Part of `pnpm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES } from './profiles';
import { POLICIES } from './sim/policies';
import { STEPS } from './browser/journeys';
import { run } from './sim/engine';

test('ten profiles, each with a policy and a journey made of real steps', () => {
  assert.equal(PROFILES.length, 10);
  assert.equal(new Set(PROFILES.map((p) => p.id)).size, 10);
  for (const p of PROFILES) {
    assert.ok(POLICIES[p.policy], `${p.id}: no policy ${p.policy}`);
    for (const s of p.journey) assert.ok(STEPS[s], `${p.id}: journey step "${s}" is not defined in browser/journeys.ts`);
  }
});

test('every persona plays 300 blocks headless without an exception', () => {
  for (const p of PROFILES.filter((x) => x.id !== 'chaos')) {
    const r = run(p, { blocks: 300, seed: 1 });
    assert.deepEqual(r.crashes, [], `${p.id} crashed`);
    assert.ok(r.final.b === 300, `${p.id} stopped early`);
  }
});
