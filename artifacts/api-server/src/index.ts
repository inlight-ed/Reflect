import app from "./app";
import { logger } from "./lib/logger";
import { hasPersistentKey } from "./lib/security";
import { scheduleMaintenance } from "./lib/maintenance";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

// Integration tokens are encrypted at rest. Without a persistent key they would become
// unreadable after every restart, so production refuses to start instead of degrading silently.
if (process.env["NODE_ENV"] === "production" && process.env["DATABASE_URL"] && !hasPersistentKey()) {
  logger.fatal("ENCRYPTION_KEY (or SESSION_SECRET) must be set in production. Add it as a secret and restart.");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// docker stop / redeploy sends SIGTERM: stop taking requests and let running ones finish.
// A sync cut off here is marked interrupted on the next run, so nothing is left locked.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "Shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

// Daily housekeeping: expired sessions, old sync log, stale counters.
scheduleMaintenance();
