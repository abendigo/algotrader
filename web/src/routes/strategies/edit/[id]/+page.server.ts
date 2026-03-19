import { error, redirect } from "@sveltejs/kit";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DATA_DIR, PROJECT_ROOT } from "$lib/server/paths.js";

const EDITOR_TYPES_PATH = join(PROJECT_ROOT, "web/src/lib/generated/editor-types.json");

export async function load({ params, locals }) {
	if (!locals.user) throw redirect(303, "/login");

	const id = params.id;
	const filePath = join(DATA_DIR, "users", locals.user.id, "strategies", `${id}.ts`);
	if (!existsSync(filePath)) throw error(404, "Strategy not found");

	const source = readFileSync(filePath, "utf-8");

	let types: Record<string, string> = {};
	if (existsSync(EDITOR_TYPES_PATH)) {
		types = JSON.parse(readFileSync(EDITOR_TYPES_PATH, "utf-8"));
	}

	return { strategyId: id, source, types };
}
