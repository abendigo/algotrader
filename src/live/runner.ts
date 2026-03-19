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
import { RecordingBroker } from "./recording-broker.js";
import type { Config } from "../core/config.js";
import type { Strategy } from "../core/strategy.js";
import type { Tick } from "../core/types.js";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dirname, "../../data");

const DEFAULT_INSTRUMENTS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
];

export interface SessionFile {
  sessionId: string;
  pid: number;
  userId: string;
  accountId: string;
  strategy: string;
  config: Record<string, unknown>;
  status: "starting" | "running" | "stopped" | "error";
  startedAt: string;
  lastHeartbeat: string;
  lastError?: string;
}

interface LogEntry {
  timestamp: string;
  type: "start" | "tick" | "trade" | "exit" | "error" | "stop" | "status";
  message: string;
  data?: Record<string, unknown>;
}


function getLiveDir(userId: string, accountId: string): string {
  return join(DATA_DIR, "users", userId, "live", accountId);
}

class LiveRunner {
  private broker: OandaBroker;
  private recordingBroker: RecordingBroker;
  private strategy: Strategy;
  private liveDir: string;
  private logFile: string;
  private tradesFile: string;
  private stateFile: string;
  private sessionFilePath: string | null;
  private sessionData: SessionFile | null = null;
  private tickCount = 0;
  private lastStatusTime = 0;
  private stream: { close: () => void } | null = null;
  private stopping = false;
  private accountLabel: string;

  constructor(
    config: Config,
    account: { accountId: string; label: string },
    userId: string,
    strategy: Strategy,
    sessionFilePath: string | null = null,
  ) {
    this.broker = new OandaBroker(config);
    this.recordingBroker = new RecordingBroker(this.broker, strategy.name);
    this.accountLabel = account.label;
    this.strategy = strategy;
    this.sessionFilePath = sessionFilePath;

    this.liveDir = getLiveDir(userId, account.accountId);
    if (!existsSync(this.liveDir)) mkdirSync(this.liveDir, { recursive: true });

    this.stateFile = join(this.liveDir, "state.json");
    this.tradesFile = join(this.liveDir, "trades.jsonl");
    const dateStr = new Date().toISOString().slice(0, 10);
    this.logFile = join(this.liveDir, `${dateStr}.jsonl`);
  }

  private updateSessionFile(updates: Partial<SessionFile>): void {
    if (!this.sessionFilePath) return;
    try {
      if (this.sessionData) {
        Object.assign(this.sessionData, updates);
      } else if (existsSync(this.sessionFilePath)) {
        this.sessionData = JSON.parse(readFileSync(this.sessionFilePath, "utf-8"));
        Object.assign(this.sessionData!, updates);
      } else {
        return;
      }
      writeFileSync(this.sessionFilePath, JSON.stringify(this.sessionData, null, 2));
    } catch {
      // Don't crash if session file write fails
    }
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
      this.updateSessionFile({ lastHeartbeat: new Date(timestamp).toISOString() });
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

    this.updateSessionFile({ status: "running", pid: process.pid, lastHeartbeat: new Date().toISOString() });

    const ctx = { broker: this.recordingBroker };
    await this.strategy.init(ctx);

    let processing = false;
    const tickQueue: Tick[] = [];

    const processTick = async (tick: Tick) => {
      this.tickCount++;

      try {
        await this.strategy.onTick(ctx, tick);

        // Log new entries
        for (const entry of this.recordingBroker.flushEntries()) {
          this.log({
            timestamp: entry.entryTime,
            type: "trade",
            message: `OPENED ${entry.side.toUpperCase()} ${entry.units} ${entry.instrument} @ ${entry.entryPrice} [${entry.entryOrderId}]`,
            data: { instrument: entry.instrument, side: entry.side, units: entry.units, price: entry.entryPrice, orderId: entry.entryOrderId },
          });
        }

        // Log and persist completed trades
        for (const trade of this.recordingBroker.flushTrades()) {
          appendFileSync(this.tradesFile, JSON.stringify(trade) + "\n");
          const pnlStr = (trade.pnl ?? 0) >= 0 ? `+${(trade.pnl ?? 0).toFixed(2)}` : (trade.pnl ?? 0).toFixed(2);
          const durStr = trade.durationMs ? ` (${Math.round(trade.durationMs / 60000)}min)` : "";
          this.log({
            timestamp: trade.exitTime!,
            type: "exit",
            message: `CLOSED ${trade.instrument} @ ${trade.exitPrice} | PnL=${pnlStr}${durStr} [${trade.exitOrderId}]`,
            data: { instrument: trade.instrument, exitPrice: trade.exitPrice, pnl: trade.pnl, durationMs: trade.durationMs, orderId: trade.exitOrderId },
          });
        }

        // Log failures for debugging
        for (const fail of this.recordingBroker.flushFailures()) {
          this.log({
            timestamp: fail.timestamp,
            type: "error",
            message: `${fail.method}(${fail.instrument}) FAILED: ${fail.error}`,
            data: { method: fail.method, instrument: fail.instrument, error: fail.error, request: fail.request },
          });
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
    this.updateSessionFile({ status: "stopped", lastHeartbeat: new Date().toISOString() });
  }
}

// --- CLI ---

function getFlag(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

function getFlagNumber(name: string, defaultValue: number): number {
  const raw = getFlag(name);
  if (raw == null) return defaultValue;
  const n = parseFloat(raw);
  return isNaN(n) ? defaultValue : n;
}

const userFlag = getFlag("user");
const accountFlag = getFlag("account");
const strategyFlag = getFlag("strategy");
const unitsFlag = getFlagNumber("units", 100);
const stopFracFlag = getFlag("stop-frac");
const skipDaysFlag = getFlag("skip-days");
const trailActivateFlag = getFlag("trail-activate");
const trailDistFlag = getFlag("trail-dist");
const pairsFlag = getFlag("pairs");
const sessionFileFlag = getFlag("session-file");

if (!userFlag || !strategyFlag || !accountFlag) {
  console.error("Usage: npm run live --user=<email> --strategy=<name> --account=<oanda-id> [--units=100] [--stop-frac=1.0] [--skip-days=5] [--trail-activate=0.5] [--trail-dist=0.3] [--pairs=EUR_USD,GBP_USD] [--session-file=path]");
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

const oandaConfig = getConfigForUser(user.id, accountFlag);

async function main() {
  // Build strategy config from CLI flags
  const strategyConfig: Record<string, unknown> = { units: unitsFlag };
  if (stopFracFlag != null) strategyConfig.stopRangeFraction = parseFloat(stopFracFlag);
  if (skipDaysFlag != null) strategyConfig.skipDays = skipDaysFlag.split(",").map(Number);
  if (trailActivateFlag != null) strategyConfig.trailActivateFraction = parseFloat(trailActivateFlag);
  if (trailDistFlag != null) strategyConfig.trailDistanceFraction = parseFloat(trailDistFlag);
  if (pairsFlag != null) strategyConfig.instruments = pairsFlag;

  const strategy = await loadStrategy(user!.id, strategyFlag!, strategyConfig);
  const runner = new LiveRunner(oandaConfig, { accountId: accountFlag!, label: accountFlag! }, user!.id, strategy, sessionFileFlag ?? null);

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
  // Update session file with error status
  if (sessionFileFlag && existsSync(sessionFileFlag)) {
    try {
      const session = JSON.parse(readFileSync(sessionFileFlag, "utf-8"));
      session.status = "error";
      session.lastError = err instanceof Error ? err.message : String(err);
      session.lastHeartbeat = new Date().toISOString();
      writeFileSync(sessionFileFlag, JSON.stringify(session, null, 2));
    } catch { /* ignore */ }
  }
  process.exit(1);
});
