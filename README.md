# Algotrader

Algorithmic trading system supporting backtesting, paper trading, and live execution.

## Supported Markets

### Forex (OANDA) — Primary
- 70+ forex pairs via OANDA REST v20 API
- Built-in paper trading via practice account
- Streaming prices via WebSocket
- Historical candle data through the API

### Futures (Tradovate) — Planned
- Micro contracts (MES, MNQ, MGC) for granular position sizing
- REST + WebSocket API with built-in paper trading
- Nearly 24-hour markets Sun-Fri

### Crypto (Binance) — Planned
- Spot and futures, testnet for paper trading

### Crypto DEX (Hyperliquid) — Stretch Goal
- On-chain order book, no gas fees on trades

## Strategy: Cross-Currency Lead-Lag

The core thesis: when the USD strengthens or weakens, not all pairs reprice simultaneously. Majors (EUR/USD, USD/JPY) move first; crosses (AUD/CAD, GBP/NZD) lag behind. This creates short-lived mispricings.

### How it works
1. Stream all USD-denominated pairs in real time
2. Compute a USD strength index from major pairs
3. Derive implied cross rates (e.g., implied AUD/CAD = USD/CAD ÷ USD/AUD)
4. Compare implied vs actual quoted cross rates
5. When deviation exceeds a threshold, trade the cross toward its implied value
6. Exit when the deviation mean-reverts

### Key questions to validate via backtesting
- Which pairs consistently lag? (lead-lag correlation analysis)
- What is the typical lag duration? (seconds vs minutes)
- Does the spread eat the edge? (realistic cost modeling)
- Are lead-lag relationships stable over time?

## Modes
- **Backtest** — replay historical candle/tick data
- **Paper** — live data, simulated execution (OANDA practice account)
- **Live** — real execution against live account
