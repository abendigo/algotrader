/**
 * Type-checked code snippets for the "Live Recovery" docs section.
 *
 * Each snippet is enclosed in @doc-snippet markers. The generation script
 * extracts content between markers for display in the documentation.
 * The full file is compiled by tsc, so interface changes break the build.
 */

import type { Strategy, StrategyContext, RecoveryConfig } from "#core/strategy.js";
import type { Tick, Position } from "#core/types.js";

// @doc-snippet recovery-modes
// In strategyMeta:
const clean: RecoveryConfig = { mode: "clean" };
const backfill: RecoveryConfig = { mode: "backfill", lookback: 120, granularity: "M1" };
const checkpoint: RecoveryConfig = { mode: "checkpoint" };
const custom: RecoveryConfig = { mode: "custom" };
// @doc-snippet-end

// @doc-snippet backfill-ontick
async function onTickWithBackfill(ctx: StrategyContext, tick: Tick) {
  if (ctx.backfilling) {
    // Update indicators but skip order placement
    return;
  }
  // Normal trading logic...
}
// @doc-snippet-end

// @doc-snippet checkpoint-methods
class CheckpointExample {
  private zScores = new Map<string, number>();
  private lastPrices = new Map<string, number>();

  checkpoint(): unknown {
    return {
      zScores: [...this.zScores.entries()],
      lastPrices: [...this.lastPrices.entries()],
    };
  }

  restore(state: unknown): void {
    const s = state as { zScores: [string, number][]; lastPrices: [string, number][] };
    this.zScores = new Map(s.zScores);
    this.lastPrices = new Map(s.lastPrices);
  }
}
// @doc-snippet-end

// @doc-snippet custom-recover
async function recoverExample(ctx: StrategyContext, positions: Position[]) {
  // Fetch recent candles to rebuild indicator state
  const candles = await ctx.broker.getCandles("EUR_USD", "M1", 60);
  // Check existing positions from broker
  const existing = await ctx.broker.getPositions();
  // Rebuild strategy state from candles and positions...
}
// @doc-snippet-end

// Prevent unused variable warnings
void [clean, backfill, checkpoint, custom, onTickWithBackfill, CheckpointExample, recoverExample];
