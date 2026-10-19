/* Power-market units. On chain a provider's rate is a whole number of micro-units of its denom
 * (ualpha, uguild.*) per mW per block; players think in whole units per kW per day. The chain's
 * smallest rate, 1 µ per mW·block, is already about 16,000 per kW·day, so lower asks cannot be listed. */

/** mW per kW. */
export const KW = 1e6;
/** Blocks in a day at the measured block time (pow/work.ts measures it; 5.4 s until then). */
export let BLOCKS_PER_DAY = Math.round(86_400 / 5.4);
export function setBlockSeconds(s: number) { BLOCKS_PER_DAY = Math.round(86_400 / s); MIN_PER_KW_DAY = perKwDay(1) / 1e6; }

/** A chain rate (µ per mW·block) as micro-units per kW·day (show with micro()). */
export const perKwDay = (rateAmount: number | string) => Number(rateAmount) * KW * BLOCKS_PER_DAY;

/** The chain rate for an ask in whole units per kW·day, and the price it really lists at. */
export function chainRate(askPerKwDay: number): { amount: string; listed: number; changed: boolean } {
  const exact = (askPerKwDay * 1e6) / (KW * BLOCKS_PER_DAY);
  const amount = Math.max(1, Math.round(exact));
  const listed = perKwDay(amount) / 1e6;
  return { amount: String(amount), listed, changed: Math.abs(listed - askPerKwDay) > Math.max(1e-9, askPerKwDay * 0.01) };
}

/** The smallest listable price, in whole units per kW·day. */
export let MIN_PER_KW_DAY = perKwDay(1) / 1e6;
