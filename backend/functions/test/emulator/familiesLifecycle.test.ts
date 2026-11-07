/**
 * D2: Slice 3 lifecycle callable handlers against the Firestore emulator with the deterministic
 * fake billing provider (Substage 3A). Fake-provider results prove domain behavior only.
 * ProofPoints: PL-PP-WP03-16, -17, -18, -19, -20, -22, -27, -28, -29, -30 (see each describe).
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { RECOVERY_WINDOW_MS, TRIAL_DURATION_MS } from "../../src/domain/family.js";
import { CONFIRMATION_TOKEN_TTL_MS } from "../../src/domain/confirmation.js";
import { processCancellationCase, processRecoveryDeadline } from "../../src/workers/lifecycleWorkers.js";
import { assertSessionDataConformsToA1, SLICE3_LIFECYCLE_STATES } from "../support/a1Schema.js";
import { clearFirestore, db, expectDomainError, newOpId, uniqueUid } from "../support/emulator.js";
import { T0, World, caseDoc, casesFor, claimOf, familyDoc, ms, snapshotState, verified } from "../support/lifecycle.js";

const STRESS = Number(process.env["WP03_STRESS_ITERATIONS"] ?? 50);
const PARALLEL = 5;
before(clearFirestore);

describe("families.close: zero-liability trial goes directly to CLOSING (S3-D09; PL-PP-WP03-17, -18)", () => {
  test("verified zero liability: CLOSING, 30-day clock from commit, no cancellation, token consumed", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const req = await w.closeReq(uid, familyId);
    const res = await w.close(verified(uid), req);

    assert.equal(res.status, "COMMITTED");
    assert.deepEqual(res.data, {
      familyId,
      lifecycleState: "CLOSING",
      familyEpoch: 1,
      cancellationStatus: "NOT_REQUIRED",
      closureCaseId: res.data.closureCaseId,
      recoverUntilAt: new Date(T0 + RECOVERY_WINDOW_MS).toISOString(),
    });
    const fam = await familyDoc(familyId);
    assert.equal(fam["lifecycleState"], "CLOSING");
    assert.equal(fam["familyEpoch"], 1, "close never changes the epoch");
    const c = await caseDoc(res.data.closureCaseId);
    assert.equal(c["cancellationStatus"], "NOT_REQUIRED");
    assert.equal(ms(c["recoverUntilAt"]), T0 + RECOVERY_WINDOW_MS);
    assert.equal(c["nextAttemptAt"], null, "no cancellation work dispatched");
    assert.equal(c["liabilitySource"], "FAKE_PROVIDER");
    assert.deepEqual(w.provider.calls.map((x) => x.op), ["checkLiability"], "no requestCancellation for a zero-liability trial");
    assert.equal(await claimOf(uid), familyId, "owner claim retained while CLOSING");

    // Access frozen for owner and member immediately (no provider callback needed).
    const own = (await w.session(verified(uid), { apiVersion: "v0.4" })).data;
    assertSessionDataConformsToA1(own, SLICE3_LIFECYCLE_STATES);
    assert.deepEqual(own.joinedFamilies.map((f) => [f.familyId, f.role, f.accessMode, f.lifecycleState]), [[familyId, "OWNER", "NONE", "CLOSING"]]);
    assert.equal(own.selectedFamilySuggestion, null);
    const mem = (await w.session(verified(member), { apiVersion: "v0.4" })).data;
    assert.deepEqual(mem.joinedFamilies, [{ familyId, role: "MEMBER", accessMode: "NONE" }]);
  });
});

describe("families.close: paid and uncertain liability (D44, INV-05; PL-PP-WP03-17, -18)", () => {
  test("verified paid obligation: CLOSURE_PENDING_BILLING, durable cancellation case due now, no clock", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const res = await w.close(verified(uid), await w.closeReq(uid, familyId));
    assert.equal(res.data.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(res.data.cancellationStatus, "PENDING");
    assert.equal("recoverUntilAt" in res.data, false);
    const c = await caseDoc(res.data.closureCaseId);
    assert.equal(c["recoverUntilAt"], null);
    assert.equal(ms(c["nextAttemptAt"]), T0);
    assert.equal(await claimOf(uid), familyId);
  });

  const uncertain: Record<string, (w: World, familyId: string) => Promise<void>> = {
    "local pending purchase": (w, f) => w.billing(f, "PENDING", "p-pending"),
    "provider outage": async (w, f) => void w.provider.scriptLiability(f, "OUTAGE"),
    "provider timeout": async (w, f) => void w.provider.scriptLiability(f, "TIMEOUT"),
    "unknown purchase correlation": (w, f) => w.billing(f, "NONE", "unknown-ref"),
    "provider and local disagree": (w, f) => w.billing(f, "ACTIVE", null),
  };
  for (const [name, arrange] of Object.entries(uncertain)) {
    test(`${name}: reconciliation hold (CLOSURE_PENDING_BILLING / LIABILITY_UNRESOLVED), no clock, no fabricated CLOSING`, async () => {
      const w = new World();
      const { uid, familyId } = await w.trialFamily();
      await arrange(w, familyId);
      const res = await w.close(verified(uid), await w.closeReq(uid, familyId));
      assert.equal(res.data.lifecycleState, "CLOSURE_PENDING_BILLING");
      assert.equal(res.data.cancellationStatus, "LIABILITY_UNRESOLVED");
      assert.equal((await caseDoc(res.data.closureCaseId))["recoverUntilAt"], null);
      assert.equal(await claimOf(uid), familyId);
    });
  }

  test("billing record changes between the provider check and the commit -> hold, not ZERO_VERIFIED", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    w.afterLiabilityCheck = () => w.billing(familyId, "PENDING", "late-purchase");
    const res = await w.close(verified(uid), await w.closeReq(uid, familyId));
    assert.equal(res.data.cancellationStatus, "LIABILITY_UNRESOLVED");
  });
});

describe("families.close rejections leave no trace (W-02; PL-PP-WP03-16, -27 shape)", () => {
  test("unverified email is rejected before the body is examined", async () => {
    const w = new World();
    await expectDomainError(w.close({ uid: "u-unverified", emailVerified: false }, { garbage: true }), "EMAIL_VERIFICATION_REQUIRED");
  });

  test("missing / unknown / expired / foreign-family / wrong-action / stale-epoch tokens", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const other = await w.trialFamily("other");
    const before = await snapshotState(uid, familyId);
    const base = { apiVersion: "v0.4", familyId, familyEpoch: 1 };

    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId() }), "VALIDATION_FAILED");
    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId(), confirmationToken: "Z".repeat(43) }), "CONFIRMATION_REQUIRED");
    const foreign = await w.token(other.uid, other.familyId, "families.close");
    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId(), confirmationToken: foreign }), "CONFIRMATION_REQUIRED");
    const myTokenOtherFamily = await w.token(uid, other.familyId, "families.close");
    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId(), confirmationToken: myTokenOtherFamily }), "CONFIRMATION_REQUIRED");
    const waiveToken = await w.token(uid, familyId, "families.waiveRecovery");
    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId(), confirmationToken: waiveToken }), "CONFIRMATION_REQUIRED");
    const epoch2 = await w.token(uid, familyId, "families.close", 2);
    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId(), confirmationToken: epoch2 }), "CONFIRMATION_REQUIRED");
    const expiring = await w.token(uid, familyId, "families.close");
    w.clock.advance(CONFIRMATION_TOKEN_TTL_MS);
    await expectDomainError(w.close(verified(uid), { ...base, opId: newOpId(), confirmationToken: expiring }), "CONFIRMATION_EXPIRED");

    assert.equal(await snapshotState(uid, familyId), before, "no state change on any rejection");
    assert.equal(w.provider.calls.length, 0, "no provider call for a request that fails a guard");
  });

  test("member, stranger, missing family, stale epoch", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const before = await snapshotState(uid, familyId);
    await expectDomainError(w.close(verified(member), await w.closeReq(member, familyId)), "OWNER_REQUIRED");
    const stranger = uniqueUid("stranger");
    await expectDomainError(w.close(verified(stranger), await w.closeReq(stranger, familyId)), "OWNER_REQUIRED");
    await expectDomainError(w.close(verified(uid), await w.closeReq(uid, "noSuchFamily000000000")), "NOT_FOUND");
    await expectDomainError(w.close(verified(uid), await w.closeReq(uid, familyId, 2)), "STALE_EPOCH_REJECTED");
    assert.equal(await snapshotState(uid, familyId), before);
  });

  test("reservation family cannot be closed as ACTIVE (UNENTITLED_AWAITING_PAYMENT)", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    // Release is not possible yet, so seed a reservation family directly for the guard check.
    const res = await db.collection("families").add({
      ownerUid: uid,
      lifecycleState: "UNENTITLED_AWAITING_PAYMENT",
      familyEpoch: 1,
      reservationCreatedAt: Timestamp.fromMillis(T0),
      reservationExpiresAt: Timestamp.fromMillis(T0 + 86_400_000),
    });
    await expectDomainError(w.close(verified(uid), await w.closeReq(uid, res.id)), "UNENTITLED_AWAITING_PAYMENT");
    assert.ok(familyId);
  });

  test("closing an already closing family: FAMILY_CLOSING / FAMILY_CLOSURE_PENDING", async () => {
    const w = new World();
    const t = await w.trialFamily();
    await w.closed(t.uid, t.familyId);
    await expectDomainError(w.close(verified(t.uid), await w.closeReq(t.uid, t.familyId)), "FAMILY_CLOSING");
    const p = await w.paidFamily();
    await w.closed(p.uid, p.familyId);
    await expectDomainError(w.close(verified(p.uid), await w.closeReq(p.uid, p.familyId)), "FAMILY_CLOSURE_PENDING");
  });
});

describe("families.close idempotency and concurrency (AC-S3-02, AC-S3-11; PL-PP-WP03-18)", () => {
  test("same opId replay returns the original response with no second case or provider call; changed payload rejects", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const req = await w.closeReq(uid, familyId);
    const first = await w.close(verified(uid), req);
    w.clock.advance(60_000);
    const again = await w.close(verified(uid), JSON.parse(JSON.stringify(req)) as unknown);
    assert.deepEqual(again, first);
    assert.equal(w.provider.calls.length, 1);
    assert.equal(await casesFor(familyId), 1);
    await expectDomainError(w.close(verified(uid), { ...req, familyEpoch: 2 }), "IDEMPOTENCY_KEY_REUSED");
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId, 1, req.opId)), "IDEMPOTENCY_KEY_REUSED");
  });

  test("another actor reusing the owner's opId gets no cached data (fresh request -> OWNER_REQUIRED)", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const req = await w.closeReq(uid, familyId);
    await w.close(verified(uid), req);
    await expectDomainError(w.close(verified(member), { ...req }), "OWNER_REQUIRED");
  });

  test(`concurrent closes with distinct opIds: exactly one case (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.paidFamily(`cc${i}`);
      const reqs = await Promise.all(Array.from({ length: PARALLEL }, () => w.closeReq(uid, familyId)));
      const results = await Promise.allSettled(reqs.map((r) => w.close(verified(uid), r)));
      const ok = results.filter((r) => r.status === "fulfilled");
      assert.equal(ok.length, 1, `iteration ${i}: one winner`);
      // A2-D4: the five seeded tokens supersede one another, so a loser is rejected either as
      // superseded (CONFIRMATION_REQUIRED) or, if it ran after the winner, as FAMILY_CLOSURE_PENDING.
      for (const r of results) {
        if (r.status === "rejected") assert.ok(["FAMILY_CLOSURE_PENDING", "CONFIRMATION_REQUIRED"].includes((r.reason as { code: string }).code));
      }
      assert.equal(await casesFor(familyId), 1);
    }
  });

  test(`concurrent identical requests: one commit, identical responses (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`ci${i}`);
      const req = await w.closeReq(uid, familyId);
      const results = await Promise.all(Array.from({ length: PARALLEL }, () => w.close(verified(uid), { ...req })));
      for (const r of results) assert.deepEqual(r, results[0]);
      assert.equal(await casesFor(familyId), 1);
    }
  });
});

describe("families.restore (D43/D44, S3-D07; PL-PP-WP03-19, -20, -22)", () => {
  test("pending cancellation -> CLOSURE_CANCELLATION_IN_PROGRESS with no side effects", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    await w.closed(uid, familyId);
    const before = await snapshotState(uid, familyId);
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "CLOSURE_CANCELLATION_IN_PROGRESS");
    assert.equal(await snapshotState(uid, familyId), before);
  });

  test("CLOSING: restore once, epoch +1, members revoked, replay identical, old-epoch work rejected", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const closeReq = await w.closeReq(uid, familyId);
    const closeRes = await w.close(verified(uid), closeReq);
    w.clock.advance(3_600_000);
    const req = w.restoreReq(familyId);
    const res = await w.restore(verified(uid), req);
    assert.deepEqual(res.data, { familyId, lifecycleState: "ACTIVE", familyEpoch: 2, accessMode: "READ_WRITE" });

    const fam = await familyDoc(familyId);
    assert.equal(fam["familyEpoch"], 2);
    assert.equal(fam["closureCaseId"], null);
    assert.ok((await caseDoc(closeRes.data.closureCaseId))["restoredAt"] instanceof Timestamp);
    assert.equal((await db.doc(`families/${familyId}/members/${member}`).get()).get("state"), "REVOKED");
    assert.equal((await db.doc(`users/${member}/memberships/${familyId}`).get()).get("state"), "REVOKED");
    assert.equal((await db.doc(`families/${familyId}/members/${uid}`).get()).get("state"), "ACTIVE");

    // Replay after the epoch moved: original result, no second increment (AC-S3-02).
    w.clock.advance(1000);
    assert.deepEqual(await w.restore(verified(uid), { ...req }), res);
    assert.equal((await familyDoc(familyId))["familyEpoch"], 2);

    // PL-PP-WP03-22: pre-restore (epoch 1) work never commits.
    await expectDomainError(w.close(verified(uid), await w.closeReq(uid, familyId, 1)), "STALE_EPOCH_REJECTED");
    await expectDomainError(w.waive(verified(uid), await w.waiveReq(uid, familyId, 1)), "STALE_EPOCH_REJECTED");
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId, 1)), "STALE_EPOCH_REJECTED");
    // An old opId retried out of order replays its original result and does not re-close.
    assert.deepEqual(await w.close(verified(uid), { ...closeReq }), closeRes);
    assert.equal((await familyDoc(familyId))["lifecycleState"], "ACTIVE");
    // Revoked member stays out after restore (no revival).
    const mem = (await w.session(verified(member), { apiVersion: "v0.4" })).data;
    assert.deepEqual(mem.joinedFamilies, []);
    // New-epoch work proceeds.
    const reclosed = await w.close(verified(uid), await w.closeReq(uid, familyId, 2));
    assert.equal(reclosed.data.familyEpoch, 2);
  });

  test("restore does not fabricate entitlement: trial ended during closure -> READ_ONLY", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    w.clock.advance(TRIAL_DURATION_MS - 60_000);
    await w.closed(uid, familyId);
    w.clock.advance(120_000);
    const res = await w.restore(verified(uid), w.restoreReq(familyId));
    assert.equal(res.data.accessMode, "READ_ONLY");
  });

  test("deadline boundary: 1 ms before succeeds; at the deadline CLOSURE_RECOVERY_EXPIRED", async () => {
    const w = new World();
    const a = await w.trialFamily("edge-a");
    const b = await w.trialFamily("edge-b");
    await w.closed(a.uid, a.familyId);
    await w.closed(b.uid, b.familyId);
    w.clock.advance(RECOVERY_WINDOW_MS - 1);
    assert.equal((await w.restore(verified(a.uid), w.restoreReq(a.familyId))).data.familyEpoch, 2);
    w.clock.advance(1);
    await expectDomainError(w.restore(verified(b.uid), w.restoreReq(b.familyId)), "CLOSURE_RECOVERY_EXPIRED");
  });

  test("member and stranger restore -> OWNER_REQUIRED; ACTIVE family -> FAMILY_NOT_CLOSED", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "FAMILY_NOT_CLOSED");
    await w.closed(uid, familyId);
    await expectDomainError(w.restore(verified(member), w.restoreReq(familyId)), "OWNER_REQUIRED");
    await expectDomainError(w.restore(verified(uniqueUid("x")), w.restoreReq(familyId)), "OWNER_REQUIRED");
  });

  test(`parallel restores with distinct opIds: epoch advances exactly once (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`pr${i}`);
      await w.closed(uid, familyId);
      const results = await Promise.allSettled(Array.from({ length: PARALLEL }, () => w.restore(verified(uid), w.restoreReq(familyId))));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `iteration ${i}`);
      for (const r of results) if (r.status === "rejected") assert.equal((r.reason as { code: string }).code, "STALE_EPOCH_REJECTED");
      assert.equal((await familyDoc(familyId))["familyEpoch"], 2);
    }
  });
});

describe("families.waiveRecovery (D47; PL-PP-WP03-27, -28, -29, -30)", () => {
  test("CLOSING waiver: DELETION_PENDING with atomic claim release, audit, trial still consumed", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const caseId = await w.closed(uid, familyId);
    const ledgerBefore = (await db.doc(`trialLedger/${uid}`).get()).data();
    w.clock.advance(1000);
    const res = await w.waive(verified(uid), await w.waiveReq(uid, familyId));
    assert.deepEqual(res.data, { familyId, lifecycleState: "DELETION_PENDING", familyEpoch: 1, disposition: "DELETION_PENDING" });

    assert.equal((await familyDoc(familyId))["lifecycleState"], "DELETION_PENDING");
    assert.equal((await familyDoc(familyId))["familyEpoch"], 1, "waiver never changes the epoch");
    assert.equal(await claimOf(uid), null);
    const c = await caseDoc(caseId);
    assert.equal(ms(c["waiverCommittedAt"]), T0 + 1000);
    assert.equal(ms(c["ownershipReleasedAt"]), T0 + 1000);
    assert.equal(c["deletionCompletedAt"], undefined, "DELETION_PENDING is not purge");
    const audit = (await db.doc(`ownershipReleaseAudits/${caseId}`).get()).data();
    assert.equal(audit?.["ownerUid"], uid);
    assert.equal(audit?.["trigger"], "WAIVER");
    assert.equal(audit?.["trialLedgerReset"], false);
    assert.deepEqual((await db.doc(`trialLedger/${uid}`).get()).data(), ledgerBefore);
    assert.equal((await db.doc(`families/${familyId}/members/${uid}`).get()).get("state"), "RELEASED");

    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "RECOVERY_ALREADY_WAIVED");
    await expectDomainError(w.waive(verified(uid), await w.waiveReq(uid, familyId)), "RECOVERY_ALREADY_WAIVED");

    // Session stays consistent (HB-3) after release; trial not reset.
    const s = (await w.session(verified(uid), { apiVersion: "v0.4" })).data;
    assertSessionDataConformsToA1(s, SLICE3_LIFECYCLE_STATES);
    assert.deepEqual(s, { ownedFamilyId: null, joinedFamilies: [], trialEligible: false, selectedFamilySuggestion: null });
    // PL-PP-WP03-30: lawful release permits one new family, an unentitled reservation (no second trial).
    const next = await w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    assert.equal(next.data.lifecycleState, "UNENTITLED_AWAITING_PAYMENT");
    await expectDomainError(w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }), "OWNER_ALREADY_HAS_FAMILY");
    assert.equal((await familyDoc(familyId))["ownerUid"], uid, "original family keeps its immutable owner");
  });

  test("pending-cancellation waiver: intent only, claim retained; verified cancellation -> DELETION_PENDING directly", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    const res = await w.waive(verified(uid), await w.waiveReq(uid, familyId));
    assert.equal(res.data.disposition, "WAIVER_RECORDED_PENDING_BILLING");
    assert.equal(res.data.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(await claimOf(uid), familyId);
    await expectDomainError(w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }), "OWNER_ALREADY_HAS_FAMILY");
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "CLOSURE_CANCELLATION_IN_PROGRESS");

    assert.equal(await processCancellationCase({ db, clock: w.clock, provider: w.provider }, caseId), "DELETION_PENDING");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "DELETION_PENDING");
    assert.equal(await claimOf(uid), null);
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "RECOVERY_ALREADY_WAIVED");
  });

  test("pending-cancellation waiver + permanent provider failure: no release, no false success", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    await w.waive(verified(uid), await w.waiveReq(uid, familyId));
    w.provider.scriptCancellation(familyId, "PERMANENT_FAILURE");
    assert.equal(await processCancellationCase({ db, clock: w.clock, provider: w.provider }, caseId), "MANUAL_REVIEW");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");
    assert.equal(await claimOf(uid), familyId);
    assert.equal((await w.status(verified(uid), { apiVersion: "v0.4", familyId })).data.closureStatus, "MANUAL_BILLING_ACTION_REQUIRED");
  });

  test("CLOSING waiver with a reconciliation hold: waiver committed, claim retained, later released by the worker", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const caseId = await w.closed(uid, familyId);
    await w.billing(familyId, "PENDING", "late-purchase");
    const res = await w.waive(verified(uid), await w.waiveReq(uid, familyId));
    assert.equal(res.data.disposition, "WAIVER_RECORDED_RELEASE_PENDING");
    assert.equal(res.data.lifecycleState, "CLOSING");
    assert.equal(await claimOf(uid), familyId);
    assert.equal((await caseDoc(caseId))["releaseBlockedReason"], "RECONCILIATION_HOLD");
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "RECOVERY_ALREADY_WAIVED");

    const deps = { db, clock: w.clock, provider: w.provider };
    assert.equal(await processRecoveryDeadline(deps, familyId), "RELEASE_BLOCKED");
    await w.billing(familyId, "NONE", null);
    assert.equal(await processRecoveryDeadline(deps, familyId), "DELETION_PENDING");
    assert.equal(await claimOf(uid), null);
  });

  test("waiver negative controls: member, cross-family / expired / close-action token, stale epoch, reuse, ACTIVE", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const other = await w.trialFamily("o");
    await expectDomainError(w.waive(verified(uid), await w.waiveReq(uid, familyId)), "CLOSURE_NOT_ELIGIBLE_FOR_WAIVER");
    await w.closed(uid, familyId);
    await w.closed(other.uid, other.familyId);
    const before = await snapshotState(uid, familyId);
    const base = { apiVersion: "v0.4", familyId, familyEpoch: 1 };

    await expectDomainError(w.waive(verified(member), await w.waiveReq(member, familyId)), "OWNER_REQUIRED");
    const cross = await w.token(uid, other.familyId, "families.waiveRecovery");
    await expectDomainError(w.waive(verified(uid), { ...base, opId: newOpId(), confirmationToken: cross }), "CONFIRMATION_REQUIRED");
    const closeTok = await w.token(uid, familyId, "families.close");
    await expectDomainError(w.waive(verified(uid), { ...base, opId: newOpId(), confirmationToken: closeTok }), "CONFIRMATION_REQUIRED");
    await expectDomainError(w.waive(verified(uid), await w.waiveReq(uid, familyId, 2)), "STALE_EPOCH_REJECTED");
    const late = await w.token(uid, familyId, "families.waiveRecovery");
    w.clock.advance(CONFIRMATION_TOKEN_TTL_MS);
    await expectDomainError(w.waive(verified(uid), { ...base, opId: newOpId(), confirmationToken: late }), "CONFIRMATION_EXPIRED");
    assert.equal(await snapshotState(uid, familyId), before, "no state change");

    const req = await w.waiveReq(uid, familyId);
    const first = await w.waive(verified(uid), req);
    assert.deepEqual(await w.waive(verified(uid), { ...req }), first, "same opId replay is identical");
    await expectDomainError(w.waive(verified(uid), { ...req, confirmationToken: await w.token(uid, familyId, "families.waiveRecovery") }), "IDEMPOTENCY_KEY_REUSED");
    // A consumed token cannot be reused under a new opId.
    await expectDomainError(w.waive(verified(uid), { ...req, opId: newOpId() }), "RECOVERY_ALREADY_WAIVED");
  });

  test(`waiver vs restore race in CLOSING: exactly one wins, state consistent (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`wr${i}`);
      await w.closed(uid, familyId);
      const wreq = await w.waiveReq(uid, familyId);
      const [wr, rr] = await Promise.allSettled([w.waive(verified(uid), wreq), w.restore(verified(uid), w.restoreReq(familyId))]);
      assert.equal([wr, rr].filter((r) => r.status === "fulfilled").length, 1, `iteration ${i}`);
      const fam = await familyDoc(familyId);
      if (wr.status === "fulfilled") {
        assert.equal(fam["lifecycleState"], "DELETION_PENDING");
        assert.equal(fam["familyEpoch"], 1);
        assert.equal(await claimOf(uid), null);
      } else {
        assert.equal(fam["lifecycleState"], "ACTIVE");
        assert.equal(fam["familyEpoch"], 2);
        assert.equal(await claimOf(uid), familyId);
      }
    }
  });

  test(`release vs concurrent creates: never two nonterminal owned families (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`rc${i}`);
      await w.closed(uid, familyId);
      const wreq = await w.waiveReq(uid, familyId);
      const creates = Array.from({ length: 2 }, () => w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }));
      await Promise.allSettled([w.waive(verified(uid), wreq), ...creates]);
      const owned = await db.collection("families").where("ownerUid", "==", uid).get();
      const live = owned.docs.filter((d) => d.get("lifecycleState") !== "DELETION_PENDING");
      assert.ok(live.length <= 1, `iteration ${i}: ${live.length} nonterminal families`);
      const claim = await claimOf(uid);
      if (live.length === 1) assert.equal(claim, live[0]?.id);
      else assert.equal(claim, null);
    }
  });
});

describe("families.getClosureStatus (AC-S3-10; PL-PP-WP03-17, -20)", () => {
  test("owner-only sanitized projection across the lifecycle", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const req = { apiVersion: "v0.4", familyId };
    assert.deepEqual((await w.status(verified(uid), req)).data, { familyId, lifecycleState: "ACTIVE", closureStatus: "NOT_CLOSED", waiverRecorded: false });
    await w.closed(uid, familyId);
    const s = await w.status(verified(uid), req);
    assert.deepEqual(s.data, {
      familyId,
      lifecycleState: "CLOSING",
      closureStatus: "RECOVERY_AVAILABLE",
      waiverRecorded: false,
      recoverUntilAt: new Date(T0 + RECOVERY_WINDOW_MS).toISOString(),
    });
    assert.equal(s.opId, null);
    await expectDomainError(w.status(verified(member), req), "OWNER_REQUIRED");
    await expectDomainError(w.status(verified(uid), { apiVersion: "v0.4", familyId: "nope00000000000000000" }), "NOT_FOUND");
    await expectDomainError(w.status({ uid, emailVerified: false }, req), "EMAIL_VERIFICATION_REQUIRED");
    const text = JSON.stringify(s);
    for (const secret of ["caseId", "closureCaseId", "purchaseRef", "attempts", "provider", member]) {
      assert.ok(!text.includes(secret), `projection must not include ${secret}`);
    }
  });
});
