import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { startBacktest, type BacktestOptions } from "$lib/server/processes.js";

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const strategy = body.strategy as string;
  const granularity = (body.granularity as string) || "M1";

  if (!strategy) return json({ error: "strategy is required" }, { status: 400 });

  const options: BacktestOptions = {};
  if (body.spreadMult != null) options.spreadMult = body.spreadMult;
  if (body.execDelay != null) options.execDelay = body.execDelay;
  if (body.entryDelay != null) options.entryDelay = body.entryDelay;
  if (body.timeVaryingSpread) options.timeVaryingSpread = true;
  if (body.slippage != null) options.slippage = body.slippage;
  if (body.fromDate) options.fromDate = body.fromDate;
  if (body.toDate) options.toDate = body.toDate;
  if (body.reward != null) options.reward = body.reward;
  if (body.pairs) options.pairs = body.pairs;
  if (body.balance != null) options.balance = body.balance;
  if (body.strategyConfig) options.strategyConfig = body.strategyConfig as Record<string, unknown>;

  const result = startBacktest(user.id, user.email, strategy, granularity, options);
  if (!result.success) {
    return json({ error: result.error }, { status: 500 });
  }

  return json({ success: true, message: `Backtest started: ${strategy} on ${granularity}` });
};
