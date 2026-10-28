/**
 * D2: families.create against the Firestore emulator. ProofPoints PL-PP-WP03-15, -25 and
 * -30 (partial). Handlers are called directly with a FakeClock; transport is covered in e2e.
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { familiesCreateHandler } from "../../src/commands/familiesCreate.js";
import type { CreateWriteStep } from "../../src/commands/familiesCreate.js";
import { RESERVATION_TTL_MS, TRIAL_DURATION_MS } from "../../src/domain/family.js";
import { IDEMPOTENCY_RETENTION_MS } from "../../src/persistence/idempotency.js";
import { FakeClock, clearFirestore, db, docsForUid, expectDomainError, newOpId, uniqueUid } from "../support/emulator.js";

const T0 = Date.UTC(2026, 9, 28, 12, 0, 0, 0);
const STRESS_ITERATIONS = Number(process.env["WP03_STRESS_ITERATIONS"] ?? 50);
const PARALLEL = 5;

const verified = (uid: string) => ({ uid, emailVerified: true });
const req = (opId: string, payload: Record<string, unknown> = {}) => ({ apiVersion: "v0.4", opId, payload });

before(clearFirestore);

describe("families.create: trial path", () => {
  test("eligible verified UID: ACTIVE trial family, epoch 1, all records written", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const uid = uniqueUid("trial");
    const opId = newOpId();

    const res = await create(verified(uid), req(opId, { displayName: "  The Smiths " }));
    const { familyId } = res.data;
    assert.equal(res.apiVersion, "v0.4");
    assert.equal(res.opId, opId);
    assert.equal(res.status, "COMMITTED");
    assert.equal(res.serverTime, "2026-10-28T12:00:00.000Z");
    assert.deepEqual(res.data, {
      familyId,
      lifecycleState: "ACTIVE",
      familyEpoch: 1,
      displayName: "The Smiths",
      trialStartedAt: "2026-10-28T12:00:00.000Z",
      trialEndsAt: "2026-11-18T12:00:00.000Z",
    });

    const family = (await db.doc(`families/${familyId}`).get()).data();
    assert.equal(family?.["ownerUid"], uid);
    assert.equal(family?.["lifecycleState"], "ACTIVE");
    assert.equal(family?.["familyEpoch"], 1);
    assert.equal(family?.["displayName"], "The Smiths");
    assert.equal((family?.["trialEndsAt"] as Timestamp).toMillis(), T0 + TRIAL_DURATION_MS);

    assert.deepEqual((await db.doc(`families/${familyId}/members/${uid}`).get()).data(), {
      role: "OWNER",
      state: "ACTIVE",
      joinedAt: Timestamp.fromMillis(T0),
    });
    assert.deepEqual((await db.doc(`users/${uid}/memberships/${familyId}`).get()).data(), {
      role: "OWNER",
      state: "ACTIVE",
      joinedAt: Timestamp.fromMillis(T0),
    });
    assert.equal((await db.doc(`users/${uid}`).get()).get("ownedFamilyId"), familyId);
    const ledger = (await db.doc(`trialLedger/${uid}`).get()).data();
    assert.equal(ledger?.["familyId"], familyId);
    assert.equal(ledger?.["opId"], opId);

    const idem = await db.collection("idempotency").where("actorUid", "==", uid).get();
    assert.equal(idem.size, 1);
    assert.equal((idem.docs[0]?.get("retainUntil") as Timestamp).toMillis(), T0 + IDEMPOTENCY_RETENTION_MS);
    assert.deepEqual(JSON.parse(idem.docs[0]?.get("responseJson") as string), res);
  });

  test("displayName omitted: no displayName stored or returned", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    const res = await create(verified(uniqueUid("noname")), req(newOpId()));
    assert.equal("displayName" in res.data, false);
    assert.equal((await db.doc(`families/${res.data.familyId}`).get()).get("displayName"), undefined);
  });

  test("unverified email: EMAIL_VERIFICATION_REQUIRED and nothing written", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    const uid = uniqueUid("unverified");
    await expectDomainError(create({ uid, emailVerified: false }, req(newOpId())), "EMAIL_VERIFICATION_REQUIRED");
    assert.deepEqual(await docsForUid(uid), []);
  });

  test("invalid displayName: VALIDATION_FAILED and nothing written", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    const uid = uniqueUid("badname");
    await expectDomainError(create(verified(uid), req(newOpId(), { displayName: "a\nb" })), "VALIDATION_FAILED");
    assert.deepEqual(await docsForUid(uid), []);
  });
});

describe("families.create: owner limit (D42) and reservation (D45, D46)", () => {
  test("second create with a new opId: OWNER_ALREADY_HAS_FAMILY, no new records", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    const uid = uniqueUid("limit");
    await create(verified(uid), req(newOpId()));
    const before = await docsForUid(uid);
    await expectDomainError(create(verified(uid), req(newOpId())), "OWNER_ALREADY_HAS_FAMILY");
    assert.deepEqual(await docsForUid(uid), before);
  });

  test("trial already consumed: 24-hour UNENTITLED_AWAITING_PAYMENT reservation, ledger untouched", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const uid = uniqueUid("reserve");
    const ledger = { consumedAt: Timestamp.fromMillis(T0 - 1000), familyId: "old-family", opId: newOpId() };
    await db.doc(`trialLedger/${uid}`).set(ledger);

    const res = await create(verified(uid), req(newOpId()));
    assert.deepEqual(res.data, {
      familyId: res.data.familyId,
      lifecycleState: "UNENTITLED_AWAITING_PAYMENT",
      familyEpoch: 1,
      reservationCreatedAt: "2026-10-28T12:00:00.000Z",
      reservationExpiresAt: "2026-10-29T12:00:00.000Z",
    });
    const family = (await db.doc(`families/${res.data.familyId}`).get()).data();
    assert.equal((family?.["reservationExpiresAt"] as Timestamp).toMillis(), T0 + RESERVATION_TTL_MS);
    assert.equal(family?.["trialEndsAt"], undefined);
    assert.deepEqual((await db.doc(`trialLedger/${uid}`).get()).data(), ledger);
  });

  test("PL-2 / PP-30 (partial): an expired, unreleased reservation still blocks create; trial stays consumed", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const uid = uniqueUid("expired");
    await db.doc(`trialLedger/${uid}`).set({ consumedAt: Timestamp.fromMillis(T0), familyId: "x", opId: newOpId() });
    await create(verified(uid), req(newOpId()));
    for (const offset of [RESERVATION_TTL_MS, RESERVATION_TTL_MS + 1, 30 * RESERVATION_TTL_MS]) {
      clock.millis = T0 + offset;
      await expectDomainError(create(verified(uid), req(newOpId())), "OWNER_ALREADY_HAS_FAMILY");
    }
    assert.equal((await db.doc(`trialLedger/${uid}`).get()).get("familyId"), "x");
  });
});

describe("families.create: idempotency (API §5; PP-25)", () => {
  test("same opId replay returns the identical response, including original timestamps, after 25 hours", async () => {
    const clock = new FakeClock(T0);
    const create = familiesCreateHandler({ db, clock });
    const uid = uniqueUid("replay");
    await db.doc(`trialLedger/${uid}`).set({ consumedAt: Timestamp.fromMillis(T0), familyId: "x", opId: newOpId() });
    const opId = newOpId();
    const first = await create(verified(uid), req(opId, { displayName: "Kim" }));
    clock.advance(25 * 3_600_000);
    const replay = await create(verified(uid), req(opId, { displayName: "Kim" }));
    assert.deepEqual(replay, first);
    assert.equal(replay.data.reservationExpiresAt, "2026-10-29T12:00:00.000Z");
    const families = await db.collection("families").where("ownerUid", "==", uid).get();
    assert.equal(families.size, 1);
  });

  test("replay is order-insensitive to request keys", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    const uid = uniqueUid("keyorder");
    const opId = newOpId();
    const first = await create(verified(uid), { apiVersion: "v0.4", opId, payload: { displayName: "A" } });
    const replay = await create(verified(uid), { payload: { displayName: "A" }, opId, apiVersion: "v0.4" });
    assert.deepEqual(replay, first);
  });

  for (const [name, changed] of [
    ["displayName added", { displayName: "Other" }],
    ["displayName changed", { displayName: "Kim " }],
  ] as const) {
    test(`same opId with ${name}: IDEMPOTENCY_KEY_REUSED, nothing written`, async () => {
      const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
      const uid = uniqueUid("reuse");
      const opId = newOpId();
      await create(verified(uid), req(opId, name === "displayName added" ? {} : { displayName: "Kim" }));
      const before = await docsForUid(uid);
      await expectDomainError(create(verified(uid), req(opId, changed)), "IDEMPOTENCY_KEY_REUSED");
      assert.deepEqual(await docsForUid(uid), before);
    });
  }

  test("same opId from a different user is a separate operation", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    const opId = newOpId();
    const a = await create(verified(uniqueUid("a")), req(opId));
    const b = await create(verified(uniqueUid("b")), req(opId));
    assert.notEqual(a.data.familyId, b.data.familyId);
  });
});

describe("families.create: atomic rollback (membership and reverse index)", () => {
  const steps: CreateWriteStep[] = ["family", "ownerMember", "userOwnerClaim", "reverseMembership", "trialLedger", "idempotency"];
  for (const failAt of steps) {
    test(`failure before writing ${failAt}: no records persist, and a retry then succeeds`, async () => {
      const uid = uniqueUid(`rollback-${failAt}`);
      const opId = newOpId();
      const failing = familiesCreateHandler({
        db,
        clock: new FakeClock(T0),
        beforeWrite: (step) => {
          if (step === failAt) throw new Error(`injected failure at ${step}`);
        },
      });
      await assert.rejects(failing(verified(uid), req(opId)), /injected failure/);
      assert.deepEqual(await docsForUid(uid), []);

      const res = await familiesCreateHandler({ db, clock: new FakeClock(T0) })(verified(uid), req(opId));
      assert.equal(res.data.lifecycleState, "ACTIVE");
      const paths = await docsForUid(uid);
      assert.ok(paths.includes(`families/${res.data.familyId}/members/${uid}`));
      assert.ok(paths.includes(`users/${uid}/memberships/${res.data.familyId}`));
    });
  }
});

describe(`families.create: concurrency stress (${STRESS_ITERATIONS} iterations x ${PARALLEL} parallel; PP-15, PP-25)`, () => {
  test("distinct opIds: exactly one family and one trial claim per UID", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const uid = uniqueUid(`race-${i}`);
      const results = await Promise.allSettled(Array.from({ length: PARALLEL }, () => create(verified(uid), req(newOpId()))));
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      assert.equal(won.length, 1, `iteration ${i}: winners`);
      for (const r of lost) {
        assert.equal((r.reason as { code?: string }).code, "OWNER_ALREADY_HAS_FAMILY", `iteration ${i}: ${String(r.reason)}`);
      }
      const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof create>>>).value.data.familyId;
      const families = await db.collection("families").where("ownerUid", "==", uid).get();
      assert.equal(families.size, 1, `iteration ${i}: families`);
      assert.equal((await db.doc(`trialLedger/${uid}`).get()).get("familyId"), winner, `iteration ${i}: ledger`);
      assert.equal((await db.doc(`users/${uid}`).get()).get("ownedFamilyId"), winner, `iteration ${i}: owner claim`);
    }
  });

  test("identical opId: every caller gets the same committed response, one family", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const uid = uniqueUid(`same-${i}`);
      const opId = newOpId();
      const results = await Promise.all(Array.from({ length: PARALLEL }, () => create(verified(uid), req(opId))));
      for (const r of results) assert.deepEqual(r, results[0], `iteration ${i}: responses differ`);
      const families = await db.collection("families").where("ownerUid", "==", uid).get();
      assert.equal(families.size, 1, `iteration ${i}: families`);
    }
  });

  test("trial consumed, distinct opIds: exactly one reservation per UID", async () => {
    const create = familiesCreateHandler({ db, clock: new FakeClock(T0) });
    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const uid = uniqueUid(`race-res-${i}`);
      await db.doc(`trialLedger/${uid}`).set({ consumedAt: Timestamp.fromMillis(T0), familyId: "x", opId: newOpId() });
      const results = await Promise.allSettled(Array.from({ length: PARALLEL }, () => create(verified(uid), req(newOpId()))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `iteration ${i}: winners`);
      const families = await db.collection("families").where("ownerUid", "==", uid).get();
      assert.equal(families.size, 1, `iteration ${i}: families`);
      assert.equal(families.docs[0]?.get("lifecycleState"), "UNENTITLED_AWAITING_PAYMENT");
    }
  });
});
