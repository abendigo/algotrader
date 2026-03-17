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

  const strategies = listAllStrategies(userId);

  return {
    strategies,
    accounts,
    availableGranularities,
  };
}
