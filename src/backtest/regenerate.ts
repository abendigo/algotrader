/**
 * Regenerate HTML and CSV reports from saved JSON result files.
 *
 * Usage: npm run regenerate [filename]
 *   filename: base name without extension (e.g., "london-breakout-M1-2026-03-17-02-32-49")
 *   If no filename given, regenerates all JSON result files in reports/
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { exportHTML } from "./export-html.js";
import { exportCSV } from "./export-csv.js";
import type { BacktestResult } from "./types.js";

const REPORTS_DIR = join(import.meta.dirname, "../../reports");

function regenerate(jsonFile: string): void {
  const jsonPath = join(REPORTS_DIR, jsonFile);
  const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
    strategyName: string;
    result: BacktestResult;
  };

  const baseName = jsonFile.replace(".json", "");

  const htmlPath = join(REPORTS_DIR, `${baseName}.html`);
  writeFileSync(htmlPath, exportHTML(data.result, data.strategyName));

  const csvPath = join(REPORTS_DIR, `${baseName}.csv`);
  writeFileSync(csvPath, exportCSV(data.result));

  console.log(`Regenerated: ${baseName}`);
}

const target = process.argv[2];

if (target) {
  const jsonFile = target.endsWith(".json") ? target : `${target}.json`;
  if (!existsSync(join(REPORTS_DIR, jsonFile))) {
    console.error(`Not found: ${jsonFile}`);
    process.exit(1);
  }
  regenerate(jsonFile);
} else {
  // Regenerate all
  if (!existsSync(REPORTS_DIR)) {
    console.error("No reports directory found");
    process.exit(1);
  }
  const jsonFiles = readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    console.log("No JSON result files found. Run a backtest first.");
  } else {
    for (const f of jsonFiles) {
      regenerate(f);
    }
    console.log(`\nRegenerated ${jsonFiles.length} reports.`);
  }
}
