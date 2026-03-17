import { fail } from "@sveltejs/kit";
import { listAllStrategies } from "$lib/server/strategies.js";
import { copySharedStrategy } from "$lib/server/strategies.js";

export async function load({ locals }) {
  const userId = locals.user?.id ?? "";
  const all = listAllStrategies(userId);
  const userIds = new Set(all.filter((s) => s.source === "user").map((s) => s.id));
  const shared = all.filter((s) => s.source === "shared");

  return {
    strategies: shared.map((s) => ({
      ...s,
      alreadyCopied: userIds.has(s.id),
    })),
  };
}

export const actions = {
  copy: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const strategyId = formData.get("strategyId")?.toString() ?? "";

    const result = copySharedStrategy(locals.user.id, strategyId);
    if (!result.success) {
      return fail(400, { error: result.error });
    }
    return { success: true, message: `Strategy copied to your collection` };
  },
};
