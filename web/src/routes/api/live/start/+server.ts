import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { startLive } from "$lib/server/processes.js";

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const accountId = body.accountId as string;
  const strategy = body.strategy as string;
  const units = (body.units as number) || 100;

  if (!accountId) return json({ error: "accountId is required" }, { status: 400 });
  if (!strategy) return json({ error: "strategy is required" }, { status: 400 });

  const result = await startLive(user.id, user.email, accountId, strategy, units);
  if (!result.success) {
    return json({ error: result.error }, { status: 409 });
  }

  return json({ success: true, message: `Started ${strategy} on ${accountId}` });
};
