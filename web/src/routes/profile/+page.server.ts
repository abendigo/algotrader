import { fail } from "@sveltejs/kit";
import {
  setApiKey,
  clearApiKey,
  discoverAccounts,
} from "$lib/server/auth.js";

export function load({ locals }) {
  return { user: locals.user };
}

export const actions = {
  saveApiKey: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const apiKey = formData.get("apiKey")?.toString()?.trim() ?? "";

    if (!apiKey) {
      return fail(400, { error: "API key is required" });
    }

    const { accounts, error } = await discoverAccounts(apiKey);
    if (error) {
      return fail(400, { error: `Invalid key: ${error}` });
    }
    if (accounts.length === 0) {
      return fail(400, { error: "No accessible accounts found for this API key" });
    }

    setApiKey(locals.user.id, apiKey);
    return { success: true, message: `API key saved — ${accounts.length} account${accounts.length > 1 ? "s" : ""} accessible` };
  },

  clearApiKey: async ({ locals }) => {
    if (!locals.user) return fail(401);
    clearApiKey(locals.user.id);
    return { success: true, message: "API key removed" };
  },
};
