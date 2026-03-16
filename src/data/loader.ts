/**
 * Loads candle data from the daily file structure:
 *   data/{granularity}/{instrument}/{YYYY-MM-DD}.json
 *
 * Falls back to the old single-file format for compatibility:
 *   data/{granularity}/{instrument}.json
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Candle, Instrument } from "../core/types.js";

const DATA_DIR = join(import.meta.dirname, "../../data");

/**
 * Load candles for a single instrument. Optionally filter by date range.
 * Merges all daily files, sorted by timestamp.
 */
export function loadCandles(
  granularity: string,
  instrument: string,
  fromDate?: string, // "YYYY-MM-DD" inclusive
  toDate?: string, // "YYYY-MM-DD" inclusive
): Candle[] {
  const instDir = join(DATA_DIR, granularity, instrument);

  // New daily-file layout
  if (existsSync(instDir) && isDirectory(instDir)) {
    const files = readdirSync(instDir)
      .filter((f) => f.endsWith(".json"))
      .sort(); // lexicographic sort = date order

    let filtered = files;
    if (fromDate) {
      filtered = filtered.filter((f) => f.replace(".json", "") >= fromDate);
    }
    if (toDate) {
      filtered = filtered.filter((f) => f.replace(".json", "") <= toDate);
    }

    const allCandles: Candle[] = [];
    for (const file of filtered) {
      const data = JSON.parse(readFileSync(join(instDir, file), "utf-8")) as Candle[];
      allCandles.push(...data);
    }
    return allCandles;
  }

  // Legacy single-file layout
  const legacyFile = join(DATA_DIR, granularity, `${instrument}.json`);
  if (existsSync(legacyFile)) {
    const candles = JSON.parse(readFileSync(legacyFile, "utf-8")) as Candle[];
    if (fromDate || toDate) {
      const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
      const toTs = toDate ? new Date(toDate + "T23:59:59.999Z").getTime() : Infinity;
      return candles.filter((c) => c.timestamp >= fromTs && c.timestamp <= toTs);
    }
    return candles;
  }

  return [];
}

/**
 * Discover all instruments that have data for a given granularity.
 */
export function discoverInstruments(granularity: string): Instrument[] {
  const dir = join(DATA_DIR, granularity);
  if (!existsSync(dir)) return [];

  return readdirSync(dir).filter((entry) => {
    const full = join(dir, entry);
    // Daily layout: subdirectory per instrument
    if (isDirectory(full)) return true;
    // Legacy layout: instrument.json
    if (entry.endsWith(".json")) return true;
    return false;
  }).map((entry) => entry.replace(".json", ""));
}

function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}
