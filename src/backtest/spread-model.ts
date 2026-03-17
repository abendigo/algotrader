/**
 * Time-varying spread model for realistic backtesting.
 *
 * Forex spreads vary significantly throughout the day based on
 * which trading sessions are active. This model returns a multiplier
 * applied to the base spread for each instrument.
 *
 * Typical pattern:
 *   - Session opens (first 5 min): 1.8x - spreads widen as market makers adjust
 *   - Session open settling (5-15 min): 1.3x - spreads narrowing
 *   - Asian session only: 1.4x - low liquidity
 *   - London session: 1.0x - good liquidity
 *   - London/NY overlap: 0.9x - tightest spreads of the day
 *   - NY afternoon: 1.1x - liquidity fading
 *   - Weekend: 3.0x - very wide
 */

/**
 * Get a spread multiplier for a given timestamp based on session activity.
 * Uses Intl for DST-aware timezone conversion.
 */
export function getSpreadMultiplier(timestamp: number): number {
  const date = new Date(timestamp);
  const dayOfWeek = date.getUTCDay();

  // Weekend: very wide spreads
  if (dayOfWeek === 0 || dayOfWeek === 6) return 3.0;

  // Get local times for each session
  const london = getLocalHourMin(timestamp, "Europe/London");
  const ny = getLocalHourMin(timestamp, "America/New_York");
  const tokyo = getLocalHourMin(timestamp, "Asia/Tokyo"); // no DST

  const londonMin = london.hour * 60 + london.min;
  const nyMin = ny.hour * 60 + ny.min;
  const tokyoMin = tokyo.hour * 60 + tokyo.min;

  // London open: 8:00 local
  const londonOpen = 8 * 60;
  const londonClose = 16 * 60 + 30;
  const londonActive = londonMin >= londonOpen && londonMin < londonClose;

  // NY open: 9:30 local
  const nyOpen = 9 * 60 + 30;
  const nyClose = 16 * 60;
  const nyActive = nyMin >= nyOpen && nyMin < nyClose;

  // Tokyo: 9:00 - 15:00 local
  const tokyoOpen = 9 * 60;
  const tokyoClose = 15 * 60;
  const tokyoActive = tokyoMin >= tokyoOpen && tokyoMin < tokyoClose;

  // Check for session opens (first 5 minutes)
  const atLondonOpen = londonMin >= londonOpen && londonMin < londonOpen + 5;
  const atNyOpen = nyMin >= nyOpen && nyMin < nyOpen + 5;

  // Session open settling (5-15 minutes after open)
  const londonSettling = londonMin >= londonOpen + 5 && londonMin < londonOpen + 15;
  const nySettling = nyMin >= nyOpen + 5 && nyMin < nyOpen + 15;

  // Session open spike
  if (atLondonOpen || atNyOpen) return 1.8;
  if (londonSettling || nySettling) return 1.3;

  // London/NY overlap — tightest spreads
  if (londonActive && nyActive) return 0.9;

  // Single major session active
  if (londonActive) return 1.0;
  if (nyActive) return 1.05;

  // Tokyo session only
  if (tokyoActive) return 1.4;

  // Off-hours (between sessions)
  return 1.5;
}

function getLocalHourMin(timestamp: number, timezone: string): { hour: number; min: number } {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  return {
    hour: parseInt(parts.find((p) => p.type === "hour")!.value, 10),
    min: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
  };
}
