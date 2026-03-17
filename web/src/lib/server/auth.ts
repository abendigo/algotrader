import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { hash, verify } from "@node-rs/argon2";

const DATA_DIR = join(import.meta.dirname, "../../../../data");
const USERS_FILE = join(DATA_DIR, "users.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
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
  // Prune expired sessions
  const now = new Date().toISOString();
  return sessions.filter((s) => s.expiresAt > now);
}

function saveSessions(sessions: Session[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
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

  users.push({
    id: randomBytes(16).toString("hex"),
    email: email.toLowerCase(),
    passwordHash,
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

  // Create session
  const token = randomBytes(32).toString("hex");
  const sessions = loadSessions();
  sessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
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

export function logout(token: string): void {
  const sessions = loadSessions();
  saveSessions(sessions.filter((s) => s.token !== token));
}
