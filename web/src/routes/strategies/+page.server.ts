import { fail, redirect } from "@sveltejs/kit";
import { listAllStrategies, listSharedAndBuiltin, hasSharedOrBuiltin, copySharedStrategy } from "$lib/server/strategies.js";
import { listReports } from "$lib/server/reports.js";
import { statSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "$lib/server/paths.js";

export async function load({ locals }) {
  if (!locals.user) throw redirect(303, "/login");

  const userId = locals.user.id;
  const allStrategies = listAllStrategies(userId);
  const userStrategies = allStrategies.filter((s) => s.source === "user");

  // Enrich user strategies with file info and best backtest
  const reports = listReports(userId);
  const userDir = join(DATA_DIR, "users", userId, "strategies");

  const enrichedUser = userStrategies.map((s) => {
    let fileSize: number | null = null;
    let modifiedAt: string | null = null;
    try {
      const stat = statSync(join(userDir, `${s.id}.ts`));
      fileSize = stat.size;
      modifiedAt = stat.mtime.toISOString();
    } catch { /* ignore */ }

    // Best backtest for this strategy (by return %)
    const stratReports = reports.filter((r) => r.strategy === s.id);
    const bestReport = stratReports.length > 0
      ? stratReports.reduce((best, r) =>
        (r.metrics?.returnPct ?? -Infinity) > (best.metrics?.returnPct ?? -Infinity) ? r : best
      ) : null;

    return {
      ...s,
      revertable: hasSharedOrBuiltin(s.id),
      fileSize,
      modifiedAt,
      bestReturn: bestReport?.metrics?.returnPct ?? null,
      bestSharpe: bestReport?.metrics?.sharpeRatio ?? null,
      backtestCount: stratReports.length,
    };
  });

  // Shared/builtin strategies (not in user's collection)
  const catalog = listSharedAndBuiltin();
  const userIds = new Set(userStrategies.map((s) => s.id));
  const available = catalog.map((s) => ({
    ...s,
    alreadyCopied: userIds.has(s.id),
  }));

  return {
    userStrategies: enrichedUser,
    available,
  };
}

export const actions = {
  copy: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const strategyId = formData.get("strategyId")?.toString() ?? "";
    const result = copySharedStrategy(locals.user.id, strategyId);
    if (!result.success) return fail(400, { error: result.error });
    return { success: true, message: "Copied to your collection" };
  },
};
