/**
 * Regenerate HTML and CSV reports from saved JSON result files.
 *
 * Usage: npm run regenerate [filename] --user=<id-or-email>
 *   filename: base name without extension (e.g., "london-breakout-M1-2026-03-17-02-32-49")
 *   If no filename given, regenerates all JSON result files.
 *   --user flag determines which user's reports directory to use.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { exportHTML, type ReportMeta } from "./export-html.js";
import { exportCSV } from "./export-csv.js";
import type { BacktestResult } from "./types.js";
import { findUser, getUserReportsDir } from "../core/users.js";

const userFlag = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1];

if (!userFlag) {
  console.error("Error: --user=<id-or-email> is required.");
  console.error("Usage: npm run regenerate [filename] --user=<id-or-email>");
  process.exit(1);
}
const user = findUser(userFlag);
if (!user) {
  console.error(`User not found: ${userFlag}`);
  process.exit(1);
}
const reportsDir = getUserReportsDir(user.id);
console.log(`User: ${user.email}`);

function regenerate(jsonFile: string): void {
  const jsonPath = join(reportsDir, jsonFile);
  const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
    strategyName: string;
    strategyConfig?: Record<string, unknown>;
    backtestConfig?: Record<string, unknown>;
    paramDescriptions?: Record<string, string>;
    result: BacktestResult;
  };

  const baseName = jsonFile.replace(".json", "");

  const meta = (data.strategyConfig || data.backtestConfig || data.paramDescriptions)
    ? { strategyConfig: data.strategyConfig, backtestConfig: data.backtestConfig, paramDescriptions: data.paramDescriptions }
    : undefined;

  const htmlPath = join(reportsDir, `${baseName}.html`);
  writeFileSync(htmlPath, exportHTML(data.result, data.strategyName, meta));

  const csvPath = join(reportsDir, `${baseName}.csv`);
  writeFileSync(csvPath, exportCSV(data.result));

  console.log(`Regenerated: ${baseName}`);
}

// Filter out flags to get the target filename
const target = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (target) {
  const jsonFile = target.endsWith(".json") ? target : `${target}.json`;
  if (!existsSync(join(reportsDir, jsonFile))) {
    console.error(`Not found: ${jsonFile}`);
    process.exit(1);
  }
  regenerate(jsonFile);
} else {
  // Regenerate all
  if (!existsSync(reportsDir)) {
    console.error("No reports directory found");
    process.exit(1);
  }
  const jsonFiles = readdirSync(reportsDir).filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    console.log("No JSON result files found. Run a backtest first.");
  } else {
    for (const f of jsonFiles) {
      regenerate(f);
    }
    console.log(`\nRegenerated ${jsonFiles.length} reports.`);
  }
}
