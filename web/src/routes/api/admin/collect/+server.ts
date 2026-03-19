import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getSystemApiKey } from "$lib/server/system-config.js";
import { collect, getExistingDataRange } from "../../../../../../src/data/collect.js";
import { GRANULARITY_SECONDS, type Granularity } from "../../../../../../src/core/types.js";
import { createJob, updateJob, cancelJob, isJobCancelled, getAllJobs, clearFinishedJobs } from "$lib/server/collect-jobs.js";

/** Batch sizes in days for "previous" direction */
function getBatchDays(granularity: string): number {
  const seconds = GRANULARITY_SECONDS[granularity as Granularity] ?? 60;
  if (seconds <= 60) return 90;      // S5-M1: 3 months
  if (seconds <= 1800) return 180;   // M5-M30: 6 months
  if (seconds <= 43200) return 365;  // H1-H12: 1 year
  return 365 * 5;                    // D, W, M: 5 years
}

/** Max history for "fetch all" */
function getMaxDays(granularity: string): number {
  const seconds = GRANULARITY_SECONDS[granularity as Granularity] ?? 60;
  if (seconds <= 60) return 365;       // S5-M1: 1 year
  if (seconds <= 1800) return 365 * 2; // M5-M30: 2 years
  if (seconds <= 43200) return 365 * 5; // H1-H12: 5 years
  return 365 * 10;                     // D, W, M: 10 years
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
  const direction = body.direction as "latest" | "previous" | "all";
  const instruments = body.instruments as string[] | undefined;
  const label = body.label as string | undefined;

  if (!granularity || !direction) {
    return json({ error: "granularity and direction are required" }, { status: 400 });
  }

  const existing = getExistingDataRange(granularity, instruments);
  const to = new Date();
  let from: Date;

  if (direction === "all") {
    from = new Date(Date.now() - getMaxDays(granularity) * 86_400_000);
  } else if (direction === "latest") {
    if (existing) {
      from = new Date(new Date(existing.latest).getTime() - 86_400_000);
    } else {
      from = new Date(Date.now() - getBatchDays(granularity) * 86_400_000);
    }
  } else {
    // previous — go back one batch from earliest, but always collect up to today
    if (existing) {
      const batchDays = getBatchDays(granularity);
      from = new Date(new Date(existing.earliest).getTime() - batchDays * 86_400_000);
    } else {
      from = new Date(Date.now() - getBatchDays(granularity) * 86_400_000);
    }
  }

  // Create job and start collection in background
  const job = createJob(granularity, direction, instruments, label);

  // Fire and forget — the job runs asynchronously
  collect({
    apiKey,
    granularity: granularity as Granularity,
    from,
    to,
    instruments,
    onProgress: (progress) => {
      if (isJobCancelled(job.id)) throw new Error("Cancelled");
      updateJob(job.id, progress);
    },
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

/**
 * DELETE /api/admin/collect?id=<jobId>
 * Cancel a running collection job.
 */
export const DELETE: RequestHandler = ({ url, locals }) => {
  const user = locals.user;
  if (!user || user.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const jobId = url.searchParams.get("id");
  if (!jobId) return json({ error: "id is required" }, { status: 400 });

  const cancelled = cancelJob(jobId);
  if (!cancelled) return json({ error: "Job not found or not running" }, { status: 404 });

  return json({ ok: true });
};
