import { fail } from "@sveltejs/kit";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getDataSummary } from "$lib/server/data.js";

const DATA_DIR = join(import.meta.dirname, "../../../../data");
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

export function load() {
  return {
    users: loadUserSummaries(),
    data: getDataSummary(),
    disk: getDataDiskUsage(),
  };
}

export const actions = {
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
