/**
 * System-level configuration stored in data/system-config.json.
 * Separate from per-user config — used for admin operations like data collection.
 *
 * Also manages the OANDA instrument cache (data/instruments-cache.json).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { DATA_DIR } from "./paths.js";

const CONFIG_FILE = join(DATA_DIR, "system-config.json");
const INSTRUMENTS_CACHE_FILE = join(DATA_DIR, "instruments-cache.json");
const OANDA_BASE_URL = "https://api-fxpractice.oanda.com";
const ENCRYPTION_KEY = scryptSync("algotrader-encryption-key", "salt", 32);

interface SystemConfig {
  oandaApiKey?: string; // encrypted
  oandaAccountId?: string;
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

export async function getSystemAccountId(): Promise<string | null> {
  const config = loadConfig();
  if (config.oandaAccountId) return config.oandaAccountId;

  // Auto-discover and persist if API key exists but account ID is missing
  const apiKey = getSystemApiKey();
  if (!apiKey) return null;

  const accountId = await discoverAccountId(apiKey);
  if (accountId) {
    config.oandaAccountId = accountId;
    saveConfig(config);
  }
  return accountId;
}

/**
 * Save the system API key. Auto-discovers the account ID from OANDA
 * and fetches the instrument list.
 */
export async function setSystemApiKey(apiKey: string): Promise<{ success: boolean; error?: string }> {
  const trimmed = apiKey.trim();

  // Discover account ID
  const accountId = await discoverAccountId(trimmed);
  if (!accountId) {
    return { success: false, error: "Could not discover OANDA account. Check the API key." };
  }

  const config = loadConfig();
  config.oandaApiKey = encrypt(trimmed);
  config.oandaAccountId = accountId;
  saveConfig(config);

  // Fetch and cache instruments
  await refreshInstrumentCache(trimmed, accountId);

  return { success: true };
}

export function hasSystemApiKey(): boolean {
  const config = loadConfig();
  return !!config.oandaApiKey;
}

// --- Account discovery ---

async function discoverAccountId(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${OANDA_BASE_URL}/v3/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accounts: { id: string }[] };
    return data.accounts[0]?.id ?? null;
  } catch {
    return null;
  }
}

// --- Instrument cache ---

export interface CachedInstrument {
  name: string;
  type: string;
  displayName: string;
}

export interface InstrumentCache {
  fetchedAt: string;
  accountId: string;
  instruments: CachedInstrument[];
}

export function getInstrumentCache(): InstrumentCache | null {
  if (!existsSync(INSTRUMENTS_CACHE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(INSTRUMENTS_CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function refreshInstrumentCache(
  apiKey?: string,
  accountId?: string,
): Promise<{ success: boolean; error?: string; count?: number }> {
  const key = apiKey ?? getSystemApiKey();
  const acctId = accountId ?? await getSystemAccountId();

  if (!key || !acctId) {
    return { success: false, error: "System API key or account ID not configured" };
  }

  try {
    const res = await fetch(`${OANDA_BASE_URL}/v3/accounts/${acctId}/instruments`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `OANDA API error ${res.status}: ${body}` };
    }

    const data = (await res.json()) as {
      instruments: Array<{
        name: string;
        type: string;
        displayName: string;
      }>;
    };

    const cache: InstrumentCache = {
      fetchedAt: new Date().toISOString(),
      accountId: acctId,
      instruments: data.instruments.map((i) => ({
        name: i.name,
        type: i.type,
        displayName: i.displayName,
      })),
    };

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(INSTRUMENTS_CACHE_FILE, JSON.stringify(cache, null, 2));

    return { success: true, count: cache.instruments.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get instruments grouped by type.
 */
export function getInstrumentsByGroup(): Record<string, CachedInstrument[]> {
  const cache = getInstrumentCache();
  if (!cache) return {};

  const groups: Record<string, CachedInstrument[]> = {};
  for (const inst of cache.instruments) {
    const group = groups[inst.type] ?? [];
    group.push(inst);
    groups[inst.type] = group;
  }

  // Sort instruments within each group
  for (const group of Object.values(groups)) {
    group.sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}
