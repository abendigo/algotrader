import { fail } from "@sveltejs/kit";
import {
  setApiKey,
  getApiKey,
  clearApiKey,
  addAccount,
  removeAccount,
  updateAccount,
  testConnection,
  listOandaAccounts,
} from "$lib/server/auth.js";

export async function load({ locals }) {
  let oandaAccounts: { id: string; tags: string[] }[] = [];

  if (locals.user) {
    const { getApiKey: getKey } = await import("$lib/server/auth.js");
    const apiKey = getKey(locals.user.id);
    if (apiKey) {
      oandaAccounts = await listOandaAccounts(apiKey);
    }
  }

  return {
    user: locals.user,
    oandaAccounts,
  };
}

export const actions = {
  saveApiKey: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const apiKey = formData.get("apiKey")?.toString() ?? "";

    if (!apiKey) {
      return fail(400, { error: "API key is required" });
    }

    setApiKey(locals.user.id, apiKey);
    return { success: true, message: "API key saved" };
  },

  clearApiKey: async ({ locals }) => {
    if (!locals.user) return fail(401);
    clearApiKey(locals.user.id);
    return { success: true, message: "API key removed" };
  },

  testConnection: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const accountId = formData.get("accountId")?.toString() ?? "";

    const apiKey = getApiKey(locals.user.id);
    if (!apiKey) {
      return fail(400, { error: "Set your API key first" });
    }

    const result = await testConnection(apiKey, accountId);
    if (result.success) {
      return {
        success: true,
        message: `Connected! Balance: ${result.balance?.toFixed(2)} ${result.currency}`,
      };
    }
    return fail(400, { error: result.error });
  },

  addAccount: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const accountId = formData.get("accountId")?.toString() ?? "";
    const label = formData.get("label")?.toString() ?? "";
    const strategy = formData.get("strategy")?.toString() ?? "";
    const type = formData.get("type")?.toString() as "practice" | "live" ?? "practice";
    const units = parseInt(formData.get("units")?.toString() ?? "100", 10);

    if (!accountId || !label) {
      return fail(400, { error: "Account ID and label are required" });
    }

    // Test the connection first
    const apiKey = getApiKey(locals.user.id);
    if (!apiKey) {
      return fail(400, { error: "Set your API key first" });
    }

    const test = await testConnection(apiKey, accountId);
    if (!test.success) {
      return fail(400, { error: `Connection failed: ${test.error}` });
    }

    addAccount(locals.user.id, accountId, label, strategy, type, units);
    return { success: true, message: `Account "${label}" added (${test.currency} ${test.balance?.toFixed(2)})` };
  },

  removeAccount: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const id = formData.get("id")?.toString() ?? "";
    removeAccount(locals.user.id, id);
    return { success: true, message: "Account removed" };
  },

  toggleAccount: async ({ request, locals }) => {
    if (!locals.user) return fail(401);
    const formData = await request.formData();
    const id = formData.get("id")?.toString() ?? "";
    const active = formData.get("active") === "true";
    updateAccount(locals.user.id, id, { active });
    return { success: true };
  },
};
