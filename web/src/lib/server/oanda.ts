/**
 * Server-side OANDA connection for the web app.
 * Uses per-user credentials from user profile.
 */

import { getApiKey } from "./auth.js";

export interface OandaConfig {
  apiKey: string;
  accountId: string;
  baseUrl: string;
}

/** Get OANDA config for a user + specific account ID */
export function getUserOandaConfig(userId: string, accountId: string): OandaConfig | null {
  const apiKey = getApiKey(userId);
  if (!apiKey) return null;

  // TODO: detect practice vs live from account ID format
  const baseUrl = "https://api-fxpractice.oanda.com";

  return { apiKey, accountId, baseUrl };
}

export async function userOandaFetch<T>(config: OandaConfig, path: string): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OANDA API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}
