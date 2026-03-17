import { listUserStrategies } from "$lib/server/strategies.js";

export function load({ locals }) {
  const userId = locals.user?.id ?? "";
  return {
    strategies: listUserStrategies(userId),
  };
}
