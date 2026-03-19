import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "$lib/server/paths.js";

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_SIZE = 100 * 1024; // 100 KB

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

	const id = params.id;
	if (!id || !SAFE_ID.test(id)) return json({ error: "Invalid strategy id" }, { status: 400 });

	const filePath = join(DATA_DIR, "users", locals.user.id, "strategies", `${id}.ts`);
	if (!existsSync(filePath)) return json({ error: "Strategy not found" }, { status: 404 });

	const source = readFileSync(filePath, "utf-8");
	return json({ source });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

	const id = params.id;
	if (!id || !SAFE_ID.test(id)) return json({ error: "Invalid strategy id" }, { status: 400 });

	const body = await request.json();
	const source = body.source;

	if (typeof source !== "string") return json({ error: "Missing source" }, { status: 400 });
	if (source.length > MAX_SIZE) return json({ error: "File too large (100KB max)" }, { status: 400 });

	const userDir = join(DATA_DIR, "users", locals.user.id, "strategies");
	if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

	writeFileSync(join(userDir, `${id}.ts`), source, "utf-8");
	return json({ success: true });
};
