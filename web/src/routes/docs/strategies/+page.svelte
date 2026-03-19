<script lang="ts">
	let { data } = $props();
	// svelte-ignore state_referenced_locally
	const d = data.docs as Record<string, any>;

	// Helper: get interface info
	function iface(name: string) { return (d.interfaces as Record<string, any>)[name]; }
	function snippet(name: string) { return (d.snippets as Record<string, any>)[name] ?? ""; }

	// Filter broker members to the ones strategies typically use (exclude streamPrices, name)
	const brokerMethods = (iface("Broker")?.members ?? []).filter(
		(m: any) => !["name", "streamPrices", "getCandlesByRange"].includes(m.name)
	);
</script>

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
			<li><a href="#live-recovery">Live Recovery</a></li>
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
		<p>Strategy files can live in three places, loaded in priority order:</p>
		<ol>
			<li><strong>User strategies</strong> &mdash; <code>data/users/&lbrace;userId&rbrace;/strategies/my-strategy.ts</code> (private, highest priority)</li>
			<li><strong>Shared strategies</strong> &mdash; <code>data/shared/strategies/my-strategy.ts</code> (community, in data volume)</li>
			<li><strong>Built-in strategies</strong> &mdash; <code>src/strategies/my-strategy.ts</code> (shipped with the app, read-only)</li>
		</ol>
		<p>
			If you have a strategy with the same filename at multiple levels, the highest-priority
			version is loaded. Copy a built-in or shared strategy to customize it.
		</p>
		<p>
			All imports must use <code>#</code>-prefixed subpath aliases (e.g., <code>#core/strategy.js</code>)
			so they resolve correctly regardless of where the file is on disk.
		</p>
	</section>

	<section id="minimal-example">
		<h2>Minimal Example</h2>
		<p>A complete strategy that buys EUR/USD when the spread narrows below a threshold:</p>
		<pre><code>{d.examples["example-spread"]}</code></pre>
	</section>

	<section id="strategy-interface">
		<h2>Strategy Interface</h2>
		<p>Your class must implement every member of the <code>Strategy</code> interface from <code>#core/strategy.js</code>:</p>
		{#if iface("Strategy")}
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Member</th><th>Type</th><th>Description</th></tr>
					</thead>
					<tbody>
						{#each iface("Strategy").members as m}
							<tr>
								<td><code>{m.name}{m.optional ? "?" : ""}</code></td>
								<td><code>{m.type}</code></td>
								<td>{m.doc || (m.readonly ? "readonly" : "")}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section id="context-and-broker">
		<h2>Context &amp; Broker API</h2>
		<p>
			The <code>ctx</code> parameter gives you access to <code>ctx.broker</code>, which implements
			the <code>Broker</code> interface. The same interface is backed by OANDA in live mode and a
			simulated broker in backtests.
		</p>
		{#if iface("StrategyContext")}
			<h3>StrategyContext</h3>
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Field</th><th>Type</th><th>Description</th></tr>
					</thead>
					<tbody>
						{#each iface("StrategyContext").members as m}
							<tr>
								<td><code>{m.name}{m.optional ? "?" : ""}</code></td>
								<td><code>{m.type}</code></td>
								<td>{m.doc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		<h3>Broker Methods</h3>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Method</th><th>Signature</th><th>Description</th></tr>
				</thead>
				<tbody>
					{#each brokerMethods as m}
						<tr>
							<td><code>{m.name}</code></td>
							<td><code>{m.type}</code></td>
							<td>{m.doc}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<h3 id="order-request">OrderRequest</h3>
		{#if iface("OrderRequest")}
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Field</th><th>Type</th><th>Description</th></tr>
					</thead>
					<tbody>
						{#each iface("OrderRequest").members as m}
							<tr>
								<td><code>{m.name}{m.optional ? "?" : ""}</code></td>
								<td><code>{m.type}</code></td>
								<td>{m.doc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section id="tick-object">
		<h2>Tick Object</h2>
		<p>Every call to <code>onTick</code> receives a <code>Tick</code>:</p>
		{#if iface("Tick")}
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Field</th><th>Type</th><th>Description</th></tr>
					</thead>
					<tbody>
						{#each iface("Tick").members as m}
							<tr>
								<td><code>{m.name}</code></td>
								<td><code>{m.type}</code></td>
								<td>{m.doc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
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
  recovery: { mode: "clean" },      // See Live Recovery below
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
  // Clean empty strings from UI form values before merging
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== "" && v != null) cleaned[k] = v;
  }
  this.config = { ...DEFAULTS, ...cleaned };
}`}</code></pre>
	</section>

	<section id="live-monitoring">
		<h2>Live Monitoring (getState)</h2>
		<p>
			The <code>getState()</code> method powers the live monitoring page. It's called after every tick
			and the returned snapshot is displayed in real time. Return useful indicators and position info
			to make monitoring easier.
		</p>
		<pre><code>{snippet("get-state")}</code></pre>
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
					{#each d.imports as imp}
						<tr>
							<td><code>{imp.path}</code></td>
							<td><code>{imp.file}</code></td>
							<td>{#each imp.exports as ex, i}{#if i > 0}, {/if}<code>{ex}</code>{/each}</td>
						</tr>
					{/each}
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

`}{snippet("backtest-signals")}</code></pre>
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
		<h3>Recovery Modes</h3>
		<pre><code>{snippet("recovery-modes")}</code></pre>
		<h3>Backfill: skip orders during replay</h3>
		<pre><code>{snippet("backfill-ontick")}</code></pre>
		<h3>Checkpoint: serialize/restore state</h3>
		<pre><code>{snippet("checkpoint-methods")}</code></pre>
		<h3>Custom: full control</h3>
		<pre><code>{snippet("custom-recover")}</code></pre>
	</section>

	<section id="tips">
		<h2>Tips</h2>
		<ul>
			<li>Use <code>hedging: "forbidden"</code> unless you specifically need simultaneous long/short on the same pair. Most OANDA practice accounts use netting.</li>
			<li>Always filter ticks by <code>tick.instrument</code> in <code>onTick</code> &mdash; you'll receive ticks for all instruments in your list.</li>
			<li>Keep a <code>DEFAULT_CONFIG</code> object and merge with constructor args. Config values from the UI may be missing or zero.</li>
			<li>The live service automatically closes all positions on shutdown, so <code>dispose()</code> only needs to clean up your internal state.</li>
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
