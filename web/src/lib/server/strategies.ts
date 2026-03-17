import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { listStrategies, type StrategyMeta, type ConfigFields, type ConfigFieldDef } from "../../../../src/core/strategy-loader.js";

export type { StrategyMeta, ConfigFields, ConfigFieldDef };

const DATA_DIR = join(import.meta.dirname, "../../../../data");
const SHARED_DIR = join(DATA_DIR, "shared/strategies");

export function listAllStrategies(userId: string): StrategyMeta[] {
  return listStrategies(userId);
}

export function copySharedStrategy(userId: string, strategyId: string): { success: boolean; error?: string } {
  const sourceFile = join(SHARED_DIR, `${strategyId}.ts`);
  if (!existsSync(sourceFile)) return { success: false, error: "Strategy not found" };

  const userDir = join(DATA_DIR, "users", userId, "strategies");
  if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

  const destFile = join(userDir, `${strategyId}.ts`);
  if (existsSync(destFile)) return { success: false, error: "You already have this strategy" };

  copyFileSync(sourceFile, destFile);
  return { success: true };
}
