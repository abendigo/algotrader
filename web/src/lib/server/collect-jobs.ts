/**
 * In-memory tracker for data collection jobs.
 * Tracks progress so the admin page can poll for status.
 */

import type { CollectProgress } from "../../../../src/data/collect.js";

export interface CollectJob {
  id: string;
  granularity: string;
  direction: "latest" | "previous";
  startedAt: string;
  progress: CollectProgress;
}

const jobs = new Map<string, CollectJob>();
let jobCounter = 0;

export function createJob(granularity: string, direction: "latest" | "previous"): CollectJob {
  const id = `collect-${++jobCounter}`;
  const job: CollectJob = {
    id,
    granularity,
    direction,
    startedAt: new Date().toISOString(),
    progress: {
      status: "running",
      totalInstruments: 0,
      completedInstruments: 0,
      totalDayFiles: 0,
      fetchedDayFiles: 0,
      skippedDayFiles: 0,
      errors: 0,
      message: "Starting...",
    },
  };
  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, progress: CollectProgress): void {
  const job = jobs.get(id);
  if (job) job.progress = progress;
}

export function getJob(id: string): CollectJob | undefined {
  return jobs.get(id);
}

export function getActiveJobs(): CollectJob[] {
  return [...jobs.values()].filter((j) => j.progress.status === "running");
}

export function getAllJobs(): CollectJob[] {
  return [...jobs.values()];
}

export function clearFinishedJobs(): void {
  for (const [id, job] of jobs) {
    if (job.progress.status !== "running") jobs.delete(id);
  }
}
