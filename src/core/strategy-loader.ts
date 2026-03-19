/**
 * Dynamic strategy loader.
 *
 * Three-tier strategy resolution:
 *   1. User strategies   — data/users/{userId}/strategies/ (private, in data volume)
 *   2. Shared strategies — data/shared/strategies/ (public, in data volume)
 *   3. Builtin strategies — src/strategies/ (shipped with the app image, read-only)
 *
 * Uses dynamic import() so strategy files are resolved at runtime.
 * Strategy files must use #-prefixed subpath imports (e.g., #core/strategy.js).
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import type { Strategy, RecoveryConfig } from "./strategy.js";

export interface ConfigFieldDef {
  label: string;
  type: "number" | "text";
  default?: unknown;
  placeholder?: string;
  min?: number;
  step?: number;
}

export interface ConfigFields {
  common?: Record<string, ConfigFieldDef>;
  backtest?: Record<string, ConfigFieldDef>;
  live?: Record<string, ConfigFieldDef>;
}

export interface StrategyMeta {
  id: string;
  name: string;
  description?: string;
  configFields?: ConfigFields;
  recovery?: RecoveryConfig;
  source: "user" | "shared" | "builtin";
}

const DATA_DIR = process.env.DATA_DIR ?? resolve(import.meta.dirname, "../../data");
const SHARED_STRATEGIES_DIR = join(DATA_DIR, "shared/strategies");
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? resolve(import.meta.dirname, "../..");
const BUILTIN_STRATEGIES_DIR = join(PROJECT_ROOT, "src/strategies");

/**
 * Dynamically load and instantiate a strategy.
 *
 * Resolution order:
 *   1. data/users/{userId}/strategies/{strategyName}.ts (user private)
 *   2. data/shared/strategies/{strategyName}.ts (shared, data volume)
 *   3. src/strategies/{strategyName}.ts (builtin, shipped with image)
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
  const sharedFile = join(SHARED_STRATEGIES_DIR, `${strategyName}.ts`);
  const builtinFile = join(BUILTIN_STRATEGIES_DIR, `${strategyName}.ts`);

  let filePath: string;
  if (existsSync(userFile)) {
    filePath = userFile;
  } else if (existsSync(sharedFile)) {
    filePath = sharedFile;
  } else if (existsSync(builtinFile)) {
    filePath = builtinFile;
  } else {
    throw new Error(
      `Strategy "${strategyName}" not found. Checked:\n  ${userFile}\n  ${sharedFile}\n  ${builtinFile}`,
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

/**
 * Extract strategyMeta from a strategy file's source text without importing it.
 * The strategyMeta export is a plain object literal with no dependencies,
 * so we can safely evaluate it in isolation.
 */
function extractMeta(filePath: string, id: string, source: StrategyMeta["source"]): StrategyMeta {
  const src = readFileSync(filePath, "utf-8");

  // Find "export const strategyMeta = { ... };" — match the outermost braces
  const startMatch = src.match(/export\s+const\s+strategyMeta\s*=\s*\{/);
  if (!startMatch || startMatch.index === undefined) {
    return {
      id,
      name: id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      source,
    };
  }

  const braceStart = startMatch.index + startMatch[0].length - 1;
  let depth = 1;
  let i = braceStart + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  const objText = src.slice(braceStart, i);

  try {
    // Strip TypeScript "as const" annotations before eval
    const cleaned = objText.replace(/\bas\s+const\b/g, "");
    const meta = new Function(`return (${cleaned})`)() as {
      name?: string;
      description?: string;
      configFields?: ConfigFields;
      recovery?: RecoveryConfig;
    };
    return {
      id,
      name: meta.name ?? id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      description: meta.description,
      configFields: meta.configFields,
      recovery: meta.recovery,
      source,
    };
  } catch {
    return {
      id,
      name: id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      source,
    };
  }
}

/** List all strategies available to a user (user > shared > builtin). */
export function listStrategies(userId: string): StrategyMeta[] {
  const results: StrategyMeta[] = [];
  const seen = new Set<string>();

  // 1. User strategies (highest priority)
  const userDir = join(DATA_DIR, "users", userId, "strategies");
  if (existsSync(userDir)) {
    for (const f of readdirSync(userDir).filter((f) => f.endsWith(".ts"))) {
      const id = f.replace(".ts", "");
      results.push(extractMeta(join(userDir, f), id, "user"));
      seen.add(id);
    }
  }

  // 2. Shared strategies (data volume — skip if user has their own version)
  if (existsSync(SHARED_STRATEGIES_DIR)) {
    for (const f of readdirSync(SHARED_STRATEGIES_DIR).filter((f) => f.endsWith(".ts"))) {
      const id = f.replace(".ts", "");
      if (seen.has(id)) continue;
      results.push(extractMeta(join(SHARED_STRATEGIES_DIR, f), id, "shared"));
      seen.add(id);
    }
  }

  // 3. Builtin strategies (shipped with image — skip if already found)
  if (existsSync(BUILTIN_STRATEGIES_DIR)) {
    for (const f of readdirSync(BUILTIN_STRATEGIES_DIR).filter((f) => f.endsWith(".ts"))) {
      const id = f.replace(".ts", "");
      if (seen.has(id)) continue;
      results.push(extractMeta(join(BUILTIN_STRATEGIES_DIR, f), id, "builtin"));
    }
  }

  return results;
}

/** List shared and builtin strategies (no deduplication against user strategies). */
export function listSharedStrategies(): StrategyMeta[] {
  const results: StrategyMeta[] = [];
  const seen = new Set<string>();

  if (existsSync(SHARED_STRATEGIES_DIR)) {
    for (const f of readdirSync(SHARED_STRATEGIES_DIR).filter((f) => f.endsWith(".ts"))) {
      const id = f.replace(".ts", "");
      results.push(extractMeta(join(SHARED_STRATEGIES_DIR, f), id, "shared"));
      seen.add(id);
    }
  }

  if (existsSync(BUILTIN_STRATEGIES_DIR)) {
    for (const f of readdirSync(BUILTIN_STRATEGIES_DIR).filter((f) => f.endsWith(".ts"))) {
      const id = f.replace(".ts", "");
      if (seen.has(id)) continue;
      results.push(extractMeta(join(BUILTIN_STRATEGIES_DIR, f), id, "builtin"));
    }
  }

  return results;
}
