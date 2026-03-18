import { join } from "path";

/**
 * Resolve the data directory path.
 *
 * In Docker (adapter-node build), import.meta.dirname points inside the
 * build output, so relative paths break. Use DATA_DIR env var instead.
 *
 * In local dev (Vite), the relative path from source works fine.
 */
export const DATA_DIR = process.env.DATA_DIR
  ?? join(import.meta.dirname, "../../../../data");

export const PROJECT_ROOT = process.env.PROJECT_ROOT
  ?? join(import.meta.dirname, "../../../..");
