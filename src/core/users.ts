/**
 * Read-only access to user data for CLI tools.
 * Reads from data/users.json and decrypts API keys.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDecipheriv, scryptSync } from "crypto";

const DATA_DIR = join(import.meta.dirname, "../../data");
const USERS_FILE = join(DATA_DIR, "users.json");

// Must match the encryption key in web/src/lib/server/auth.ts
const ENCRYPTION_KEY = scryptSync("algotrader-encryption-key", "salt", 32);

export interface User {
  id: string;
  email: string;
  role: "admin" | "user";
  oandaApiKey?: string; // encrypted
}

function decrypt(data: string): string {
  const [ivHex, tagHex, encrypted] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function loadUsers(): User[] {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, "utf-8"));
}

/** Find a user by ID or email */
export function findUser(idOrEmail: string): User | null {
  const users = loadUsers();
  return users.find((u) => u.id === idOrEmail || u.email === idOrEmail) ?? null;
}

/** Get decrypted OANDA API key for a user */
export function getUserApiKey(userId: string): string | null {
  const user = findUser(userId);
  if (!user?.oandaApiKey) return null;
  return decrypt(user.oandaApiKey);
}

/** Get the user's reports directory path */
export function getUserReportsDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "reports");
}

/** Get the user's backtests directory path */
export function getUserBacktestsDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "backtests");
}

/** Get the user's strategies directory path */
export function getUserStrategiesDir(userId: string): string {
  return join(DATA_DIR, "users", userId, "strategies");
}

/** List all users (for CLI discovery) */
export function listUsers(): User[] {
  return loadUsers();
}
