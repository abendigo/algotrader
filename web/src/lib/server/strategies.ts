import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dirname, "../../../../data");
const SHARED_DIR = join(DATA_DIR, "shared/strategies");
const USERS_DIR = join(DATA_DIR, "users");
const MANIFEST_FILE = join(SHARED_DIR, "manifest.json");

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
  configFields?: ConfigFields;
}

export interface UserStrategy {
  filename: string;
  name: string;
  sourceId?: string;
  configFields?: ConfigFields;
}

function userStrategiesDir(userId: string): string {
  return join(USERS_DIR, userId, "strategies");
}

export function listSharedStrategies(): SharedStrategy[] {
  if (!existsSync(MANIFEST_FILE)) return [];
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"));
}

export function listUserStrategies(userId: string): UserStrategy[] {
  const userDir = userStrategiesDir(userId);
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

  const userDir = userStrategiesDir(userId);
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
  const file = join(userStrategiesDir(userId), filename);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}

export function getSharedStrategyCode(filename: string): string | null {
  const file = join(SHARED_DIR, filename);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}
