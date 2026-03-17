import { json } from "@sveltejs/kit";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(import.meta.dirname, "../../../../../logs");
const STATE_FILE = join(LOGS_DIR, "live-state.json");

export function GET({ url }) {
  const type = url.searchParams.get("type") ?? "state";

  if (type === "state") {
    if (!existsSync(STATE_FILE)) {
      return json({ running: false, message: "Live runner not active" });
    }
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    // Check if state is stale (older than 30 seconds)
    const stateAge = Date.now() - new Date(state.timestamp).getTime();
    state.stale = stateAge > 30_000;
    return json(state);
  }

  if (type === "log") {
    // Return today's trade log
    const dateStr = new Date().toISOString().slice(0, 10);
    const logFile = join(LOGS_DIR, `live-${dateStr}.jsonl`);
    if (!existsSync(logFile)) return json([]);

    const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // Return only trade and exit entries (not every tick)
    const trades = entries.filter(
      (e: any) => e.type === "trade" || e.type === "exit" || e.type === "status"
    );
    return json(trades);
  }

  if (type === "logs") {
    // List available log dates
    if (!existsSync(LOGS_DIR)) return json([]);
    const files = readdirSync(LOGS_DIR)
      .filter((f) => f.startsWith("live-") && f.endsWith(".jsonl"))
      .map((f) => f.replace("live-", "").replace(".jsonl", ""))
      .sort()
      .reverse();
    return json(files);
  }

  return json({ error: "Unknown type" }, { status: 400 });
}
