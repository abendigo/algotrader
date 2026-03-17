import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { hash, verify } from "@node-rs/argon2";

const DATA_DIR = join(import.meta.dirname, "../../../../data");
const USERS_FILE = join(DATA_DIR, "users.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

// Encryption key for API keys (derived from a fixed salt — in production, use an env var)
const ENCRYPTION_KEY = scryptSync("algotrader-encryption-key", "salt", 32);

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
  oandaApiKey?: string; // encrypted
}

export interface PublicUser {
  id: string;
  email: string;
  role: "admin" | "user";
  hasApiKey: boolean;
}

interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
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

function loadUsers(): User[] {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, "utf-8"));
}

function saveUsers(users: User[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadSessions(): Session[] {
  if (!existsSync(SESSIONS_FILE)) return [];
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8")) as Session[];
  const now = new Date().toISOString();
  return sessions.filter((s) => s.expiresAt > now);
}

function saveSessions(sessions: Session[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    hasApiKey: !!user.oandaApiKey,
  };
}

export async function register(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const users = loadUsers();

  if (users.find((u) => u.email === email.toLowerCase())) {
    return { success: false, error: "Email already registered" };
  }

  if (password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }

  const passwordHash = await hash(password);

  // First user is admin
  const role = users.length === 0 ? "admin" : "user";

  users.push({
    id: randomBytes(16).toString("hex"),
    email: email.toLowerCase(),
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
  });

  saveUsers(users);
  return { success: true };
}

export async function login(
  email: string,
  password: string,
): Promise<{ success: boolean; token?: string; error?: string }> {
  const users = loadUsers();
  const user = users.find((u) => u.email === email.toLowerCase());

  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    return { success: false, error: "Invalid email or password" };
  }

  const token = randomBytes(32).toString("hex");
  const sessions = loadSessions();
  sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  saveSessions(sessions);

  return { success: true, token };
}

export function validateSession(token: string | undefined): User | null {
  if (!token) return null;

  const sessions = loadSessions();
  const session = sessions.find((s) => s.token === token);
  if (!session) return null;

  const users = loadUsers();
  return users.find((u) => u.id === session.userId) ?? null;
}

export function getPublicUser(token: string | undefined): PublicUser | null {
  const user = validateSession(token);
  return user ? toPublicUser(user) : null;
}

export function logout(token: string): void {
  const sessions = loadSessions();
  saveSessions(sessions.filter((s) => s.token !== token));
}

// --- API Key management ---

export function setApiKey(userId: string, apiKey: string): void {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  user.oandaApiKey = encrypt(apiKey);
  saveUsers(users);
}

export function getApiKey(userId: string): string | null {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user?.oandaApiKey) return null;
  return decrypt(user.oandaApiKey);
}

export function clearApiKey(userId: string): void {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  delete user.oandaApiKey;
  saveUsers(users);
}

// --- OANDA API helpers ---

export interface DiscoveredAccount {
  id: string;
  alias: string;
  balance: number;
  currency: string;
  openTradeCount: number;
  openPositionCount: number;
  pl: number;
  hedgingEnabled: boolean;
}

/** Discover accounts accessible with the given API key and fetch their summaries. */
export async function discoverAccounts(
  apiKey: string,
): Promise<{ accounts: DiscoveredAccount[]; error?: string }> {
  const baseUrl = "https://api-fxpractice.oanda.com";
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v3/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { accounts: [], error: "Failed to connect to OANDA" };
  }
  if (!res.ok) {
    return { accounts: [], error: `OANDA API error: ${res.status}` };
  }
  const data = (await res.json()) as { accounts: { id: string }[] };

  const accounts: DiscoveredAccount[] = [];
  await Promise.all(
    data.accounts.map(async (acct) => {
      try {
        const summaryRes = await fetch(`${baseUrl}/v3/accounts/${acct.id}/summary`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!summaryRes.ok) return;
        const summary = (await summaryRes.json()) as {
          account: {
            alias: string;
            balance: string;
            currency: string;
            openTradeCount: number;
            openPositionCount: number;
            pl: string;
            hedgingEnabled?: boolean;
          };
        };
        accounts.push({
          id: acct.id,
          alias: summary.account.alias ?? "",
          balance: parseFloat(summary.account.balance),
          currency: summary.account.currency,
          openTradeCount: summary.account.openTradeCount,
          openPositionCount: summary.account.openPositionCount,
          pl: parseFloat(summary.account.pl),
          hedgingEnabled: summary.account.hedgingEnabled ?? false,
        });
      } catch {
        // skip inaccessible accounts
      }
    }),
  );

  return { accounts };
}
