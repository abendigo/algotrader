/**
 * SessionManager — strategy lifecycle, error isolation, recovery, and restart.
 *
 * Manages all strategy sessions within a user's service. Each session gets its
 * own OandaBroker instance (strategies may use different accounts) and is
 * registered with the StreamManager for shared tick delivery.
 */

import { OandaBroker } from "../brokers/oanda/index.js";
import { getConfigForUser } from "../core/config.js";
import { loadStrategy } from "../core/strategy-loader.js";
import { RecordingBroker } from "./recording-broker.js";
import type { Strategy, StrategyContext, RecoveryConfig } from "../core/strategy.js";
import type { Config } from "../core/config.js";
import type { Tick, Position } from "../core/types.js";
import type { StreamManager } from "./stream-manager.js";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dirname, "../../data");

const DEFAULT_INSTRUMENTS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
];

const MAX_CONSECUTIVE_ERRORS = 5;

export interface SessionFile {
  sessionId: string;
  userId: string;
  accountId: string;
  strategy: string;
  config: Record<string, unknown>;
  status: "starting" | "running" | "stopped" | "error";
  startedAt: string;
  lastHeartbeat: string;
  restartCount: number;
  lastError: string | null;
}

interface LiveSession {
  sessionId: string;
  accountId: string;
  strategyName: string;
  strategy: Strategy;
  broker: OandaBroker;
  recordingBroker: RecordingBroker;
  ctx: StrategyContext;
  config: Record<string, unknown>;
  sessionFile: SessionFile;
  sessionFilePath: string;
  liveDir: string;
  logFile: string;
  tradesFile: string;
  stateFile: string;
  checkpointFile: string;
  tickCount: number;
  consecutiveErrors: number;
  lastStatusTime: number;
  processing: boolean;
  tickQueue: Tick[];
  recovery?: RecoveryConfig;
}

interface LogEntry {
  timestamp: string;
  type: "start" | "tick" | "trade" | "exit" | "error" | "stop" | "status" | "recovery";
  message: string;
  sessionId?: string;
  strategy?: string;
  data?: Record<string, unknown>;
}

export class SessionManager {
  private sessions = new Map<string, LiveSession>();
  private streamManager: StreamManager;
  private userId: string;
  private userEmail: string;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onIdle: (() => void) | null = null;

  constructor(
    streamManager: StreamManager,
    userId: string,
    userEmail: string,
    onIdle?: () => void,
  ) {
    this.streamManager = streamManager;
    this.userId = userId;
    this.userEmail = userEmail;
    this.onIdle = onIdle ?? null;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  getSessions(): SessionFile[] {
    return [...this.sessions.values()].map((s) => s.sessionFile);
  }

  getSession(sessionId: string): SessionFile | undefined {
    return this.sessions.get(sessionId)?.sessionFile;
  }

  /**
   * Start a new strategy session.
   */
  async startSession(
    accountId: string,
    strategyName: string,
    config: Record<string, unknown>,
  ): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
    // Check for existing running session on this account + strategy
    for (const s of this.sessions.values()) {
      if (s.accountId === accountId && s.strategyName === strategyName && s.sessionFile.status === "running") {
        return { ok: false, error: `Session already running for ${strategyName} on ${accountId}` };
      }
    }

    this.cancelIdleTimer();

    const sessionId = `${accountId}-${strategyName}-${Date.now()}`;

    try {
      const session = await this.createSession(sessionId, accountId, strategyName, config);
      await this.initializeSession(session, false);
      return { ok: true, sessionId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, error };
    }
  }

  /**
   * Stop a running session: unregister from stream, close positions, dispose strategy.
   */
  async stopSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: "Session not found" };

    await this.teardownSession(session, "stopped");
    this.sessions.delete(sessionId);
    this.checkIdle();
    return { ok: true };
  }

  /**
   * Stop all sessions (for service shutdown).
   */
  async stopAll(): Promise<void> {
    const promises = [...this.sessions.keys()].map((id) => this.stopSession(id));
    await Promise.allSettled(promises);
  }

  /**
   * Resume sessions from session files on startup (crash recovery).
   */
  async resumeFromFiles(): Promise<void> {
    const sessionsDir = join(DATA_DIR, "users", this.userId, "live-sessions");
    if (!existsSync(sessionsDir)) return;

    const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const filePath = join(sessionsDir, file);
        const sf = JSON.parse(readFileSync(filePath, "utf-8")) as SessionFile;

        // Only resume sessions that were running when the service crashed
        if (sf.status !== "running" && sf.status !== "starting") continue;
        if (sf.userId !== this.userId) continue;

        console.log(`[SessionManager] Resuming session ${sf.sessionId} (${sf.strategy} on ${sf.accountId})`);

        try {
          const session = await this.createSession(
            sf.sessionId,
            sf.accountId,
            sf.strategy,
            sf.config,
          );
          session.sessionFile.restartCount = (sf.restartCount ?? 0) + 1;
          await this.initializeSession(session, true);
        } catch (err) {
          console.error(`[SessionManager] Failed to resume ${sf.sessionId}:`, err);
          sf.status = "error";
          sf.lastError = err instanceof Error ? err.message : String(err);
          sf.lastHeartbeat = new Date().toISOString();
          writeFileSync(filePath, JSON.stringify(sf, null, 2));
        }
      } catch {
        // Skip malformed files
      }
    }
  }

  // --- Internal ---

  private streamConfigured = false;

  private async createSession(
    sessionId: string,
    accountId: string,
    strategyName: string,
    config: Record<string, unknown>,
  ): Promise<LiveSession> {
    const oandaConfig = getConfigForUser(this.userEmail, accountId);
    const broker = new OandaBroker(oandaConfig);

    // Configure the shared stream with the first real account ID we see
    if (!this.streamConfigured) {
      this.streamManager.setConfig(oandaConfig);
      this.streamConfigured = true;
    }

    const strategy = await loadStrategy(this.userId, strategyName, config);

    // Extract recovery config from strategyMeta if available
    let recovery: RecoveryConfig | undefined;
    try {
      const { listStrategies } = await import("../core/strategy-loader.js");
      const meta = listStrategies(this.userId).find((m) => m.id === strategyName);
      recovery = meta?.recovery;
    } catch { /* ignore */ }

    const liveDir = join(DATA_DIR, "users", this.userId, "live", accountId);
    if (!existsSync(liveDir)) mkdirSync(liveDir, { recursive: true });

    const sessionsDir = join(DATA_DIR, "users", this.userId, "live-sessions");
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

    const sessionFilePath = join(sessionsDir, `${sessionId}.json`);
    const dateStr = new Date().toISOString().slice(0, 10);

    const sessionFile: SessionFile = {
      sessionId,
      userId: this.userId,
      accountId,
      strategy: strategyName,
      config,
      status: "starting",
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      restartCount: 0,
      lastError: null,
    };
    writeFileSync(sessionFilePath, JSON.stringify(sessionFile, null, 2));

    const recordingBroker = new RecordingBroker(broker, strategyName);
    const session: LiveSession = {
      sessionId,
      accountId,
      strategyName,
      strategy,
      broker,
      recordingBroker,
      ctx: { broker: recordingBroker },
      config,
      sessionFile,
      sessionFilePath,
      liveDir,
      logFile: join(liveDir, `${dateStr}.jsonl`),
      tradesFile: join(liveDir, "trades.jsonl"),
      stateFile: join(liveDir, `state-${sessionId}.json`),
      checkpointFile: join(liveDir, `checkpoint-${sessionId}.json`),
      tickCount: 0,
      consecutiveErrors: 0,
      lastStatusTime: 0,
      processing: false,
      tickQueue: [],
      recovery,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  private async initializeSession(session: LiveSession, isRestart: boolean): Promise<void> {
    const { strategy, ctx, broker } = session;

    // Write fresh state immediately so the web UI doesn't show stale data
    this.writeState(session, Date.now());

    // Enforce hedging compatibility
    const account = await broker.getAccountSummary();
    if (strategy.hedging === "required" && !account.hedgingEnabled) {
      throw new Error(`Strategy "${strategy.name}" requires a hedging account`);
    }
    if (strategy.hedging === "forbidden" && account.hedgingEnabled) {
      throw new Error(`Strategy "${strategy.name}" requires a netting account`);
    }

    // Run recovery or init
    if (isRestart) {
      await this.runRecovery(session);
    } else {
      await strategy.init(ctx);
    }

    // Update session file
    session.sessionFile.status = "running";
    session.sessionFile.lastHeartbeat = new Date().toISOString();
    this.writeSessionFile(session);

    this.log(session, {
      timestamp: new Date().toISOString(),
      type: "start",
      message: `${strategy.name} ${isRestart ? "resumed" : "started"}. Balance: $${account.balance.toFixed(2)}`,
      data: { strategy: strategy.name, balance: account.balance, isRestart },
    });

    // Register with stream manager
    const instruments = strategy.instruments
      ? [...strategy.instruments]
      : DEFAULT_INSTRUMENTS;

    this.streamManager.addListener(session.sessionId, instruments, (tick: Tick) => {
      session.tickQueue.push(tick);
      this.drainQueue(session);
    });
  }

  private async runRecovery(session: LiveSession): Promise<void> {
    const { strategy, ctx, broker, recovery } = session;
    const mode = recovery?.mode ?? "clean";

    this.log(session, {
      timestamp: new Date().toISOString(),
      type: "recovery",
      message: `Running ${mode} recovery for ${strategy.name}`,
    });

    const positions = await broker.getPositions();

    switch (mode) {
      case "clean":
        await strategy.init(ctx);
        break;

      case "backfill": {
        const { lookback, granularity } = recovery as { mode: "backfill"; lookback: number; granularity: string };
        await strategy.init(ctx);

        // Get instruments to backfill
        const instruments = strategy.instruments
          ? [...strategy.instruments]
          : DEFAULT_INSTRUMENTS;

        // Fetch candles and replay as synthetic ticks
        const backfillCtx: StrategyContext = { ...ctx, backfilling: true };
        for (const instrument of instruments) {
          try {
            const candles = await broker.getCandles(instrument, granularity as any, lookback);
            for (const candle of candles) {
              const syntheticTick: Tick = {
                instrument,
                timestamp: candle.timestamp,
                bid: candle.close,
                ask: candle.close, // midpoint candle — bid=ask=close
              };
              await strategy.onTick(backfillCtx, syntheticTick);
            }
          } catch (err) {
            console.error(`[SessionManager] Backfill error for ${instrument}:`, err);
          }
        }

        this.log(session, {
          timestamp: new Date().toISOString(),
          type: "recovery",
          message: `Backfill complete: ${instruments.length} instruments, ${lookback} candles each`,
        });
        break;
      }

      case "checkpoint": {
        if (strategy.restore && existsSync(session.checkpointFile)) {
          try {
            const checkpoint = JSON.parse(readFileSync(session.checkpointFile, "utf-8"));
            await strategy.init(ctx);
            strategy.restore(checkpoint);
            this.log(session, {
              timestamp: new Date().toISOString(),
              type: "recovery",
              message: "Restored from checkpoint",
            });
          } catch (err) {
            console.error(`[SessionManager] Checkpoint restore failed, falling back to clean init:`, err);
            await strategy.init(ctx);
          }
        } else {
          await strategy.init(ctx);
        }
        break;
      }

      case "custom": {
        if (strategy.recover) {
          await strategy.recover(ctx, positions);
        } else {
          console.warn(`[SessionManager] Strategy declares "custom" recovery but has no recover() method, falling back to init()`);
          await strategy.init(ctx);
        }
        break;
      }
    }
  }

  private async drainQueue(session: LiveSession): Promise<void> {
    if (session.processing) return;
    session.processing = true;

    while (session.tickQueue.length > 0) {
      if (session.sessionFile.status !== "running") break;
      const tick = session.tickQueue.shift()!;
      await this.processTick(session, tick);
    }

    session.processing = false;
  }

  private async processTick(session: LiveSession, tick: Tick): Promise<void> {
    session.tickCount++;

    try {
      await session.strategy.onTick(session.ctx, tick);
      session.consecutiveErrors = 0;

      // Log new entries
      for (const entry of session.recordingBroker.flushEntries()) {
        this.log(session, {
          timestamp: entry.entryTime,
          type: "trade",
          message: `OPENED ${entry.side.toUpperCase()} ${entry.units} ${entry.instrument} @ ${entry.entryPrice} [${entry.entryOrderId}]`,
          data: { instrument: entry.instrument, side: entry.side, units: entry.units, price: entry.entryPrice, orderId: entry.entryOrderId },
        });
      }

      // Log and persist completed trades
      for (const trade of session.recordingBroker.flushTrades()) {
        appendFileSync(session.tradesFile, JSON.stringify(trade) + "\n");
        const pnlStr = (trade.pnl ?? 0) >= 0 ? `+${(trade.pnl ?? 0).toFixed(2)}` : (trade.pnl ?? 0).toFixed(2);
        const durStr = trade.durationMs ? ` (${Math.round(trade.durationMs / 60000)}min)` : "";
        this.log(session, {
          timestamp: trade.exitTime!,
          type: "exit",
          message: `CLOSED ${trade.instrument} @ ${trade.exitPrice} | PnL=${pnlStr}${durStr} [${trade.exitOrderId}]`,
          data: { instrument: trade.instrument, exitPrice: trade.exitPrice, pnl: trade.pnl, durationMs: trade.durationMs, orderId: trade.exitOrderId },
        });
      }

      // Log failures for debugging
      for (const fail of session.recordingBroker.flushFailures()) {
        this.log(session, {
          timestamp: fail.timestamp,
          type: "error",
          message: `${fail.method}(${fail.instrument}) FAILED: ${fail.error}`,
          data: { method: fail.method, instrument: fail.instrument, error: fail.error, request: fail.request as any },
        });
      }

      // Write state
      this.writeState(session, tick.timestamp);

      // Write checkpoint if applicable
      if (session.recovery?.mode === "checkpoint" && session.strategy.checkpoint) {
        try {
          const state = session.strategy.checkpoint();
          writeFileSync(session.checkpointFile, JSON.stringify(state));
        } catch { /* don't crash on checkpoint failure */ }
      }

      // Periodic status log
      if (tick.timestamp - session.lastStatusTime > 300_000) {
        session.lastStatusTime = tick.timestamp;
        await this.logStatus(session, tick.timestamp);
      }
    } catch (err) {
      session.consecutiveErrors++;
      const errMsg = err instanceof Error ? err.message : String(err);

      this.log(session, {
        timestamp: new Date(tick.timestamp).toISOString(),
        type: "error",
        message: `Error processing tick: ${errMsg}`,
        data: { consecutiveErrors: session.consecutiveErrors },
      });

      if (session.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[SessionManager] ${session.sessionId} hit ${MAX_CONSECUTIVE_ERRORS} consecutive errors, marking as error`);
        session.sessionFile.status = "error";
        session.sessionFile.lastError = errMsg;
        this.writeSessionFile(session);
        this.streamManager.removeListener(session.sessionId);
        this.sessions.delete(session.sessionId);
        this.checkIdle();
      } else {
        // Auto-restart: reload strategy and re-initialize
        console.log(`[SessionManager] Restarting ${session.sessionId} after error (${session.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
        await this.restartSession(session);
      }
    }
  }

  private async restartSession(session: LiveSession): Promise<void> {
    // Unregister from stream
    this.streamManager.removeListener(session.sessionId);

    try {
      await session.strategy.dispose();
    } catch { /* ignore dispose errors */ }

    try {
      // Reload strategy
      session.strategy = await loadStrategy(this.userId, session.strategyName, session.config);
      session.recordingBroker = new RecordingBroker(session.broker, session.strategyName);
      session.ctx = { broker: session.recordingBroker };
      session.sessionFile.restartCount++;
      session.tickQueue = [];
      session.processing = false;

      await this.initializeSession(session, true);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[SessionManager] Failed to restart ${session.sessionId}:`, errMsg);
      session.sessionFile.status = "error";
      session.sessionFile.lastError = errMsg;
      this.writeSessionFile(session);
      this.sessions.delete(session.sessionId);
      this.checkIdle();
    }
  }

  private async teardownSession(session: LiveSession, status: "stopped" | "error"): Promise<void> {
    this.streamManager.removeListener(session.sessionId);

    // Close positions
    try {
      const positions = await session.broker.getPositions();
      for (const pos of positions) {
        console.log(`[SessionManager] Closing ${pos.instrument} ${pos.side} ${pos.units}u...`);
        await session.broker.closePosition(pos.instrument);
      }
    } catch (err) {
      console.error(`[SessionManager] Error closing positions:`, err);
    }

    // Get final balance for log
    try {
      const account = await session.broker.getAccountSummary();
      this.log(session, {
        timestamp: new Date().toISOString(),
        type: "stop",
        message: `${session.strategy.name} stopped. Final balance: $${account.balance.toFixed(2)}. Ticks: ${session.tickCount}`,
        data: { balance: account.balance, ticksProcessed: session.tickCount },
      });
    } catch { /* ignore */ }

    try {
      await session.strategy.dispose();
    } catch { /* ignore */ }

    session.sessionFile.status = status;
    session.sessionFile.lastHeartbeat = new Date().toISOString();
    this.writeSessionFile(session);
  }

  private async logStatus(session: LiveSession, timestamp: number): Promise<void> {
    try {
      const acct = await session.broker.getAccountSummary();
      const positions = await session.broker.getPositions();
      const openPos = positions.map((p) =>
        `${p.instrument} ${p.side} ${p.units}u PnL=$${p.unrealizedPL.toFixed(2)}`
      );
      this.log(session, {
        timestamp: new Date(timestamp).toISOString(),
        type: "status",
        message: `Balance: $${acct.balance.toFixed(2)}, Unrealized: $${acct.unrealizedPL.toFixed(2)}, Positions: ${openPos.length}`,
        data: {
          balance: acct.balance,
          unrealizedPL: acct.unrealizedPL,
          positions: openPos,
          ticksProcessed: session.tickCount,
        },
      });
    } catch { /* ignore */ }
  }

  private writeState(session: LiveSession, timestamp: number): void {
    try {
      const strategyState = session.strategy.getState();
      const state = {
        timestamp: new Date(timestamp).toISOString(),
        running: true,
        tickCount: session.tickCount,
        strategy: strategyState,
        strategyName: session.strategy.name,
      };
      writeFileSync(session.stateFile, JSON.stringify(state, null, 2));
      session.sessionFile.lastHeartbeat = new Date(timestamp).toISOString();
      this.writeSessionFile(session);
    } catch { /* ignore */ }
  }

  private writeSessionFile(session: LiveSession): void {
    try {
      writeFileSync(session.sessionFilePath, JSON.stringify(session.sessionFile, null, 2));
    } catch { /* ignore */ }
  }

  private log(session: LiveSession, entry: LogEntry): void {
    entry.sessionId = session.sessionId;
    entry.strategy = session.strategyName;
    const line = JSON.stringify(entry);
    appendFileSync(session.logFile, line + "\n");

    if (entry.type !== "tick") {
      const time = entry.timestamp.slice(11, 19);
      console.log(`[${session.sessionId}] [${time}] ${entry.type.toUpperCase()}: ${entry.message}`);
    }
  }

  private checkIdle(): void {
    if (this.sessions.size === 0 && this.onIdle) {
      console.log("[SessionManager] No active sessions, starting 60s idle timer...");
      this.idleTimer = setTimeout(() => {
        if (this.sessions.size === 0 && this.onIdle) {
          console.log("[SessionManager] Idle timeout reached, triggering shutdown...");
          this.onIdle();
        }
      }, 60_000);
    }
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
