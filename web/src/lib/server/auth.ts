import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";
import { hash, verify } from "@node-rs/argon2";

const DATA_DIR = join(import.meta.dirname, "../../../../data");
const USERS_FILE = join(DATA_DIR, "users.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

// Encryption key for API keys (derived from a fixed salt — in production, use an env var)
const ENCRYPTION_KEY = scryptSync("algotrader-encryption-key", "salt", 32);

export interface OandaAccount {
  id: string;
  accountId: string;
  label: string;
  strategy: string;
  type: "practice" | "live";
  units: number;
  active: boolean;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
  oandaApiKey?: string; // encrypted
  accounts: OandaAccount[];
}

export interface PublicUser {
  id: string;
  email: string;
  role: "admin" | "user";
  hasApiKey: boolean;
  accounts: OandaAccount[];
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
    accounts: user.accounts,
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
    accounts: [],
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

// --- Account management ---

export function addAccount(
  userId: string,
  accountId: string,
  label: string,
  strategy: string,
  type: "practice" | "live",
  units: number,
): OandaAccount | null {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return null;

  const account: OandaAccount = {
    id: randomBytes(8).toString("hex"),
    accountId,
    label,
    strategy,
    type,
    units,
    active: true,
  };

  user.accounts.push(account);
  saveUsers(users);
  return account;
}

export function removeAccount(userId: string, accountInternalId: string): void {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  user.accounts = user.accounts.filter((a) => a.id !== accountInternalId);
  saveUsers(users);
}

export function updateAccount(
  userId: string,
  accountInternalId: string,
  updates: Partial<Pick<OandaAccount, "label" | "strategy" | "units" | "active">>,
): void {
  const users = loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  const account = user.accounts.find((a) => a.id === accountInternalId);
  if (!account) return;
  Object.assign(account, updates);
  saveUsers(users);
}

// --- OANDA API helpers for user accounts ---

export async function listOandaAccounts(
  apiKey: string,
): Promise<{ id: string; tags: string[] }[]> {
  const baseUrl = "https://api-fxpractice.oanda.com";
  const res = await fetch(`${baseUrl}/v3/accounts`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { accounts: { id: string; tags: string[] }[] };
  return data.accounts;
}

export async function testConnection(
  apiKey: string,
  accountId: string,
): Promise<{ success: boolean; balance?: number; currency?: string; error?: string }> {
  try {
    const baseUrl = "https://api-fxpractice.oanda.com";
    const res = await fetch(`${baseUrl}/v3/accounts/${accountId}/summary`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      return { success: false, error: `OANDA API error ${res.status}` };
    }

    const data = (await res.json()) as { account: { balance: string; currency: string } };
    return {
      success: true,
      balance: parseFloat(data.account.balance),
      currency: data.account.currency,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
