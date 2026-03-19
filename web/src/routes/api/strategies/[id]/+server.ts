import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, copyFileSync } from "fs";
import { join } from "path";
import { DATA_DIR, PROJECT_ROOT } from "$lib/server/paths.js";

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

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

	const id = params.id;
	if (!id || !SAFE_ID.test(id)) return json({ error: "Invalid strategy id" }, { status: 400 });

	const filePath = join(DATA_DIR, "users", locals.user.id, "strategies", `${id}.ts`);
	if (!existsSync(filePath)) return json({ error: "Strategy not found" }, { status: 404 });

	unlinkSync(filePath);
	return json({ success: true });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

	const id = params.id;
	if (!id || !SAFE_ID.test(id)) return json({ error: "Invalid strategy id" }, { status: 400 });

	const body = await request.json();
	const action = body.action;

	const userDir = join(DATA_DIR, "users", locals.user.id, "strategies");
	if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });

	if (action === "fork") {
		const sourceFile = join(userDir, `${id}.ts`);
		if (!existsSync(sourceFile)) return json({ error: "Strategy not found" }, { status: 404 });

		const newId = body.newId;
		if (!newId || !SAFE_ID.test(newId)) return json({ error: "Invalid fork name" }, { status: 400 });

		const destFile = join(userDir, `${newId}.ts`);
		if (existsSync(destFile)) return json({ error: "A strategy with that name already exists" }, { status: 409 });

		copyFileSync(sourceFile, destFile);
		return json({ success: true, id: newId });
	}

	if (action === "share") {
		if (locals.user.role !== "admin") return json({ error: "Admin only" }, { status: 403 });

		const sourceFile = join(userDir, `${id}.ts`);
		if (!existsSync(sourceFile)) return json({ error: "Strategy not found" }, { status: 404 });

		const sharedDir = join(DATA_DIR, "shared/strategies");
		if (!existsSync(sharedDir)) mkdirSync(sharedDir, { recursive: true });

		copyFileSync(sourceFile, join(sharedDir, `${id}.ts`));
		return json({ success: true });
	}

	if (action === "revert") {
		const sharedFile = join(DATA_DIR, "shared/strategies", `${id}.ts`);
		const builtinFile = join(PROJECT_ROOT, "src/strategies", `${id}.ts`);
		const sourceFile = existsSync(sharedFile) ? sharedFile : existsSync(builtinFile) ? builtinFile : null;

		if (!sourceFile) return json({ error: "No shared/builtin version to revert to" }, { status: 404 });

		copyFileSync(sourceFile, join(userDir, `${id}.ts`));
		return json({ success: true });
	}

	return json({ error: "Unknown action" }, { status: 400 });
};
