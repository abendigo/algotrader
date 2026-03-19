import { listAllStrategies } from "$lib/server/strategies.js";
import { getApiKey, discoverAccounts } from "$lib/server/auth.js";
import { getDataSummary } from "$lib/server/data.js";

export async function load({ locals }) {
  const userId = locals.user?.id ?? "";
  let accounts: { id: string; alias: string; hedgingEnabled: boolean }[] = [];

  if (locals.user?.hasApiKey) {
    const apiKey = getApiKey(locals.user.id);
    if (apiKey) {
      const result = await discoverAccounts(apiKey);
      accounts = result.accounts.map((a) => ({
        id: a.id,
        alias: a.alias || a.id,
        hedgingEnabled: a.hedgingEnabled,
      }));
    }
  }

  const dataSummary = getDataSummary();
  const availableGranularities = dataSummary.brokers.flatMap((b) =>
    b.granularities.map((g) => ({ name: g.name, from: g.dateRange.from, to: g.dateRange.to }))
  );

  const allStrategies = listAllStrategies(userId);
  const userStrategies = allStrategies.filter((s) => s.source === "user");

  // Track which user strategies have a shared/builtin counterpart (revertable)
  const nonUserIds = new Set(
    allStrategies.filter((s) => s.source !== "user").map((s) => s.id),
  );
  const userStrategiesWithMeta = userStrategies.map((s) => ({
    ...s,
    revertable: nonUserIds.has(s.id),
  }));

  return {
    strategies: allStrategies,
    userStrategies: userStrategiesWithMeta,
    accounts,
    availableGranularities,
  };
}
