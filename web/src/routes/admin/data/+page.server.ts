import {
  hasSystemApiKey,
  getInstrumentCache,
  getInstrumentsByGroup,
  refreshInstrumentCache,
  type CachedInstrument,
} from "$lib/server/system-config.js";
import {
  getInstrumentCoverage,
} from "../../../../../src/data/collect.js";
import { GRANULARITIES_SORTED } from "../../../../../src/core/types.js";
import { USD_MAJORS, CROSSES } from "../../../../../src/data/instruments.js";

const majorsSet = new Set<string>(USD_MAJORS);
const crossesSet = new Set<string>(CROSSES);

export async function load() {
  const cache = getInstrumentCache();
  const rawGroups = getInstrumentsByGroup();

  // Split CURRENCY into Majors, Crosses, and Exotics
  const currency = rawGroups["CURRENCY"] ?? [];
  const majors: CachedInstrument[] = [];
  const crosses: CachedInstrument[] = [];
  const exotics: CachedInstrument[] = [];
  for (const inst of currency) {
    if (majorsSet.has(inst.name)) majors.push(inst);
    else if (crossesSet.has(inst.name)) crosses.push(inst);
    else exotics.push(inst);
  }

  const groups: Record<string, CachedInstrument[]> = {};
  if (majors.length > 0) groups["MAJORS"] = majors;
  if (crosses.length > 0) groups["CROSSES"] = crosses;
  if (exotics.length > 0) groups["EXOTICS"] = exotics;
  for (const [key, val] of Object.entries(rawGroups)) {
    if (key !== "CURRENCY") groups[key] = val;
  }

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
