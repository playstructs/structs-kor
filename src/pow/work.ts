/* The pure parts of proof-of-work: what is hashed, and when a proof qualifies.
 * Work rows come from structs-pg view.work_live: `difficulty_target` is the CalculateDifficulty
 * range (the struct type's build / ore-mining / ore-refining difficulty, or the planet's shield
 * for RAID), and a RAID row's object_id is the raiding fleet, its target_id the planet. */
import type { WorkRow } from '../api/guild';

/** The string structsd hashes with a nonce appended ("5-12BUILD3007073NONCE", "9-4@2-7RAID3001000NONCE"). */
export const prefixOf = (w: Pick<WorkRow, 'category' | 'object_id' | 'target_id' | 'block_start'>) =>
  w.category === 'RAID' ? `${w.object_id}@${w.target_id}RAID${w.block_start}NONCE` : `${w.object_id}${w.category}${w.block_start}NONCE`;

/** Blocks until the chain's bar falls to `zeros` (Infinity if it never will). */
export function blocksUntil(t: { range: number; blockStart: number }, zeros: number, height: number) {
  if (t.range <= 1) return Infinity;
  const age = Math.ceil(Math.pow(t.range, (64 - zeros) / 63));
  return Math.max(0, t.blockStart + age - (height + 1));
}

/** Seconds per block on the testnet, for turning block counts into wall time. */
export const BLOCK_SECONDS = 6;
/** About how many blocks a fresh build (or mine/refine proof) of this difficulty takes to qualify,
 * hashing at `rate` hashes/s: the chain's bar falls with age, and the best proof after N hashes has
 * about log16(N) leading hex zeros. Without hashing, the bar reaches zero at age ≈ range^(64/63). */
export function estimateBlocks(range: number, rate: number, blockSeconds = BLOCK_SECONDS): number {
  if (range <= 1) return 1;
  const never = Math.ceil(Math.pow(range, 64 / 63));
  if (!(rate > 0)) return never;
  for (let age = 1; age < never; age++) {
    // Whole leading hex zeros, as the chain counts them; the bar at this age is the same rule as blocksUntil.
    const zeros = Math.floor(Math.log(rate * age * blockSeconds) / Math.log(16));
    if (age >= Math.ceil(Math.pow(range, (64 - zeros) / 63))) return age;
  }
  return never;
}
