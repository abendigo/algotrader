import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { stopLive } from "$lib/server/processes.js";

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const accountId = body.accountId as string;
  if (!accountId) return json({ error: "accountId is required" }, { status: 400 });

  const result = stopLive(user.id, accountId);
  if (!result.success) {
    return json({ error: result.error }, { status: 404 });
  }

  return json({ success: true, message: "Stop signal sent" });
};
