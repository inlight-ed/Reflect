import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPublicUrl, isBlockedAddress, pinnedFetch } from "../lib/integrations/net";

describe("SSRF guard", () => {
  it("blocks private, loopback, metadata and IPv4-in-IPv6 addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fc00::1", "fe80::1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "fec0::1"]) {
      assert.equal(isBlockedAddress(address), true, address);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isBlockedAddress(address), false, address);
  });

  it("rejects URLs that point inside", async () => {
    for (const url of ["https://127.1/", "https://0x7f000001/", "https://[::ffff:127.0.0.1]/", "http://example.com/", "https://user:pass@example.com/"]) {
      await assert.rejects(assertPublicUrl(url), url);
    }
  });

  it("checks the address again when connecting (DNS rebinding)", async () => {
    // "localhost" passes no early check here; the socket's own lookup must refuse it.
    await assert.rejects(pinnedFetch("https://localhost:9/"), (error: NodeJS.ErrnoException) => error.code === "EPRIVATE" || /PRIVATE/.test(error.message));
  });
});
