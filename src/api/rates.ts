/* Power-market units. On chain a provider's rate is a whole number of micro-units of its denom
 * (ualpha, uguild.*) per mW per block; players think in whole units per kW per day. The chain's
 * smallest rate, 1 µ per mW·block, is already 14,400 per kW·day, so lower asks cannot be listed. */

/** mW per kW. */
export const KW = 1e6;
/** ~6 s blocks (structs-ai: charge grows about one a block, every 6 s). */
export const BLOCKS_PER_DAY = 14_400;

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
export const MIN_PER_KW_DAY = perKwDay(1) / 1e6;
