/**
 * Type-checked snippet for the "Live Monitoring" docs section.
 */

import type { StrategyStateSnapshot } from "#core/strategy.js";

// @doc-snippet get-state
function getStateExample(): StrategyStateSnapshot {
  return {
    phase: "Scanning",  // Current state label
    detail: "Warming up 45/60 ticks",  // Optional extra info
    indicators: [
      { label: "Z-Score", instrument: "AUD_CAD", value: "1.82", signal: "neutral" },
      { label: "Spread", value: "1.2 pips", signal: "buy" },
    ],
    positions: [
      { instrument: "EUR_GBP", side: "sell", entryPrice: 0.8421, pnl: -2.30 },
    ],
  };
}
// @doc-snippet-end

void getStateExample;
