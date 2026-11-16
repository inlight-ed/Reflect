import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { assertPublicUrl, fetchWithTimeout, isBlockedAddress, MAX_REMOTE_BYTES, pinnedFetch } from "../lib/integrations/net";

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

async function withServer<T>(handler: Parameters<typeof createServer>[1], run: (url: string) => Promise<T>): Promise<T> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("response limits", () => {
  it("stops reading a response from a user-supplied server after MAX_REMOTE_BYTES", async () => {
    process.env["MCP_ALLOW_PRIVATE"] = "1";
    try {
      await withServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.alloc(MAX_REMOTE_BYTES + 1024));
      }, async (url) => {
        const response = await pinnedFetch(url);
        await assert.rejects(response.arrayBuffer());
      });
    } finally {
      delete process.env["MCP_ALLOW_PRIVATE"];
    }
  });

  it("still returns small responses in full", async () => {
    process.env["MCP_ALLOW_PRIVATE"] = "1";
    try {
      await withServer((_req, res) => res.end("hello"), async (url) => {
        assert.equal(await (await pinnedFetch(url)).text(), "hello");
      });
    } finally {
      delete process.env["MCP_ALLOW_PRIVATE"];
    }
  });

  it("fetchWithTimeout gives up when the body stalls after the headers", async () => {
    await withServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{");
    }, async (url) => {
      const response = await fetchWithTimeout(url, { timeoutMs: 300 });
      await assert.rejects(response.json());
    });
  });

  it("fetchWithTimeout does not follow redirects", async () => {
    await withServer((_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:9/" });
      res.end();
    }, async (url) => {
      await assert.rejects(fetchWithTimeout(url));
    });
  });
});
