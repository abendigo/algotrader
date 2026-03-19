import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSystemApiKey } from "$lib/server/system-config.js";
import { collect, getExistingDataRange } from "../../../../../../src/data/collect.js";
import { GRANULARITY_SECONDS, type Granularity } from "../../../../../../src/core/types.js";
import { createJob, updateJob, getAllJobs, clearFinishedJobs } from "$lib/server/collect-jobs.js";

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
 * Starts a collection job and returns immediately with the job ID.
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
  const instruments = body.instruments as string[] | undefined;

  if (!granularity || !direction) {
    return json({ error: "granularity and direction are required" }, { status: 400 });
  }

  const batchDays = getBatchDays(granularity);
  const existing = getExistingDataRange(granularity, instruments);

  let from: Date;
  let to: Date;

  if (direction === "latest") {
    if (existing) {
      from = new Date(new Date(existing.latest).getTime() - 86_400_000);
    } else {
      from = new Date(Date.now() - batchDays * 86_400_000);
    }
    to = new Date();
  } else {
    if (existing) {
      to = new Date(existing.earliest);
      from = new Date(to.getTime() - batchDays * 86_400_000);
    } else {
      to = new Date();
      from = new Date(to.getTime() - batchDays * 86_400_000);
    }
  }

  // Create job and start collection in background
  const job = createJob(granularity, direction, instruments);

  // Fire and forget — the job runs asynchronously
  collect({
    apiKey,
    granularity: granularity as Granularity,
    from,
    to,
    instruments,
    onProgress: (progress) => updateJob(job.id, progress),
  }).catch((err) => {
    updateJob(job.id, {
      status: "error",
      totalInstruments: 0,
      completedInstruments: 0,
      totalDayFiles: 0,
      fetchedDayFiles: 0,
      skippedDayFiles: 0,
      errors: 1,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  return json({
    ok: true,
    jobId: job.id,
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  });
};

/**
 * GET /api/admin/collect
 * Returns all collection jobs (for polling).
 * ?action=clear removes finished jobs.
 */
export const GET: RequestHandler = ({ url, locals }) => {
  const user = locals.user;
  if (!user || user.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  if (url.searchParams.get("action") === "clear") {
    clearFinishedJobs();
  }

  return json({ jobs: getAllJobs() });
};
