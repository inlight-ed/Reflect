/**
 * Shared Drizzle client, created on first use so the API still starts (in demo mode)
 * when DATABASE_URL is missing. Imports are static on purpose: dynamic imports here
 * make the bundler initialise shared modules (zod) out of order.
 */
import { createDb, type Database } from "@workspace/db/client";
import * as schema from "@workspace/db/schema";

export class NoDatabaseError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
  }
}

export function hasDatabase() {
  return Boolean(process.env["DATABASE_URL"]);
}

let client: Database | undefined;

export async function database() {
  if (!hasDatabase()) throw new NoDatabaseError();
  client ??= createDb(process.env["DATABASE_URL"]!);
  return { db: client, ...schema };
}
