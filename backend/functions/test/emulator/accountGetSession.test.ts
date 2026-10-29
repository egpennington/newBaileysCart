/**
 * D2: account.getSession against the Firestore emulator. Privacy (owned + joined only, no
 * owner-only fields for joined families), unpaid reservations (accessMode NONE), and
 * reverse-index cross-checking. ProofPoint PL-PP-WP03-14 (partial). Every successful response is
 * checked against API Amendment A1 v0.2 §A1.5 (T-GAP-1).
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { accountGetSessionHandler as rawSessionHandler } from "../../src/commands/accountGetSession.js";
import type { SessionDeps } from "../../src/commands/accountGetSession.js";
import { familiesCreateHandler } from "../../src/commands/familiesCreate.js";
import { TRIAL_DURATION_MS } from "../../src/domain/family.js";
import { assertSessionDataConformsToA1 } from "../support/a1Schema.js";
import { FakeClock, clearFirestore, db, expectDomainError, newOpId, uniqueUid } from "../support/emulator.js";

const T0 = Date.UTC(2026, 9, 28, 12, 0, 0, 0);
const verified = (uid: string) => ({ uid, emailVerified: true });
const SESSION_REQ = { apiVersion: "v0.4" };

/** The real handler; every successful response must conform to A1 v0.2 §A1.5 (T-GAP-1). */
function accountGetSessionHandler(deps: SessionDeps): ReturnType<typeof rawSessionHandler> {
  const handler = rawSessionHandler(deps);
  return async (actor, data) => {
    const res = await handler(actor, data);
    assertSessionDataConformsToA1(res.data);
    return res;
  };
}

/** Adds `uid` as a MEMBER of an existing family, writing both edges (what invites.accept will do). */
async function seedMember(familyId: string, uid: string, state = "ACTIVE"): Promise<void> {
  const edge = { role: "MEMBER", state, joinedAt: Timestamp.fromMillis(T0) };
  await db.doc(`families/${familyId}/members/${uid}`).set(edge);
  await db.doc(`users/${uid}/memberships/${familyId}`).set(edge);
}

before(clearFirestore);

describe("account.getSession", () => {
  test("new user: nothing owned or joined, trial eligible", async () => {
    const res = await accountGetSessionHandler({ db, clock: new FakeClock(T0) })(verified(uniqueUid("new")), SESSION_REQ);
    assert.equal(res.status, "COMMITTED");
    assert.equal(res.opId, null);
    assert.equal(res.serverTime, "2026-10-28T12:00:00.000Z");
    assert.deepEqual(res.data, { ownedFamilyId: null, joinedFamilies: [], trialEligible: true, selectedFamilySuggestion: null });
  });

  test("a valid caller opId is echoed", async () => {
    const opId = newOpId();
    const res = await accountGetSessionHandler({ db, clock: new FakeClock(T0) })(verified(uniqueUid("op")), {
      apiVersion: "v0.4",
      opId,
    });
    assert.equal(res.opId, opId);
  });

  test("trial owner: READ_WRITE before trial end, READ_ONLY from trial end", async () => {
    const clock = new FakeClock(T0);
    const uid = uniqueUid("owner");
    const created = await familiesCreateHandler({ db, clock })(verified(uid), {
      apiVersion: "v0.4",
      opId: newOpId(),
      payload: { displayName: "Home" },
    });
    const familyId = created.data.familyId;
    const session = accountGetSessionHandler({ db, clock });

    clock.millis = T0 + TRIAL_DURATION_MS - 1;
    assert.deepEqual((await session(verified(uid), SESSION_REQ)).data, {
      ownedFamilyId: familyId,
      joinedFamilies: [
        {
          familyId,
          role: "OWNER",
          accessMode: "READ_WRITE",
          displayName: "Home",
          lifecycleState: "ACTIVE",
          trialEndsAt: "2026-11-18T12:00:00.000Z",
        },
      ],
      trialEligible: false,
      selectedFamilySuggestion: familyId,
    });

    clock.millis = T0 + TRIAL_DURATION_MS;
    const expired = (await session(verified(uid), SESSION_REQ)).data;
    assert.equal(expired.joinedFamilies[0]?.accessMode, "READ_ONLY");
    assert.equal(expired.selectedFamilySuggestion, familyId);
  });

  test("unpaid reservation: accessMode NONE, no shopping access suggested (GAI §7.1)", async () => {
    const clock = new FakeClock(T0);
    const uid = uniqueUid("unpaid");
    await db.doc(`trialLedger/${uid}`).set({ consumedAt: Timestamp.fromMillis(T0), familyId: "old", opId: newOpId() });
    const created = await familiesCreateHandler({ db, clock })(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    const familyId = created.data.familyId;
    for (const now of [T0, T0 + 2 * 86_400_000]) {
      clock.millis = now;
      assert.deepEqual((await accountGetSessionHandler({ db, clock })(verified(uid), SESSION_REQ)).data, {
        ownedFamilyId: familyId,
        joinedFamilies: [
          {
            familyId,
            role: "OWNER",
            accessMode: "NONE",
            lifecycleState: "UNENTITLED_AWAITING_PAYMENT",
            reservationExpiresAt: "2026-10-29T12:00:00.000Z",
          },
        ],
        trialEligible: false,
        selectedFamilySuggestion: null,
      });
    }
  });

  test("privacy: owned + joined families only; joined families carry no owner-only fields", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const me = uniqueUid("me");
    const alice = uniqueUid("alice");
    const bob = uniqueUid("bob");
    const carol = uniqueUid("carol");

    const mine = (await create(verified(me), { apiVersion: "v0.4", opId: newOpId(), payload: { displayName: "Mine" } })).data.familyId;
    const aliceFam = (await create(verified(alice), { apiVersion: "v0.4", opId: newOpId(), payload: { displayName: "Alice" } })).data
      .familyId;
    await db.doc(`trialLedger/${bob}`).set({ consumedAt: Timestamp.fromMillis(T0), familyId: "old", opId: newOpId() });
    const bobFam = (await create(verified(bob), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data.familyId;
    const carolFam = (await create(verified(carol), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data.familyId;
    await seedMember(aliceFam, me);
    await seedMember(bobFam, me);

    const session = accountGetSessionHandler({ db, clock });
    const data = (await session(verified(me), SESSION_REQ)).data;
    const byId = new Map(data.joinedFamilies.map((f) => [f.familyId, f]));
    assert.deepEqual([...byId.keys()].sort(), [mine, aliceFam, bobFam].sort());
    assert.equal(byId.has(carolFam), false);
    assert.equal(data.ownedFamilyId, mine);
    assert.equal(data.selectedFamilySuggestion, mine);
    assert.deepEqual(byId.get(aliceFam), { familyId: aliceFam, role: "MEMBER", accessMode: "READ_WRITE", displayName: "Alice" });
    assert.deepEqual(byId.get(bobFam), { familyId: bobFam, role: "MEMBER", accessMode: "NONE" });

    const serialized = JSON.stringify(data);
    for (const leak of [alice, bob, carol, carolFam, "trialStartedAt", "reservationCreatedAt"]) {
      assert.ok(!serialized.includes(leak), `session leaks ${leak}`);
    }

    // The other owners' sessions do not reveal this user's family.
    const aliceView = (await session(verified(alice), SESSION_REQ)).data;
    assert.deepEqual(aliceView.joinedFamilies.map((f) => f.familyId), [aliceFam]);
  });

  test("member of a usable family, owner of an unpaid one: suggestion is the usable family", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const me = uniqueUid("me2");
    const host = uniqueUid("host");
    await db.doc(`trialLedger/${me}`).set({ consumedAt: Timestamp.fromMillis(T0), familyId: "old", opId: newOpId() });
    await create(verified(me), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    const hostFam = (await create(verified(host), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data.familyId;
    await seedMember(hostFam, me);
    assert.equal((await accountGetSessionHandler({ db, clock })(verified(me), SESSION_REQ)).data.selectedFamilySuggestion, hostFam);
  });

  test("reverse index alone grants nothing: a stale or inactive edge is excluded", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const me = uniqueUid("stale");
    const other = uniqueUid("other");
    const otherFam = (await create(verified(other), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data.familyId;
    // Reverse edge without the family's own membership edge.
    await db.doc(`users/${me}/memberships/${otherFam}`).set({ role: "OWNER", state: "ACTIVE", joinedAt: Timestamp.fromMillis(T0) });
    // A real but inactive membership.
    const third = uniqueUid("third");
    const thirdFam = (await create(verified(third), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data.familyId;
    await seedMember(thirdFam, me, "REVOKED");
    // A reverse edge to a family that does not exist.
    await db.doc(`users/${me}/memberships/no-such-family`).set({ role: "MEMBER", state: "ACTIVE", joinedAt: Timestamp.fromMillis(T0) });

    const data = (await accountGetSessionHandler({ db, clock })(verified(me), SESSION_REQ)).data;
    assert.deepEqual(data.joinedFamilies, []);
  });

  test("a MEMBER edge claiming OWNER role on another's family is reported as MEMBER", async () => {
    const clock = new FakeClock(T0);
    const me = uniqueUid("claim");
    const owner = uniqueUid("realowner");
    const fam = (await familiesCreateHandler({ db, clock })(verified(owner), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data
      .familyId;
    const edge = { role: "OWNER", state: "ACTIVE", joinedAt: Timestamp.fromMillis(T0) };
    await db.doc(`families/${fam}/members/${me}`).set(edge);
    await db.doc(`users/${me}/memberships/${fam}`).set(edge);
    const f = (await accountGetSessionHandler({ db, clock })(verified(me), SESSION_REQ)).data.joinedFamilies[0];
    assert.equal(f?.role, "MEMBER");
    assert.equal(f && "lifecycleState" in f, false);
  });

  test("unverified email: getSession still succeeds (A1 §A1.5; T-GAP-5)", async () => {
    const clock = new FakeClock(T0);
    const session = accountGetSessionHandler({ db, clock });
    const fresh = await session({ uid: uniqueUid("unv-new"), emailVerified: false }, SESSION_REQ);
    assert.equal(fresh.status, "COMMITTED");
    assert.deepEqual(fresh.data, { ownedFamilyId: null, joinedFamilies: [], trialEligible: true, selectedFamilySuggestion: null });

    // An owner whose token is no longer verified still gets the full session.
    const uid = uniqueUid("unv-owner");
    const familyId = (await familiesCreateHandler({ db, clock })(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} })).data
      .familyId;
    const owned = await session({ uid, emailVerified: false }, SESSION_REQ);
    assert.equal(owned.status, "COMMITTED");
    assert.deepEqual(owned.data, {
      ownedFamilyId: familyId,
      joinedFamilies: [
        { familyId, role: "OWNER", accessMode: "READ_WRITE", lifecycleState: "ACTIVE", trialEndsAt: "2026-11-18T12:00:00.000Z" },
      ],
      trialEligible: false,
      selectedFamilySuggestion: familyId,
    });
  });

  test("joinedFamilies in UTF-16 code-unit order; suggestion is the first usable entry (A1 §A1.5; T-GAP-7)", async () => {
    const clock = new FakeClock(T0);
    const me = uniqueUid("order");
    const tag = newOpId().slice(0, 8);
    // Test fixtures written directly through the Admin SDK so the IDs are chosen: code-unit order
    // (Z U+005A < a U+0061 < m) differs from locale order (a, m, Z) and from insertion order.
    const upper = `Z-${tag}`;
    const lower = `a-${tag}`;
    const mid = `m-${tag}`;
    const unpaid = `0-${tag}`;
    const seedFamily = async (familyId: string, lifecycle: Record<string, unknown>) => {
      await db.doc(`families/${familyId}`).set({ ownerUid: uniqueUid("host"), familyEpoch: 1, ...lifecycle });
      await seedMember(familyId, me);
    };
    const trial = { lifecycleState: "ACTIVE", trialEndsAt: Timestamp.fromMillis(T0 + TRIAL_DURATION_MS) };
    for (const id of [mid, lower, upper]) await seedFamily(id, trial);
    // Sorts first but is not usable, so the suggestion must skip it.
    await seedFamily(unpaid, { lifecycleState: "UNENTITLED_AWAITING_PAYMENT", reservationExpiresAt: Timestamp.fromMillis(T0 + 86_400_000) });

    const data = (await accountGetSessionHandler({ db, clock })(verified(me), SESSION_REQ)).data;
    assert.deepEqual(
      data.joinedFamilies.map((f) => f.familyId),
      [unpaid, upper, lower, mid],
    );
    assert.equal(data.ownedFamilyId, null);
    assert.equal(data.selectedFamilySuggestion, upper);
  });

  test("validation: unknown field and bad version rejected", async () => {
    const session = accountGetSessionHandler({ db, clock: new FakeClock(T0) });
    await expectDomainError(session(verified("x"), { apiVersion: "v0.4", uid: "victim" }), "VALIDATION_FAILED");
    await expectDomainError(session(verified("x"), { apiVersion: "v0.3" }), "API_VERSION_UNSUPPORTED");
  });
});
