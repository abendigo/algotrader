/**
 * Service HTTP API — exposes endpoints for the web app and admin to communicate
 * with a user's live trading service.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { SessionManager } from "./session-manager.js";
import type { StreamManager } from "./stream-manager.js";

export interface ServiceStatus {
  userId: string;
  email: string;
  uptime: number;
  streamConnected: boolean;
  ticksReceived: number;
  sessions: number;
  memoryUsage: number;
}

export function createServiceApi(
  sessionManager: SessionManager,
  streamManager: StreamManager,
  userId: string,
  email: string,
  startedAt: number,
  onShutdown: () => void,
): { server: ReturnType<typeof createServer>; start: (port: number) => Promise<number> } {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method?.toUpperCase() ?? "GET";

    res.setHeader("Content-Type", "application/json");

    try {
      // POST /sessions/start
      if (method === "POST" && path === "/sessions/start") {
        const body = await readBody(req);
        const { accountId, strategy, config } = body;

        if (!accountId || !strategy) {
          return send(res, 400, { ok: false, error: "accountId and strategy are required" });
        }

        const result = await sessionManager.startSession(accountId, strategy, config ?? {});
        return send(res, result.ok ? 200 : 400, result);
      }

      // POST /sessions/stop
      if (method === "POST" && path === "/sessions/stop") {
        const body = await readBody(req);
        const { sessionId } = body;

        if (!sessionId) {
          return send(res, 400, { ok: false, error: "sessionId is required" });
        }

        const result = await sessionManager.stopSession(sessionId);
        return send(res, result.ok ? 200 : 400, result);
      }

      // GET /sessions
      if (method === "GET" && path === "/sessions") {
        const sessions = sessionManager.getSessions();
        return send(res, 200, { sessions });
      }

      // GET /status
      if (method === "GET" && path === "/status") {
        const status: ServiceStatus = {
          userId,
          email,
          uptime: Date.now() - startedAt,
          streamConnected: streamManager.connected,
          ticksReceived: streamManager.ticksReceived,
          sessions: sessionManager.sessionCount,
          memoryUsage: Math.round(process.memoryUsage.call(process).rss / (1024 * 1024)),
        };
        return send(res, 200, status);
      }

      // POST /shutdown
      if (method === "POST" && path === "/shutdown") {
        send(res, 200, { ok: true });
        // Trigger shutdown after response is sent
        setImmediate(onShutdown);
        return;
      }

      send(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ServiceAPI] Error handling ${method} ${path}:`, message);
      send(res, 500, { error: message });
    }
  });

  return {
    server,
    start: (port: number) =>
      new Promise<number>((resolve, reject) => {
        server.listen(port, () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolve(actualPort);
        });
        server.on("error", reject);
      }),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
