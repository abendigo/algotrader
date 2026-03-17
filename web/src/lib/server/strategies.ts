import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join } from "path";

const STRATEGIES_DIR = join(import.meta.dirname, "../../../../strategies");
const SHARED_DIR = join(STRATEGIES_DIR, "shared");
const MANIFEST_FILE = join(SHARED_DIR, "manifest.json");

export interface SharedStrategy {
  id: string;
  name: string;
  filename: string;
  description: string;
  category: string;
  badge: string;
  instruments: string;
  timeframe: string;
  backtestNote: string;
  config: Record<string, unknown>;
}

export interface UserStrategy {
  filename: string;
  name: string;
  sourceId?: string; // shared strategy ID if copied from shared
}

export function listSharedStrategies(): SharedStrategy[] {
  if (!existsSync(MANIFEST_FILE)) return [];
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"));
}

export function listUserStrategies(userId: string): UserStrategy[] {
  const userDir = join(STRATEGIES_DIR, userId);
  if (!existsSync(userDir)) return [];

  const manifestFile = join(userDir, "manifest.json");
  if (existsSync(manifestFile)) {
    return JSON.parse(readFileSync(manifestFile, "utf-8"));
  }

  // Fallback: list .ts files
  return readdirSync(userDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({
      filename: f,
      name: f.replace(".ts", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    }));
}

export function copySharedStrategy(userId: string, strategyId: string): { success: boolean; error?: string } {
  const shared = listSharedStrategies();
  const strategy = shared.find((s) => s.id === strategyId);
  if (!strategy) return { success: false, error: "Strategy not found" };

  const sourceFile = join(SHARED_DIR, strategy.filename);
  if (!existsSync(sourceFile)) return { success: false, error: "Strategy file not found" };

  const userDir = join(STRATEGIES_DIR, userId);
  if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

  const destFile = join(userDir, strategy.filename);
  if (existsSync(destFile)) return { success: false, error: "You already have this strategy" };

  copyFileSync(sourceFile, destFile);

  // Update user manifest
  const userStrategies = listUserStrategies(userId);
  userStrategies.push({
    filename: strategy.filename,
    name: strategy.name,
    sourceId: strategy.id,
  });

  const manifestFile = join(userDir, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(userStrategies, null, 2));

  return { success: true };
}

export function getUserStrategyCode(userId: string, filename: string): string | null {
  const userDir = join(STRATEGIES_DIR, userId);
  const file = join(userDir, filename);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}

export function getSharedStrategyCode(filename: string): string | null {
  const file = join(SHARED_DIR, filename);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}
