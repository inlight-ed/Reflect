import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

/** Creates a client without the import-time DATABASE_URL check of the package root. */
export function createDb(connectionString: string) {
  return drizzle(new pg.Pool({ connectionString }), { schema });
}

export type Database = ReturnType<typeof createDb>;
