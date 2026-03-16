/**
 * Collects historical candle data from OANDA for all tracked instruments.
 * Saves one JSON file per instrument per day in data/{granularity}/{instrument}/.
 *
 * Usage: npx tsx src/data/collect.ts [granularity] [days]
 * Example: npx tsx src/data/collect.ts M1 30
 *
 * Incrementally collects: skips days that already have data on disk.
 */

import { OandaClient } from "../brokers/oanda/client.js";
import { getConfig } from "../core/config.js";
import type { Candle, Granularity } from "../core/types.js";
import { ALL_INSTRUMENTS } from "./instruments.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dirname, "../../data");

/** OANDA limits candle requests to 5000 per call. Paginate as needed. */
const MAX_CANDLES_PER_REQUEST = 5000;

/** Granularity to milliseconds */
const GRANULARITY_MS: Record<string, number> = {
  S5: 5_000,
  S10: 10_000,
  S15: 15_000,
  S30: 30_000,
  M1: 60_000,
  M2: 120_000,
  M5: 300_000,
  M10: 600_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D: 86_400_000,
};

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

async function main() {
  const granularity = (process.argv[2] || "M1") as Granularity;
  const days = parseInt(process.argv[3] || "7", 10);

  const config = getConfig();
  const client = new OandaClient(config);

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const dates = dateRange(from, to);

  console.log(
    `Collecting ${granularity} candles for ${ALL_INSTRUMENTS.length} instruments, ` +
      `${dates.length} days (${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])})`,
  );

  let fetched = 0;
  let skipped = 0;

  for (const instrument of ALL_INSTRUMENTS) {
    const instDir = join(DATA_DIR, granularity, instrument);
    if (!existsSync(instDir)) {
      mkdirSync(instDir, { recursive: true });
    }

    const missing: Date[] = [];
    for (const day of dates) {
      const file = join(instDir, `${formatDate(day)}.json`);
      if (!existsSync(file)) {
        missing.push(day);
      } else {
        skipped++;
      }
    }

    if (missing.length === 0) {
      console.log(`  ${instrument}: all ${dates.length} days cached`);
      continue;
    }

    let totalCandles = 0;
    for (const day of missing) {
      try {
        const candles = await collectDay(client, instrument, granularity, day);
        const file = join(instDir, `${formatDate(day)}.json`);
        writeFileSync(file, JSON.stringify(candles));
        totalCandles += candles.length;
        fetched++;
      } catch (err) {
        console.error(
          `  ${instrument} ${formatDate(day)}: FAILED -`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    console.log(`  ${instrument}: ${missing.length} days fetched (${totalCandles} candles)`);
    await sleep(200);
  }

  console.log(`\nDone. Fetched ${fetched} day-files, skipped ${skipped} already cached.`);
}

main().catch(console.error);
