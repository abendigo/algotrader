/**
 * Collects historical candle data from OANDA for all tracked instruments.
 * Saves to JSON files in data/ directory for offline analysis.
 *
 * Usage: npx tsx src/data/collect.ts [granularity] [days]
 * Example: npx tsx src/data/collect.ts M1 7
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

async function collectInstrument(
  client: OandaClient,
  instrument: string,
  granularity: Granularity,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  const allCandles: Candle[] = [];
  let cursor = from;

  while (cursor < to) {
    const stepMs = GRANULARITY_MS[granularity];
    if (!stepMs) throw new Error(`Unknown granularity: ${granularity}`);

    const chunkEnd = new Date(
      Math.min(cursor.getTime() + stepMs * MAX_CANDLES_PER_REQUEST, to.getTime()),
    );

    const candles = await client.getCandlesByRange(
      instrument,
      granularity,
      cursor,
      chunkEnd,
    );

    allCandles.push(...candles);

    if (candles.length === 0) {
      // No data in this range, skip forward
      cursor = chunkEnd;
    } else {
      // Move cursor past the last candle
      cursor = new Date(candles[candles.length - 1].timestamp + stepMs);
    }

    // Rate limit: be polite to the API
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

  const outDir = join(DATA_DIR, granularity);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  console.log(
    `Collecting ${granularity} candles for ${ALL_INSTRUMENTS.length} instruments, ${days} days (${from.toISOString()} to ${to.toISOString()})`,
  );

  for (const instrument of ALL_INSTRUMENTS) {
    const outFile = join(outDir, `${instrument}.json`);

    if (existsSync(outFile)) {
      console.log(`  ${instrument}: already exists, skipping`);
      continue;
    }

    try {
      const candles = await collectInstrument(client, instrument, granularity, from, to);
      writeFileSync(outFile, JSON.stringify(candles));
      console.log(`  ${instrument}: ${candles.length} candles`);
    } catch (err) {
      console.error(`  ${instrument}: FAILED -`, err instanceof Error ? err.message : err);
    }

    // Rate limit between instruments
    await sleep(200);
  }

  console.log("Done.");
}

main().catch(console.error);
