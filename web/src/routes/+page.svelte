<script lang="ts">
</script>

<div class="landing">
	<div class="hero">
		<h1>Algotrader</h1>
		<p class="tagline">Algorithmic forex trading with backtested strategies</p>
		<p class="description">
			Build, backtest, and deploy trading strategies across multiple brokers.
			Real-time price streaming, historical data analysis, and comprehensive
			trade reporting.
		</p>
		<div class="cta">
			<a href="/register" class="btn primary">Get Started</a>
			<a href="/login" class="btn secondary">Log In</a>
		</div>
	</div>

	<div class="features">
		<div class="feature">
			<h3>Backtesting Engine</h3>
			<p>Test strategies against years of historical data with realistic spread models, slippage simulation, and time-varying costs.</p>
		</div>
		<div class="feature">
			<h3>Live Trading</h3>
			<p>Stream real-time prices, monitor positions, and execute trades on OANDA with paper or live accounts.</p>
		</div>
		<div class="feature">
			<h3>Strategy Library</h3>
			<p>London Breakout, Cross-Currency Lead-Lag, Currency Momentum, Correlation Pairs, and more.</p>
		</div>
		<div class="feature">
			<h3>Trade Reports</h3>
			<p>Detailed HTML reports with equity curves, trade journals, per-instrument breakdown, and strategy explainers.</p>
		</div>
	</div>
</div>

<style>
	.landing {
		max-width: 800px;
		margin: 0 auto;
	}
	.hero {
		text-align: center;
		padding: 80px 0 60px;
	}
	h1 {
		font-size: 2.8em;
		color: #58a6ff;
		margin-bottom: 12px;
	}
	.tagline {
		font-size: 1.2em;
		color: #c9d1d9;
		margin-bottom: 16px;
	}
	.description {
		color: #8b949e;
		font-size: 0.95em;
		max-width: 500px;
		margin: 0 auto 32px;
		line-height: 1.6;
	}
	.cta {
		display: flex;
		gap: 12px;
		justify-content: center;
	}
	.btn {
		padding: 10px 24px;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.95em;
		text-decoration: none;
	}
	.btn.primary {
		background: #238636;
		color: #fff;
	}
	.btn.primary:hover {
		background: #2ea043;
		text-decoration: none;
	}
	.btn.secondary {
		background: #21262d;
		color: #c9d1d9;
		border: 1px solid #30363d;
	}
	.btn.secondary:hover {
		background: #30363d;
		text-decoration: none;
	}
	.features {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 16px;
		padding-bottom: 60px;
	}
	.feature {
		background: #161b22;
		border: 1px solid #21262d;
		border-radius: 8px;
		padding: 20px;
	}
	.feature h3 {
		color: #c9d1d9;
		font-size: 1em;
		margin-bottom: 8px;
	}
	.feature p {
		color: #8b949e;
		font-size: 0.85em;
		line-height: 1.5;
	}
</style>
