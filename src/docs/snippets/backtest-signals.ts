/**
 * Type-checked snippet for the "Backtest Compatibility" docs section.
 */

import { BacktestBroker } from "#backtest/broker.js";
import type { SignalSnapshot } from "#backtest/types.js";
import type { StrategyContext } from "#core/strategy.js";

// @doc-snippet backtest-signals
// Inside onTick:
function recordSignalExample(ctx: StrategyContext) {
  if (ctx.broker instanceof BacktestBroker) {
    const signal: SignalSnapshot = {
      zScore: 2.1,
      deviation: 0.003,
      deviationMean: 0.001,
      deviationStd: 0.001,
      impliedRate: 0.9012,
      actualRate: 0.9042,
      legA: "AUD_USD", legAPrice: 0.6543,
      legB: "USD_CAD", legBPrice: 1.3789,
    };
    ctx.broker.setEntrySignal(signal);
  }
}
// @doc-snippet-end

void recordSignalExample;
