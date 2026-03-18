import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { stopLive, stopLiveBySessionId } from "$lib/server/processes.js";

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const sessionId = body.sessionId as string | undefined;
  const accountId = body.accountId as string | undefined;

  if (!sessionId && !accountId) {
    return json({ error: "sessionId or accountId is required" }, { status: 400 });
  }

  const result = sessionId
    ? await stopLiveBySessionId(user.id, sessionId)
    : await stopLive(user.id, accountId!);

  if (!result.success) {
    return json({ error: result.error }, { status: 404 });
  }

  return json({ success: true, message: "Stop signal sent" });
};
