import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const configSchema = z.object({
  OANDA_API_KEY: z.string().min(1),
  OANDA_ACCOUNT_ID: z.string().min(1),
  OANDA_BASE_URL: z
    .string()
    .url()
    .default("https://api-fxpractice.oanda.com"),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = configSchema.parse(process.env);
  }
  return _config;
}
