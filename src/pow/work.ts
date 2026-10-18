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
