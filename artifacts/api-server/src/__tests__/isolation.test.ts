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

  it("a signed-in seller without orders is told so, never answered from the demo shop", async () => {
    const response = await b.call("POST", "/shift-market/ask", { question: "Какие товары растут?", locale: "ru" });
    const body = response.json as { answer: string; insufficientData: boolean };
    assert.equal(body.insufficientData, true);
    assert.match(body.answer, /заказов пока нет/);
    assert.ok(!body.answer.includes("демо"));
  });

  it("sellers cannot delete their data or account through the API (administrator only)", async () => {
    for (const path of ["/data", "/auth/account", "/account"]) {
      assert.equal((await b.call("DELETE", path)).status, 404, `DELETE ${path}`);
    }
    // ...and the failed attempts removed nothing of A's or B's.
    assert.ok((await b.call("GET", "/data/status")).text.includes("orders"));
  });

  it("B disconnecting their own integration leaves A untouched", async () => {
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
    for (const [method, path] of [["GET", "/data/status"], ["GET", "/feedback"], ["GET", "/integrations/runs"], ["POST", "/data/import"], ["POST", "/integrations/KASPI_API/sync"]] as const) {
      assert.equal((await anonymous.call(method, path, method === "GET" ? undefined : {})).status, 401, `${method} ${path}`);
    }
  });
});

describe("agency workspaces and roles", { skip }, () => {
  const owner = new Client();
  const viewer = new Client();
  const stranger = new Client();
  const PLAN = `Медиаплан ${stamp}`;
  const CLIENT = `Бренд ${stamp}`;
  let agencyId = "";
  let shopId = "";
  const plan = { client: CLIENT, title: PLAN, placements: [{ variant: "Лайт", platform: "Wolt Ads", format: "Hero Banner", cost: 1_000_000, planImpressions: 500_000 }] };

  before(async () => {
    for (const [client, tag] of [[owner, "owner"], [viewer, "viewer"], [stranger, "stranger"]] as const) {
      assert.equal((await client.call("POST", "/auth/register", { email: `agency-${tag}-${stamp}@example.kz`, password: "password-123" })).status, 201);
    }
    shopId = ((await owner.call("GET", "/auth/me")).json as { workspace: { id: string } }).workspace.id;
    const created = await owner.call("POST", "/workspaces", { kind: "AGENCY", name: `Okori ${stamp}` });
    assert.equal(created.status, 201);
    agencyId = (created.json as { id: string }).id;
    assert.equal((await owner.call("POST", "/media-plans", plan)).status, 201);
  });

  it("creating an agency opens it; the shop keeps its own data", async () => {
    const me = (await owner.call("GET", "/auth/me")).json as { workspace: { id: string; kind: string; role: string }; workspaces: unknown[] };
    assert.deepEqual([me.workspace.id, me.workspace.kind, me.workspace.role], [agencyId, "AGENCY", "OWNER"]);
    assert.equal(me.workspaces.length, 2);
    const clients = (await owner.call("GET", "/clients")).json as Array<{ name: string; plans: number }>;
    assert.deepEqual(clients.map((client) => [client.name, client.plans]), [[CLIENT, 1]]);
    assert.equal((await owner.call("POST", `/workspaces/${shopId}/open`)).status, 200);
    assert.ok(!(await owner.call("GET", "/media-plans")).text.includes(PLAN), "the plan belongs to the agency, not the shop");
    assert.equal((await owner.call("POST", `/workspaces/${agencyId}/open`)).status, 200);
  });

  it("nobody outside the workspace can open it or see its plans and clients", async () => {
    assert.equal((await stranger.call("POST", `/workspaces/${agencyId}/open`)).status, 404);
    for (const path of ["/media-plans", "/clients", "/workspace/members", "/auth/me", "/workspaces"]) {
      const response = await stranger.call("GET", path);
      for (const marker of [PLAN, CLIENT, `Okori ${stamp}`]) assert.ok(!response.text.includes(marker), `${path} leaks ${marker}`);
    }
  });

  it("only the owner invites; a viewer joins by link and reads but cannot change anything", async () => {
    assert.equal((await stranger.call("POST", "/workspace/invites", { role: "VIEWER" })).status, 201, "an owner of their own shop may invite to it");
    const invite = await owner.call("POST", "/workspace/invites", { role: "VIEWER" });
    assert.equal(invite.status, 201);
    const token = (invite.json as { token: string }).token;
    assert.deepEqual((await new Client().call("GET", `/invites/${token}`)).json, { name: `Okori ${stamp}`, kind: "AGENCY", role: "VIEWER" });
    assert.equal((await new Client().call("POST", `/invites/${token}/accept`)).status, 401, "accepting needs an account");
    const joined = await viewer.call("POST", `/invites/${token}/accept`);
    assert.equal(joined.status, 200);
    assert.equal((joined.json as { id: string }).id, agencyId);
    assert.equal((await stranger.call("POST", `/invites/${token}/accept`)).status, 404, "a link works once");

    assert.ok((await viewer.call("GET", "/media-plans")).text.includes(PLAN));
    const planId = ((await viewer.call("GET", "/media-plans")).json as { plans: Array<{ id: string; clientId: string }> }).plans[0]!;
    assert.ok((await viewer.call("GET", `/media-plans?clientId=${planId.clientId}`)).text.includes(PLAN));
    for (const [method, path, body] of [
      ["POST", "/media-plans", plan],
      ["POST", "/clients", { name: "Новый" }],
      ["POST", "/data/import", { kind: "PRODUCTS", products: [{ sku: "X" }] }],
      ["PUT", "/integrations/KASPI_API", { secret: "x" }],
      ["POST", "/workspace/invites", { role: "OWNER" }],
      ["PATCH", "/workspace", { name: "Захват" }],
      ["PUT", `/workspace/members/${"x"}`, { role: "OWNER" }],
    ] as const) {
      const response = await viewer.call(method, path, body);
      assert.equal(response.status, 403, `${method} ${path} → ${response.status}`);
    }
  });

  it("the owner sees the viewer and can raise the role; the viewer can leave", async () => {
    const members = (await owner.call("GET", "/workspace/members")).json as Array<{ userId: string; email: string; role: string }>;
    const guest = members.find((member) => member.email === `agency-viewer-${stamp}@example.kz`)!;
    assert.equal(guest.role, "VIEWER");
    assert.equal((await owner.call("PUT", `/workspace/members/${guest.userId}`, { role: "MEMBER" })).status, 204);
    assert.equal((await viewer.call("POST", "/clients", { name: `Клиент ${stamp}` })).status, 201, "a member edits");
    const me = members.find((member) => member.role === "OWNER")!;
    assert.equal((await viewer.call("DELETE", `/workspace/members/${me.userId}`)).status, 403, "only an owner removes others");
    assert.equal((await owner.call("DELETE", `/workspace/members/${me.userId}`)).status, 409, "the last owner cannot leave");
    assert.equal((await viewer.call("DELETE", `/workspace/members/${guest.userId}`)).status, 204);
    const after = (await viewer.call("GET", "/auth/me")).json as { workspace: { id: string } };
    assert.notEqual(after.workspace.id, agencyId, "after leaving, the person is back in their own workspace");
    assert.ok(!(await viewer.call("GET", "/media-plans")).text.includes(PLAN));
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
