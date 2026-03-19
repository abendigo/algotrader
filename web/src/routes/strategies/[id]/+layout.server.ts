import { error, redirect } from "@sveltejs/kit";
import { existsSync, readFileSync, statSync } from "fs";
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
    isAdmin: locals.user.role === "admin",
  };
}
