/**
 * Typical spreads from OANDA in absolute price units.
 * Captured from live practice account pricing API (Sunday session).
 * Weekday spreads during London/NY overlap are typically tighter.
 * These represent conservative estimates.
 *
 * To refresh: npx tsx -e "import('./src/data/refresh-spreads.js')"
 */
export const SPREADS: Record<string, number> = {
  EUR_USD: 0.00015,
  GBP_USD: 0.00024,
  USD_JPY: 0.012,
  USD_CAD: 0.00022,
  USD_CHF: 0.00017,
  AUD_USD: 0.00015,
  NZD_USD: 0.00027,
  EUR_GBP: 0.00018,
  EUR_JPY: 0.024,
  EUR_CAD: 0.00049,
  EUR_CHF: 0.00027,
  EUR_AUD: 0.00039,
  EUR_NZD: 0.00078,
  GBP_JPY: 0.049,
  GBP_CAD: 0.00064,
  GBP_CHF: 0.00048,
  GBP_AUD: 0.00057,
  GBP_NZD: 0.0013,
  AUD_JPY: 0.033,
  AUD_CAD: 0.00033,
  AUD_CHF: 0.00022,
  AUD_NZD: 0.00044,
  NZD_JPY: 0.046,
  NZD_CAD: 0.00052,
  NZD_CHF: 0.00041,
  CAD_JPY: 0.046,
  CAD_CHF: 0.00028,
  CHF_JPY: 0.065,
};
