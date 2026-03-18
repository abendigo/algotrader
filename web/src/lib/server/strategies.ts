import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { listStrategies, type StrategyMeta, type ConfigFields, type ConfigFieldDef } from "../../../../src/core/strategy-loader.js";

export type { StrategyMeta, ConfigFields, ConfigFieldDef };

import { DATA_DIR, PROJECT_ROOT } from "./paths.js";
const SHARED_DIR = join(DATA_DIR, "shared/strategies");
const BUILTIN_DIR = join(PROJECT_ROOT, "src/strategies");

export function listAllStrategies(userId: string): StrategyMeta[] {
  return listStrategies(userId);
}

export function copySharedStrategy(userId: string, strategyId: string): { success: boolean; error?: string } {
  // Check shared (data volume) first, then builtin (app image)
  const sharedFile = join(SHARED_DIR, `${strategyId}.ts`);
  const builtinFile = join(BUILTIN_DIR, `${strategyId}.ts`);
  const sourceFile = existsSync(sharedFile) ? sharedFile : existsSync(builtinFile) ? builtinFile : null;

  if (!sourceFile) return { success: false, error: "Strategy not found" };

  const userDir = join(DATA_DIR, "users", userId, "strategies");
  if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

  const destFile = join(userDir, `${strategyId}.ts`);
  if (existsSync(destFile)) return { success: false, error: "You already have this strategy" };

  copyFileSync(sourceFile, destFile);
  return { success: true };
}
