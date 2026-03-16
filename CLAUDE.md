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
- Commit at appropriate milestones — don't let changes pile up
- Never leave the repo in a dirty state between tasks

## Commands
(TODO: fill in as build/test/lint scripts are added)
