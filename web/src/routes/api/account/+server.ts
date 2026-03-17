import { json } from "@sveltejs/kit";
import { oandaFetch, getAccountPath } from "$lib/server/oanda.js";

export async function GET() {
  const data = await oandaFetch<{
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
  }>(`${getAccountPath()}/summary`);

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
}
