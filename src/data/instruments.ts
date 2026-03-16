/** Major USD pairs — USD is base or quote */
export const USD_MAJORS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CAD",
  "USD_CHF",
  "AUD_USD",
  "NZD_USD",
] as const;

/** Cross pairs derivable from USD majors */
export const CROSSES = [
  "EUR_GBP",
  "EUR_JPY",
  "EUR_CAD",
  "EUR_CHF",
  "EUR_AUD",
  "EUR_NZD",
  "GBP_JPY",
  "GBP_CAD",
  "GBP_CHF",
  "GBP_AUD",
  "GBP_NZD",
  "AUD_JPY",
  "AUD_CAD",
  "AUD_CHF",
  "AUD_NZD",
  "NZD_JPY",
  "NZD_CAD",
  "NZD_CHF",
  "CAD_JPY",
  "CAD_CHF",
  "CHF_JPY",
] as const;

/** All instruments we track */
export const ALL_INSTRUMENTS = [...USD_MAJORS, ...CROSSES] as const;

/** Currency codes involved */
export const CURRENCIES = ["EUR", "GBP", "USD", "JPY", "CAD", "CHF", "AUD", "NZD"] as const;

export type Currency = (typeof CURRENCIES)[number];

/**
 * Parse an instrument into its base and quote currencies.
 * "EUR_USD" → ["EUR", "USD"]
 */
export function parsePair(instrument: string): [Currency, Currency] {
  const [base, quote] = instrument.split("_");
  return [base as Currency, quote as Currency];
}

/**
 * Given two currencies, find the instrument name (OANDA format).
 * Returns the pair in the correct OANDA order, or null if not found.
 */
export function findInstrument(a: Currency, b: Currency): string | null {
  const direct = `${a}_${b}`;
  const reverse = `${b}_${a}`;
  const all = ALL_INSTRUMENTS as readonly string[];
  if (all.includes(direct)) return direct;
  if (all.includes(reverse)) return reverse;
  return null;
}

/**
 * For a given cross pair, find the two USD-leg majors that imply it.
 * e.g., "AUD_CAD" → { legA: "AUD_USD", legB: "USD_CAD" }
 *
 * The implied rate is computed as:
 *   implied = getUsdRate(base) / getUsdRate(quote)
 * where getUsdRate converts each currency to "units of currency per 1 USD"
 */
export function findTriangle(cross: string): { legA: string; legB: string } | null {
  const [base, quote] = parsePair(cross);
  if (base === "USD" || quote === "USD") return null; // not a cross

  const legA = findInstrument(base, "USD" as Currency);
  const legB = findInstrument(quote, "USD" as Currency);

  if (!legA || !legB) return null;
  return { legA, legB };
}
