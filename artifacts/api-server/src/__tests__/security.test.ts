import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { safeError, scrub } from "../lib/logger";
import { decryptSecret, encryptSecret, hashPassword, HashingBusyError, openSecret, resetKeysForTests, verifyPassword } from "../lib/security";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  resetKeysForTests();
});

describe("secrets", () => {
  it("round-trips and never stores the plain value", () => {
    process.env["ENCRYPTION_KEY"] = "key-one";
    resetKeysForTests();
    const sealed = encryptSecret("kaspi-token-123");
    assert.ok(!sealed.includes("kaspi-token-123"));
    assert.equal(decryptSecret(sealed), "kaspi-token-123");
  });

  it("rejects tampered data", () => {
    process.env["ENCRYPTION_KEY"] = "key-one";
    resetKeysForTests();
    const parts = encryptSecret("token").split(".");
    parts[3] = Buffer.from("other").toString("base64");
    assert.equal(decryptSecret(parts.join(".")), undefined);
  });

  it("reads secrets encrypted with a previous key during rotation", () => {
    process.env["ENCRYPTION_KEY"] = "old-key";
    resetKeysForTests();
    const sealed = encryptSecret("token");
    process.env["ENCRYPTION_KEY"] = "new-key";
    process.env["ENCRYPTION_KEY_PREVIOUS"] = "old-key";
    resetKeysForTests();
    assert.deepEqual(openSecret(sealed), { plain: "token", rotated: true });
    delete process.env["ENCRYPTION_KEY_PREVIOUS"];
    resetKeysForTests();
    assert.equal(decryptSecret(sealed), undefined);
  });
});

describe("passwords", () => {
  it("verifies only the right password", async () => {
    const hash = await hashPassword("correct horse battery");
    assert.equal(await verifyPassword("correct horse battery", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);
  });
});

describe("log scrubbing", () => {
  it("removes SQL parameters from database errors", () => {
    const error = new Error('Failed query: insert into "users" ("email","password_hash") values ($1, $2)\nparams: seller@example.kz,scrypt$abc');
    const logged = safeError(error);
    assert.ok(!JSON.stringify(logged).includes("seller@example.kz"));
    assert.ok(!JSON.stringify(logged).includes("scrypt$abc"));
  });

  it("removes tokens and keys", () => {
    assert.ok(!scrub("Authorization: Bearer abc.def.ghi").includes("abc.def"));
    assert.ok(!scrub("request failed token=s3cr3t&page=1").includes("s3cr3t"));
    assert.ok(!scrub('{"X-Auth-Token":"kaspi-123"}').includes("kaspi-123"));
  });
});

describe("password hashing queue", () => {
  it("runs a burst in turn and refuses what does not fit in the queue instead of piling up", async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, (_, index) => hashPassword(`burst-password-${index}`)));
    const refused = results.filter((result) => result.status === "rejected");
    assert.equal(results.length - refused.length, 34, "2 running + 32 waiting are served");
    assert.ok(refused.every((result) => result.status === "rejected" && result.reason instanceof HashingBusyError));
    // The queue drains completely: the next sign-in works as usual.
    assert.ok(await verifyPassword("after-burst", await hashPassword("after-burst")));
  });
});
