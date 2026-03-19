import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "$lib/server/paths.js";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * DELETE /api/live/session?id=<sessionId>
 * Delete a session file.
 */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

	const sessionId = url.searchParams.get("id");
	if (!sessionId || !SAFE_ID.test(sessionId)) return json({ error: "Invalid session id" }, { status: 400 });

	const sessionPath = join(DATA_DIR, "users", locals.user.id, "live-sessions", `${sessionId}.json`);
	if (!existsSync(sessionPath)) return json({ error: "Session not found" }, { status: 404 });

	unlinkSync(sessionPath);
	return json({ success: true });
};
