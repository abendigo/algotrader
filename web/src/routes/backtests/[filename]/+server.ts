import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { deleteReport } from "$lib/server/reports.js";

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: "Not authenticated" }, { status: 401 });

	const deleted = deleteReport(locals.user.id, params.filename);
	if (!deleted) return json({ error: "Report not found" }, { status: 404 });

	return json({ success: true });
};
