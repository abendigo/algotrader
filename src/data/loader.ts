/**
 * Loads candle data from the daily file structure:
 *   data/{broker}/{granularity}/{instrument}/{YYYY-MM-DD}.json
 *
 * Falls back to legacy layouts for compatibility:
 *   data/{granularity}/{instrument}/{YYYY-MM-DD}.json  (no broker prefix)
 *   data/{granularity}/{instrument}.json                (single file)
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Candle, Instrument } from "../core/types.js";

const DATA_ROOT = join(import.meta.dirname, "../../data");

/** Default broker for data operations */
const DEFAULT_BROKER = "oanda";

/**
 * Get the data directory for a broker.
 * Checks new layout (data/{broker}) first, falls back to legacy (data/).
 */
function getDataDir(broker: string = DEFAULT_BROKER): string {
  const brokerDir = join(DATA_ROOT, broker);
  if (existsSync(brokerDir) && isDirectory(brokerDir)) return brokerDir;
  // Legacy fallback: data/ directly
  return DATA_ROOT;
}

/**
 * Load candles for a single instrument. Optionally filter by date range.
 * Merges all daily files, sorted by timestamp.
 */
export function loadCandles(
  granularity: string,
  instrument: string,
  fromDate?: string, // "YYYY-MM-DD" inclusive
  toDate?: string, // "YYYY-MM-DD" inclusive
  broker?: string,
): Candle[] {
  // Try new broker-prefixed layout first, then legacy
  const dirs = broker
    ? [join(DATA_ROOT, broker)]
    : [join(DATA_ROOT, DEFAULT_BROKER), DATA_ROOT];

  for (const dataDir of dirs) {
    const instDir = join(dataDir, granularity, instrument);

    // Daily-file layout
    if (existsSync(instDir) && isDirectory(instDir)) {
      const files = readdirSync(instDir)
        .filter((f) => f.endsWith(".json"))
        .sort();

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
      if (allCandles.length > 0) return allCandles;
    }

    // Legacy single-file layout
    const legacyFile = join(dataDir, granularity, `${instrument}.json`);
    if (existsSync(legacyFile)) {
      const candles = JSON.parse(readFileSync(legacyFile, "utf-8")) as Candle[];
      if (fromDate || toDate) {
        const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
        const toTs = toDate ? new Date(toDate + "T23:59:59.999Z").getTime() : Infinity;
        return candles.filter((c) => c.timestamp >= fromTs && c.timestamp <= toTs);
      }
      return candles;
    }
  }

  return [];
}

/**
 * Discover all instruments that have data for a given granularity.
 */
export function discoverInstruments(granularity: string, broker?: string): Instrument[] {
  const dirs = broker
    ? [join(DATA_ROOT, broker)]
    : [join(DATA_ROOT, DEFAULT_BROKER), DATA_ROOT];

  for (const dataDir of dirs) {
    const dir = join(dataDir, granularity);
    if (!existsSync(dir)) continue;

    const instruments = readdirSync(dir).filter((entry) => {
      const full = join(dir, entry);
      if (isDirectory(full)) return true;
      if (entry.endsWith(".json")) return true;
      return false;
    }).map((entry) => entry.replace(".json", ""));

    if (instruments.length > 0) return instruments;
  }

  return [];
}

/**
 * List all available brokers that have data.
 */
export function discoverBrokers(): string[] {
  if (!existsSync(DATA_ROOT)) return [];
  return readdirSync(DATA_ROOT).filter((entry) => {
    const full = join(DATA_ROOT, entry);
    if (!isDirectory(full)) return false;
    // A broker dir contains granularity subdirs (M1, M5, etc.)
    const contents = readdirSync(full);
    return contents.some((c) => /^[SMHDW]\d*$/.test(c));
  });
}

function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}
