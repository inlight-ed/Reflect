import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { register } from "../lib/auth";
import {
  acceptInvite,
  createClient,
  createInvite,
  createWorkspace,
  listClients,
  listMembers,
  listWorkspaces,
  previewInvite,
  removeMember,
  renameClient,
  resolveWorkspace,
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

describe("workspaces, members and clients", { skip }, () => {
  const ids: string[] = [];
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const account = async (tag: string, name?: string) => {
    const created = await register(`ws-${tag}-${stamp}@example.kz`, "password-123", name);
    ids.push(created.user.id);
    return created;
  };
  after(async () => {
    for (const id of ids) await deleteAccountForTests(id);
  });

  it("a new account starts in its own shop, as its owner", async () => {
    const { user, workspaceId } = await account("new", "Айгерим");
    const all = await listWorkspaces(user.id);
    assert.deepEqual(all, [{ id: workspaceId, kind: "SHOP", name: "Айгерим", role: "OWNER" }]);
  });

  it("an invitation link adds the person with its role, works once, and keeps an existing role", async () => {
    const owner = await account("owner");
    const guest = await account("guest");
    const agency = await createWorkspace(owner.user.id, "AGENCY", "Okori");
    const invite = await createInvite(agency, owner.user.id, "VIEWER");
    assert.deepEqual(await previewInvite(invite.token), { name: "Okori", kind: "AGENCY", role: "VIEWER" });

    assert.equal(await acceptInvite(invite.token, guest.user.id), agency);
    assert.equal(await code(acceptInvite(invite.token, guest.user.id)), "INVALID_INVITE", "a link works once");
    assert.equal(await code(previewInvite(invite.token)), "INVALID_INVITE");
    const roles = Object.fromEntries((await listMembers(agency)).map((member) => [member.userId, member.role]));
    assert.deepEqual(roles, { [owner.user.id]: "OWNER", [guest.user.id]: "VIEWER" });

    const again = await createInvite(agency, owner.user.id, "OWNER");
    await acceptInvite(again.token, guest.user.id);
    assert.equal((await listMembers(agency)).find((member) => member.userId === guest.user.id)?.role, "VIEWER", "a second link does not change the role");
    assert.equal(await code(acceptInvite("not-a-token", guest.user.id)), "INVALID_INVITE");
  });

  it("a workspace always keeps an owner; removing someone only takes away access", async () => {
    const owner = await account("keep");
    const helper = await account("helper");
    const agency = await createWorkspace(owner.user.id, "AGENCY", "Агентство");
    await acceptInvite((await createInvite(agency, owner.user.id, "MEMBER")).token, helper.user.id);

    assert.equal(await code(setMemberRole(agency, owner.user.id, "MEMBER")), "LAST_OWNER");
    assert.equal(await code(removeMember(agency, owner.user.id)), "LAST_OWNER");
    await setMemberRole(agency, helper.user.id, "OWNER");
    await setMemberRole(agency, owner.user.id, "MEMBER");
    assert.equal(await code(setMemberRole(agency, helper.user.id, "VIEWER")), "LAST_OWNER");

    await createClient(agency, "L'Oréal");
    await removeMember(agency, owner.user.id);
    assert.ok(!(await listWorkspaces(owner.user.id)).some((item) => item.id === agency));
    assert.equal((await listClients(agency)).length, 1, "the agency's data stays");
    assert.equal(await code(removeMember(agency, owner.user.id)), "NOT_FOUND");
  });

  it("opens the remembered workspace only while the person is a member, and never leaves them without one", async () => {
    const owner = await account("resolve");
    const other = await account("stranger");
    const agency = await createWorkspace(owner.user.id, "AGENCY", "Okori");
    assert.equal((await resolveWorkspace(owner.user.id, agency, "x")).id, agency);
    assert.equal((await resolveWorkspace(owner.user.id, other.workspaceId, "x")).id, owner.workspaceId, "someone else's workspace is never opened");
    assert.equal((await resolveWorkspace(owner.user.id, null, "x")).id, owner.workspaceId);

    const lonely = await account("lonely");
    const helperOwner = await account("lonely-owner");
    await acceptInvite((await createInvite(lonely.workspaceId, lonely.user.id, "OWNER")).token, helperOwner.user.id);
    await removeMember(lonely.workspaceId, lonely.user.id);
    const fresh = await resolveWorkspace(lonely.user.id, lonely.workspaceId, "Новый магазин");
    assert.notEqual(fresh.id, lonely.workspaceId);
    assert.deepEqual({ kind: fresh.kind, role: fresh.role, name: fresh.name }, { kind: "SHOP", role: "OWNER", name: "Новый магазин" });
  });

  it("matches clients by name in any letter case and refuses a rename onto another client", async () => {
    const owner = await account("clients");
    const agency = await createWorkspace(owner.user.id, "AGENCY", "Okori");
    const loreal = await createClient(agency, "L'Oréal");
    assert.equal((await createClient(agency, "  l'oréal ")).id, loreal.id);
    const lg = await createClient(agency, "LG");
    assert.equal(await code(renameClient(agency, lg.id, "L'ORÉAL")), "INVALID_NAME");
    assert.equal((await renameClient(agency, lg.id, "LG Electronics")).name, "LG Electronics");
    assert.equal(await code(renameClient(owner.workspaceId, lg.id, "Чужой")), "NOT_FOUND", "a client is renamed only inside its workspace");
    assert.deepEqual((await listClients(agency)).map((client) => client.name), ["L'Oréal", "LG Electronics"]);
    assert.equal(await code(createClient(agency, "   ")), "INVALID_NAME");
  });
});
