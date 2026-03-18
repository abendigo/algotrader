<div class="docs">
	<h1>Writing a Strategy</h1>
	<p class="subtitle">
		Everything you need to build, backtest, and deploy a custom trading strategy.
	</p>

	<nav class="toc">
		<h3>Contents</h3>
		<ol>
			<li><a href="#overview">Overview</a></li>
			<li><a href="#minimal-example">Minimal Example</a></li>
			<li><a href="#strategy-interface">Strategy Interface</a></li>
			<li><a href="#context-and-broker">Context &amp; Broker API</a></li>
			<li><a href="#tick-object">Tick Object</a></li>
			<li><a href="#strategy-meta">Strategy Metadata</a></li>
			<li><a href="#config-fields">Config Fields</a></li>
			<li><a href="#live-monitoring">Live Monitoring (getState)</a></li>
			<li><a href="#available-imports">Available Imports</a></li>
			<li><a href="#backtest-compatibility">Backtest Compatibility</a></li>
			<li><a href="#tips">Tips</a></li>
		</ol>
	</nav>

	<section id="overview">
		<h2>Overview</h2>
		<p>
			Strategies are TypeScript files that implement the <code>Strategy</code> interface.
			The same code runs in backtest, paper, and live modes &mdash; the runner swaps the broker implementation
			while your strategy logic stays identical.
		</p>
		<p>Strategy files live in one of two places:</p>
		<ul>
			<li><strong>User strategies</strong> &mdash; <code>data/users/&lbrace;userId&rbrace;/strategies/my-strategy.ts</code></li>
			<li><strong>Shared strategies</strong> &mdash; <code>data/shared/strategies/my-strategy.ts</code></li>
		</ul>
		<p>
			User strategies take priority &mdash; if you have a file with the same name as a shared strategy,
			yours will be loaded instead.
		</p>
		<p>
			All imports must use <code>#</code>-prefixed subpath aliases (e.g., <code>#core/strategy.js</code>)
			so they resolve correctly regardless of where the file is on disk.
		</p>
	</section>

	<section id="minimal-example">
		<h2>Minimal Example</h2>
		<p>A complete strategy that buys EUR/USD when the spread narrows below a threshold:</p>
		<pre><code>{`import type { Strategy, StrategyContext, StrategyStateSnapshot } from "#core/strategy.js";
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
}`}</code></pre>
	</section>

	<section id="strategy-interface">
		<h2>Strategy Interface</h2>
		<p>Your class must implement every member of the <code>Strategy</code> interface from <code>#core/strategy.js</code>:</p>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Member</th><th>Type</th><th>Description</th></tr>
				</thead>
				<tbody>
					<tr><td><code>name</code></td><td><code>string</code></td><td>Identifier used in logs and the UI. Should be kebab-case matching your filename.</td></tr>
					<tr><td><code>hedging</code></td><td><code>"required" | "forbidden" | "allowed"</code></td><td>Account compatibility. <code>"forbidden"</code> = netting (one position per instrument, most common). <code>"required"</code> = needs hedging (simultaneous long/short). <code>"allowed"</code> = works either way.</td></tr>
					<tr><td><code>instruments</code></td><td><code>readonly string[]</code> (optional)</td><td>Instruments to stream. If omitted, the runner uses the 7 USD majors: EUR_USD, GBP_USD, USD_JPY, USD_CAD, USD_CHF, AUD_USD, NZD_USD.</td></tr>
					<tr><td><code>init(ctx)</code></td><td><code>Promise&lt;void&gt;</code></td><td>Called once when the strategy starts. Use it to fetch initial data, warm up indicators, etc.</td></tr>
					<tr><td><code>onTick(ctx, tick)</code></td><td><code>Promise&lt;void&gt;</code></td><td>Called on every price tick. This is your core logic &mdash; analyze the tick, manage positions, place orders.</td></tr>
					<tr><td><code>dispose()</code></td><td><code>Promise&lt;void&gt;</code></td><td>Called on shutdown. Clean up state. (Open positions are closed automatically by the runner.)</td></tr>
					<tr><td><code>getState()</code></td><td><code>StrategyStateSnapshot</code></td><td>Returns current state for the live monitoring page. Called after every tick.</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="context-and-broker">
		<h2>Context &amp; Broker API</h2>
		<p>
			The <code>ctx</code> parameter gives you access to <code>ctx.broker</code>, which implements
			the <code>Broker</code> interface. The same interface is backed by OANDA in live mode and a
			simulated broker in backtests.
		</p>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Method</th><th>Returns</th><th>Description</th></tr>
				</thead>
				<tbody>
					<tr><td><code>getAccountSummary()</code></td><td><code>AccountSummary</code></td><td>Balance, unrealized P&amp;L, currency, hedging mode.</td></tr>
					<tr><td><code>getPositions()</code></td><td><code>Position[]</code></td><td>All open positions with instrument, side, units, average price, unrealized P&amp;L.</td></tr>
					<tr><td><code>submitOrder(order)</code></td><td><code>OrderResult</code></td><td>Place an order. See <a href="#order-request">OrderRequest</a> below.</td></tr>
					<tr><td><code>closePosition(instrument)</code></td><td><code>OrderResult</code></td><td>Close all units of a position on an instrument.</td></tr>
					<tr><td><code>getCandles(instrument, granularity, count)</code></td><td><code>Candle[]</code></td><td>Fetch recent historical candles (OHLCV).</td></tr>
					<tr><td><code>getPrice(instrument)</code></td><td><code>Tick</code></td><td>Get current bid/ask for an instrument.</td></tr>
				</tbody>
			</table>
		</div>

		<h3 id="order-request">OrderRequest</h3>
		<pre><code>{`{
  instrument: "EUR_USD",  // Instrument to trade
  side: "buy" | "sell",   // Direction
  type: "market",         // "market", "limit", or "stop"
  units: 1000,            // Position size
  price?: 1.0850,         // Required for limit/stop orders
}`}</code></pre>
	</section>

	<section id="tick-object">
		<h2>Tick Object</h2>
		<p>Every call to <code>onTick</code> receives a <code>Tick</code>:</p>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Field</th><th>Type</th><th>Description</th></tr>
				</thead>
				<tbody>
					<tr><td><code>instrument</code></td><td><code>string</code></td><td>OANDA format, e.g., <code>"EUR_USD"</code></td></tr>
					<tr><td><code>timestamp</code></td><td><code>number</code></td><td>Unix milliseconds</td></tr>
					<tr><td><code>bid</code></td><td><code>number</code></td><td>Best bid price</td></tr>
					<tr><td><code>ask</code></td><td><code>number</code></td><td>Best ask price</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Ticks arrive for all instruments listed in your <code>instruments</code> property.
			Always check <code>tick.instrument</code> before using the price.
		</p>
	</section>

	<section id="strategy-meta">
		<h2>Strategy Metadata</h2>
		<p>
			Export a <code>strategyMeta</code> constant to control how your strategy appears in the UI.
			This is optional but recommended.
		</p>
		<pre><code>{`export const strategyMeta = {
  name: "My Strategy",              // Display name
  description: "What this strategy does...",  // Shown on the strategies page
  configFields: { ... },            // See Config Fields below
};`}</code></pre>
		<p>
			If you don't export <code>strategyMeta</code>, the name is derived from the filename
			(e.g., <code>my-strategy.ts</code> becomes "My Strategy").
		</p>
	</section>

	<section id="config-fields">
		<h2>Config Fields</h2>
		<p>
			Config fields define form inputs that appear in the UI when running backtests or starting
			live sessions. Values are passed to your strategy constructor as a <code>Record&lt;string, unknown&gt;</code>.
		</p>
		<pre><code>{`configFields: {
  common: {
    // Shown in both backtest and live UI
    entryZ: { label: "Entry z-score", type: "number", default: 2.0, min: 0, step: 0.1 },
  },
  backtest: {
    // Backtest-only fields
  },
  live: {
    // Live-only fields
    units: { label: "Units", type: "number", default: 10000, min: 1 },
  },
}`}</code></pre>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Field Property</th><th>Type</th><th>Description</th></tr>
				</thead>
				<tbody>
					<tr><td><code>label</code></td><td><code>string</code></td><td>Label shown in the form</td></tr>
					<tr><td><code>type</code></td><td><code>"number" | "text"</code></td><td>Input type</td></tr>
					<tr><td><code>default</code></td><td><code>number | string</code></td><td>Default value (pre-filled in UI)</td></tr>
					<tr><td><code>min</code></td><td><code>number</code></td><td>Minimum value (number inputs only)</td></tr>
					<tr><td><code>step</code></td><td><code>number</code></td><td>Step increment (number inputs only)</td></tr>
					<tr><td><code>placeholder</code></td><td><code>string</code></td><td>Placeholder text (text inputs only)</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			In your constructor, read these from the config object and merge with defaults:
		</p>
		<pre><code>{`constructor(cfg: Record<string, unknown>) {
  this.config = {
    entryZ: (cfg.entryZ as number) ?? 2.0,
    units: (cfg.units as number) ?? 10000,
  };
}`}</code></pre>
	</section>

	<section id="live-monitoring">
		<h2>Live Monitoring (getState)</h2>
		<p>
			The <code>getState()</code> method powers the live monitoring page. It's called after every tick
			and the returned snapshot is displayed in real time. Return useful indicators and position info
			to make monitoring easier.
		</p>
		<pre><code>{`getState(): StrategyStateSnapshot {
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
}`}</code></pre>
		<p>
			The <code>signal</code> field on indicators controls color coding: <code>"buy"</code> (green),
			<code>"sell"</code> (red), <code>"neutral"</code> (gray), <code>"warn"</code> (yellow).
		</p>
	</section>

	<section id="available-imports">
		<h2>Available Imports</h2>
		<p>Use <code>#</code>-prefixed aliases for all imports. These resolve via the project's
			<code>package.json</code> <code>imports</code> field.
		</p>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Import Path</th><th>Resolves To</th><th>Key Exports</th></tr>
				</thead>
				<tbody>
					<tr>
						<td><code>#core/strategy.js</code></td>
						<td><code>src/core/strategy.ts</code></td>
						<td><code>Strategy</code>, <code>StrategyContext</code>, <code>StrategyStateSnapshot</code>, <code>StrategyIndicator</code>, <code>StrategyPosition</code>, <code>HedgingMode</code>, <code>RecoveryConfig</code></td>
					</tr>
					<tr>
						<td><code>#core/types.js</code></td>
						<td><code>src/core/types.ts</code></td>
						<td><code>Tick</code>, <code>Candle</code>, <code>Instrument</code>, <code>Side</code>, <code>OrderRequest</code>, <code>OrderResult</code>, <code>Position</code>, <code>AccountSummary</code>, <code>Granularity</code></td>
					</tr>
					<tr>
						<td><code>#core/broker.js</code></td>
						<td><code>src/core/broker.ts</code></td>
						<td><code>Broker</code> interface</td>
					</tr>
					<tr>
						<td><code>#data/instruments.js</code></td>
						<td><code>src/data/instruments.ts</code></td>
						<td><code>USD_MAJORS</code>, <code>CROSSES</code>, <code>CURRENCIES</code>, <code>parsePair()</code>, <code>findInstrument()</code>, <code>findTriangle()</code></td>
					</tr>
					<tr>
						<td><code>#backtest/types.js</code></td>
						<td><code>src/backtest/types.ts</code></td>
						<td><code>SignalSnapshot</code>, <code>Trade</code>, <code>BacktestResult</code>, <code>BacktestConfig</code></td>
					</tr>
					<tr>
						<td><code>#backtest/broker.js</code></td>
						<td><code>src/backtest/broker.ts</code></td>
						<td><code>BacktestBroker</code> class (for backtest-specific features)</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="backtest-compatibility">
		<h2>Backtest Compatibility</h2>
		<p>
			During backtests, <code>ctx.broker</code> is a <code>BacktestBroker</code>. You can check
			this to record signal snapshots for the trade journal:
		</p>
		<pre><code>{`import { BacktestBroker } from "#backtest/broker.js";
import type { SignalSnapshot } from "#backtest/types.js";

// Inside onTick:
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
  ctx.broker.recordSignal(signal);
}`}</code></pre>
		<p>
			Signal snapshots are attached to trades in the backtest report, making it easier to
			debug entry/exit decisions.
		</p>
	</section>

	<section id="live-recovery">
		<h2>Live Recovery</h2>
		<p>
			When a strategy is restarted (service restart, crash recovery), the service uses the
			<code>recovery</code> field in <code>strategyMeta</code> to decide how to restore state.
			If omitted, the default is <code>"clean"</code> (restart fresh).
		</p>
		<pre><code>{`// In strategyMeta:
recovery: { mode: "clean" }            // Default — restart fresh
recovery: { mode: "backfill", lookback: 120, granularity: "M1" }  // Replay candles
recovery: { mode: "checkpoint" }        // Serialize/restore state
recovery: { mode: "custom" }            // Strategy handles recovery

// For "backfill" mode, ctx.backfilling is true during candle replay:
async onTick(ctx: StrategyContext, tick: Tick) {
  if (ctx.backfilling) {
    // Update indicators but skip order placement
    this.updateIndicators(tick);
    return;
  }
  // Normal trading logic...
}

// For "checkpoint" mode, implement checkpoint() and restore():
checkpoint() { return { zScores: this.zScores, lastPrices: this.lastPrices }; }
restore(state: any) { this.zScores = state.zScores; this.lastPrices = state.lastPrices; }

// For "custom" mode, implement recover():
async recover(ctx: StrategyContext, positions: Position[]) {
  // Fetch your own candles, rebuild state, check existing positions...
}`}</code></pre>
	</section>

	<section id="tips">
		<h2>Tips</h2>
		<ul>
			<li>Use <code>hedging: "forbidden"</code> unless you specifically need simultaneous long/short on the same pair. Most OANDA practice accounts use netting.</li>
			<li>Always filter ticks by <code>tick.instrument</code> in <code>onTick</code> &mdash; you'll receive ticks for all instruments in your list.</li>
			<li>Keep a <code>DEFAULT_CONFIG</code> object and merge with constructor args. Config values from the UI may be missing or zero.</li>
			<li>The runner automatically closes all positions on shutdown, so <code>dispose()</code> only needs to clean up your internal state.</li>
			<li>Test with backtests first. Use the "Realistic" preset (1.5x spread, 0.5 pip slippage) to avoid overfitting to ideal conditions.</li>
			<li>For cross-pair strategies, use the helpers from <code>#data/instruments.js</code> &mdash; <code>parsePair()</code> splits <code>"AUD_CAD"</code> into currencies, <code>findTriangle()</code> finds the USD legs for any cross.</li>
			<li>The class name must end with <code>Strategy</code> (e.g., <code>MyCustomStrategy</code>). This is how the loader auto-discovers it.</li>
			<li>The filename is the strategy ID. Use kebab-case: <code>my-strategy.ts</code> is loaded with <code>--strategy=my-strategy</code>.</li>
		</ul>
	</section>
</div>

<style>
	.docs {
		max-width: 800px;
		margin: 0 auto;
		padding-bottom: 80px;
	}
	h1 {
		font-size: 1.8em;
		color: #c9d1d9;
		margin-bottom: 4px;
	}
	.subtitle {
		color: #8b949e;
		font-size: 1em;
		margin-bottom: 32px;
	}
	.toc {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 16px 24px;
		margin-bottom: 32px;
	}
	.toc h3 {
		font-size: 0.9em;
		color: #8b949e;
		margin: 0 0 8px;
	}
	.toc ol {
		margin: 0;
		padding-left: 20px;
	}
	.toc li {
		font-size: 0.9em;
		line-height: 1.8;
	}
	section {
		margin-bottom: 40px;
	}
	h2 {
		font-size: 1.3em;
		color: #c9d1d9;
		border-bottom: 1px solid #21262d;
		padding-bottom: 6px;
		margin-bottom: 12px;
	}
	h3 {
		font-size: 1em;
		color: #c9d1d9;
		margin: 20px 0 8px;
	}
	p {
		color: #c9d1d9;
		font-size: 0.92em;
		line-height: 1.7;
		margin: 8px 0;
	}
	ul, ol {
		color: #c9d1d9;
		font-size: 0.92em;
		line-height: 1.8;
		padding-left: 24px;
	}
	li {
		margin-bottom: 4px;
	}
	code {
		background: #1c2128;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 0.88em;
		color: #79c0ff;
	}
	pre {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 16px;
		overflow-x: auto;
		margin: 12px 0;
	}
	pre code {
		background: none;
		padding: 0;
		font-size: 0.85em;
		color: #c9d1d9;
		line-height: 1.6;
	}
	.table-wrap {
		overflow-x: auto;
		margin: 12px 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88em;
	}
	th {
		text-align: left;
		padding: 8px 12px;
		color: #8b949e;
		border-bottom: 2px solid #21262d;
		white-space: nowrap;
	}
	td {
		padding: 8px 12px;
		border-bottom: 1px solid #21262d;
		color: #c9d1d9;
		vertical-align: top;
	}
	td code {
		white-space: nowrap;
	}
	tr:hover td {
		background: #1c2128;
	}
</style>
