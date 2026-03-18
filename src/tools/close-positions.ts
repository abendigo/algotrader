/**
 * Quick utility to close all open positions on an OANDA account.
 * Usage: npx tsx src/tools/close-positions.ts --user=<email> --account=<id>
 */

import { OandaBroker } from "../brokers/oanda/index.js";
import { getConfigForUser } from "../core/config.js";
import { findUser } from "../core/users.js";

const userFlag = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1];
const accountFlag = process.argv.find((a) => a.startsWith("--account="))?.split("=")[1];

if (!userFlag || !accountFlag) {
  console.error("Usage: npx tsx src/tools/close-positions.ts --user=<email> --account=<id>");
  process.exit(1);
}

const user = findUser(userFlag);
if (!user) {
  console.error(`User not found: ${userFlag}`);
  process.exit(1);
}

const config = getConfigForUser(user.id, accountFlag);
const broker = new OandaBroker(config);

const positions = await broker.getPositions();
console.log(`Open positions: ${positions.length}`);

for (const p of positions) {
  console.log(`  ${p.instrument} ${p.side} ${p.units}u PnL=$${p.unrealizedPL.toFixed(4)}`);
}

if (positions.length === 0) {
  console.log("Nothing to close.");
  process.exit(0);
}

for (const p of positions) {
  console.log(`Closing ${p.instrument}...`);
  const result = await broker.closePosition(p.instrument);
  console.log(`  Closed at ${result.filledPrice}`);
}

console.log("Done.");
