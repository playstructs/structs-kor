/* Studio-wide quality gates. Each persona also carries its own `expect` (profiles.ts); these are
 * the rules no build may break whoever is playing. A failed gate fails `pnpm playtest:sim`. */
export const BUDGETS = {
  /** Exceptions thrown by any order or block, across all personas and seeds. */
  maxCrashes: 0,
  /** Distinct invariant violations allowed (each is a bug or an unwritten rule). */
  maxViolations: 0,
  /** No persona's median end worth may exceed the weakest non-chaos persona's by more than this:
   * a larger spread means one way to play dominates the rest. */
  maxDominance: 8,
  /** Blocks per second the headless sim must sustain (a perf regression guard for demo.step). */
  minBlocksPerSecond: 300,
  /** Share of blocks in which a non-chaos persona found nothing it could do. Above this the
   * game has dead time for that persona. */
  maxIdleShare: 0.97,
};
