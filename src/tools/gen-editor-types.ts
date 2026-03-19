/**
 * Generate a JSON bundle of core type definitions for the Monaco editor.
 *
 * Reads the source .ts files that strategies import from (strategy, types,
 * broker, instruments, backtest/types) and outputs them as a JSON map
 * keyed by their #-prefixed import path.
 *
 * Usage: npx tsx src/tools/gen-editor-types.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(import.meta.dirname, "../..");

const FILES: Record<string, string> = {
  "#core/strategy.js": "src/core/strategy.ts",
  "#core/types.js": "src/core/types.ts",
  "#core/broker.js": "src/core/broker.ts",
  "#data/instruments.js": "src/data/instruments.ts",
  "#backtest/types.js": "src/backtest/types.ts",
  "#backtest/broker.js": "src/backtest/broker.ts",
};

/** Import paths that aren't available in the editor — strip these lines */
const STRIP_IMPORTS = new Set(["./spread-model.js"]);

const result: Record<string, string> = {};

for (const [moduleId, relPath] of Object.entries(FILES)) {
  let content = readFileSync(join(ROOT, relPath), "utf-8");
  // Strip imports from modules we don't bundle
  content = content.split("\n").filter((line) => {
    const match = line.match(/from\s+["']([^"']+)["']/);
    return !match || !STRIP_IMPORTS.has(match[1]);
  }).join("\n");
  result[moduleId] = content;
}

const outPath = join(ROOT, "web/src/lib/generated/editor-types.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2));

console.log(`Wrote ${Object.keys(result).length} type files to ${outPath}`);
