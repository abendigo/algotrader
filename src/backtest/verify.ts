/**
 * Backtest engine verification test.
 *
 * Creates synthetic price data with known values, runs a trivial strategy,
 * and verifies every trade and the final balance match hand calculations.
 *
 * Usage: npx tsx src/backtest/verify.ts
 */

import type { Strategy, StrategyContext, StrategyStateSnapshot } from "../core/strategy.js";
import type { Tick, Instrument } from "../core/types.js";
import { BacktestBroker } from "./broker.js";
import type { Trade } from "./types.js";

// ===== Test Harness =====

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, msg: string): void {
  if (Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg} — expected ${expected}, got ${actual} (diff ${(actual - expected).toFixed(6)})`);
  }
}

// ===== Synthetic Ticks =====

function makeTick(instrument: string, timestamp: number, price: number): Tick {
  return { instrument, timestamp, bid: price, ask: price };
}

// ===== Test 1: Simple buy and sell on EUR_USD (quote = USD, account = USD) =====

async function testSimpleBuySell(): Promise<void> {
  console.log("\nTest 1: Simple buy/sell on EUR_USD (USD account)");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "USD");
  // Zero spread — fill at exact price

  // Feed EUR_USD at 1.10000
  const tick1 = makeTick("EUR_USD", 1000, 1.10000);
  broker.setTick(tick1);

  // Buy 100 units
  const entry = await broker.submitOrder({ instrument: "EUR_USD", side: "buy", type: "market", units: 100 });
  assertClose(entry.filledPrice, 1.10000, 0.00001, "Entry price should be 1.10000");

  // Price moves to 1.10500
  const tick2 = makeTick("EUR_USD", 2000, 1.10500);
  broker.setTick(tick2);

  // Close position
  const exit = await broker.closePosition("EUR_USD");
  assertClose(exit.filledPrice, 1.10500, 0.00001, "Exit price should be 1.10500");

  // P&L: (1.10500 - 1.10000) * 100 = 0.50 USD
  // Quote currency is USD, account is USD — no conversion
  const trades = broker.getTrades();
  assert(trades.length === 1, "Should have 1 trade");
  assertClose(trades[0].pnl, 0.50, 0.001, "P&L should be $0.50");
  assertClose(broker.getBalance(), 1000.50, 0.001, "Balance should be $1000.50");

  if (trades[0].conversion) {
    assert(trades[0].conversion.quoteCurrency === "USD", "Quote currency should be USD");
    assert(trades[0].conversion.accountCurrency === "USD", "Account currency should be USD");
    assertClose(trades[0].conversion.conversionRate, 1, 0.001, "Conversion rate should be 1");
    assert(trades[0].conversion.conversionPair === "none", "Conversion pair should be 'none'");
  }
}

// ===== Test 2: Buy USD_JPY (quote = JPY, account = USD) =====

async function testCurrencyConversion(): Promise<void> {
  console.log("\nTest 2: Buy USD_JPY (JPY quote, USD account)");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "USD");

  // Feed USD_JPY at 150.000
  broker.setTick(makeTick("USD_JPY", 1000, 150.000));

  // Buy 100 units
  await broker.submitOrder({ instrument: "USD_JPY", side: "buy", type: "market", units: 100 });

  // Price moves to 151.000 (1 yen gain per unit)
  broker.setTick(makeTick("USD_JPY", 2000, 151.000));

  await broker.closePosition("USD_JPY");

  // P&L in quote (JPY): (151.000 - 150.000) * 100 = 100 JPY
  // Convert to USD: 100 / 151.000 = 0.6623 USD
  const trades = broker.getTrades();
  assert(trades.length === 1, "Should have 1 trade");
  assertClose(trades[0].pnl, 100 / 151.000, 0.01, `P&L should be ~${(100 / 151).toFixed(4)} USD`);

  if (trades[0].conversion) {
    assertClose(trades[0].conversion.pnlQuote, 100, 0.01, "P&L in quote should be 100 JPY");
    assert(trades[0].conversion.quoteCurrency === "JPY", "Quote should be JPY");
    assert(trades[0].conversion.conversionPair === "USD_JPY", "Should convert via USD_JPY");
  }
}

// ===== Test 3: CAD account trading EUR_USD (two-hop: USD → CAD) =====

async function testTwoHopConversion(): Promise<void> {
  console.log("\nTest 3: CAD account trading EUR_USD (two-hop conversion)");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "CAD");

  // Feed EUR_USD and USD_CAD
  broker.setTick(makeTick("EUR_USD", 1000, 1.10000));
  broker.setTick(makeTick("USD_CAD", 1000, 1.37000));

  // Buy 100 EUR_USD
  await broker.submitOrder({ instrument: "EUR_USD", side: "buy", type: "market", units: 100 });

  // Price moves to 1.10500, USD_CAD stays at 1.37
  broker.setTick(makeTick("EUR_USD", 2000, 1.10500));
  broker.setTick(makeTick("USD_CAD", 2000, 1.37000));

  await broker.closePosition("EUR_USD");

  // P&L in quote (USD): (1.10500 - 1.10000) * 100 = 0.50 USD
  // Convert to CAD: 0.50 * 1.37 = 0.685 CAD
  const trades = broker.getTrades();
  assert(trades.length === 1, "Should have 1 trade");
  assertClose(trades[0].pnl, 0.50 * 1.37, 0.01, `P&L should be ~${(0.50 * 1.37).toFixed(4)} CAD`);

  if (trades[0].conversion) {
    assertClose(trades[0].conversion.pnlQuote, 0.50, 0.001, "P&L in quote should be 0.50 USD");
    assert(trades[0].conversion.quoteCurrency === "USD", "Quote should be USD");
    assert(trades[0].conversion.accountCurrency === "CAD", "Account should be CAD");
  }
}

// ===== Test 4: Spread is applied correctly =====

async function testSpread(): Promise<void> {
  console.log("\nTest 4: Spread applied correctly");

  // Spread of 0.0002 (2 pips on EUR/USD)
  const broker = new BacktestBroker(1000, 0.0002, 1, false, 0, "USD");

  broker.setTick(makeTick("EUR_USD", 1000, 1.10000));

  // Buy: should fill at mid + half spread = 1.10000 + 0.0001 = 1.10010
  const entry = await broker.submitOrder({ instrument: "EUR_USD", side: "buy", type: "market", units: 100 });
  assertClose(entry.filledPrice, 1.10010, 0.00001, "Buy should fill at 1.10010 (mid + half spread)");

  // Close at same price: sell at mid - half spread = 1.10000 - 0.0001 = 1.09990
  const exit = await broker.closePosition("EUR_USD");
  assertClose(exit.filledPrice, 1.09990, 0.00001, "Sell should fill at 1.09990 (mid - half spread)");

  // P&L: (1.09990 - 1.10010) * 100 = -0.02 USD (lost the spread)
  const trades = broker.getTrades();
  assertClose(trades[0].pnl, -0.02, 0.001, "Round-trip P&L should be -$0.02 (spread cost)");
}

// ===== Test 5: Sell (short) trade =====

async function testShort(): Promise<void> {
  console.log("\nTest 5: Short trade on EUR_USD");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "USD");

  broker.setTick(makeTick("EUR_USD", 1000, 1.10000));

  // Sell 100 units
  await broker.submitOrder({ instrument: "EUR_USD", side: "sell", type: "market", units: 100 });

  // Price drops to 1.09500 (good for shorts)
  broker.setTick(makeTick("EUR_USD", 2000, 1.09500));

  await broker.closePosition("EUR_USD");

  // P&L: (1.10000 - 1.09500) * 100 = 0.50 USD
  const trades = broker.getTrades();
  assertClose(trades[0].pnl, 0.50, 0.001, "Short P&L should be $0.50");
}

// ===== Test 6: Losing trade =====

async function testLosingTrade(): Promise<void> {
  console.log("\nTest 6: Losing buy trade");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "USD");

  broker.setTick(makeTick("EUR_USD", 1000, 1.10000));
  await broker.submitOrder({ instrument: "EUR_USD", side: "buy", type: "market", units: 100 });

  // Price drops
  broker.setTick(makeTick("EUR_USD", 2000, 1.09000));
  await broker.closePosition("EUR_USD");

  // P&L: (1.09000 - 1.10000) * 100 = -1.00 USD
  const trades = broker.getTrades();
  assertClose(trades[0].pnl, -1.00, 0.001, "Losing buy P&L should be -$1.00");
  assertClose(broker.getBalance(), 999.00, 0.001, "Balance should be $999.00");
}

// ===== Test 7: Multiple trades, balance accumulation =====

async function testMultipleTrades(): Promise<void> {
  console.log("\nTest 7: Multiple trades, balance accumulation");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "USD");

  // Trade 1: buy EUR_USD 1.10 → 1.11 = +$1.00
  broker.setTick(makeTick("EUR_USD", 1000, 1.10000));
  await broker.submitOrder({ instrument: "EUR_USD", side: "buy", type: "market", units: 100 });
  broker.setTick(makeTick("EUR_USD", 2000, 1.11000));
  await broker.closePosition("EUR_USD");

  // Trade 2: sell EUR_USD 1.11 → 1.10 = +$1.00
  broker.setTick(makeTick("EUR_USD", 3000, 1.11000));
  await broker.submitOrder({ instrument: "EUR_USD", side: "sell", type: "market", units: 100 });
  broker.setTick(makeTick("EUR_USD", 4000, 1.10000));
  await broker.closePosition("EUR_USD");

  // Trade 3: buy EUR_USD 1.10 → 1.09 = -$1.00
  broker.setTick(makeTick("EUR_USD", 5000, 1.10000));
  await broker.submitOrder({ instrument: "EUR_USD", side: "buy", type: "market", units: 100 });
  broker.setTick(makeTick("EUR_USD", 6000, 1.09000));
  await broker.closePosition("EUR_USD");

  const trades = broker.getTrades();
  assert(trades.length === 3, "Should have 3 trades");
  assertClose(trades[0].pnl, 1.00, 0.001, "Trade 1 P&L: +$1.00");
  assertClose(trades[1].pnl, 1.00, 0.001, "Trade 2 P&L: +$1.00");
  assertClose(trades[2].pnl, -1.00, 0.001, "Trade 3 P&L: -$1.00");

  // Net: +1 +1 -1 = +1
  assertClose(broker.getBalance(), 1001.00, 0.001, "Final balance should be $1001.00");
}

// ===== Test 8: CAD account trading USD_JPY (two-hop: JPY → USD → CAD) =====

async function testTwoHopJpyCad(): Promise<void> {
  console.log("\nTest 8: CAD account trading USD_JPY (JPY → USD → CAD)");

  const broker = new BacktestBroker(1000, 0, 1, false, 0, "CAD");

  broker.setTick(makeTick("USD_JPY", 1000, 150.000));
  broker.setTick(makeTick("USD_CAD", 1000, 1.37000));

  await broker.submitOrder({ instrument: "USD_JPY", side: "buy", type: "market", units: 100 });

  broker.setTick(makeTick("USD_JPY", 2000, 151.500));
  broker.setTick(makeTick("USD_CAD", 2000, 1.37000));

  await broker.closePosition("USD_JPY");

  // P&L in JPY: (151.5 - 150.0) * 100 = 150 JPY
  // JPY → USD: 150 / 151.5 = 0.9901 USD
  // USD → CAD: 0.9901 * 1.37 = 1.3564 CAD
  const expectedCad = (150 / 151.5) * 1.37;
  const trades = broker.getTrades();
  assertClose(trades[0].pnl, expectedCad, 0.01, `P&L should be ~${expectedCad.toFixed(4)} CAD`);

  if (trades[0].conversion) {
    assertClose(trades[0].conversion.pnlQuote, 150, 0.01, "P&L in quote should be 150 JPY");
  }
}

// ===== Run all tests =====

async function main(): Promise<void> {
  console.log("Backtest Engine Verification");
  console.log("============================");

  await testSimpleBuySell();
  await testCurrencyConversion();
  await testTwoHopConversion();
  await testSpread();
  await testShort();
  await testLosingTrade();
  await testMultipleTrades();
  await testTwoHopJpyCad();

  console.log(`\n============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
