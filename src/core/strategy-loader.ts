/**
 * Dynamic strategy loader.
 *
 * Loads a strategy from the user's directory if present, otherwise falls back
 * to the shared strategies in data/shared/strategies/. Uses dynamic import() so
 * strategy files are resolved at runtime — no static switch statement needed.
 *
 * Strategy files must use #-prefixed subpath imports (e.g., #core/strategy.js)
 * so they resolve correctly regardless of their location on disk.
 */

import { existsSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import type { Strategy } from "./strategy.js";

const DATA_DIR = resolve(import.meta.dirname, "../../data");
const SHARED_STRATEGIES_DIR = join(DATA_DIR, "shared/strategies");

/**
 * Dynamically load and instantiate a strategy.
 *
 * Resolution order:
 *   1. data/users/{userId}/strategies/{strategyName}.ts
 *   2. data/shared/strategies/{strategyName}.ts
 *
 * The loaded module is expected to export a class whose name ends with
 * "Strategy" (e.g., LeadLagStrategy). That class is instantiated with
 * the provided config object.
 */
export async function loadStrategy(
  userId: string,
  strategyName: string,
  config: Record<string, unknown>,
): Promise<Strategy> {
  const userFile = join(DATA_DIR, "users", userId, "strategies", `${strategyName}.ts`);
  const builtinFile = join(SHARED_STRATEGIES_DIR, `${strategyName}.ts`);

  let filePath: string;
  if (existsSync(userFile)) {
    filePath = userFile;
  } else if (existsSync(builtinFile)) {
    filePath = builtinFile;
  } else {
    throw new Error(
      `Strategy "${strategyName}" not found. Checked:\n  ${userFile}\n  ${builtinFile}`,
    );
  }

  const fileUrl = pathToFileURL(filePath).href;
  const mod = await import(fileUrl);

  // Find the Strategy class export (convention: name ends with "Strategy")
  const strategyClassName = Object.keys(mod).find(
    (key) => key.endsWith("Strategy") && typeof mod[key] === "function",
  );

  if (!strategyClassName) {
    throw new Error(
      `No Strategy class found in ${filePath}. Expected an export whose name ends with "Strategy".`,
    );
  }

  const StrategyCtor = mod[strategyClassName] as new (config: Record<string, unknown>) => Strategy;
  return new StrategyCtor(config);
}
