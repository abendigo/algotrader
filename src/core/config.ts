import { findUser, getUserApiKey } from "./users.js";

export interface Config {
  OANDA_API_KEY: string;
  OANDA_ACCOUNT_ID: string;
  OANDA_BASE_URL: string;
}

/**
 * Build an OANDA config from a user's stored credentials.
 * @param userIdOrEmail - user ID or email to look up
 * @param accountId - OANDA account ID to use
 */
export function getConfigForUser(userIdOrEmail: string, accountId: string): Config {
  const user = findUser(userIdOrEmail);
  if (!user) {
    throw new Error(`User not found: ${userIdOrEmail}`);
  }

  const apiKey = getUserApiKey(user.id);
  if (!apiKey) {
    throw new Error(`No OANDA API key set for ${user.email}. Add one on the profile page.`);
  }

  // TODO: detect practice vs live from account ID format
  const baseUrl = "https://api-fxpractice.oanda.com";

  return {
    OANDA_API_KEY: apiKey,
    OANDA_ACCOUNT_ID: accountId,
    OANDA_BASE_URL: baseUrl,
  };
}
