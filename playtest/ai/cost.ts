/* Cost of a deep-dive run, from what a run measured. With real turns (a Claude run) the token
 * counts come straight from the API's usage. With a scripted run there are no API calls, so the
 * estimate is built from the measured size of each observation the model would have been sent. */
import type { AiResult } from './agent';

/** $ per million tokens (Claude API list price for claude-sonnet-5-5 at the time of writing). */
export const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };

export function measuredCost(rs: AiResult[]) {
  const t = rs.reduce((a, r) => ({ input: a.input + r.usage.input, cacheWrite: a.cacheWrite + r.usage.cacheWrite, cacheRead: a.cacheRead + r.usage.cacheRead, output: a.output + r.usage.output }), { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  const usd = (t.input * PRICE.input + t.cacheWrite * PRICE.cacheWrite + t.cacheRead * PRICE.cacheRead + t.output * PRICE.output) / 1e6;
  return { tokens: t, usd, turns: rs.reduce((a, r) => a + r.turns.length, 0) };
}

/** Estimate N agents × `steps` turns from observation sizes. Assumptions, stated in the output:
 * an image costs width×height/750 tokens; Korean UI text ~1 token per 1.6 characters; each turn
 * adds ~600 output tokens (tool call plus adaptive thinking at medium effort) and ~150 tokens of
 * tool results; system prompt and tools ~5k tokens, cached. Context editing clears tool results
 * once the prompt passes 100k tokens, keeping the last 8, so the prompt saw-tooths between ~40k and
 * 100k; every clear rewrites the cache from the clear point. */
export function estimate(rs: AiResult[], agents: number, steps: number, contextEditing = true) {
  const obs = rs.flatMap((r) => r.observations).filter((o) => o.width);
  const avg = (f: (o: (typeof obs)[number]) => number) => obs.reduce((a, o) => a + f(o), 0) / Math.max(1, obs.length);
  const imageTok = avg((o) => (o.width * o.height) / 750), textTok = avg((o) => o.textChars / 1.6);
  const perTurnIn = imageTok + textTok + 150, out = 600, sys = 5000;
  let ctx = sys, cost = 0, peak = 0;
  const clearAt = 100_000, keepTurns = 8;
  for (let t = 0; t < steps; t++) {
    // This turn: everything before the newest addition is a cache read; the addition is a write.
    cost += ((ctx) * PRICE.cacheRead + perTurnIn * PRICE.cacheWrite + out * PRICE.output) / 1e6;
    ctx += perTurnIn + out;
    peak = Math.max(peak, ctx);
    if (contextEditing && ctx > clearAt) {
      // Old tool results and screenshots go; what remains is re-cached once.
      ctx = sys + keepTurns * (perTurnIn + out) + (t * out * 0.3);
      cost += (ctx * PRICE.cacheWrite) / 1e6;
    }
  }
  return {
    perAgentUsd: cost, totalUsd: cost * agents, peakContext: Math.round(peak),
    perTurn: { imageTokens: Math.round(imageTok), textTokens: Math.round(textTok), inputAdded: Math.round(perTurnIn), output: out },
    observations: obs.length,
  };
}
