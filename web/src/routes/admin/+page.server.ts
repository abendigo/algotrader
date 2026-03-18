import { fail } from "@sveltejs/kit";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getDataSummary } from "$lib/server/data.js";
import { ServiceClient, readServiceDiscovery } from "../../../../src/live/service-client.js";
import { hasSystemApiKey, setSystemApiKey, getSystemApiKey } from "$lib/server/system-config.js";

import { DATA_DIR } from "$lib/server/paths.js";

const BROKERS_DIR = join(DATA_DIR, "brokers");
const USERS_FILE = join(DATA_DIR, "users.json");

interface UserSummary {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  hasApiKey: boolean;
}

function loadUserSummaries(): UserSummary[] {
  if (!existsSync(USERS_FILE)) return [];
  const users = JSON.parse(readFileSync(USERS_FILE, "utf-8"));
  return users.map((u: any) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    hasApiKey: !!u.oandaApiKey,
  }));
}

function getDataDiskUsage(): { path: string; size: string; files: number } {
  if (!existsSync(BROKERS_DIR)) return { path: BROKERS_DIR, size: "0 MB", files: 0 };

  let totalSize = 0;
  let totalFiles = 0;

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        totalSize += stat.size;
        totalFiles++;
      }
    }
  }

  walk(BROKERS_DIR);

  const mb = totalSize / (1024 * 1024);
  const sizeStr = mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;

  return { path: BROKERS_DIR, size: sizeStr, files: totalFiles };
}

interface LiveServiceInfo {
  userId: string;
  email: string;
  port: number;
  uptime?: number;
  streamConnected?: boolean;
  sessionCount?: number;
  ticksReceived?: number;
  memoryUsage?: number;
  error?: string;
}

async function discoverServices(): Promise<LiveServiceInfo[]> {
  const usersDir = join(DATA_DIR, "users");
  if (!existsSync(usersDir)) return [];

  const emailMap = new Map<string, string>();
  for (const u of loadUserSummaries()) emailMap.set(u.id, u.email);

  const services: LiveServiceInfo[] = [];
  for (const userId of readdirSync(usersDir)) {
    const discovery = readServiceDiscovery(userId);
    if (!discovery) continue;

    const info: LiveServiceInfo = {
      userId,
      email: emailMap.get(userId) ?? userId,
      port: discovery.port,
    };

    try {
      const client = new ServiceClient(discovery.port);
      const status = await client.getStatus();
      info.uptime = status.uptime;
      info.streamConnected = status.streamConnected;
      info.sessionCount = status.sessions;
      info.ticksReceived = status.ticksReceived;
      info.memoryUsage = status.memoryUsage;
    } catch {
      info.error = "Unresponsive";
    }

    services.push(info);
  }

  return services;
}

export async function load() {
  return {
    users: loadUserSummaries(),
    data: getDataSummary(),
    disk: getDataDiskUsage(),
    services: await discoverServices(),
    hasSystemApiKey: hasSystemApiKey(),
  };
}

export const actions = {
  setApiKey: async ({ request }) => {
    const formData = await request.formData();
    const apiKey = formData.get("apiKey")?.toString() ?? "";

    if (!apiKey) return fail(400, { error: "API key is required" });

    setSystemApiKey(apiKey);
    return { success: true, message: "System API key saved" };
  },

  setRole: async ({ request }) => {
    const formData = await request.formData();
    const userId = formData.get("userId")?.toString() ?? "";
    const role = formData.get("role")?.toString() as "admin" | "user" ?? "user";

    if (!existsSync(USERS_FILE)) return fail(400, { error: "No users file" });

    const users = JSON.parse(readFileSync(USERS_FILE, "utf-8"));
    const user = users.find((u: any) => u.id === userId);
    if (!user) return fail(400, { error: "User not found" });

    user.role = role;

    const { writeFileSync } = await import("fs");
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    return { success: true, message: `${user.email} is now ${role}` };
  },
};
