import {
  hasSystemApiKey,
  getInstrumentCache,
  getInstrumentsByGroup,
  refreshInstrumentCache,
} from "$lib/server/system-config.js";
import {
  getInstrumentCoverage,
} from "../../../../../src/data/collect.js";
import { GRANULARITIES_SORTED } from "../../../../../src/core/types.js";

export async function load() {
  const cache = getInstrumentCache();
  const groups = getInstrumentsByGroup();

  // Get coverage for each granularity
  const granularities = GRANULARITIES_SORTED.map((gran) => {
    const coverage = getInstrumentCoverage(gran);
    return { name: gran, coverage };
  });

  return {
    hasApiKey: hasSystemApiKey(),
    instrumentCount: cache?.instruments.length ?? 0,
    instrumentsFetchedAt: cache?.fetchedAt ?? null,
    groups,
    granularities,
  };
}

export const actions = {
  refreshInstruments: async () => {
    const result = await refreshInstrumentCache();
    if (!result.success) {
      return { error: result.error };
    }
    return { success: true, message: `Cached ${result.count} instruments` };
  },
};
