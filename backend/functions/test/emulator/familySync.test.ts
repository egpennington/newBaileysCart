/**
 * D2: BC-FAMILY-SYNC-01 family sharing against the Firestore emulator (Sync Contract Rev 2).
 * Handlers are called directly with a FakeClock; the callable wire and the read rules are covered in
 * test/e2e/familySync.test.ts and test/rules/familyRead.test.ts.
 *
 * Households: A (owner) and B (invited member) share family F1; C owns a separate family F2.
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { familiesCreateHandler } from "../../src/commands/familiesCreate.js";
import {
  FAMILY_MEMBER_CAPACITY,
  INVITE_TTL_MS,
  inviteCodeHash,
  invitesAcceptHandler,
  invitesCreateHandler,
  itemsAddHandler,
  itemsDeleteHandler,
  itemsEditHandler,
  itemsUndoDeleteHandler,
} from "../../src/commands/familySync.js";
import { FakeClock, clearFirestore, db, expectDomainError, newOpId, uniqueUid } from "../support/emulator.js";

const T0 = Date.UTC(2026, 10, 25, 12, 0, 0, 0);
const clock = new FakeClock(T0);
const deps = { db, clock };
const createFamily = familiesCreateHandler(deps);
const createInvite = invitesCreateHandler(deps);
const acceptInvite = invitesAcceptHandler(deps);
const add = itemsAddHandler(deps);
const edit = itemsEditHandler(deps);
const del = itemsDeleteHandler(deps);
const undo = itemsUndoDeleteHandler(deps);

const verified = (uid: string) => ({ uid, emailVerified: true });
const unverified = (uid: string) => ({ uid, emailVerified: false });
const V = "v0.4";

const A = uniqueUid("sync-a");
const B = uniqueUid("sync-b");
const C = uniqueUid("sync-c");
let F1 = "";
let F2 = "";

async function newFamily(uid: string): Promise<string> {
  return (await createFamily(verified(uid), { apiVersion: V, opId: newOpId(), payload: {} })).data.familyId;
}

async function invite(owner: string, familyId: string): Promise<string> {
  const res = await createInvite(verified(owner), { apiVersion: V, opId: newOpId(), familyId, familyEpoch: 1 });
  assert.ok(res.data.code !== null);
  return res.data.code;
}

const addReq = (familyId: string, itemId: string, name: string, category = "DAIRY", opId = newOpId()) => ({
  apiVersion: V,
  opId,
  familyId,
  familyEpoch: 1,
  itemId,
  name,
  category,
});
const editReq = (familyId: string, itemId: string, patch: Record<string, unknown>, opId = newOpId()) => ({
  apiVersion: V,
  opId,
  familyId,
  familyEpoch: 1,
  itemId,
  patch,
});
const itemReq = (familyId: string, itemId: string, opId = newOpId()) => ({ apiVersion: V, opId, familyId, familyEpoch: 1, itemId });

async function listItem(familyId: string, itemId: string) {
  return (await db.doc(`families/${familyId}/listItems/${itemId}`).get()).data();
}
async function item(familyId: string, itemId: string) {
  return (await db.doc(`families/${familyId}/items/${itemId}`).get()).data();
}

before(async () => {
  await clearFirestore();
  F1 = await newFamily(A);
  F2 = await newFamily(C);
  const code = await invite(A, F1);
  await acceptInvite(verified(B), { apiVersion: V, opId: newOpId(), code });
});

describe("invites", () => {
  test("accept makes B an ACTIVE MEMBER of F1 (both edges) and writes listMeta with the family epoch", async () => {
    assert.deepEqual((await db.doc(`families/${F1}/members/${B}`).get()).get("state"), "ACTIVE");
    assert.deepEqual((await db.doc(`families/${F1}/members/${B}`).get()).get("role"), "MEMBER");
    assert.deepEqual((await db.doc(`users/${B}/memberships/${F1}`).get()).get("state"), "ACTIVE");
    assert.deepEqual((await db.doc(`families/${F1}/listMeta/current`).get()).data(), { familyEpoch: 1 });
  });

  test("the code is stored only as a hash; the invite records family, epoch, expiry and consumption", async () => {
    const code = await invite(A, F1);
    const stored = await db.collection("invites").where("familyId", "==", F1).get();
    for (const d of stored.docs) assert.ok(!JSON.stringify(d.data()).includes(code), "plaintext code stored");
    const doc = (await db.doc(`invites/${inviteCodeHash(code)}`).get()).data();
    assert.equal(doc?.["familyEpoch"], 1);
    assert.equal(doc?.["consumedBy"], null);
    assert.equal(doc?.["expiresAt"].toMillis(), T0 + INVITE_TTL_MS);
  });

  test("a replayed invites.create returns the original result without the code", async () => {
    const opId = newOpId();
    const first = await createInvite(verified(A), { apiVersion: V, opId, familyId: F1, familyEpoch: 1 });
    const replay = await createInvite(verified(A), { apiVersion: V, opId, familyId: F1, familyEpoch: 1 });
    assert.ok(first.data.code !== null);
    assert.equal(replay.data.code, null);
    assert.equal(replay.data.expiresAt, first.data.expiresAt);
  });

  test("only the owner creates invites; non-members get NOT_FOUND", async () => {
    await expectDomainError(createInvite(verified(B), { apiVersion: V, opId: newOpId(), familyId: F1, familyEpoch: 1 }), "OWNER_REQUIRED");
    await expectDomainError(createInvite(verified(C), { apiVersion: V, opId: newOpId(), familyId: F1, familyEpoch: 1 }), "NOT_FOUND");
  });

  test("a used, unknown or expired code is INVITE_INVALID; owner and existing member get ALREADY_MEMBER", async () => {
    const code = await invite(A, F1);
    const d = uniqueUid("sync-d");
    await acceptInvite(verified(d), { apiVersion: V, opId: newOpId(), code });
    await expectDomainError(acceptInvite(verified(C), { apiVersion: V, opId: newOpId(), code }), "INVITE_INVALID");
    await expectDomainError(acceptInvite(verified(C), { apiVersion: V, opId: newOpId(), code: "0000000000000000" }), "INVITE_INVALID");

    const fresh = await invite(A, F1);
    await expectDomainError(acceptInvite(verified(A), { apiVersion: V, opId: newOpId(), code: fresh }), "ALREADY_MEMBER");
    await expectDomainError(acceptInvite(verified(B), { apiVersion: V, opId: newOpId(), code: fresh }), "ALREADY_MEMBER");

    clock.advance(INVITE_TTL_MS);
    await expectDomainError(acceptInvite(verified(C), { apiVersion: V, opId: newOpId(), code: fresh }), "INVITE_INVALID");
    clock.millis = T0;
    // The rejected attempts consumed nothing.
    assert.equal((await db.doc(`invites/${inviteCodeHash(fresh)}`).get()).get("consumedBy"), null);
    await db.doc(`families/${F1}/members/${d}`).update({ state: "REMOVED_BY_TEST" });
  });

  test("an unverified email cannot accept", async () => {
    const code = await invite(A, F1);
    await expectDomainError(acceptInvite(unverified(C), { apiVersion: V, opId: newOpId(), code }), "EMAIL_VERIFICATION_REQUIRED");
  });

  test(`capacity: at most ${FAMILY_MEMBER_CAPACITY} ACTIVE members`, async () => {
    const owner = uniqueUid("cap-owner");
    const fam = await newFamily(owner);
    for (let i = 1; i < FAMILY_MEMBER_CAPACITY; i++) {
      await acceptInvite(verified(uniqueUid(`cap-${i}`)), { apiVersion: V, opId: newOpId(), code: await invite(owner, fam) });
    }
    const last = await invite(owner, fam);
    await expectDomainError(acceptInvite(verified(uniqueUid("cap-x")), { apiVersion: V, opId: newOpId(), code: last }), "FAMILY_FULL");
  });
});

describe("A adds milk, B sees it and checks it off, both see the update", () => {
  const milk = newOpId();

  test("A adds: authoritative item and live read model written in one transaction", async () => {
    const res = await add(verified(A), addReq(F1, milk, "  Milk "));
    assert.deepEqual(res.data, { itemId: milk, name: "Milk", category: "DAIRY", checked: false, deleted: false, rev: 1 });
    const li = await listItem(F1, milk);
    assert.deepEqual(Object.keys(li ?? {}).sort(), ["category", "checked", "name", "rev", "updatedAt"]);
    assert.equal(li?.["name"], "Milk");
    assert.equal((await item(F1, milk))?.["createdBy"], A);
  });

  test("B checks it off with an explicit value; the read model shows checked for everyone", async () => {
    const res = await edit(verified(B), editReq(F1, milk, { checked: true }));
    assert.equal(res.data.checked, true);
    assert.equal(res.data.rev, 2);
    assert.equal((await listItem(F1, milk))?.["checked"], true);
  });

  test("field-level: a rename leaves checked and category untouched", async () => {
    await edit(verified(A), editReq(F1, milk, { name: "Oat milk" }));
    const li = await listItem(F1, milk);
    assert.equal(li?.["name"], "Oat milk");
    assert.equal(li?.["checked"], true);
    assert.equal(li?.["category"], "DAIRY");
    assert.equal(li?.["rev"], 3);
  });

  test("concurrent edits of different fields both apply (last write wins per field)", async () => {
    await Promise.all([
      edit(verified(A), editReq(F1, milk, { category: "MISC" })),
      edit(verified(B), editReq(F1, milk, { checked: false })),
    ]);
    const li = await listItem(F1, milk);
    assert.equal(li?.["category"], "MISC");
    assert.equal(li?.["checked"], false);
    assert.equal(li?.["rev"], 5);
  });
});

describe("idempotency and epoch", () => {
  test("a replayed items.add returns the original response and changes nothing", async () => {
    const id = newOpId();
    const opId = newOpId();
    const first = await add(verified(A), addReq(F1, id, "Bread", "DRY", opId));
    clock.advance(1000);
    const replay = await add(verified(A), addReq(F1, id, "Bread", "DRY", opId));
    clock.millis = T0;
    assert.deepEqual(replay, first);
    assert.equal((await listItem(F1, id))?.["rev"], 1);
  });

  test("the same opId with a different request is IDEMPOTENCY_KEY_REUSED", async () => {
    const opId = newOpId();
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Eggs", "DAIRY", opId));
    await expectDomainError(edit(verified(A), editReq(F1, id, { checked: true }, opId)), "IDEMPOTENCY_KEY_REUSED");
    await expectDomainError(add(verified(A), addReq(F1, id, "Eggs!", "DAIRY", opId)), "IDEMPOTENCY_KEY_REUSED");
  });

  test("a stale familyEpoch is rejected with no change", async () => {
    const id = newOpId();
    await expectDomainError(add(verified(A), { ...addReq(F1, id, "Stale"), familyEpoch: 2 }), "STALE_EPOCH_REJECTED");
    assert.equal(await item(F1, id), undefined);
    assert.equal(await listItem(F1, id), undefined);
  });

  test("a second add of the same itemId by another operation is ITEM_ID_CONFLICT", async () => {
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Rice"));
    await expectDomainError(add(verified(B), addReq(F1, id, "Rice")), "ITEM_ID_CONFLICT");
  });
});

describe("delete, undo and no resurrection", () => {
  test("delete removes the read-model document and keeps a server tombstone; redundant delete is satisfied", async () => {
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Butter"));
    const delOp = newOpId();
    const res = await del(verified(B), itemReq(F1, id, delOp));
    assert.equal(res.data.deleted, true);
    assert.equal(res.data.deleteOpId, delOp);
    assert.equal(await listItem(F1, id), undefined);
    assert.equal((await item(F1, id))?.["deleted"], true);
    const again = await del(verified(A), itemReq(F1, id));
    assert.equal(again.data.deleteOpId, delOp);
    assert.equal((await item(F1, id))?.["rev"], 2);
  });

  test("an edit of a deleted item is ITEM_DELETED and does not resurrect it", async () => {
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Jam"));
    await del(verified(A), itemReq(F1, id));
    await expectDomainError(edit(verified(B), editReq(F1, id, { checked: true })), "ITEM_DELETED");
    assert.equal(await listItem(F1, id), undefined);
  });

  test("undo with the matching deleteOpId restores the item; a conflicting undo is rejected", async () => {
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Tea"));
    const delOp = newOpId();
    await del(verified(A), itemReq(F1, id, delOp));
    await expectDomainError(undo(verified(A), { ...itemReq(F1, id), deleteOpId: newOpId() }), "UNDO_CONFLICT");
    const res = await undo(verified(B), { ...itemReq(F1, id), deleteOpId: delOp });
    assert.equal(res.data.deleted, false);
    assert.equal((await listItem(F1, id))?.["name"], "Tea");
    const twice = await undo(verified(A), { ...itemReq(F1, id), deleteOpId: delOp });
    assert.equal(twice.data.rev, res.data.rev);
  });

  test("ITEM_NOT_FOUND for an unknown item", async () => {
    await expectDomainError(edit(verified(A), editReq(F1, newOpId(), { checked: true })), "ITEM_NOT_FOUND");
    await expectDomainError(del(verified(A), itemReq(F1, newOpId())), "ITEM_NOT_FOUND");
  });
});

describe("household isolation: C cannot touch F1", () => {
  test("every item command from C on F1 is NOT_FOUND and changes nothing", async () => {
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Apples", "PRODUCE"));
    const before = await listItem(F1, id);
    await expectDomainError(add(verified(C), addReq(F1, newOpId(), "Intruder")), "NOT_FOUND");
    await expectDomainError(edit(verified(C), editReq(F1, id, { checked: true })), "NOT_FOUND");
    await expectDomainError(del(verified(C), itemReq(F1, id)), "NOT_FOUND");
    await expectDomainError(undo(verified(C), { ...itemReq(F1, id), deleteOpId: newOpId() }), "NOT_FOUND");
    assert.deepEqual(await listItem(F1, id), before);
  });

  test("C's own family is separate: C's items are never in F1 and A cannot write to F2", async () => {
    const id = newOpId();
    await add(verified(C), addReq(F2, id, "C-only"));
    assert.equal(await listItem(F1, id), undefined);
    await expectDomainError(edit(verified(A), editReq(F2, id, { checked: true })), "NOT_FOUND");
    await expectDomainError(edit(verified(B), editReq(F2, id, { checked: true })), "NOT_FOUND");
  });

  test("C cannot replay A's opId to read A's cached response (idempotency is per actor)", async () => {
    const opId = newOpId();
    const id = newOpId();
    await add(verified(A), addReq(F1, id, "Secret", "MISC", opId));
    await expectDomainError(add(verified(C), addReq(F1, id, "Secret", "MISC", opId)), "NOT_FOUND");
  });
});

describe("revocation and lifecycle", () => {
  test("a member whose state is no longer ACTIVE gets MEMBERSHIP_REVOKED, also for a replay", async () => {
    const owner = uniqueUid("rev-owner");
    const fam = await newFamily(owner);
    const m = uniqueUid("rev-m");
    await acceptInvite(verified(m), { apiVersion: V, opId: newOpId(), code: await invite(owner, fam) });
    const opId = newOpId();
    const id = newOpId();
    await add(verified(m), addReq(fam, id, "Before", "MISC", opId));
    await db.doc(`families/${fam}/members/${m}`).update({ state: "REVOKED" });
    await expectDomainError(add(verified(m), addReq(fam, newOpId(), "After")), "MEMBERSHIP_REVOKED");
    await expectDomainError(add(verified(m), addReq(fam, id, "Before", "MISC", opId)), "MEMBERSHIP_REVOKED");
  });

  test("a family that is not ACTIVE rejects writes; an expired trial is READ_ONLY", async () => {
    const owner = uniqueUid("life-owner");
    const fam = await newFamily(owner);
    await db.doc(`families/${fam}`).update({ lifecycleState: "CLOSING", closureCaseId: "case-x" });
    await expectDomainError(add(verified(owner), addReq(fam, newOpId(), "x")), "FAMILY_CLOSING");
    await db.doc(`families/${fam}`).update({ lifecycleState: "ACTIVE", closureCaseId: null });
    clock.advance(30 * 86_400_000);
    await expectDomainError(add(verified(owner), addReq(fam, newOpId(), "x")), "READ_ONLY");
    clock.millis = T0;
  });

  test("an unverified email cannot write", async () => {
    await expectDomainError(add(unverified(A), addReq(F1, newOpId(), "x")), "EMAIL_VERIFICATION_REQUIRED");
  });
});

describe("validation", () => {
  for (const [name, request] of [
    ["unknown top-level key", { ...addReq("f", newOpId(), "x"), extra: 1 }],
    ["unknown patch key", editReq("f", newOpId(), { checked: true, rev: 9 })],
    ["empty patch", editReq("f", newOpId(), {})],
    ["toggle instead of explicit value", editReq("f", newOpId(), { checked: "toggle" })],
    ["blank name", addReq("f", newOpId(), "   ")],
    ["line break in name", addReq("f", newOpId(), "a\nb")],
    ["bidi control in name", addReq("f", newOpId(), "a\u202Eb")],
    ["101 code points", addReq("f", newOpId(), "x".repeat(101))],
    ["unknown category", addReq("f", newOpId(), "x", "SNACKS")],
    ["itemId not UUID v4", { ...addReq("f", newOpId(), "x"), itemId: "not-a-uuid" }],
  ] as const) {
    test(`rejects ${name}`, async () => {
      const call = name.includes("patch") || name.includes("toggle") ? edit(verified(A), request) : add(verified(A), request);
      await expectDomainError(call, "VALIDATION_FAILED");
    });
  }
});
