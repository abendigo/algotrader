/**
 * Per-user live trading service.
 *
 * Usage: npx tsx src/live/service.ts --user=<email-or-id> [--port=0]
 *
 * One service per user. Manages all live sessions, shares one OANDA streaming
 * connection, and exposes an HTTP API for the web app and admin.
 *
 * Lifecycle:
 *   1. Load user config
 *   2. Create StreamManager + SessionManager
 *   3. Start HTTP server, write discovery file
 *   4. Resume any previously-running sessions (crash recovery)
 *   5. Run until idle timeout, SIGTERM, or /shutdown
 *   6. Graceful shutdown: stop all sessions, delete discovery file
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { findUser } from "../core/users.js";
import { getConfigForUser } from "../core/config.js";
import { StreamManager } from "./stream-manager.js";
import { SessionManager } from "./session-manager.js";
import { createServiceApi } from "./service-api.js";
import type { ServiceDiscovery } from "./service-client.js";

const DATA_DIR = join(import.meta.dirname, "../../data");

function getFlag(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

const userFlag = getFlag("user");
const portFlag = getFlag("port");

if (!userFlag) {
  console.error("Usage: npx tsx src/live/service.ts --user=<email-or-id> [--port=0]");
  process.exit(1);
}

const user = findUser(userFlag);
if (!user) {
  console.error(`User not found: ${userFlag}`);
  process.exit(1);
}

const requestedPort = portFlag ? parseInt(portFlag, 10) : 0;
const startedAt = Date.now();

// Ensure user data directories exist
const userDir = join(DATA_DIR, "users", user.id);
if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

const discoveryPath = join(userDir, "live-service.json");

// We need a default account to create the StreamManager's OANDA client.
// The stream uses the first account's API key (all accounts share the same key for a user).
// Find a valid account config — we'll use the first account that works.
// For the stream, we just need the API key — the account ID doesn't matter for pricing streams.
// Use a placeholder account ID; strategies will use their own accounts.
let streamConfig = getConfigForUser(user.email, "stream-placeholder");

const streamManager = new StreamManager(streamConfig);
let sessionManager: SessionManager;
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\n[Service] Shutting down...");

  // Stop all sessions (closes positions)
  await sessionManager.stopAll();

  // Close stream
  streamManager.close();

  // Delete discovery file
  try {
    if (existsSync(discoveryPath)) unlinkSync(discoveryPath);
  } catch { /* ignore */ }

  console.log("[Service] Shutdown complete.");
  process.exit(0);
}

sessionManager = new SessionManager(streamManager, user.id, user.email, shutdown);

const { server, start } = createServiceApi(
  sessionManager,
  streamManager,
  user.id,
  user.email,
  startedAt,
  shutdown,
);

async function main(): Promise<void> {
  // Start HTTP server
  const actualPort = await start(requestedPort);

  // Write discovery file
  const discovery: ServiceDiscovery = {
    port: actualPort,
    pid: process.pid,
    startedAt: new Date(startedAt).toISOString(),
  };
  writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2));

  console.log(`[Service] Live trading service for ${user!.email}`);
  console.log(`[Service] HTTP API on port ${actualPort} (PID: ${process.pid})`);
  console.log(`[Service] Discovery file: ${discoveryPath}`);

  // Resume previously-running sessions
  await sessionManager.resumeFromFiles();

  console.log(`[Service] Ready. ${sessionManager.sessionCount} active session(s).`);
}

// Signal handlers
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[Service] Fatal error:", err);
  try {
    if (existsSync(discoveryPath)) unlinkSync(discoveryPath);
  } catch { /* ignore */ }
  process.exit(1);
});
