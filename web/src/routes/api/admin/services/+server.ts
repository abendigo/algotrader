import { json } from "@sveltejs/kit";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { RequestHandler } from "./$types.js";
import { ServiceClient, readServiceDiscovery } from "../../../../../../src/live/service-client.js";

import { DATA_DIR } from "$lib/server/paths.js";

const USERS_FILE = join(DATA_DIR, "users.json");

interface ServiceInfo {
  userId: string;
  email: string;
  port: number;
  pid: number;
  startedAt: string;
  uptime?: number;
  streamConnected?: boolean;
  sessionCount?: number;
  ticksReceived?: number;
  memoryUsage?: number;
  error?: string;
}

/**
 * GET /api/admin/services — list all running user services
 */
export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const usersDir = join(DATA_DIR, "users");
  if (!existsSync(usersDir)) return json([]);

  // Load user email lookup
  const emailMap = new Map<string, string>();
  if (existsSync(USERS_FILE)) {
    try {
      const users = JSON.parse(readFileSync(USERS_FILE, "utf-8")) as Array<{ id: string; email: string }>;
      for (const u of users) emailMap.set(u.id, u.email);
    } catch { /* ignore */ }
  }

  const services: ServiceInfo[] = [];

  // Scan for discovery files
  for (const userId of readdirSync(usersDir)) {
    const discovery = readServiceDiscovery(userId);
    if (!discovery) continue;

    const info: ServiceInfo = {
      userId,
      email: emailMap.get(userId) ?? userId,
      port: discovery.port,
      pid: discovery.pid,
      startedAt: discovery.startedAt,
    };

    // Try to get live status from the service
    try {
      const client = new ServiceClient(discovery.port);
      const status = await client.getStatus();
      info.uptime = status.uptime;
      info.streamConnected = status.streamConnected;
      info.sessionCount = status.sessions;
      info.ticksReceived = status.ticksReceived;
      info.memoryUsage = status.memoryUsage;
    } catch {
      info.error = "Service unresponsive";
    }

    services.push(info);
  }

  return json(services);
};

/**
 * POST /api/admin/services — stop a user's service
 * Body: { userId: string }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== "admin") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const targetUserId = body.userId as string;
  if (!targetUserId) {
    return json({ error: "userId is required" }, { status: 400 });
  }

  const discovery = readServiceDiscovery(targetUserId);
  if (!discovery) {
    return json({ error: "No service found for this user" }, { status: 404 });
  }

  try {
    const client = new ServiceClient(discovery.port);
    await client.shutdown();
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
