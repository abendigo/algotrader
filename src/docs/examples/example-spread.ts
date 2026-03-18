/**
 * Example strategy: buys EUR/USD when the spread narrows, sells when it widens.
 *
 * This file serves as both a runnable strategy AND the "Minimal Example" in the
 * strategy documentation. It is type-checked by the compiler, so any interface
 * changes that break this file will be caught at build time.
 */

import type { Strategy, StrategyContext, StrategyStateSnapshot } from "#core/strategy.js";
import type { Tick } from "#core/types.js";

export const strategyMeta = {
  name: "Simple Spread",
  description: "Buys EUR/USD when spread is tight, sells when it widens.",
  configFields: {
    common: {
      spreadThreshold: {
        label: "Max spread (pips)", type: "number" as const,
        default: 1.5, min: 0, step: 0.1,
      },
    },
    backtest: {},
    live: {
      units: { label: "Units", type: "number" as const, default: 1000, min: 1 },
    },
  },
};

interface Config {
  spreadThreshold: number;
  units: number;
}

const DEFAULTS: Config = { spreadThreshold: 1.5, units: 1000 };

export class SimpleSpreadStrategy implements Strategy {
  readonly name = "simple-spread";
  readonly hedging = "forbidden" as const;
  readonly instruments = ["EUR_USD"] as const;

  private config: Config;
  private inPosition = false;

  constructor(cfg: Record<string, unknown>) {
    this.config = {
      spreadThreshold: (cfg.spreadThreshold as number) ?? DEFAULTS.spreadThreshold,
      units: (cfg.units as number) ?? DEFAULTS.units,
    };
  }

  async init() {}

  async onTick(ctx: StrategyContext, tick: Tick) {
    if (tick.instrument !== "EUR_USD") return;

    const spread = (tick.ask - tick.bid) * 10_000; // convert to pips

    if (!this.inPosition && spread < this.config.spreadThreshold) {
      await ctx.broker.submitOrder({
        instrument: "EUR_USD",
        side: "buy",
        type: "market",
        units: this.config.units,
      });
      this.inPosition = true;
    } else if (this.inPosition && spread > this.config.spreadThreshold * 2) {
      await ctx.broker.closePosition("EUR_USD");
      this.inPosition = false;
    }
  }

  async dispose() {}

  getState(): StrategyStateSnapshot {
    return {
      phase: this.inPosition ? "In position" : "Watching",
      indicators: [],
      positions: [],
    };
  }
}
