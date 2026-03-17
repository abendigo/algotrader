import { json } from "@sveltejs/kit";
import { oandaFetch, getAccountPath } from "$lib/server/oanda.js";

export async function GET() {
  const data = await oandaFetch<{
    positions: Array<{
      instrument: string;
      long: { units: string; averagePrice: string; unrealizedPL: string };
      short: { units: string; averagePrice: string; unrealizedPL: string };
    }>;
  }>(`${getAccountPath()}/openPositions`);

  const positions = [];
  for (const p of data.positions) {
    const longUnits = parseFloat(p.long.units);
    const shortUnits = parseFloat(p.short.units);

    if (longUnits > 0) {
      positions.push({
        instrument: p.instrument,
        side: "buy" as const,
        units: longUnits,
        avgPrice: parseFloat(p.long.averagePrice),
        unrealizedPL: parseFloat(p.long.unrealizedPL),
      });
    }
    if (shortUnits < 0) {
      positions.push({
        instrument: p.instrument,
        side: "sell" as const,
        units: Math.abs(shortUnits),
        avgPrice: parseFloat(p.short.averagePrice),
        unrealizedPL: parseFloat(p.short.unrealizedPL),
      });
    }
  }

  return json(positions);
}
