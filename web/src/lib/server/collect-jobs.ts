/**
 * In-memory tracker for data collection jobs.
 * Tracks progress so the admin page can poll for status.
 */

import type { CollectProgress } from "../../../../src/data/collect.js";
import { eventBus } from "./event-bus.js";

let lastEmit = 0;
const THROTTLE_MS = 500;

function emitUpdate(): void {
  const now = Date.now();
  if (now - lastEmit < THROTTLE_MS) return;
  lastEmit = now;
  eventBus.emit("collect", { jobs: getAllJobs() });
}

export interface CollectJob {
  id: string;
  granularity: string;
  direction: "latest" | "previous" | "all";
  label?: string;
  instruments?: string[];
  startedAt: string;
  progress: CollectProgress;
}

const jobs = new Map<string, CollectJob>();
let jobCounter = 0;

export function createJob(granularity: string, direction: "latest" | "previous" | "all", instruments?: string[], label?: string): CollectJob {
  const id = `collect-${++jobCounter}`;
  const job: CollectJob = {
    id,
    granularity,
    direction,
    label,
    instruments,
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
  emitUpdate();
  return job;
}

export function updateJob(id: string, progress: CollectProgress): void {
  const job = jobs.get(id);
  if (job) {
    job.progress = progress;
    emitUpdate();
  }
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

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.progress.status !== "running") return false;
  job.progress = { ...job.progress, status: "error", message: "Cancelled by user" };
  lastEmit = 0; // force immediate emit
  emitUpdate();
  return true;
}

/** Returns true if the job has been cancelled */
export function isJobCancelled(id: string): boolean {
  const job = jobs.get(id);
  return !job || job.progress.status !== "running";
}

export function clearFinishedJobs(): void {
  for (const [id, job] of jobs) {
    if (job.progress.status !== "running") jobs.delete(id);
  }
}
