# Algotrader

## Stack
- TypeScript
- Node.js

## Architecture
- Core engine with strategy/broker/data abstractions
- Broker connectors are swappable — same strategy code runs in backtest, paper, and live modes
- Multi-pair streaming data feed

## Broker Priority
1. OANDA (forex) — primary target, REST v20 API + streaming
2. Tradovate (futures) — modern REST + WebSocket API, micro contracts
3. Binance (crypto) — testnet for paper trading
4. Hyperliquid (on-chain) — stretch goal

## First Strategy: Cross-Currency Lead-Lag
- Track all USD pairs to build a USD strength signal
- Compute implied cross rates from majors (e.g., implied AUD/CAD = USD/CAD ÷ USD/AUD)
- When actual cross rate deviates from implied → trade toward implied
- Mean reversion timeframe: seconds to minutes
- Key hypothesis: crosses (AUD/CAD, etc.) reprice slower than majors (EUR/USD, etc.)

## Workflow
- Always check for uncommitted changes (`git status`) before starting any new work
- **Commit after every logical unit of work** (new feature, refactor, bugfix) — do NOT batch multiple features into one commit session
- If a task produces changes across multiple concerns, split into separate commits
- Never leave the repo in a dirty state between tasks
- When in doubt, commit more often rather than less

## Commands
- `npm run build` — compile TypeScript to dist/
- `npm run typecheck` — type check without emitting
- `npm run dev` — run src/index.ts with tsx
- `npm run collect [granularity] [days]` — pull historical candles from OANDA (e.g., `npm run collect M1 7`)
- `npm run analyze [granularity]` — run lead-lag analysis on collected data (e.g., `npm run analyze M1`)
- `npm run backtest [strategy] [granularity]` — run backtest (e.g., `npm run backtest lead-lag M1`)
  - Strategies: `lead-lag`, `cross-drift`, `currency-momentum`, `session-divergence`, `london-breakout`, `cross-momentum`, `range-fade`, `correlation-pairs`
  - Generates HTML, CSV, and JSON reports in `reports/`
- `npm run regenerate [filename]` — regenerate HTML/CSV from saved JSON results
- `npm run live` — run London Breakout strategy live on OANDA practice account (logs to `logs/`)
