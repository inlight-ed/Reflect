import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable, Transform } from "node:stream";

export class UnsafeUrlError extends Error {}

/** Largest response pinnedFetch will read from a user-supplied server. */
export const MAX_REMOTE_BYTES = 10 * 1024 * 1024;

/** Passes bytes through and fails the stream once more than `limit` have gone by. */
function limitBytes(limit: number) {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) done(new UnsafeUrlError("RESPONSE_TOO_LARGE"));
      else done(null, chunk);
    },
  });
}

/**
 * Addresses a user-supplied URL must never reach: private, loopback, link-local (incl. cloud
 * metadata 169.254.169.254), CGNAT, multicast/reserved, and the IPv6 forms that embed IPv4
 * (mapped ::ffff:0:0/96, compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo 2001::/32).
 */
// Separate lists on purpose: in one BlockList an IPv6 rule such as ::/96 also matches every IPv4
// address, which would block all public servers.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blockedV6.addSubnet(network, prefix, "ipv6");

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, "ipv4");
  if (family === 6) return blockedV6.check(address, "ipv6");
  return true;
}

const allowPrivate = () => process.env["MCP_ALLOW_PRIVATE"] === "1";

/**
 * Guards server-side requests to user-supplied URLs (MCP servers): https only, no credentials
 * in the URL, and the host must resolve only to public addresses. This is the early check that
 * gives a clear error; pinnedFetch repeats it at connection time. MCP_ALLOW_PRIVATE=1 is for local
 * development only.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("INVALID_URL");
  }
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) throw new UnsafeUrlError("HTTPS_REQUIRED");
  if (url.username || url.password) throw new UnsafeUrlError("CREDENTIALS_IN_URL");
  if (allowPrivate()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (!addresses.length) throw new UnsafeUrlError("HOST_NOT_FOUND");
  if (addresses.some(isBlockedAddress)) throw new UnsafeUrlError("PRIVATE_ADDRESS");
  return url;
}

/**
 * DNS lookup used for the actual socket. Checking here, rather than only before the request,
 * means the address that was validated is the address connected to, so a DNS answer that
 * changes between check and connect (DNS rebinding) cannot reach an internal host.
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = (addresses as unknown as Array<{ address: string; family: number }>).filter((entry) => allowPrivate() || !isBlockedAddress(entry.address));
    if (!list.length) return callback(Object.assign(new Error("PRIVATE_ADDRESS"), { code: "EPRIVATE" }), "", 0);
    if (options.all) return (callback as unknown as (err: null, list: Array<{ address: string; family: number }>) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

function bodyOf(body: RequestInit["body"]): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new TypeError("Unsupported request body");
}

/**
 * fetch() for user-supplied URLs: connects only to addresses that pass the block list (checked
 * in the socket's own lookup), never follows redirects, and streams the response so SSE works.
 */
export async function pinnedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) throw new UnsafeUrlError("HTTPS_REQUIRED");
  if (url.username || url.password) throw new UnsafeUrlError("CREDENTIALS_IN_URL");
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !allowPrivate() && isBlockedAddress(literal)) throw new UnsafeUrlError("PRIVATE_ADDRESS");
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const payload = bodyOf(init.body);
  if (payload) headers.set("content-length", String(payload.length));
  const transport = url.protocol === "https:" ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(url, { method: init.method ?? "GET", headers: Object.fromEntries(headers), lookup: safeLookup, signal: init.signal ?? undefined }, (response) => {
      const status = response.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new UnsafeUrlError("REDIRECT_BLOCKED"));
        return;
      }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item);
      }
      const nullBody = status === 204 || status === 304 || init.method === "HEAD";
      resolve(new Response(nullBody ? null : (Readable.toWeb(response.pipe(limitBytes(MAX_REMOTE_BYTES))) as ReadableStream), { status, statusText: response.statusMessage, headers: responseHeaders }));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

/**
 * fetch() with a deadline that also covers reading the body (AbortSignal.timeout keeps running
 * after the headers arrive, so a stalled response body cannot hang the caller). Redirects are
 * refused unless the caller opts in, so credentials in headers are never replayed elsewhere.
 */
export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15_000, ...rest } = init;
  return fetch(url, { redirect: "error", ...rest, signal: AbortSignal.timeout(timeoutMs) });
}
