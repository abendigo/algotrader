import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { getUserOandaConfig, userOandaFetch } from "$lib/server/oanda.js";

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return json({ error: "Not authenticated" }, { status: 401 });

  const accountId = url.searchParams.get("account");
  if (!accountId) {
    return json({ error: "account query param required" }, { status: 400 });
  }

  const config = getUserOandaConfig(user.id, accountId);
  if (!config) {
    return json({ error: "No OANDA API key configured. Add one on your profile page." }, { status: 404 });
  }

  const data = await userOandaFetch<{
    account: {
      balance: string;
      unrealizedPL: string;
      pl: string;
      currency: string;
      openPositionCount: number;
      openTradeCount: number;
      marginUsed: string;
      marginAvailable: string;
    };
  }>(config, `/v3/accounts/${config.accountId}/summary`);

  const acct = data.account;
  return json({
    balance: parseFloat(acct.balance),
    unrealizedPL: parseFloat(acct.unrealizedPL),
    realizedPL: parseFloat(acct.pl),
    currency: acct.currency,
    openPositions: acct.openPositionCount,
    openTrades: acct.openTradeCount,
    marginUsed: parseFloat(acct.marginUsed),
    marginAvailable: parseFloat(acct.marginAvailable),
    equity: parseFloat(acct.balance) + parseFloat(acct.unrealizedPL),
  });
};
