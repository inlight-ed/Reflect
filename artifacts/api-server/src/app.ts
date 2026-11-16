import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { attachUser, sameOriginWrites } from "./lib/auth";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimit } from "./middlewares/rate-limit";

const app: Express = express();

// Replit (and most hosts) put the API behind one proxy; trust it so req.ip is the real client.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// The web app is served from the same origin, so cross-origin access is off by default.
// List extra origins (comma-separated) in ALLOWED_ORIGINS if another site must call the API.
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(cookieParser());
// Imports carry up to 5000 rows per request; everything else stays small.
app.use("/api/data/import", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.use("/api", rateLimit({ name: "api", windowMs: 60_000, max: 300 }));
app.use("/api", sameOriginWrites);
app.use("/api", attachUser);
app.use("/api", router);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "NOT_FOUND" });
});

/**
 * Outside Replit the API also serves the built web app, so one process (one container) runs
 * the whole service. STATIC_DIR points at artifacts/shift-market/dist/public. Hashed files in
 * /assets are cached for a year; index.html is revalidated so a new release shows at once.
 * Unknown paths return index.html so client-side routes like /overview work on reload.
 */
const staticDir = process.env["STATIC_DIR"] ? path.resolve(process.env["STATIC_DIR"]) : undefined;
if (staticDir && existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir, {
    index: false,
    setHeaders(res, file) {
      res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
    },
  }));
  app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// Never leak stack traces or library messages to the browser.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err === "object" && err && "status" in err && typeof err.status === "number" ? err.status : 500;
  if (status >= 500) req.log.error({ err }, "Unhandled API error");
  res.status(status).json({ error: status === 413 ? "PAYLOAD_TOO_LARGE" : status < 500 ? "BAD_REQUEST" : "INTERNAL_ERROR" });
});

export default app;
