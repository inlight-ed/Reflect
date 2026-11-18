import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { register } from "../lib/auth";
import { database } from "../lib/database";
import { createMediaPlan, getMediaPlan, listMediaPlans, MediaClientForbidden, MediaPlanNotFound, saveMediaFact } from "../lib/media-plans";
import {
  acceptInvite,
  createClient,
  createInvite,
  createWorkspace,
  denyLimited,
  listClients,
  listMembers,
  memberClientIds,
  previewInvite,
  removeMember,
  requireAllClients,
  resolveWorkspace,
  setMemberClients,
  setMemberRole,
  WorkspaceError,
} from "../lib/workspaces";
import { deleteAccountForTests } from "./helpers";

const skip = process.env["DATABASE_URL"] ? false : "set DATABASE_URL to run database tests";
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "OK";
  } catch (error) {
    if (error instanceof WorkspaceError) return error.code;
    throw error;
  }
};
const plan = (client: string, platform = "Wolt Ads") => ({
  client,
  title: `План ${client}`,
  placements: [{ variant: "Лайт", platform, format: "Hero Banner", cost: 1_000_000, planImpressions: 1_000_000 }],
});

describe("access limited to some clients of an agency", { skip }, () => {
  const ids: string[] = [];
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const account = async (tag: string) => {
    const created = await register(`ca-${tag}-${stamp}@example.kz`, "password-123");
    ids.push(created.user.id);
    return created;
  };
  after(async () => {
    for (const id of ids) await deleteAccountForTests(id);
  });

  /** An agency with two clients and one plan each, and a brand representative limited to L'Oréal. */
  async function setup(tag: string) {
    const owner = await account(`${tag}-owner`);
    const brand = await account(`${tag}-brand`);
    const agency = await createWorkspace(owner.user.id, "AGENCY", "Okori");
    const loreal = await createClient(agency, "L'Oréal");
    const lg = await createClient(agency, "LG");
    const lorealPlan = await createMediaPlan(agency, plan("L'Oréal"));
    const lgPlan = await createMediaPlan(agency, plan("LG", "Kaspi"));
    const invite = await createInvite(agency, owner.user.id, "VIEWER", [loreal.id]);
    await acceptInvite(invite.token, brand.user.id);
    const scope = (await resolveWorkspace(brand.user.id, agency, "x")).clientIds;
    return { owner, brand, agency, loreal, lg, lorealPlan, lgPlan, scope };
  }

  it("an invitation limited to clients gives the person those clients only", async () => {
    const { owner, brand, agency, loreal, scope } = await setup("invite");
    assert.deepEqual(scope, [loreal.id]);
    const access = await resolveWorkspace(brand.user.id, agency, "x");
    assert.equal(access.restricted, true);
    assert.equal(access.role, "VIEWER");
    const ownerAccess = await resolveWorkspace(owner.user.id, agency, "x");
    assert.deepEqual([ownerAccess.restricted, ownerAccess.clientIds], [false, null], "an owner sees everything");
    assert.equal((await previewInvite((await createInvite(agency, owner.user.id, "VIEWER", [loreal.id])).token)).restricted, true);
    assert.equal((await previewInvite((await createInvite(agency, owner.user.id, "VIEWER")).token)).restricted, false);
  });

  it("clients, plans and benchmarks of other clients are invisible, and look like they do not exist", async () => {
    const { agency, lorealPlan, lgPlan, lg, loreal, scope } = await setup("read");
    assert.deepEqual((await listClients(agency, scope)).map((client) => client.name), ["L'Oréal"]);
    assert.equal((await listClients(agency, null)).length, 2);

    const list = await listMediaPlans(agency, undefined, scope);
    assert.deepEqual(list.plans.map((item) => item.client), ["L'Oréal"]);
    assert.deepEqual(list.benchmarks.map((item) => [item.platform, item.clients]), [["Wolt Ads", 1]], "the agency's wider price base is not shown");
    assert.equal((await listMediaPlans(agency, undefined, null)).benchmarks.length, 2);
    assert.equal((await listMediaPlans(agency, lg.id, scope)).plans.length, 0, "asking for another client's plans returns nothing");
    assert.equal((await listMediaPlans(agency, loreal.id, scope)).plans.length, 1);

    assert.equal((await getMediaPlan(agency, lorealPlan.id, scope)).client, "L'Oréal");
    await assert.rejects(getMediaPlan(agency, lgPlan.id, scope), MediaPlanNotFound);
    await assert.rejects(saveMediaFact(agency, lgPlan.id, lgPlan.placements[0]!.id, { factImpressions: 5 }, scope), MediaPlanNotFound);
    assert.equal((await getMediaPlan(agency, lgPlan.id)).placements[0]?.factImpressions, null, "the refused write changed nothing");
  });

  it("a limited member adds plans only to their own clients and never creates a client", async () => {
    const { agency, scope, loreal } = await setup("write");
    await assert.rejects(createMediaPlan(agency, plan("LG"), scope), MediaClientForbidden);
    await assert.rejects(createMediaPlan(agency, plan("Новый клиент"), scope), MediaClientForbidden);
    assert.equal((await listClients(agency)).length, 2, "no client appeared");
    const own = await createMediaPlan(agency, plan(" l'oréal "), scope);
    assert.equal(own.clientId, loreal.id);
    const filled = await saveMediaFact(agency, own.id, own.placements[0]!.id, { factImpressions: 700_000 }, scope);
    assert.equal(filled.placements[0]?.delivery, 0.7);
  });

  it("a new client is not given to a limited member; the owner can widen, narrow and lift the limit", async () => {
    const { owner, brand, agency, loreal, lg } = await setup("change");
    const fresh = await createClient(agency, "Samsung");
    assert.deepEqual(await memberClientIds(agency, brand.user.id), [loreal.id]);

    await setMemberClients(agency, brand.user.id, [loreal.id, lg.id, lg.id]);
    assert.deepEqual((await memberClientIds(agency, brand.user.id)).sort(), [loreal.id, lg.id].sort());
    await setMemberClients(agency, brand.user.id, []);
    const none = await resolveWorkspace(brand.user.id, agency, "x");
    assert.deepEqual(none.clientIds, [], "limited to nothing sees nothing");
    assert.equal((await listClients(agency, none.clientIds)).length, 0);
    assert.deepEqual(await listMediaPlans(agency, undefined, none.clientIds), { plans: [], benchmarks: [] });

    await setMemberClients(agency, brand.user.id, null);
    assert.equal((await resolveWorkspace(brand.user.id, agency, "x")).clientIds, null);
    assert.ok((await listClients(agency, null)).some((client) => client.id === fresh.id));
    const row = (await listMembers(agency)).find((member) => member.userId === owner.user.id);
    assert.equal(row?.clientIds, null);
  });

  it("a deleted client drops out of every limited member's list", async () => {
    const { agency, brand, loreal } = await setup("gone");
    const { db, clientsTable } = await database();
    await db.delete(clientsTable).where(eq(clientsTable.id, loreal.id));
    assert.deepEqual(await memberClientIds(agency, brand.user.id), []);
    assert.deepEqual((await resolveWorkspace(brand.user.id, agency, "x")).clientIds, [], "still limited, now to nothing");
  });

  it("a limited member sees only their own row in the member list; the owner sees who sees what", async () => {
    const { owner, brand, agency, loreal } = await setup("members");
    const own = await listMembers(agency, brand.user.id);
    assert.deepEqual(own.map((member) => member.userId), [brand.user.id]);
    const all = await listMembers(agency);
    assert.equal(all.length, 2);
    assert.deepEqual(all.find((member) => member.userId === brand.user.id)?.clientIds, [loreal.id]);
    assert.equal(all.find((member) => member.userId === owner.user.id)?.clientIds, null);
  });

  it("refuses clients from another workspace, owners with a limit, and limits outside an agency", async () => {
    const { owner, brand, agency, loreal } = await setup("invalid");
    const outsider = await account("invalid-outsider");
    const foreign = await createClient(outsider.workspaceId, "Чужой клиент");
    assert.equal(await code(createInvite(agency, owner.user.id, "MEMBER", [foreign.id])), "INVALID_SCOPE");
    assert.equal(await code(setMemberClients(agency, brand.user.id, [loreal.id, foreign.id])), "INVALID_SCOPE");
    assert.equal(await code(createInvite(agency, owner.user.id, "OWNER", [loreal.id])), "INVALID_SCOPE");
    assert.equal(await code(setMemberClients(agency, owner.user.id, [loreal.id])), "INVALID_SCOPE", "an owner cannot be limited");
    assert.equal(await code(setMemberClients(agency, "nobody", [loreal.id])), "NOT_FOUND");
    assert.equal(await code(createInvite(outsider.workspaceId, outsider.user.id, "VIEWER", [foreign.id])), "NOT_AGENCY");
    assert.deepEqual(await memberClientIds(agency, brand.user.id), [loreal.id], "a refused change leaves the limit as it was");
  });

  it("making a limited member an owner lifts the limit; someone who already belongs keeps what they have", async () => {
    const { owner, brand, agency, loreal, lg } = await setup("promote");
    await setMemberRole(agency, brand.user.id, "OWNER");
    const promoted = await resolveWorkspace(brand.user.id, agency, "x");
    assert.deepEqual([promoted.role, promoted.restricted, promoted.clientIds], ["OWNER", false, null]);
    assert.deepEqual(await memberClientIds(agency, brand.user.id), []);

    const colleague = await account("promote-colleague");
    await acceptInvite((await createInvite(agency, owner.user.id, "MEMBER")).token, colleague.user.id);
    await acceptInvite((await createInvite(agency, owner.user.id, "VIEWER", [lg.id])).token, colleague.user.id);
    assert.equal((await resolveWorkspace(colleague.user.id, agency, "x")).clientIds, null, "a second, narrower link does not take clients away");

    const brand2 = await account("promote-brand2");
    await acceptInvite((await createInvite(agency, owner.user.id, "VIEWER", [loreal.id])).token, brand2.user.id);
    await acceptInvite((await createInvite(agency, owner.user.id, "MEMBER")).token, brand2.user.id);
    assert.deepEqual((await resolveWorkspace(brand2.user.id, agency, "x")).clientIds, [loreal.id], "a second, wider link does not give more");
  });

  it("removing a member removes their limit rows too", async () => {
    const { agency, brand } = await setup("remove");
    await removeMember(agency, brand.user.id);
    assert.deepEqual(await memberClientIds(agency, brand.user.id), []);
  });
});

describe("guards for limited members", () => {
  const run = (guard: typeof requireAllClients, workspace: unknown) => {
    let status = 200;
    let body: unknown;
    let nexted = false;
    const res = { status: (value: number) => ((status = value), res), json: (value: unknown) => ((body = value), res) } as unknown as Response;
    guard({ user: { id: "u" }, workspace } as unknown as Request, res, () => { nexted = true; });
    return { status, body, nexted };
  };
  const full = { role: "MEMBER", clientIds: null };
  const limited = { role: "MEMBER", clientIds: ["c1"] };

  it("only people who see every client add or rename clients", () => {
    assert.equal(run(requireAllClients, full).nexted, true);
    assert.deepEqual(run(requireAllClients, limited), { status: 403, body: { error: "LIMITED_ACCESS" }, nexted: false });
    assert.deepEqual(run(requireAllClients, { role: "VIEWER", clientIds: null }), { status: 403, body: { error: "READ_ONLY" }, nexted: false });
    assert.equal(run(requireAllClients, undefined).status, 401);
  });

  it("workspace-wide data is closed to limited members, including those limited to nothing", () => {
    assert.equal(run(denyLimited, full).nexted, true);
    assert.equal(run(denyLimited, limited).status, 403);
    assert.equal(run(denyLimited, { role: "MEMBER", clientIds: [] }).status, 403);
  });
});
