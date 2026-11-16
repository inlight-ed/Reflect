import { defineConfig } from "drizzle-kit";
import path from "path";

// `generate` only reads the schema and needs no database; `migrate` and `push` fail on their own
// with a connection error if DATABASE_URL is missing or wrong.
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Versioned SQL migrations, committed to git and applied in order by `migrate`.
  out: "./migrations", // relative to lib/db, where the package scripts run
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://database-url-not-set",
  },
});
