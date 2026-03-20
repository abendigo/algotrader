/**
 * Financing rates for backtesting.
 *
 * These are approximate annual rates based on OANDA's typical rates.
 * In practice, rates change over time as central banks adjust policy.
 * These represent a recent snapshot (~2024-2025) and should be updated
 * periodically.
 *
 * Positive = you earn, negative = you pay.
 * The rate depends on which currency you're long/short:
 *   Long EUR/USD = long EUR, short USD
 *   Short EUR/USD = short EUR, long USD
 *
 * Rates are annual as decimals (0.05 = 5%).
 *
 * To fetch current rates from OANDA:
 *   npx tsx src/data/fetch-financing.ts --user=<email>
 */

export const FINANCING_RATES: Record<string, { longRate: number; shortRate: number }> = {
  // USD majors — rates reflect USD ~5.3%, EUR ~3.5%, GBP ~5.0%, JPY ~0.1%, CAD ~4.5%, CHF ~1.5%, AUD ~4.35%, NZD ~5.5%
  EUR_USD: { longRate: -0.0215, shortRate: 0.0115 },   // long EUR earn 3.5%, pay USD 5.3%
  GBP_USD: { longRate: -0.0065, shortRate: -0.0035 },   // long GBP earn 5.0%, pay USD 5.3%
  USD_JPY: { longRate: 0.0485, shortRate: -0.0585 },    // long USD earn 5.3%, pay JPY 0.1%
  USD_CAD: { longRate: 0.0045, shortRate: -0.0145 },    // long USD earn 5.3%, pay CAD 4.5%
  USD_CHF: { longRate: 0.0345, shortRate: -0.0445 },    // long USD earn 5.3%, pay CHF 1.5%
  AUD_USD: { longRate: -0.0130, shortRate: 0.0030 },    // long AUD earn 4.35%, pay USD 5.3%
  NZD_USD: { longRate: -0.0015, shortRate: -0.0085 },   // long NZD earn 5.5%, pay USD 5.3%

  // Major crosses
  EUR_GBP: { longRate: -0.0180, shortRate: 0.0080 },
  EUR_JPY: { longRate: 0.0305, shortRate: -0.0405 },
  EUR_CAD: { longRate: -0.0135, shortRate: 0.0035 },
  EUR_CHF: { longRate: 0.0165, shortRate: -0.0265 },
  EUR_AUD: { longRate: -0.0120, shortRate: 0.0020 },
  EUR_NZD: { longRate: -0.0235, shortRate: 0.0135 },
  GBP_JPY: { longRate: 0.0455, shortRate: -0.0555 },
  GBP_CAD: { longRate: 0.0015, shortRate: -0.0115 },
  GBP_CHF: { longRate: 0.0315, shortRate: -0.0415 },
  GBP_AUD: { longRate: 0.0030, shortRate: -0.0130 },
  GBP_NZD: { longRate: -0.0085, shortRate: -0.0015 },
  AUD_JPY: { longRate: 0.0390, shortRate: -0.0490 },
  AUD_CAD: { longRate: -0.0050, shortRate: -0.0050 },
  AUD_CHF: { longRate: 0.0250, shortRate: -0.0350 },
  AUD_NZD: { longRate: -0.0150, shortRate: 0.0050 },
  NZD_JPY: { longRate: 0.0505, shortRate: -0.0605 },
  NZD_CAD: { longRate: 0.0065, shortRate: -0.0165 },
  NZD_CHF: { longRate: 0.0365, shortRate: -0.0465 },
  CAD_JPY: { longRate: 0.0405, shortRate: -0.0505 },
  CAD_CHF: { longRate: 0.0265, shortRate: -0.0365 },
  CHF_JPY: { longRate: 0.0105, shortRate: -0.0205 },
};
