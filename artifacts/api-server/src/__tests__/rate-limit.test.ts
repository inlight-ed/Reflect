import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

// A database nobody listens on: the shared counter cannot be read.
process.env["DATABASE_URL"] = "postgres://reflect:reflect@127.0.0.1:1/reflect";
const { rateLimit } = await import("../middlewares/rate-limit");

function call(limiter: ReturnType<typeof rateLimit>) {
  const headers: Record<string, unknown> = {};
  let status = 200;
  let body: unknown;
  let passed = false;
  const res = {
    setHeader: (name: string, value: unknown) => { headers[name] = value; },
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  const req = { ip: "203.0.113.7", log: { warn() {} } } as unknown as Request;
  return limiter(req, res, (() => { passed = true; }) as NextFunction).then(() => ({ status, body, headers, passed }));
}

describe("shared rate limits", () => {
  it("refuse the request when the shared counter is unavailable instead of falling back to memory", async () => {
    const result = await call(rateLimit({ name: "login-test", windowMs: 60_000, max: 5, shared: true }));
    assert.equal(result.passed, false);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: "TEMPORARILY_UNAVAILABLE" });
    assert.equal(result.headers["Retry-After"], 30);
  });

  it("in-memory limits keep working without the database", async () => {
    const result = await call(rateLimit({ name: "api-test", windowMs: 60_000, max: 5 }));
    assert.equal(result.passed, true);
  });
});
