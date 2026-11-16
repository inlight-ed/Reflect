import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { fetchKaspiOrders } from "../lib/integrations/kaspi";

type Handler = (req: IncomingMessage, url: URL) => { status?: number; body?: unknown } | undefined;

let server: Server | undefined;
const requests: string[] = [];

async function stopKaspi() {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server!.close(resolve));
  server = undefined;
}

async function startKaspi(handler: Handler) {
  await stopKaspi();
  requests.length = 0;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push(`${url.pathname}${url.search}`);
    const answer = handler(req, url) ?? { body: { data: [] } };
    res.writeHead(answer.status ?? 200, { "content-type": "application/vnd.api+json" });
    res.end(JSON.stringify(answer.body ?? {}));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  process.env["KASPI_API_BASE"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shop/api/v2`;
  process.env["KASPI_RETRY_DELAY_MS"] = "1";
}

afterEach(async () => {
  delete process.env["KASPI_API_BASE"];
  delete process.env["KASPI_RETRY_DELAY_MS"];
  await stopKaspi();
});

const order = (id: string) => ({ id, type: "orders", attributes: { code: `C${id}`, creationDate: Date.now() - 3_600_000, state: "ARCHIVE", status: "COMPLETED" } });
const entry = (id: string) => ({ id, type: "orderentries", attributes: { quantity: 1, totalPrice: 1000, offer: { code: "SKU1", name: "Shampoo" } } });

describe("fetchKaspiOrders", () => {
  it("retries one failed request instead of starting the whole sync again", async () => {
    let entryFailures = 1;
    await startKaspi((_req, url) => {
      if (url.pathname.endsWith("/orders") && url.searchParams.get("filter[orders][state]") === "ARCHIVE") return { body: { data: [order("1")] } };
      if (url.pathname.endsWith("/orders/1/entries")) {
        if (entryFailures-- > 0) return { status: 503 };
        return { body: { data: [entry("e1")] } };
      }
      return undefined;
    });
    const result = await fetchKaspiOrders("token", 7);
    assert.equal(result.lines.length, 1);
    assert.equal(requests.filter((request) => request.includes("/orders/1/entries")).length, 2);
    // The order list was read once per state and window, not again after the entries failure.
    assert.equal(requests.filter((request) => request.includes("state%5D=ARCHIVE") || request.includes("state]=ARCHIVE")).length, 1);
  });

  it("retries 429 but not other client errors", async () => {
    let tooMany = 1;
    await startKaspi((_req, url) => (url.searchParams.get("filter[orders][state]") === "NEW" && tooMany-- > 0 ? { status: 429 } : undefined));
    await fetchKaspiOrders("token", 1);
    assert.ok(requests.filter((request) => request.includes("NEW")).length >= 2);

    await startKaspi(() => ({ status: 400 }));
    await assert.rejects(fetchKaspiOrders("token", 1), (error: { code?: string }) => error.code === "BAD_RESPONSE");
    assert.equal(requests.length, 1);
  });

  it("reads only the window after `since` when it is given", async () => {
    await startKaspi(() => undefined);
    const since = new Date(Date.now() - 2 * 86_400_000);
    await fetchKaspiOrders("token", 60, since);
    const starts = requests.map((request) => Number(new URL(request, "http://x").searchParams.get("filter[orders][creationDate][$ge]")));
    assert.ok(starts.length > 0);
    for (const start of starts) assert.ok(start >= since.getTime(), "window must not start before `since`");
    // 2 days fit in one 14-day window: one request per state, not five windows of 60 days.
    assert.equal(requests.length, 6);
  });

  it("never reads further back than `days`, even with an older `since`", async () => {
    await startKaspi(() => undefined);
    await fetchKaspiOrders("token", 3, new Date(Date.now() - 30 * 86_400_000));
    const starts = requests.map((request) => Number(new URL(request, "http://x").searchParams.get("filter[orders][creationDate][$ge]")));
    for (const start of starts) assert.ok(start >= Date.now() - 3 * 86_400_000 - 5_000);
  });

  it("does not send the token to a host other than Kaspi's", async () => {
    let strangerHits = 0;
    const stranger = createServer((_req, res) => { strangerHits += 1; res.end("{}"); });
    await new Promise<void>((resolve) => stranger.listen(0, "127.0.0.1", resolve));
    const strangerUrl = `http://127.0.0.1:${(stranger.address() as AddressInfo).port}/product`;
    try {
      await startKaspi((_req, url) => {
        if (url.searchParams.get("filter[orders][state]") === "ARCHIVE") return { body: { data: [order("1")] } };
        if (url.pathname.endsWith("/orders/1/entries")) {
          return { body: { data: [{ id: "e1", type: "orderentries", attributes: { quantity: 1, totalPrice: 500 }, relationships: { product: { data: { id: "p1", type: "products" }, links: { related: strangerUrl } } } }] } };
        }
        return undefined;
      });
      const result = await fetchKaspiOrders("token", 7);
      assert.equal(strangerHits, 0);
      assert.equal(result.lines.length, 1);
    } finally {
      stranger.closeAllConnections();
      await new Promise((resolve) => stranger.close(resolve));
    }
  });
});
