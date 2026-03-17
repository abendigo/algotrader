/**
 * Live/paper trading runner.
 *
 * Usage: npm run live --user=<email> --strategy=<name> [--account=<id>] [--units=100]
 *
 * Connects to OANDA using the user's stored credentials, streams prices,
 * and feeds them into the strategy assigned to the account.
 *
 * Logs and state are written to data/users/{userId}/live/{accountId}/.
 * Multiple instances can run concurrently for different accounts.
 *
 * Press Ctrl+C to stop gracefully (closes open positions first).
 */

import { OandaBroker } from "../brokers/oanda/index.js";
import { getConfigForUser } from "../core/config.js";
import { findUser } from "../core/users.js";
import { loadStrategy } from "../core/strategy-loader.js";
import type { Config } from "../core/config.js";
import type { Strategy } from "../core/strategy.js";
import type { Tick } from "../core/types.js";
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dirname, "../../data");

const DEFAULT_INSTRUMENTS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
];

interface LogEntry {
  timestamp: string;
  type: "start" | "tick" | "trade" | "exit" | "error" | "stop" | "status";
  message: string;
  data?: Record<string, unknown>;
}


function getLiveDir(userId: string, accountId: string): string {
  return join(DATA_DIR, "users", userId, "live", accountId);
}

interface TradeRecord {
  instrument: string;
  side: "buy" | "sell";
  units: number;
  entryTime: string;
  entryBid: number;
  entryAsk: number;
  exitTime?: string;
  exitBid?: number;
  exitAsk?: number;
  pnl?: number;
  durationMs?: number;
}

class LiveRunner {
  private broker: OandaBroker;
  private strategy: Strategy;
  private liveDir: string;
  private logFile: string;
  private tradesFile: string;
  private stateFile: string;
  private tickCount = 0;
  private lastStatusTime = 0;
  private stream: { close: () => void } | null = null;
  private stopping = false;
  private accountLabel: string;
  private openTrades = new Map<string, TradeRecord>();

  constructor(
    config: Config,
    account: { accountId: string; label: string },
    userId: string,
    strategy: Strategy,
  ) {
    this.broker = new OandaBroker(config);
    this.accountLabel = account.label;
    this.strategy = strategy;

    this.liveDir = getLiveDir(userId, account.accountId);
    if (!existsSync(this.liveDir)) mkdirSync(this.liveDir, { recursive: true });

    this.stateFile = join(this.liveDir, "state.json");
    this.tradesFile = join(this.liveDir, "trades.jsonl");
    const dateStr = new Date().toISOString().slice(0, 10);
    this.logFile = join(this.liveDir, `${dateStr}.jsonl`);
  }

  private writeState(timestamp: number): void {
    try {
      const strategyState = this.strategy.getState();
      const state = {
        timestamp: new Date(timestamp).toISOString(),
        running: !this.stopping,
        tickCount: this.tickCount,
        strategy: strategyState,
        strategyName: this.strategy.name,
      };
      writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch {
      // Don't crash the runner if state write fails
    }
  }

  private log(entry: LogEntry): void {
    const line = JSON.stringify(entry);
    appendFileSync(this.logFile, line + "\n");

    if (entry.type !== "tick") {
      const time = entry.timestamp.slice(11, 19);
      console.log(`[${time}] ${entry.type.toUpperCase()}: ${entry.message}`);
    }
  }

  async start(): Promise<void> {
    const account = await this.broker.getAccountSummary();

    // Enforce hedging compatibility
    const hedging = this.strategy.hedging;
    if (hedging === "required" && !account.hedgingEnabled) {
      throw new Error(`Strategy "${this.strategy.name}" requires a hedging account, but this account has hedging disabled.`);
    }
    if (hedging === "forbidden" && account.hedgingEnabled) {
      throw new Error(`Strategy "${this.strategy.name}" requires a netting account, but this account has hedging enabled.`);
    }

    this.log({
      timestamp: new Date().toISOString(),
      type: "start",
      message: `${this.strategy.name} started. Balance: $${account.balance.toFixed(2)}, Currency: ${account.currency}, Hedging: ${account.hedgingEnabled ? "yes" : "no"}`,
      data: { strategy: this.strategy.name, balance: account.balance, currency: account.currency, hedgingEnabled: account.hedgingEnabled },
    });

    const instruments = this.strategy.instruments
      ? [...this.strategy.instruments]
      : DEFAULT_INSTRUMENTS;

    console.log(`\n${this.strategy.name} — Live Paper Trading`);
    console.log(`${"=".repeat(this.strategy.name.length + 24)}`);
    console.log(`Account:         ${this.accountLabel}`);
    console.log(`Account balance: $${account.balance.toFixed(2)}`);
    console.log(`Hedging:         ${account.hedgingEnabled ? "enabled" : "disabled"}`);
    console.log(`Instruments:     ${instruments.length} (${instruments.slice(0, 5).join(", ")}${instruments.length > 5 ? "..." : ""})`);
    console.log(`Log dir:         ${this.liveDir}`);
    console.log(`\nStreaming prices... (Ctrl+C to stop)\n`);

    const ctx = { broker: this.broker };
    await this.strategy.init(ctx);

    let knownPositions = new Map<string, number>();

    const syncPositions = async (): Promise<Map<string, number>> => {
      const positions = await this.broker.getPositions();
      const map = new Map<string, number>();
      for (const p of positions) {
        map.set(p.instrument, p.side === "buy" ? p.units : -p.units);
      }
      return map;
    };

    knownPositions = await syncPositions();

    let processing = false;
    const tickQueue: Tick[] = [];

    const processTick = async (tick: Tick) => {
      this.tickCount++;

      try {
        const beforeSnapshot = new Map(knownPositions);
        await this.strategy.onTick(ctx, tick);
        knownPositions = await syncPositions();

        const allInstruments = new Set([...beforeSnapshot.keys(), ...knownPositions.keys()]);
        for (const inst of allInstruments) {
          const before = beforeSnapshot.get(inst) ?? 0;
          const after = knownPositions.get(inst) ?? 0;

          if (before === 0 && after !== 0) {
            const side = after > 0 ? "buy" : "sell";
            const ts = new Date(tick.timestamp).toISOString();
            this.log({
              timestamp: ts,
              type: "trade",
              message: `OPENED ${side.toUpperCase()} ${Math.abs(after)} ${inst} @ bid=${tick.bid} ask=${tick.ask}`,
              data: { instrument: inst, side, units: Math.abs(after), bid: tick.bid, ask: tick.ask },
            });
            // Track open trade for P&L on exit
            this.openTrades.set(inst, {
              instrument: inst,
              side: side as "buy" | "sell",
              units: Math.abs(after),
              entryTime: ts,
              entryBid: tick.bid,
              entryAsk: tick.ask,
            });
          } else if (before !== 0 && after === 0) {
            const ts = new Date(tick.timestamp).toISOString();
            const entry = this.openTrades.get(inst);
            let pnl = 0;
            let durationMs = 0;
            if (entry) {
              // P&L: buy entered at ask, exit at bid; sell entered at bid, exit at ask
              const entryPrice = entry.side === "buy" ? entry.entryAsk : entry.entryBid;
              const exitPrice = entry.side === "buy" ? tick.bid : tick.ask;
              pnl = entry.side === "buy"
                ? (exitPrice - entryPrice) * entry.units
                : (entryPrice - exitPrice) * entry.units;
              durationMs = tick.timestamp - new Date(entry.entryTime).getTime();

              // Write completed trade record
              const record: TradeRecord = {
                ...entry,
                exitTime: ts,
                exitBid: tick.bid,
                exitAsk: tick.ask,
                pnl,
                durationMs,
              };
              appendFileSync(this.tradesFile, JSON.stringify(record) + "\n");
              this.openTrades.delete(inst);
            }

            const pnlStr = pnl >= 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2);
            const durStr = durationMs > 0 ? ` (${Math.round(durationMs / 60000)}min)` : "";
            this.log({
              timestamp: ts,
              type: "exit",
              message: `CLOSED ${inst} @ bid=${tick.bid} ask=${tick.ask} | PnL=${pnlStr}${durStr}`,
              data: { instrument: inst, bid: tick.bid, ask: tick.ask, pnl, durationMs },
            });
          }
        }

        this.writeState(tick.timestamp);

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

    this.stream = await this.broker.streamPrices(
      instruments,
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

    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }

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

    try {
      const account = await this.broker.getAccountSummary();
      this.log({
        timestamp: new Date().toISOString(),
        type: "stop",
        message: `${this.strategy.name} stopped. Final balance: $${account.balance.toFixed(2)}. Ticks processed: ${this.tickCount}`,
        data: { strategy: this.strategy.name, balance: account.balance, ticksProcessed: this.tickCount },
      });
      console.log(`\nFinal balance: $${account.balance.toFixed(2)}`);
      console.log(`Ticks processed: ${this.tickCount}`);
    } catch (err) {
      console.error("Error getting final balance:", err);
    }

    await this.strategy.dispose();
  }
}

// --- CLI ---

const userFlag = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1];
const accountFlag = process.argv.find((a) => a.startsWith("--account="))?.split("=")[1];
const strategyFlag = process.argv.find((a) => a.startsWith("--strategy="))?.split("=")[1];
const unitsFlag = parseInt(
  process.argv.find((a) => a.startsWith("--units="))?.split("=")[1] ?? "100",
  10,
);

if (!userFlag || !strategyFlag || !accountFlag) {
  console.error("Usage: npm run live --user=<email> --strategy=<name> --account=<oanda-id> [--units=100]");
  if (!userFlag) console.error("  Missing: --user");
  if (!strategyFlag) console.error("  Missing: --strategy");
  if (!accountFlag) console.error("  Missing: --account");
  process.exit(1);
}

const user = findUser(userFlag);
if (!user) {
  console.error(`User not found: ${userFlag}`);
  process.exit(1);
}

const config = getConfigForUser(user.id, accountFlag);

async function main() {
  const strategy = await loadStrategy(user!.id, strategyFlag!, { units: unitsFlag });
  const runner = new LiveRunner(config, { accountId: accountFlag!, label: accountFlag! }, user!.id, strategy);

  process.on("SIGINT", async () => {
    await runner.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await runner.stop();
    process.exit(0);
  });

  await runner.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
