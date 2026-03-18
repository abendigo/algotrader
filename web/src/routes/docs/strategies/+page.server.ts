import { readFileSync } from "fs";
import { join } from "path";

const DOCS_JSON = join(import.meta.dirname, "../../../lib/generated/strategy-docs.json");

export function load() {
  const docs = JSON.parse(readFileSync(DOCS_JSON, "utf-8"));
  return { docs };
}
