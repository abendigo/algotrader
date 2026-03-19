import { error, redirect } from "@sveltejs/kit";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { DATA_DIR, PROJECT_ROOT } from "$lib/server/paths.js";
import { listAllStrategies, hasSharedOrBuiltin } from "$lib/server/strategies.js";
import { getApiKey, discoverAccounts } from "$lib/server/auth.js";
import { getDataSummary } from "$lib/server/data.js";
import { listReports } from "$lib/server/reports.js";

const EDITOR_TYPES_PATH = join(PROJECT_ROOT, "web/src/lib/generated/editor-types.json");

export async function load({ params, locals }) {
  if (!locals.user) throw redirect(303, "/login");

  const userId = locals.user.id;
  const id = params.id;

  // Find strategy metadata
  const allStrategies = listAllStrategies(userId);
  const meta = allStrategies.find((s) => s.id === id);
  if (!meta) throw error(404, "Strategy not found");

  const isUserOwned = meta.source === "user";

  // Load source code (only for user-owned strategies)
  let source = "";
  let fileSize: number | null = null;
  let modifiedAt: string | null = null;
  if (isUserOwned) {
    const filePath = join(DATA_DIR, "users", userId, "strategies", `${id}.ts`);
    if (existsSync(filePath)) {
      source = readFileSync(filePath, "utf-8");
      const stat = statSync(filePath);
      fileSize = stat.size;
      modifiedAt = stat.mtime.toISOString();
    }
  }

  // Editor types
  let types: Record<string, string> = {};
  if (existsSync(EDITOR_TYPES_PATH)) {
    types = JSON.parse(readFileSync(EDITOR_TYPES_PATH, "utf-8"));
  }

  // Accounts for live trading
  let accounts: { id: string; alias: string; hedgingEnabled: boolean }[] = [];
  if (locals.user.hasApiKey) {
    const apiKey = getApiKey(userId);
    if (apiKey) {
      const result = await discoverAccounts(apiKey);
      accounts = result.accounts.map((a) => ({
        id: a.id,
        alias: a.alias || a.id,
        hedgingEnabled: a.hedgingEnabled,
      }));
    }
  }

  // Granularities for backtesting
  const dataSummary = getDataSummary();
  const availableGranularities = dataSummary.brokers.flatMap((b) =>
    b.granularities.map((g) => ({ name: g.name, from: g.dateRange.from, to: g.dateRange.to })),
  );

  // Backtest reports for this strategy
  const allReports = listReports(userId);
  const strategyReports = allReports.filter((r) => r.strategy === id);

  // Past sessions for this strategy
  // Load all trades for this user, indexed by account
  interface TradeRecord {
    strategy?: string;
    instrument: string;
    side: string;
    units: number;
    entryTime: string;
    exitTime?: string;
    pnl?: number;
  }
  const tradesByAccount = new Map<string, TradeRecord[]>();
  const liveDir = join(DATA_DIR, "users", userId, "live");
  if (existsSync(liveDir)) {
    for (const acct of readdirSync(liveDir)) {
      const tradesFile = join(liveDir, acct, "trades.jsonl");
      if (!existsSync(tradesFile)) continue;
      try {
        const lines = readFileSync(tradesFile, "utf-8").split("\n").filter(Boolean);
        tradesByAccount.set(acct, lines.map((l) => JSON.parse(l)));
      } catch { /* ignore */ }
    }
  }

  interface PastSession {
    sessionId: string;
    accountId: string;
    config: Record<string, unknown>;
    status: string;
    lastError: string | null;
    startedAt: string;
    lastHeartbeat: string;
    trades: number;
    totalPnl: number;
    winners: number;
    losers: number;
  }
  const pastSessions: PastSession[] = [];
  const sessionsDir = join(DATA_DIR, "users", userId, "live-sessions");
  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
      try {
        const sf = JSON.parse(readFileSync(join(sessionsDir, f), "utf-8"));
        if (sf.strategy === id) {
          // Match trades to this session by account, strategy, and time window
          const accountTrades = tradesByAccount.get(sf.accountId) ?? [];
          const sessionStart = new Date(sf.startedAt).getTime();
          const sessionEnd = new Date(sf.lastHeartbeat).getTime();
          const matched = accountTrades.filter((t) => {
            if (t.strategy && t.strategy !== id && t.strategy !== sf.strategy) return false;
            const entryTime = new Date(t.entryTime).getTime();
            return entryTime >= sessionStart && entryTime <= sessionEnd;
          });

          pastSessions.push({
            sessionId: sf.sessionId,
            accountId: sf.accountId,
            config: sf.config ?? {},
            status: sf.status,
            lastError: sf.lastError ?? sf.error ?? null, // runner used 'error' historically
            startedAt: sf.startedAt,
            lastHeartbeat: sf.lastHeartbeat,
            trades: matched.length,
            totalPnl: matched.reduce((sum, t) => sum + (t.pnl ?? 0), 0),
            winners: matched.filter((t) => (t.pnl ?? 0) > 0).length,
            losers: matched.filter((t) => (t.pnl ?? 0) < 0).length,
          });
        }
      } catch { /* ignore */ }
    }
    pastSessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  return {
    strategy: {
      ...meta,
      isUserOwned,
      revertable: isUserOwned ? hasSharedOrBuiltin(id) : false,
      fileSize,
      modifiedAt,
    },
    source,
    types,
    accounts,
    availableGranularities,
    reports: strategyReports,
    pastSessions,
    isAdmin: locals.user.role === "admin",
  };
}
