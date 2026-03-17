import { fail } from "@sveltejs/kit";
import { listSharedStrategies, listUserStrategies, copySharedStrategy } from "$lib/server/strategies.js";

export function load({ locals }) {
  const userId = locals.user?.id ?? "";
  const shared = listSharedStrategies();
  const mine = listUserStrategies(userId);
  const myFilenames = new Set(mine.map((s) => s.filename));

  return {
    strategies: shared.map((s) => ({
      ...s,
      alreadyCopied: myFilenames.has(s.filename),
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
