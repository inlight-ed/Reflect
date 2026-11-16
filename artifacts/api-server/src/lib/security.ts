import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { logger } from "./logger";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Password hash format: scrypt$N$r$p$saltBase64$hashBase64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A dummy hash so failed logins for unknown emails take as long as real ones. */
let dummyHash: Promise<string> | undefined;
export function timingDummyHash() {
  dummyHash ??= hashPassword(randomBytes(12).toString("hex"));
  return dummyHash;
}

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const derive = (secret: string) => createHash("sha256").update(secret).digest();

/** True when integration secrets can survive a restart (a persistent key is configured). */
export function hasPersistentKey() {
  return Boolean(process.env["ENCRYPTION_KEY"] ?? process.env["SESSION_SECRET"]);
}

let keys: { current: Buffer; previous: Buffer[] } | undefined;
/**
 * ENCRYPTION_KEY (or SESSION_SECRET) encrypts. To rotate, move the old value to
 * ENCRYPTION_KEY_PREVIOUS (comma-separated for several); secrets still decrypt and are
 * re-encrypted with the new key the next time they are read.
 */
function keyRing() {
  if (keys) return keys;
  const configured = process.env["ENCRYPTION_KEY"] ?? process.env["SESSION_SECRET"];
  let current: Buffer;
  if (configured) current = derive(configured);
  else {
    // index.ts refuses to start in production without a key; this is development only.
    logger.warn("ENCRYPTION_KEY is not set: integration secrets use a temporary key and must be re-entered after a restart");
    current = randomBytes(32);
  }
  const previous = (process.env["ENCRYPTION_KEY_PREVIOUS"] ?? "").split(",").map((value) => value.trim()).filter(Boolean).map(derive);
  keys = { current, previous };
  return keys;
}

/** AES-256-GCM. Output: v1.ivBase64.tagBase64.dataBase64 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyRing().current, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function open(sealed: string, key: Buffer): string | undefined {
  try {
    const [version, ivB64, tagB64, dataB64] = sealed.split(".");
    if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Decrypts with the current key, then previous keys. `rotated` is set when an old key was used. */
export function openSecret(sealed: string): { plain: string; rotated: boolean } | undefined {
  const ring = keyRing();
  const plain = open(sealed, ring.current);
  if (plain !== undefined) return { plain, rotated: false };
  for (const key of ring.previous) {
    const old = open(sealed, key);
    if (old !== undefined) return { plain: old, rotated: true };
  }
  return undefined;
}

export function decryptSecret(sealed: string): string | undefined {
  return openSecret(sealed)?.plain;
}

/** Test hook: forget derived keys after changing env. */
export function resetKeysForTests() {
  keys = undefined;
}

/** Last 4 characters, for showing "•••• 1a2b" without revealing the secret. */
export const secretHint = (secret: string) => (secret.length > 8 ? `•••• ${secret.slice(-4)}` : "••••");
