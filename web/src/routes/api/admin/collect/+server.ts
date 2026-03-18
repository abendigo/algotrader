import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSystemApiKey } from "$lib/server/system-config.js";
import { collect, getExistingDataRange } from "../../../../../../src/data/collect.js";
import { GRANULARITY_SECONDS, type Granularity } from "../../../../../../src/core/types.js";

/** Batch sizes in days, scaled by granularity */
function getBatchDays(granularity: string): number {
  const seconds = GRANULARITY_SECONDS[granularity as Granularity] ?? 60;
  if (seconds <= 60) return 7;       // S5-M1
  if (seconds <= 1800) return 30;    // M5-M30
  if (seconds <= 43200) return 90;   // H1-H12
  return 365;                        // D, W, M
}

/**
 * POST /api/admin/collect
 * Body: { granularity: string, direction: "latest" | "previous" }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = getSystemApiKey();
  if (!apiKey) {
    return json({ error: "System API key not configured. Set it in the admin page." }, { status: 400 });
  }

  const body = await request.json();
  const granularity = body.granularity as string;
  const direction = body.direction as "latest" | "previous";

  if (!granularity || !direction) {
    return json({ error: "granularity and direction are required" }, { status: 400 });
  }

  const batchDays = getBatchDays(granularity);
  const existing = getExistingDataRange(granularity);

  let from: Date;
  let to: Date;

  if (direction === "latest") {
    // From last data (minus 1 day overlap) to now
    if (existing) {
      from = new Date(new Date(existing.latest).getTime() - 86_400_000); // 1 day overlap
    } else {
      // No data yet — fetch the last batchDays
      from = new Date(Date.now() - batchDays * 86_400_000);
    }
    to = new Date();
  } else {
    // Fetch further back in history
    if (existing) {
      to = new Date(existing.earliest);
      from = new Date(to.getTime() - batchDays * 86_400_000);
    } else {
      // No data yet — fetch the last batchDays
      to = new Date();
      from = new Date(to.getTime() - batchDays * 86_400_000);
    }
  }

  const messages: string[] = [];
  const result = await collect({
    apiKey,
    granularity: granularity as Granularity,
    from,
    to,
    onProgress: (msg) => messages.push(msg),
  });

  return json({
    ok: true,
    ...result,
    messages,
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  });
};

/**
 * GET /api/admin/collect?granularity=M1
 * Returns existing data range for a granularity.
 */
export const GET: RequestHandler = ({ url, locals }) => {
  const user = locals.user;
  if (!user || user.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const granularity = url.searchParams.get("granularity");
  if (!granularity) {
    return json({ error: "granularity param required" }, { status: 400 });
  }

  const range = getExistingDataRange(granularity);
  return json({ range });
};
