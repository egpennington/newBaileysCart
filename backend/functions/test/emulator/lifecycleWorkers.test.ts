/**
 * D2: lifecycle workers against the Firestore emulator with scripted fake-provider scenarios:
 * success, outage, timeout, permanent failure, duplicate and reordered completion, recovery deadline
 * and reservation reconciliation (Substage 3A; emulator-only, not scheduled, no real provider).
 * ProofPoints: PL-PP-WP03-18, -20, -24 (partial), -26, -28, -30.
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { RECOVERY_WINDOW_MS, RESERVATION_TTL_MS } from "../../src/domain/family.js";
import { MAX_PROVIDER_ATTEMPTS, retryDelayMs } from "../../src/domain/lifecycle.js";
import { applyProviderEvent, processCancellationCase, processRecoveryDeadline, recheckLiability } from "../../src/workers/lifecycleWorkers.js";
import { reconcileReservation } from "../../src/workers/reservationWorker.js";
import { clearFirestore, db, expectDomainError, newOpId, uniqueUid } from "../support/emulator.js";
import { T0, World, caseDoc, claimOf, familyDoc, ms, verified } from "../support/lifecycle.js";

before(clearFirestore);

const depsOf = (w: World) => ({ db, clock: w.clock, provider: w.provider });

describe("cancellation saga (PL-PP-WP03-18)", () => {
  test("outage then success: no clock while pending; clock starts at verified completion", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    w.provider.scriptCancellation(familyId, "OUTAGE", "VERIFIED");

    assert.equal(await processCancellationCase(depsOf(w), caseId), "RETRY_SCHEDULED");
    let c = await caseDoc(caseId);
    assert.equal(c["attempts"], 1);
    assert.equal(c["recoverUntilAt"], null);
    assert.equal(ms(c["nextAttemptAt"]), T0 + retryDelayMs(1));
    assert.equal(await processCancellationCase(depsOf(w), caseId), "NOT_DUE");

    w.clock.advance(retryDelayMs(1));
    assert.equal(await processCancellationCase(depsOf(w), caseId), "CLOSING");
    c = await caseDoc(caseId);
    assert.equal(c["cancellationStatus"], "VERIFIED");
    assert.equal(ms(c["closureConfirmedAt"]), T0 + retryDelayMs(1));
    assert.equal(ms(c["recoverUntilAt"]), T0 + retryDelayMs(1) + RECOVERY_WINDOW_MS);
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSING");
    assert.equal(await claimOf(uid), familyId, "verified cancellation does not release ownership");
    assert.equal((await w.restore(verified(uid), w.restoreReq(familyId))).data.familyEpoch, 2);
  });

  test("timeout after possible completion: retried, provider effect at most once", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    w.provider.scriptCancellation(familyId, "TIMEOUT", "VERIFIED");
    assert.equal(await processCancellationCase(depsOf(w), caseId), "RETRY_SCHEDULED");
    assert.equal((await caseDoc(caseId))["recoverUntilAt"], null);
    w.clock.advance(retryDelayMs(1));
    assert.equal(await processCancellationCase(depsOf(w), caseId), "CLOSING");
    assert.equal(w.provider.effects.get(caseId), 1);
  });

  test("retries exhaust to MANUAL_REVIEW, never CLOSING", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    w.provider.scriptCancellation(familyId, "RETRYABLE_FAILURE");
    let last = "";
    for (let i = 0; i < MAX_PROVIDER_ATTEMPTS; i++) {
      last = await processCancellationCase(depsOf(w), caseId);
      w.clock.advance(retryDelayMs(i + 1));
    }
    assert.equal(last, "MANUAL_REVIEW");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");
    assert.equal((await caseDoc(caseId))["recoverUntilAt"], null);
  });

  test("duplicate completion events and a racing worker: one transition, one clock", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    w.clock.advance(5000);
    const verifiedEvent = w.provider.event("VERIFIED");
    const results = await Promise.all([
      applyProviderEvent(depsOf(w), caseId, verifiedEvent),
      applyProviderEvent(depsOf(w), caseId, verifiedEvent),
      processCancellationCase(depsOf(w), caseId),
    ]);
    assert.equal(results.filter((r) => r === "CLOSING").length, 1, JSON.stringify(results));
    const deadline = ms((await caseDoc(caseId))["recoverUntilAt"]);
    w.clock.advance(60_000);
    assert.equal(await applyProviderEvent(depsOf(w), caseId, verifiedEvent), "NO_CHANGE");
    assert.equal(ms((await caseDoc(caseId))["recoverUntilAt"]), deadline, "duplicates never move the deadline");
  });

  test("reordered events: a late PENDING after VERIFIED does not regress; a stale failure is ignored", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    const pending = w.provider.event("PENDING");
    const failure = w.provider.event("PERMANENT_FAILURE");
    const done = w.provider.event("VERIFIED");
    assert.equal(await applyProviderEvent(depsOf(w), caseId, failure), "MANUAL_REVIEW");
    assert.equal(await applyProviderEvent(depsOf(w), caseId, pending), "NO_CHANGE", "older than the applied failure");
    assert.equal(await applyProviderEvent(depsOf(w), caseId, done), "CLOSING");
    assert.equal(await applyProviderEvent(depsOf(w), caseId, pending), "NO_CHANGE");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSING");
  });

  test("events for a restored (stale) case have no effect", async () => {
    const w = new World();
    const { uid, familyId } = await w.paidFamily();
    const caseId = await w.closed(uid, familyId);
    await applyProviderEvent(depsOf(w), caseId, w.provider.event("VERIFIED"));
    await w.restore(verified(uid), w.restoreReq(familyId));
    assert.equal(await applyProviderEvent(depsOf(w), caseId, w.provider.event("VERIFIED")), "NO_CHANGE");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "ACTIVE");
  });

  test("liability hold re-check: zero liability later -> CLOSING with the clock starting at the re-check", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    w.provider.scriptLiability(familyId, "OUTAGE", "NONE");
    const caseId = await w.closed(uid, familyId);
    assert.equal((await caseDoc(caseId))["cancellationStatus"], "LIABILITY_UNRESOLVED");
    w.clock.advance(7_200_000);
    assert.equal(await recheckLiability(depsOf(w), caseId), "CLOSING");
    assert.equal(ms((await caseDoc(caseId))["recoverUntilAt"]), T0 + 7_200_000 + RECOVERY_WINDOW_MS);
  });
});

describe("recovery deadline and DELETION_PENDING (PL-PP-WP03-20, -30)", () => {
  test("before the deadline: NOT_DUE; at the deadline: DELETION_PENDING, claim released, not purged", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const caseId = await w.closed(uid, familyId);
    w.clock.advance(RECOVERY_WINDOW_MS - 1);
    assert.equal(await processRecoveryDeadline(depsOf(w), familyId), "NOT_DUE");
    assert.equal(await claimOf(uid), familyId);
    w.clock.advance(1);
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "CLOSURE_RECOVERY_EXPIRED");
    assert.equal(await processRecoveryDeadline(depsOf(w), familyId), "DELETION_PENDING");
    assert.equal(await claimOf(uid), null);
    assert.equal((await db.doc(`ownershipReleaseAudits/${caseId}`).get()).get("trigger"), "DEADLINE");
    assert.ok((await db.doc(`trialLedger/${uid}`).get()).exists, "trial ledger preserved");
    assert.ok((await db.doc(`families/${familyId}`).get()).exists, "family data not purged");
    await expectDomainError(w.restore(verified(uid), w.restoreReq(familyId)), "CLOSURE_RECOVERY_EXPIRED");
    assert.equal((await w.status(verified(uid), { apiVersion: "v0.4", familyId })).data.closureStatus, "DELETION_PENDING");
    assert.equal(await processRecoveryDeadline(depsOf(w), familyId), "NO_CHANGE", "idempotent");
  });

  test("deadline passed but a purchase hold exists: RELEASE_BLOCKED, claim retained, create still denied", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const caseId = await w.closed(uid, familyId);
    await w.billing(familyId, "PENDING", "settling");
    w.clock.advance(RECOVERY_WINDOW_MS);
    assert.equal(await processRecoveryDeadline(depsOf(w), familyId), "RELEASE_BLOCKED");
    assert.equal((await caseDoc(caseId))["releaseBlockedReason"], "RECONCILIATION_HOLD");
    assert.equal(await claimOf(uid), familyId);
    await expectDomainError(w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }), "OWNER_ALREADY_HAS_FAMILY");
  });

  test("owner claim pointing elsewhere (anomaly): RELEASE_BLOCKED CLAIM_MISMATCH, nothing cleared", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const caseId = await w.closed(uid, familyId);
    await db.doc(`users/${uid}`).update({ ownedFamilyId: "someOtherFamily00000" });
    w.clock.advance(RECOVERY_WINDOW_MS);
    assert.equal(await processRecoveryDeadline(depsOf(w), familyId), "RELEASE_BLOCKED");
    assert.equal((await caseDoc(caseId))["releaseBlockedReason"], "CLAIM_MISMATCH");
    assert.equal(await claimOf(uid), "someOtherFamily00000");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSING");
  });

  test("restore and deadline worker racing at the boundary: worker wins, restore expired", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    await w.closed(uid, familyId);
    w.clock.advance(RECOVERY_WINDOW_MS);
    const [r, k] = await Promise.allSettled([w.restore(verified(uid), w.restoreReq(familyId)), processRecoveryDeadline(depsOf(w), familyId)]);
    assert.equal(r.status, "rejected");
    assert.equal(k.status === "fulfilled" && k.value, "DELETION_PENDING");
  });
});

describe("reservation reconciliation (D46; PL-PP-WP03-24 partial, -26)", () => {
  async function reservation(w: World): Promise<{ uid: string; familyId: string }> {
    const t = await w.trialFamily("res");
    // Lawful release of the trial family, then the reservation (trial already consumed).
    await w.closed(t.uid, t.familyId);
    await w.waive(verified(t.uid), await w.waiveReq(t.uid, t.familyId));
    const r = await w.create(verified(t.uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    assert.equal(r.data.lifecycleState, "UNENTITLED_AWAITING_PAYMENT");
    return { uid: t.uid, familyId: r.data.familyId };
  }

  test("hour 24 purchase pending -> hold; hour 26 settles for the original reservation; claim never released", async () => {
    const w = new World();
    const { uid, familyId } = await reservation(w);
    await w.billing(familyId, "PENDING", "p-orig");
    w.clock.advance(RESERVATION_TTL_MS - 1);
    assert.equal(await reconcileReservation(depsOf(w), familyId), null, "live reservation untouched");
    w.clock.advance(1);
    assert.equal(await reconcileReservation(depsOf(w), familyId), "RESERVATION_RECONCILIATION_PENDING");
    const held = (await db.doc(`reservationCases/${familyId}`).get()).data();
    assert.equal(held?.["originalPurchaseRef"], "p-orig");
    assert.equal(await claimOf(uid), familyId);
    await expectDomainError(w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }), "OWNER_ALREADY_HAS_FAMILY");

    w.clock.advance(2 * 3_600_000);
    w.provider.scriptLiability(familyId, "ACTIVE_OBLIGATION");
    assert.equal(await reconcileReservation(depsOf(w), familyId), "PAYMENT_VERIFIED_ORIGINAL_RESERVATION");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "UNENTITLED_AWAITING_PAYMENT", "activation is billing.verifyPurchase scope, not 3A");
    assert.equal(await claimOf(uid), familyId);
  });

  test("a different purchase correlation after the hold -> REMEDIATION_REQUIRED, never rebound", async () => {
    const w = new World();
    const { familyId } = await reservation(w);
    await w.billing(familyId, "PENDING", "p-orig");
    w.clock.advance(RESERVATION_TTL_MS);
    await reconcileReservation(depsOf(w), familyId);
    await w.billing(familyId, "ACTIVE", "p-foreign");
    w.provider.scriptLiability(familyId, "ACTIVE_OBLIGATION");
    assert.equal(await reconcileReservation(depsOf(w), familyId), "REMEDIATION_REQUIRED");
    assert.equal((await db.doc(`reservationCases/${familyId}`).get()).get("originalPurchaseRef"), "p-orig");
  });

  test("expired with no purchase anywhere -> EXPIRED_NO_PURCHASE_FOUND; owner claim still held (no ratified release path)", async () => {
    const w = new World();
    const { uid, familyId } = await reservation(w);
    w.clock.advance(RESERVATION_TTL_MS);
    assert.equal(await reconcileReservation(depsOf(w), familyId), "EXPIRED_NO_PURCHASE_FOUND");
    assert.equal(await claimOf(uid), familyId);
    assert.ok((await db.doc(`families/${familyId}`).get()).get("reservationExpiresAt") instanceof Timestamp);
  });

  test("provider unavailable at expiry -> hold, never no-purchase", async () => {
    const w = new World();
    const { familyId } = await reservation(w);
    w.provider.scriptLiability(familyId, "OUTAGE");
    w.clock.advance(RESERVATION_TTL_MS);
    assert.equal(await reconcileReservation(depsOf(w), familyId), "RESERVATION_RECONCILIATION_PENDING");
    assert.ok(uniqueUid("x"));
  });
});
