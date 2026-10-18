/* The harness checks itself: every profile is fully wired, and every persona can play a short
 * game headless without throwing. Part of `pnpm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES } from './profiles';
import { POLICIES } from './sim/policies';
import { STEPS } from './browser/journeys';
import { run } from './sim/engine';
import { FEATURES, feature } from './features';

test('twenty profiles, each with a policy, a journey made of real steps and a slice of real features', () => {
  assert.equal(PROFILES.length, 20);
  assert.equal(new Set(PROFILES.map((p) => p.id)).size, 20);
  for (const p of PROFILES) {
    assert.ok(POLICIES[p.policy], `${p.id}: no policy ${p.policy}`);
    for (const s of p.journey) assert.ok(STEPS[s], `${p.id}: journey step "${s}" is not defined in browser/journeys.ts`);
    for (const f of p.slice) assert.ok(feature(f), `${p.id}: slice names unknown feature "${f}"`);
  }
});

test('together the profiles cover every feature in the checklist', () => {
  const owned = new Set(PROFILES.flatMap((p) => p.slice));
  assert.deepEqual(FEATURES.filter((f) => !owned.has(f.id)).map((f) => f.id), []);
});

test('every persona plays 300 blocks headless without an exception', () => {
  for (const p of PROFILES.filter((x) => x.id !== 'chaos' && x.sim !== false)) {
    const r = run(p, { blocks: 300, seed: 1 });
    assert.deepEqual(r.crashes, [], `${p.id} crashed`);
    assert.ok(r.final.b === 300, `${p.id} stopped early`);
  }
});
