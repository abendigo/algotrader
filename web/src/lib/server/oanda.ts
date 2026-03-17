/**
 * Server-side OANDA connection for the web app.
 * Reads credentials from the parent project's .env file.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ENV_PATH = join(import.meta.dirname, "../../../../.env");

interface OandaConfig {
  apiKey: string;
  accountId: string;
  baseUrl: string;
}

let cachedConfig: OandaConfig | null = null;

export function getOandaConfig(): OandaConfig {
  if (cachedConfig) return cachedConfig;

  if (!existsSync(ENV_PATH)) {
    throw new Error("No .env file found. Set up OANDA credentials first.");
  }

  const env = readFileSync(ENV_PATH, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of env.split("\n")) {
    const match = line.match(/^(\w+)=(.+)$/);
    if (match) vars[match[1]] = match[2];
  }

  cachedConfig = {
    apiKey: vars.OANDA_API_KEY ?? "",
    accountId: vars.OANDA_ACCOUNT_ID ?? "",
    baseUrl: vars.OANDA_BASE_URL ?? "https://api-fxpractice.oanda.com",
  };

  return cachedConfig;
}

export async function oandaFetch<T>(path: string): Promise<T> {
  const config = getOandaConfig();
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

export function getAccountPath(): string {
  return `/v3/accounts/${getOandaConfig().accountId}`;
}
