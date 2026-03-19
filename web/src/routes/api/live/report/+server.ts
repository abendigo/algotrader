import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "$lib/server/paths.js";
import { computeStats, type TestResult, type TestTrade } from "../../../../../../src/core/test-result.js";
import { exportHTML, type ReportMeta } from "../../../../../../src/backtest/export-html.js";
import { exportCSV } from "../../../../../../src/backtest/export-csv.js";

interface RawTrade {
  strategy?: string;
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

/**
 * GET /api/live/report?session=<sessionId>&format=html|csv
 * Generate and return a paper trading report for a session.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

  const sessionId = url.searchParams.get("session");
  const format = url.searchParams.get("format") ?? "html";
  if (!sessionId) return json({ error: "session is required" }, { status: 400 });

  const userId = locals.user.id;

  // Load session file
  const sessionPath = join(DATA_DIR, "users", userId, "live-sessions", `${sessionId}.json`);
  if (!existsSync(sessionPath)) return json({ error: "Session not found" }, { status: 404 });

  const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
  const strategyName = session.strategy;
  const accountId = session.accountId;

  // Load trades
  const tradesFile = join(DATA_DIR, "users", userId, "live", accountId, "trades.jsonl");
  if (!existsSync(tradesFile)) return json({ error: "No trades file found" }, { status: 404 });

  const lines = readFileSync(tradesFile, "utf-8").split("\n").filter(Boolean);
  const allTrades: RawTrade[] = lines.map((l) => JSON.parse(l));

  // Filter to this session's time window and strategy
  const sessionStart = new Date(session.startedAt).getTime();
  const sessionEnd = new Date(session.lastHeartbeat).getTime();
  const sessionTrades = allTrades.filter((t) => {
    if (t.strategy && t.strategy !== strategyName) return false;
    if (!t.exitTime) return false;
    const entryTime = new Date(t.entryTime).getTime();
    return entryTime >= sessionStart && entryTime <= sessionEnd;
  });

  // Convert to TestTrade format
  const trades: TestTrade[] = sessionTrades.map((t) => ({
    instrument: t.instrument,
    side: t.side,
    units: t.units,
    entryPrice: t.side === "buy" ? t.entryAsk : t.entryBid,
    exitPrice: t.side === "buy" ? (t.exitBid ?? t.entryBid) : (t.exitAsk ?? t.entryAsk),
    entryTime: new Date(t.entryTime).getTime(),
    exitTime: new Date(t.exitTime!).getTime(),
    pnl: t.pnl ?? 0,
  }));

  // Build TestResult
  const initialBalance = 1000; // TODO: get from account at session start
  const stats = computeStats(trades, initialBalance);
  const result: TestResult = {
    source: "paper",
    strategyName,
    startTime: sessionStart,
    endTime: sessionEnd,
    trades,
    ...stats,
  };

  if (format === "csv") {
    const csv = exportCSV(result);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${strategyName}-paper-${sessionId}.csv"`,
      },
    });
  }

  const html = exportHTML(result, strategyName);
  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
