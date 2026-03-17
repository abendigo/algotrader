import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getUserOandaConfig, userOandaFetch } from "$lib/server/oanda.js";

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const accountId = url.searchParams.get("account");
  if (!accountId) return json([]);

  const config = getUserOandaConfig(user.id, accountId);
  if (!config) return json([]);

  const data = await userOandaFetch<{
    positions: Array<{
      instrument: string;
      long: { units: string; averagePrice: string; unrealizedPL: string };
      short: { units: string; averagePrice: string; unrealizedPL: string };
    }>;
  }>(config, `/v3/accounts/${config.accountId}/openPositions`);

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
};
