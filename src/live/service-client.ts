/**
 * Service client — HTTP client for web app / admin to communicate with
 * a user's live trading service.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { SessionFile } from "./session-manager.js";
import type { ServiceStatus } from "./service-api.js";

const DATA_DIR = join(import.meta.dirname, "../../data");

export interface ServiceDiscovery {
  port: number;
  pid: number;
  startedAt: string;
}

export class ServiceClient {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async startSession(
    accountId: string,
    strategy: string,
    config: Record<string, unknown>,
  ): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
    return this.post("/sessions/start", { accountId, strategy, config });
  }

  async stopSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    return this.post("/sessions/stop", { sessionId });
  }

  async getSessions(): Promise<SessionFile[]> {
    const result = await this.get<{ sessions: SessionFile[] }>("/sessions");
    return result.sessions;
  }

  async getStatus(): Promise<ServiceStatus> {
    return this.get<ServiceStatus>("/status");
  }

  async shutdown(): Promise<void> {
    await this.post("/shutdown", {});
  }

  async isAlive(): Promise<boolean> {
    try {
      await this.get("/status");
      return true;
    } catch {
      return false;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Service error ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Service error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }
}

/**
 * Get a ServiceClient for a user by reading their discovery file.
 * Returns null if no service is running or unresponsive.
 */
export async function getServiceClient(userId: string): Promise<ServiceClient | null> {
  const discoveryPath = join(DATA_DIR, "users", userId, "live-service.json");
  if (!existsSync(discoveryPath)) return null;

  try {
    const discovery = JSON.parse(readFileSync(discoveryPath, "utf-8")) as ServiceDiscovery;
    const client = new ServiceClient(discovery.port);

    // Verify service is actually alive
    const alive = await client.isAlive();
    if (!alive) return null;

    return client;
  } catch {
    return null;
  }
}

/**
 * Read the discovery file for a user (without checking liveness).
 */
export function readServiceDiscovery(userId: string): ServiceDiscovery | null {
  const discoveryPath = join(DATA_DIR, "users", userId, "live-service.json");
  if (!existsSync(discoveryPath)) return null;

  try {
    return JSON.parse(readFileSync(discoveryPath, "utf-8")) as ServiceDiscovery;
  } catch {
    return null;
  }
}
