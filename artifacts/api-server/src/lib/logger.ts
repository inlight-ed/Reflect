import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Removes values that must never reach logs: SQL parameters (database errors include them, and they
 * can carry emails, password hashes or encrypted tokens), bearer tokens and key=value secrets.
 */
export function scrub(text: string): string {
  return text
    .replace(/params:[\s\S]*/i, "params: [redacted]")
    .replace(/\b(bearer|basic)\s+[\w.~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(token|api[_-]?key|secret|password|authorization|x-auth-token)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2[redacted]");
}

export function safeError(err: unknown) {
  if (!(err instanceof Error)) return { message: scrub(String(err)).slice(0, 500) };
  const cause = (err as { cause?: unknown }).cause;
  const code = (err as { code?: unknown }).code;
  return {
    type: err.name,
    message: scrub(err.message).slice(0, 1000),
    ...(code !== undefined ? { code: String(code) } : {}),
    ...(cause instanceof Error ? { cause: { type: cause.name, message: scrub(cause.message).slice(0, 500), ...((cause as { code?: unknown }).code ? { code: String((cause as { code?: unknown }).code) } : {}) } } : {}),
    ...(isProduction ? {} : { stack: err.stack ? scrub(err.stack) : undefined }),
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: { err: safeError, error: safeError },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-auth-token']",
      "res.headers['set-cookie']",
      "req.body",
      "*.secret",
      "*.password",
      "*.token",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
