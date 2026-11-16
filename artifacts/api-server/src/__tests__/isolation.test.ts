/**
 * Runs against a live API with a database: TEST_API_URL=http://localhost:8080/api pnpm test
 * (skipped otherwise). Checks that one seller can never see or change another seller's data,
 * that concurrent sign-ups and syncs are safe, and that "sign out everywhere" works.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const BASE = process.env["TEST_API_URL"];
const skip = BASE ? false : "set TEST_API_URL to run API isolation tests";

class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!;
    const text = await response.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text };
  }
}

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const SKU_A = `ISO-A-${stamp}`;
const NAME_A = `Секретный товар ${stamp}`;
const SECRET_A = `kaspi-token-${stamp}-abcd`;
const a = new Client();
const b = new Client();

const today = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

describe("seller data isolation", { skip }, () => {
  before(async () => {
    assert.equal((await a.call("POST", "/auth/register", { email: `iso-a-${stamp}@example.kz`, password: "password-123" })).status, 201);
    assert.equal((await b.call("POST", "/auth/register", { email: `iso-b-${stamp}@example.kz`, password: "password-123" })).status, 201);
    const orders = Array.from({ length: 40 }, (_, i) => ({ orderCode: `A${stamp}${i}`, orderedAt: today(i % 30), sku: SKU_A, productName: NAME_A, quantity: 1, amount: 9000, status: "Выдан" }));
    assert.equal((await a.call("POST", "/data/import", { kind: "ORDERS", orders })).status, 200);
    await a.call("POST", "/data/import", { kind: "PRODUCTS", products: [{ sku: SKU_A, name: NAME_A, costPrice: 4000, stock: 3 }] });
    await a.call("POST", "/data/import", { kind: "ADS", ads: [{ day: today(2), sku: SKU_A, channel: "Kaspi", spend: 5000 }] });
    await a.call("POST", "/feedback", { actionKey: `RESTOCK:${SKU_A}`, actionType: "RESTOCK", sku: SKU_A, object: NAME_A, verdict: "WORKED" });
    await a.call("POST", "/content/events", { sku: SKU_A, kind: "PHOTO", note: NAME_A });
    await a.call("POST", "/shift-market/external-media/campaigns", { name: `Кампания ${stamp}`, channel: "Instagram", startDate: today(10), endDate: today(1), budget: 100000, objective: "test" });
    await a.call("PUT", "/integrations/KASPI_API", { secret: SECRET_A });
  });

  it("seller A sees their own data", async () => {
    const products = await a.call("GET", "/shift-market/products");
    assert.ok(products.text.includes(SKU_A));
  });

  for (const path of ["/shift-market/dashboard", "/shift-market/products", "/shift-market/advertising", "/shift-market/external-media", "/content/analysis", "/data/status", "/feedback", "/integrations/runs", "/shift-market/integrations", "/auth/me"]) {
    it(`seller B never sees A's data in ${path}`, async () => {
      const response = await b.call("GET", path);
      assert.ok(response.status < 500, `${path} → ${response.status}`);
      for (const marker of [SKU_A, NAME_A, stamp + "-abcd", `Кампания ${stamp}`]) assert.ok(!response.text.includes(marker), `${path} leaks ${marker}`);
    });
  }

  it("seller B cannot open A's card by SKU", async () => {
    const response = await b.call("GET", `/content/analysis?sku=${encodeURIComponent(SKU_A)}`);
    assert.ok(!response.text.includes(NAME_A));
  });

  it("the assistant answers B from B's data only", async () => {
    const response = await b.call("POST", "/shift-market/ask", { question: `Что с товаром ${SKU_A}?`, locale: "ru" });
    assert.ok(!response.text.includes(NAME_A));
  });

  it("B deleting their data or connections leaves A untouched", async () => {
    assert.equal((await b.call("DELETE", "/data")).status < 300, true);
    await b.call("DELETE", "/integrations/KASPI_API");
    const products = await a.call("GET", "/shift-market/products");
    assert.ok(products.text.includes(SKU_A));
    const connections = (await a.call("GET", "/shift-market/integrations")).json as { connections?: Array<{ kind: string; secretHint: string | null }> };
    assert.ok(connections.connections?.find((connection) => connection.kind === "KASPI_API")?.secretHint);
  });

  it("never returns stored secrets, only a hint", async () => {
    const response = await a.call("GET", "/shift-market/integrations");
    assert.ok(!response.text.includes(SECRET_A));
  });

  it("requires sign-in for seller endpoints", async () => {
    const anonymous = new Client();
    for (const [method, path] of [["GET", "/data/status"], ["GET", "/feedback"], ["GET", "/integrations/runs"], ["POST", "/data/import"], ["DELETE", "/data"], ["POST", "/integrations/KASPI_API/sync"]] as const) {
      assert.equal((await anonymous.call(method, path, method === "GET" ? undefined : {})).status, 401, `${method} ${path}`);
    }
  });
});

describe("concurrency and sessions", { skip }, () => {
  it("two sign-ups with one email at once: one succeeds, one gets EMAIL_TAKEN", async () => {
    const email = `race-${stamp}@example.kz`;
    const results = await Promise.all([new Client(), new Client(), new Client()].map((client) => client.call("POST", "/auth/register", { email, password: "password-123" })));
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409, 409]);
  });

  it("parallel sync requests start a single run", async () => {
    const seller = new Client();
    await seller.call("POST", "/auth/register", { email: `sync-${stamp}@example.kz`, password: "password-123" });
    await seller.call("PUT", "/integrations/KASPI_API", { secret: `token-${stamp}` });
    await Promise.all([1, 2, 3].map(() => seller.call("POST", "/integrations/KASPI_API/sync")));
    const deadline = Date.now() + 30_000;
    let runs: Array<{ kind: string; status: string }> = [];
    while (Date.now() < deadline) {
      runs = (await seller.call("GET", "/integrations/runs")).json as typeof runs;
      if (runs.every((run) => run.status !== "RUNNING")) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    // Whether the token works or not, the three clicks must produce one run.
    assert.equal(runs.filter((run) => run.kind === "KASPI_API").length, 1);
  });

  it("sign out everywhere ends sessions on other devices", async () => {
    const email = `devices-${stamp}@example.kz`;
    const laptop = new Client();
    const phone = new Client();
    await laptop.call("POST", "/auth/register", { email, password: "password-123" });
    await phone.call("POST", "/auth/login", { email, password: "password-123" });
    assert.equal((await phone.call("GET", "/data/status")).status, 200);
    assert.equal((await laptop.call("POST", "/auth/logout-all")).status, 204);
    assert.equal((await phone.call("GET", "/data/status")).status, 401);
  });
});
