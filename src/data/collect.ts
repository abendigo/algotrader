/**
 * Collects historical candle data from OANDA for all tracked instruments.
 * Saves one JSON file per instrument per day in data/brokers/oanda/{granularity}/{instrument}/.
 *
 * Usage:
 *   npm run collect [granularity] [days] --api-key=<key>
 *   npm run collect [granularity] [days] --user=<id-or-email>   (legacy, reads user's key)
 *
 * Incrementally collects: skips days that already have data on disk.
 * Can also be imported and called programmatically by the web app.
 */

import { OandaClient } from "../brokers/oanda/client.js";
import { findUser, getUserApiKey } from "../core/users.js";
import type { Config } from "../core/config.js";
import { GRANULARITY_SECONDS, type Candle, type Granularity } from "../core/types.js";
import { ALL_INSTRUMENTS } from "./instruments.js";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT_DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dirname, "../../data");
const DATA_DIR = join(ROOT_DATA_DIR, "brokers/oanda");

/** OANDA limits candle requests to 5000 per call. Paginate as needed. */
const MAX_CANDLES_PER_REQUEST = 5000;

/** Granularity to milliseconds (derived from shared seconds constant) */
const GRANULARITY_MS: Record<string, number> = Object.fromEntries(
  Object.entries(GRANULARITY_SECONDS).map(([k, v]) => [k, v * 1000]),
);

/** Format a Date as YYYY-MM-DD in UTC */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get start of UTC day */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Generate all UTC dates from start (inclusive) to end (exclusive) */
function dateRange(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  let cursor = startOfDay(from);
  const endDay = startOfDay(to);
  while (cursor < endDay) {
    dates.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

async function collectDay(
  client: OandaClient,
  instrument: string,
  granularity: Granularity,
  day: Date,
): Promise<Candle[]> {
  const stepMs = GRANULARITY_MS[granularity];
  if (!stepMs) throw new Error(`Unknown granularity: ${granularity}`);

  const dayStart = startOfDay(day);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const allCandles: Candle[] = [];
  let cursor = dayStart;

  while (cursor < dayEnd) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + stepMs * MAX_CANDLES_PER_REQUEST, dayEnd.getTime()),
    );

    const candles = await client.getCandlesByRange(instrument, granularity, cursor, chunkEnd);
    allCandles.push(...candles);

    if (candles.length === 0) {
      cursor = chunkEnd;
    } else {
      cursor = new Date(candles[candles.length - 1].timestamp + stepMs);
    }

    await sleep(100);
  }

  return allCandles;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Progress update from a collection run */
export interface CollectProgress {
  status: "running" | "done" | "error";
  /** Current instrument being fetched */
  currentInstrument?: string;
  /** Total instruments to process */
  totalInstruments: number;
  /** Instruments completed so far */
  completedInstruments: number;
  /** Total day-files to fetch (across all instruments) */
  totalDayFiles: number;
  /** Day-files fetched so far */
  fetchedDayFiles: number;
  /** Day-files skipped (already cached) */
  skippedDayFiles: number;
  /** Errors encountered */
  errors: number;
  /** Human-readable message */
  message: string;
}

/** Options for programmatic collection */
export interface CollectOptions {
  apiKey: string;
  granularity: Granularity;
  from: Date;
  to: Date;
  onProgress?: (progress: CollectProgress) => void;
}

/** Result of a collection run */
export interface CollectResult {
  fetched: number;
  skipped: number;
  errors: number;
}

/**
 * Get the date range of existing data for a granularity.
 * Returns null if no data exists.
 */
export function getExistingDataRange(granularity: string): { earliest: string; latest: string } | null {
  const granDir = join(DATA_DIR, granularity);
  if (!existsSync(granDir)) return null;

  let earliest = "9999-99-99";
  let latest = "0000-00-00";
  let found = false;

  for (const inst of readdirSync(granDir)) {
    const instDir = join(granDir, inst);
    try {
      const files = readdirSync(instDir).filter((f) => f.endsWith(".json")).sort();
      if (files.length > 0) {
        found = true;
        const first = files[0].replace(".json", "");
        const last = files[files.length - 1].replace(".json", "");
        if (first < earliest) earliest = first;
        if (last > latest) latest = last;
      }
    } catch { /* skip */ }
  }

  return found ? { earliest, latest } : null;
}

/**
 * Collect candle data for a date range. Can be called programmatically.
 */
export async function collect(options: CollectOptions): Promise<CollectResult> {
  const { apiKey, granularity, from, to, onProgress } = options;

  const config: Config = {
    OANDA_API_KEY: apiKey,
    OANDA_ACCOUNT_ID: "",
    OANDA_BASE_URL: "https://api-fxpractice.oanda.com",
  };
  const client = new OandaClient(config);

  const dates = dateRange(from, to);
  if (dates.length === 0) return { fetched: 0, skipped: 0, errors: 0 };

  // Count total work upfront
  let totalDayFiles = 0;
  let skippedDayFiles = 0;
  const instrumentWork: { instrument: string; missing: Date[] }[] = [];

  for (const instrument of ALL_INSTRUMENTS) {
    const instDir = join(DATA_DIR, granularity, instrument);
    if (!existsSync(instDir)) mkdirSync(instDir, { recursive: true });

    const missing: Date[] = [];
    for (const day of dates) {
      const file = join(instDir, `${formatDate(day)}.json`);
      if (!existsSync(file)) {
        missing.push(day);
      } else {
        skippedDayFiles++;
      }
    }
    totalDayFiles += missing.length;
    if (missing.length > 0) {
      instrumentWork.push({ instrument, missing });
    }
  }

  let fetchedDayFiles = 0;
  let errors = 0;
  let completedInstruments = 0;

  const report = (instrument: string | undefined, message: string, status: "running" | "done" | "error" = "running") => {
    onProgress?.({
      status,
      currentInstrument: instrument,
      totalInstruments: instrumentWork.length,
      completedInstruments,
      totalDayFiles,
      fetchedDayFiles,
      skippedDayFiles,
      errors,
      message,
    });
  };

  report(undefined, `Collecting ${granularity}: ${instrumentWork.length} instruments, ${totalDayFiles} day-files to fetch`);

  for (const { instrument, missing } of instrumentWork) {
    report(instrument, `Fetching ${instrument} (${missing.length} days)`);

    for (const day of missing) {
      try {
        const candles = await collectDay(client, instrument, granularity, day);
        const file = join(DATA_DIR, granularity, instrument, `${formatDate(day)}.json`);
        writeFileSync(file, JSON.stringify(candles));
        fetchedDayFiles++;
      } catch (err) {
        errors++;
        report(instrument, `${instrument} ${formatDate(day)}: ${err instanceof Error ? err.message : err}`);
      }
    }

    completedInstruments++;
    report(instrument, `${instrument}: ${missing.length} days fetched`);
    await sleep(200);
  }

  report(undefined, `Done. Fetched ${fetchedDayFiles}, skipped ${skippedDayFiles}, errors ${errors}.`, errors > 0 ? "error" : "done");
  return { fetched: fetchedDayFiles, skipped: skippedDayFiles, errors };
}

// --- CLI entry point ---

async function main() {
  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const granularity = (positionalArgs[0] || "M1") as Granularity;
  const days = parseInt(positionalArgs[1] || "7", 10);

  // Resolve API key: --api-key flag, or legacy --user flag
  const apiKeyFlag = process.argv.find((a) => a.startsWith("--api-key="))?.split("=").slice(1).join("=");
  const userFlag = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1];

  let apiKey: string | undefined;

  if (apiKeyFlag) {
    apiKey = apiKeyFlag;
  } else if (userFlag) {
    const user = findUser(userFlag);
    if (!user) { console.error(`User not found: ${userFlag}`); process.exit(1); }
    apiKey = getUserApiKey(user.id) ?? undefined;
    if (!apiKey) { console.error(`No OANDA API key set for ${user.email}`); process.exit(1); }
    console.log(`User: ${user.email}`);
  }

  if (!apiKey) {
    console.error("Error: --api-key=<key> or --user=<id-or-email> is required.");
    console.error("Usage: npm run collect [granularity] [days] --api-key=<key>");
    process.exit(1);
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  await collect({ apiKey, granularity, from, to, onProgress: (p) => console.log(p.message) });
}

// Only run CLI when executed directly (not when imported by the web app)
const isDirectRun = process.argv[1]?.endsWith("collect.ts") || process.argv[1]?.endsWith("collect.js");
if (isDirectRun) {
  main().catch(console.error);
}
