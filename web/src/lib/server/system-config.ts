/**
 * System-level configuration stored in data/system-config.json.
 * Separate from per-user config — used for admin operations like data collection.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { DATA_DIR } from "./paths.js";

const CONFIG_FILE = join(DATA_DIR, "system-config.json");
const ENCRYPTION_KEY = scryptSync("algotrader-encryption-key", "salt", 32);

interface SystemConfig {
  oandaApiKey?: string; // encrypted
}

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
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

function loadConfig(): SystemConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(config: SystemConfig): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getSystemApiKey(): string | null {
  const config = loadConfig();
  if (!config.oandaApiKey) return null;
  try {
    return decrypt(config.oandaApiKey);
  } catch {
    return null;
  }
}

export function setSystemApiKey(apiKey: string): void {
  const config = loadConfig();
  config.oandaApiKey = encrypt(apiKey);
  saveConfig(config);
}

export function hasSystemApiKey(): boolean {
  const config = loadConfig();
  return !!config.oandaApiKey;
}
