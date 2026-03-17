/**
 * Live/paper trading runner for the London Breakout strategy.
 *
 * Usage: npm run live
 *
 * Connects to OANDA, streams prices for USD majors, and feeds them
 * into the London Breakout strategy. All decisions and trades are
 * logged to logs/live-{date}.jsonl.
 *
 * The strategy handles all logic (Asian range tracking, breakout
 * detection, position management, session-end exits). This runner
 * just provides the plumbing.
 *
 * Press Ctrl+C to stop gracefully (closes open positions first).
 */

import { OandaBroker } from "../brokers/oanda/index.js";
import { getConfig } from "../core/config.js";
import type { Tick } from "../core/types.js";
import { LondonBreakoutStrategy } from "../strategies/london-breakout.js";
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(import.meta.dirname, "../../logs");
const STATE_FILE = join(LOGS_DIR, "live-state.json");
const INSTRUMENTS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
] as const;

interface LogEntry {
  timestamp: string;
  type: "start" | "tick" | "trade" | "exit" | "error" | "stop" | "status";
  message: string;
  data?: Record<string, unknown>;
}

class LiveRunner {
  private broker: OandaBroker;
  private strategy: LondonBreakoutStrategy;
  private logFile: string;
  private tickCount = 0;
  private lastStatusTime = 0;
  private stream: { close: () => void } | null = null;
  private stopping = false;

  constructor() {
    const config = getConfig();
    this.broker = new OandaBroker(config);

    this.strategy = new LondonBreakoutStrategy({
      minBreakoutFraction: 0.1,
      rewardRatio: 0,
      maxRangePct: 0.005,
      minRangePct: 0.0005,
      units: 100,
      riskPerTrade: 0,
      stopRangeFraction: 1.0,
      trailActivateFraction: 2.0,
      trailDistanceFraction: 1.0,
      instruments: [...INSTRUMENTS],
      skipDays: [5],
    });

    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    this.logFile = join(LOGS_DIR, `live-${dateStr}.jsonl`);
  }

  private writeState(timestamp: number): void {
    try {
      const strategyState = this.strategy.getState();
      const state = {
        timestamp: new Date(timestamp).toISOString(),
        running: !this.stopping,
        tickCount: this.tickCount,
        strategy: strategyState,
      };
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch {
      // Don't crash the runner if state write fails
    }
  }

  private log(entry: LogEntry): void {
    const line = JSON.stringify(entry);
    appendFileSync(this.logFile, line + "\n");

    // Also print important events to console
    if (entry.type !== "tick") {
      const time = entry.timestamp.slice(11, 19);
      console.log(`[${time}] ${entry.type.toUpperCase()}: ${entry.message}`);
    }
  }

  async start(): Promise<void> {
    // Verify connection
    const account = await this.broker.getAccountSummary();
    this.log({
      timestamp: new Date().toISOString(),
      type: "start",
      message: `Connected to OANDA. Balance: $${account.balance.toFixed(2)}, Currency: ${account.currency}`,
      data: { balance: account.balance, currency: account.currency },
    });

    console.log(`\nLondon Breakout — Live Paper Trading`);
    console.log(`====================================`);
    console.log(`Account balance: $${account.balance.toFixed(2)}`);
    console.log(`Instruments:     ${INSTRUMENTS.join(", ")}`);
    console.log(`Units per trade: 100`);
    console.log(`Log file:        ${this.logFile}`);
    console.log(`\nStreaming prices... (Ctrl+C to stop)\n`);

    // Initialize strategy
    const ctx = { broker: this.broker };
    await this.strategy.init(ctx);

    // Track known positions locally to detect changes without API calls
    let knownPositions = new Map<string, number>();

    // Sync positions from broker periodically
    const syncPositions = async (): Promise<Map<string, number>> => {
      const positions = await this.broker.getPositions();
      const map = new Map<string, number>();
      for (const p of positions) {
        map.set(p.instrument, p.side === "buy" ? p.units : -p.units);
      }
      return map;
    };

    // Initial sync
    knownPositions = await syncPositions();

    // Queue for ticks — process them sequentially to avoid race conditions
    let processing = false;
    const tickQueue: Tick[] = [];

    const processTick = async (tick: Tick) => {
      this.tickCount++;

      try {
        const beforeSnapshot = new Map(knownPositions);

        // Feed tick to strategy
        await this.strategy.onTick(ctx, tick);

        // Sync positions after strategy runs (only 1 API call)
        knownPositions = await syncPositions();

        // Detect changes
        const allInstruments = new Set([...beforeSnapshot.keys(), ...knownPositions.keys()]);
        for (const inst of allInstruments) {
          const before = beforeSnapshot.get(inst) ?? 0;
          const after = knownPositions.get(inst) ?? 0;

          if (before === 0 && after !== 0) {
            this.log({
              timestamp: new Date(tick.timestamp).toISOString(),
              type: "trade",
              message: `OPENED ${after > 0 ? "BUY" : "SELL"} ${Math.abs(after)} ${inst} @ bid=${tick.bid} ask=${tick.ask}`,
              data: { instrument: inst, units: after, bid: tick.bid, ask: tick.ask },
            });
          } else if (before !== 0 && after === 0) {
            this.log({
              timestamp: new Date(tick.timestamp).toISOString(),
              type: "exit",
              message: `CLOSED ${inst} @ bid=${tick.bid} ask=${tick.ask}`,
              data: { instrument: inst, bid: tick.bid, ask: tick.ask },
            });
          }
        }

        // Write state file on every tick (lightweight — just overwrites a small JSON)
        this.writeState(tick.timestamp);

        // Periodic status update (every 5 minutes)
        if (tick.timestamp - this.lastStatusTime > 300_000) {
          this.lastStatusTime = tick.timestamp;
          const acct = await this.broker.getAccountSummary();
          const positions = await this.broker.getPositions();
          const openPos = positions.map((p) =>
            `${p.instrument} ${p.side} ${p.units}u PnL=$${p.unrealizedPL.toFixed(2)}`
          );
          this.log({
            timestamp: new Date(tick.timestamp).toISOString(),
            type: "status",
            message: `Balance: $${acct.balance.toFixed(2)}, Unrealized: $${acct.unrealizedPL.toFixed(2)}, Positions: ${openPos.length}`,
            data: {
              balance: acct.balance,
              unrealizedPL: acct.unrealizedPL,
              positions: openPos,
              ticksProcessed: this.tickCount,
            },
          });
        }
      } catch (err) {
        this.log({
          timestamp: new Date(tick.timestamp).toISOString(),
          type: "error",
          message: `Error processing tick: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    const drainQueue = async () => {
      if (processing) return;
      processing = true;
      while (tickQueue.length > 0) {
        if (this.stopping) break;
        const tick = tickQueue.shift()!;
        await processTick(tick);
      }
      processing = false;
    };

    // Start streaming
    this.stream = await this.broker.streamPrices(
      [...INSTRUMENTS],
      (tick: Tick) => {
        if (this.stopping) return;
        tickQueue.push(tick);
        drainQueue();
      },
    );
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    console.log("\nStopping...");

    // Close the price stream
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }

    // Close any open positions
    try {
      const positions = await this.broker.getPositions();
      for (const pos of positions) {
        console.log(`Closing ${pos.instrument} ${pos.side} ${pos.units}u...`);
        await this.broker.closePosition(pos.instrument);
      }
      if (positions.length > 0) {
        console.log(`Closed ${positions.length} positions.`);
      }
    } catch (err) {
      console.error("Error closing positions:", err);
    }

    // Final account status
    try {
      const account = await this.broker.getAccountSummary();
      this.log({
        timestamp: new Date().toISOString(),
        type: "stop",
        message: `Stopped. Final balance: $${account.balance.toFixed(2)}. Ticks processed: ${this.tickCount}`,
        data: { balance: account.balance, ticksProcessed: this.tickCount },
      });
      console.log(`\nFinal balance: $${account.balance.toFixed(2)}`);
      console.log(`Ticks processed: ${this.tickCount}`);
    } catch (err) {
      console.error("Error getting final balance:", err);
    }

    await this.strategy.dispose();
  }
}

// --- Main ---

const runner = new LiveRunner();

// Graceful shutdown on Ctrl+C
process.on("SIGINT", async () => {
  await runner.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await runner.stop();
  process.exit(0);
});

runner.start().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
