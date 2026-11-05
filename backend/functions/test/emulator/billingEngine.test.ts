/**
 * D2: Slice 3B Stage B1 billing engine against the Firestore emulator, using the Play-semantics
 * adapter over the deterministic fake Play API (never real Play; PL-3B-02). Covers the paid-closure
 * saga with acknowledgement vs verified finality, outages and restarts, RTDN processing as a hint,
 * internal purchase binding and late settlement, concurrency against D42-D47 invariants, and
 * redaction. ProofPoints: PL-PP-WP03-33 (isolation), -34 (saga), -35 (RTDN), -36 (binding).
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { B1_SYNTHETIC_BILLING_CONFIG } from "../../src/billing/config.js";
import { FakePlayApi } from "../../src/billing/fakePlayApi.js";
import type { FakeSubscriptionSeed } from "../../src/billing/fakePlayApi.js";
import { obfuscatedAccountIdFor, obfuscatedProfileIdFor, purchaseTokenRef } from "../../src/billing/play.js";
import { PlayBillingProvider } from "../../src/billing/playProvider.js";
import { syntheticRtdnEnvelope } from "../../src/billing/rtdn.js";
import { familiesCloseHandler } from "../../src/commands/familiesClose.js";
import { familiesRestoreHandler } from "../../src/commands/familiesRestore.js";
import { familiesWaiveRecoveryHandler } from "../../src/commands/familiesWaiveRecovery.js";
import { RECOVERY_WINDOW_MS, RESERVATION_TTL_MS } from "../../src/domain/family.js";
import { retryDelayMs } from "../../src/domain/lifecycle.js";
import { firestoreBindingLookup } from "../../src/persistence/billingStore.js";
import { processRtdnDelivery, recordVerifiedPurchase, RTDN_PROCESSING_LEASE_MS } from "../../src/workers/billingWorkers.js";
import { processCancellationCase, processRecoveryDeadline } from "../../src/workers/lifecycleWorkers.js";
import { reconcileReservation } from "../../src/workers/reservationWorker.js";
import { clearFirestore, db, expectDomainError, newOpId } from "../support/emulator.js";
import { World, caseDoc, claimOf, familyDoc, ms, snapshotState, verified } from "../support/lifecycle.js";

before(clearFirestore);

const CONFIG = B1_SYNTHETIC_BILLING_CONFIG;
const PKG = CONFIG.packageName;
const PRODUCT = CONFIG.productIds[0] as string;
const DAY = 86_400_000;
let tokenSeq = 0;

/** A lifecycle World whose billing provider is the Play adapter over a fresh fake Play API. */
class B1 {
  readonly w = new World();
  readonly api = new FakePlayApi();
  readonly play = new PlayBillingProvider(this.api, CONFIG, firestoreBindingLookup(db), this.w.clock);
  readonly deps = { db, clock: this.w.clock, provider: this.play, config: CONFIG };
  readonly bindDeps = { db, clock: this.w.clock, play: this.play };
  readonly close = familiesCloseHandler({ db, clock: this.w.clock, provider: this.play });
  readonly restore = familiesRestoreHandler({ db, clock: this.w.clock, provider: this.play });
  readonly waive = familiesWaiveRecoveryHandler({ db, clock: this.w.clock, provider: this.play });

  newToken(): string {
    tokenSeq += 1;
    return `synthetic-${process.pid}-${Date.now().toString(36)}-${tokenSeq.toString().padStart(6, "0")}`;
  }

  subscribe(uid: string, familyId: string, over: Partial<FakeSubscriptionSeed> = {}): string {
    const token = over.purchaseToken ?? this.newToken();
    this.api.seed({
      packageName: PKG,
      purchaseToken: token,
      productId: PRODUCT,
      ownerUid: uid,
      familyId,
      expiryMillis: this.w.clock.nowMillis() + 30 * DAY,
      ...over,
    });
    return token;
  }

  /** ACTIVE trial family with a provider-verified, bound subscription. */
  async paidFamily(over: Partial<FakeSubscriptionSeed> = {}): Promise<{ uid: string; familyId: string; token: string }> {
    const { uid, familyId } = await this.w.trialFamily("b1");
    const token = this.subscribe(uid, familyId, over);
    const r = await recordVerifiedPurchase(this.bindDeps, { ownerUid: uid, familyId, purchaseToken: token, productId: PRODUCT });
    assert.equal(r.kind, "WRITTEN");
    return { uid, familyId, token };
  }

  /** Bind directly (fixture) for plans the binding step itself refuses (installment). */
  async seedBinding(uid: string, familyId: string, token: string): Promise<void> {
    const ref = purchaseTokenRef(token);
    await db.doc(`purchaseBindings/${ref}`).set({
      purchaseToken: token,
      packageName: PKG,
      productId: PRODUCT,
      ownerUid: uid,
      familyId,
      obfuscatedAccountId: obfuscatedAccountIdFor(uid),
      obfuscatedProfileId: obfuscatedProfileIdFor(familyId),
      status: "BOUND",
    });
    await db.doc(`familyBilling/${familyId}`).set({ purchaseState: "ACTIVE", purchaseRef: ref });
  }

  async closePaid(uid: string, familyId: string): Promise<string> {
    const res = await this.close(verified(uid), await this.w.closeReq(uid, familyId));
    return res.data.closureCaseId;
  }

  rtdn(messageId: string, token: string | null, notificationType = 3, eventTimeMillis = this.w.clock.nowMillis()) {
    return syntheticRtdnEnvelope({
      messageId,
      packageName: PKG,
      eventTimeMillis,
      notification:
        token === null
          ? { testNotification: { version: "1.0" } }
          : { subscriptionNotification: { version: "1.0", notificationType, purchaseToken: token } },
    });
  }

  async reservation(): Promise<{ uid: string; familyId: string }> {
    const t = await this.w.trialFamily("res");
    await this.w.closed(t.uid, t.familyId);
    await this.w.waive(verified(t.uid), await this.w.waiveReq(t.uid, t.familyId));
    const r = await this.w.create(verified(t.uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    assert.equal(r.data.lifecycleState, "UNENTITLED_AWAITING_PAYMENT");
    return { uid: t.uid, familyId: r.data.familyId };
  }
}

const nonterminalOwned = async (uid: string): Promise<number> =>
  (await db.collection("families").where("ownerUid", "==", uid).get()).docs.filter((d) => d.get("lifecycleState") !== "DELETION_PENDING")
    .length;

// ---------------------------------------------------------------------------------------------

describe("paid-closure saga with authoritative verification (PL-PP-WP03-34)", () => {
  test("close freezes access, cancel + refresh verifies, CLOSING starts the 30-day clock; entitlement is not ended by it", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const member = await b.w.member(familyId);
    const res = await b.close(verified(uid), await b.w.closeReq(uid, familyId));
    assert.equal(res.data.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(res.data.cancellationStatus, "PENDING");
    assert.equal(res.data.recoverUntilAt, undefined);
    const session = await b.w.session(verified(member), { apiVersion: "v0.4" });
    assert.equal(session.data.joinedFamilies.find((f) => f.familyId === familyId)?.accessMode, "NONE", "access frozen at commit");

    const caseId = res.data.closureCaseId;
    assert.equal((await caseDoc(caseId))["liabilitySource"], "FAKE_PLAY_API");
    assert.equal(await processCancellationCase(b.deps, caseId), "CLOSING");
    const c = await caseDoc(caseId);
    assert.equal(c["cancellationStatus"], "VERIFIED");
    assert.equal(ms(c["recoverUntilAt"]), b.w.clock.nowMillis() + RECOVERY_WINDOW_MS);
    assert.equal(await claimOf(uid), familyId, "verified cancellation does not release ownership");
    assert.equal(b.api.cancelEffects(PKG, token), 1);
    const snap = await b.api.get({ packageName: PKG, purchaseToken: token });
    assert.equal(snap.subscriptionState, "SUBSCRIPTION_STATE_CANCELED");
    assert.ok(Date.parse(snap.lineItems[0]?.expiryTime ?? "") > b.w.clock.nowMillis(), "Play entitlement continues to expiry: no refund, no expiry");
  });

  test("acknowledged but not yet verified: no CLOSING, no clock, until a later authoritative refresh", async () => {
    const b = new B1();
    const { uid, familyId } = await b.paidFamily({ settleAfterGets: 1 });
    const caseId = await b.closePaid(uid, familyId);
    assert.equal(await processCancellationCase(b.deps, caseId), "RETRY_SCHEDULED");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");
    assert.equal((await caseDoc(caseId))["recoverUntilAt"], null);
    await expectDomainError(b.restore(verified(uid), b.w.restoreReq(familyId)), "CLOSURE_CANCELLATION_IN_PROGRESS");
    b.w.clock.advance(retryDelayMs(1));
    assert.equal(await processCancellationCase(b.deps, caseId), "CLOSING");
  });

  test("cancel times out after taking effect: no premature CLOSING, clock or release; restart verifies once", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    b.api.script("cancel", token, "TIMEOUT_AFTER_EFFECT", "OK");
    assert.equal(await processCancellationCase(b.deps, caseId), "RETRY_SCHEDULED");
    assert.equal((await caseDoc(caseId))["recoverUntilAt"], null);
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");
    assert.equal(await claimOf(uid), familyId);
    b.w.clock.advance(retryDelayMs(1));
    assert.equal(await processCancellationCase(b.deps, caseId), "CLOSING");
    assert.equal(b.api.cancelEffects(PKG, token), 1);
  });

  test("worker restart between the provider call and the commit: no second provider effect", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    // The "crashed" attempt: the provider effect happened, its commit never ran.
    await b.play.requestCancellation({ caseId, familyId, purchaseRef: purchaseTokenRef(token) });
    assert.equal((await caseDoc(caseId))["cancellationStatus"], "PENDING");
    assert.equal(await processCancellationCase(b.deps, caseId), "CLOSING");
    assert.equal(b.api.cancelEffects(PKG, token), 1);
    assert.equal(b.api.calls.filter((c) => c.op === "cancel").length, 1, "restart saw the stop and did not cancel again");
  });

  test("429/5xx outages retry with bounded jitter and exhaust to MANUAL_REVIEW, never CLOSING", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    b.api.script("get", token, 429, 503, 500);
    const deps = { ...b.deps, random: () => 0.999 };
    let last = "";
    for (let i = 1; i <= 8; i++) {
      last = await processCancellationCase(deps, caseId);
      const c = await caseDoc(caseId);
      if (last === "RETRY_SCHEDULED") {
        const delay = ms(c["nextAttemptAt"]) - b.w.clock.nowMillis();
        assert.ok(delay <= retryDelayMs(i) && delay >= retryDelayMs(i) * 0.8, `attempt ${i}: ${delay}`);
      }
      b.w.clock.advance(retryDelayMs(i));
    }
    assert.equal(last, "MANUAL_REVIEW");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");
    assert.equal((await caseDoc(caseId))["recoverUntilAt"], null);
    assert.equal(b.api.cancelEffects(PKG, token), 0);
  });

  test("repeated concurrent execution of one cancel case: one transition, one effect", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    const results = await Promise.all(Array.from({ length: 5 }, () => processCancellationCase(b.deps, caseId)));
    assert.equal(results.filter((r) => r === "CLOSING").length, 1, JSON.stringify(results));
    assert.equal(b.api.cancelEffects(PKG, token), 1);
    assert.equal((await caseDoc(caseId))["cancellationStatus"], "VERIFIED");
  });

  test("installment (unsupported) plan: held in MANUAL_REVIEW with a reason; never cancelled, never CLOSING, never released", async () => {
    const b = new B1();
    const { uid, familyId } = await b.w.trialFamily("inst");
    const token = b.subscribe(uid, familyId, { plan: "INSTALLMENT" });
    await b.seedBinding(uid, familyId, token);
    const caseId = await b.closePaid(uid, familyId);
    assert.equal(await processCancellationCase(b.deps, caseId), "MANUAL_REVIEW");
    const c = await caseDoc(caseId);
    assert.equal(c["billingHoldReason"], "UNSUPPORTED_PLAN_TYPE");
    assert.equal(c["recoverUntilAt"], null);
    assert.equal(b.api.calls.filter((x) => x.op === "cancel").length, 0);
    await b.waive(verified(uid), await b.w.waiveReq(uid, familyId));
    b.w.clock.advance(RECOVERY_WINDOW_MS + DAY);
    assert.equal(await processRecoveryDeadline(b.deps, familyId), "NO_CHANGE");
    assert.equal(await claimOf(uid), familyId);
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");
  });

  test("trial with verified zero liability closes directly; unknown provider state at close holds", async () => {
    const b = new B1();
    const trial = await b.w.trialFamily("zero");
    const r = await b.close(verified(trial.uid), await b.w.closeReq(trial.uid, trial.familyId));
    assert.equal(r.data.lifecycleState, "CLOSING");
    assert.equal(r.data.cancellationStatus, "NOT_REQUIRED");
    assert.equal(b.api.calls.length, 0, "no provider call without a bound purchase");

    const { uid, familyId, token } = await b.paidFamily();
    b.api.script("get", token, 503);
    const held = await b.close(verified(uid), await b.w.closeReq(uid, familyId));
    assert.equal(held.data.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(held.data.cancellationStatus, "LIABILITY_UNRESOLVED");
    assert.equal(held.data.recoverUntilAt, undefined);
  });
});

describe("concurrency against D42-D47 invariants (PL-PP-WP03-34)", () => {
  test("cancel vs restore: restore rejected while pending; after CLOSING one restore, old case inert", async () => {
    const b = new B1();
    const { uid, familyId } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    const [k, r] = await Promise.allSettled([processCancellationCase(b.deps, caseId), b.restore(verified(uid), b.w.restoreReq(familyId))]);
    assert.equal(k.status === "fulfilled" && k.value, "CLOSING");
    if (r.status === "fulfilled") assert.equal(r.value.data.familyEpoch, 2, "restore only after verified CLOSING");
    const fam = await familyDoc(familyId);
    if (r.status === "rejected") {
      assert.equal(fam["lifecycleState"], "CLOSING");
      assert.equal((await b.restore(verified(uid), b.w.restoreReq(familyId))).data.familyEpoch, 2);
    }
    assert.equal((await familyDoc(familyId))["familyEpoch"], 2, "epoch advanced exactly once");
    assert.equal(await processCancellationCase(b.deps, caseId), "NO_CHANGE", "restored case has no further effect");
  });

  test("waiver vs cancel verification: exactly one release, after financial finality", async () => {
    for (let i = 0; i < 5; i++) {
      const b = new B1();
      const { uid, familyId, token } = await b.paidFamily();
      const caseId = await b.closePaid(uid, familyId);
      await Promise.allSettled([processCancellationCase(b.deps, caseId), b.waive(verified(uid), await b.w.waiveReq(uid, familyId))]);
      b.w.clock.advance(retryDelayMs(1));
      await processCancellationCase(b.deps, caseId);
      await processRecoveryDeadline(b.deps, familyId);
      const fam = await familyDoc(familyId);
      assert.equal(fam["lifecycleState"], "DELETION_PENDING", `iteration ${i}`);
      assert.equal(await claimOf(uid), null);
      assert.equal((await caseDoc(caseId))["cancellationStatus"], "VERIFIED", "released only with verified finality");
      assert.equal((await db.doc(`ownershipReleaseAudits/${caseId}`).get()).get("trigger"), "WAIVER");
      assert.equal(b.api.cancelEffects(PKG, token), 1);
    }
  });

  test("release vs create: never two nonterminal owned families (10 iterations)", async () => {
    for (let i = 0; i < 10; i++) {
      const b = new B1();
      const { uid, familyId } = await b.w.trialFamily("rel");
      await b.w.closed(uid, familyId);
      b.w.clock.advance(RECOVERY_WINDOW_MS);
      const [rel, cr] = await Promise.allSettled([
        processRecoveryDeadline(b.deps, familyId),
        b.w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }),
      ]);
      assert.equal(rel.status === "fulfilled" && rel.value, "DELETION_PENDING");
      assert.ok(await nonterminalOwned(uid) <= 1, `iteration ${i}`);
      if (cr.status === "fulfilled") {
        assert.equal(await claimOf(uid), cr.value.data.familyId);
      } else {
        assert.equal(await claimOf(uid), null);
        const again = await b.w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
        assert.equal(await claimOf(uid), again.data.familyId);
      }
      assert.equal(await nonterminalOwned(uid), 1);
    }
  });
});

describe("RTDN processing: hint only, deduplicated, order-independent (PL-PP-WP03-35)", () => {
  test("an RTDN never creates a binding or entitlement: unbound PURCHASED for a reservation has no effect", async () => {
    const b = new B1();
    const { uid, familyId } = await b.reservation();
    const token = b.subscribe(uid, familyId);
    const before = await snapshotState(uid, familyId);
    const d = await processRtdnDelivery(b.deps, b.rtdn("m-unbound-1", token, 4));
    assert.deepEqual(d, { kind: "UNBOUND_PURCHASE" });
    assert.equal(await snapshotState(uid, familyId), before);
    assert.equal((await db.doc(`purchaseBindings/${purchaseTokenRef(token)}`).get()).exists, false);
    assert.equal((await db.doc(`familyBilling/${familyId}`).get()).exists, false);
    assert.equal((await familyDoc(familyId))["lifecycleState"], "UNENTITLED_AWAITING_PAYMENT");
    assert.equal(b.api.calls.length, 0, "no provider call for an unbound token");
  });

  test("the payload is never trusted: 'CANCELED' while Play still renews has no effect; any type with Play stopped verifies", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    const d1 = await processRtdnDelivery(b.deps, b.rtdn("m-cancel-claim", token, 3));
    assert.deepEqual(d1, { kind: "INSPECTED", inspection: "WILL_RENEW", lifecycle: "NO_LIFECYCLE_EFFECT" });
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSURE_PENDING_BILLING");

    b.api.mutate(PKG, token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    const d2 = await processRtdnDelivery(b.deps, b.rtdn("m-renewed-stale", token, 2));
    assert.deepEqual(d2, { kind: "INSPECTED", inspection: "STOP_VERIFIED", lifecycle: "CLOSING" });
    assert.equal((await caseDoc(caseId))["cancellationStatus"], "VERIFIED");
    assert.equal(await claimOf(uid), familyId);
  });

  test("duplicate and reordered deliveries: one effect, no regression", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const caseId = await b.closePaid(uid, familyId);
    b.api.mutate(PKG, token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    const t = b.w.clock.nowMillis();
    const newer = b.rtdn("m-newer", token, 3, t);
    const older = b.rtdn("m-older", token, 2, t - 60_000);
    assert.equal(((await processRtdnDelivery(b.deps, newer)) as { lifecycle: string }).lifecycle, "CLOSING");
    assert.deepEqual(await processRtdnDelivery(b.deps, newer), { kind: "DUPLICATE" });
    const late = await processRtdnDelivery(b.deps, older);
    assert.deepEqual(late, { kind: "INSPECTED", inspection: "STOP_VERIFIED", lifecycle: "NO_LIFECYCLE_EFFECT" });
    const c = await caseDoc(caseId);
    assert.equal(c["cancellationStatus"], "VERIFIED");
    assert.equal(c["revision"], 2, "one transition only");
  });

  test("concurrent duplicate deliveries of one message: processed once", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    await b.closePaid(uid, familyId);
    b.api.mutate(PKG, token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    const env = b.rtdn("m-concurrent", token, 3);
    const results = await Promise.all(Array.from({ length: 5 }, () => processRtdnDelivery(b.deps, env)));
    const inspected = results.filter((r) => r.kind === "INSPECTED");
    assert.equal(inspected.length, 1, JSON.stringify(results));
    assert.ok(results.every((r) => ["INSPECTED", "DUPLICATE", "DUPLICATE_IN_PROGRESS"].includes(r.kind)));
    assert.equal((await familyDoc(familyId))["lifecycleState"], "CLOSING");
  });

  test("a delivery left in progress by a crash is reprocessed after its lease, idempotently", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    await b.closePaid(uid, familyId);
    b.api.mutate(PKG, token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    const env = b.rtdn("m-crash", token, 3);
    // Simulate the crashed attempt's claim.
    const { deliveryRefFor } = await import("../../src/billing/rtdn.js");
    await db.doc(`rtdnDeliveries/${deliveryRefFor("m-crash")}`).set({
      status: "RECEIVED",
      leaseUntil: Timestamp.fromMillis(b.w.clock.nowMillis() + RTDN_PROCESSING_LEASE_MS),
      attempts: 1,
    });
    assert.deepEqual(await processRtdnDelivery(b.deps, env), { kind: "DUPLICATE_IN_PROGRESS" });
    b.w.clock.advance(RTDN_PROCESSING_LEASE_MS);
    assert.equal(((await processRtdnDelivery(b.deps, env)) as { lifecycle: string }).lifecycle, "CLOSING");
    const rec = (await db.doc(`rtdnDeliveries/${deliveryRefFor("m-crash")}`).get()).data();
    assert.equal(rec?.["status"], "COMPLETED");
    assert.equal(rec?.["attempts"], 2);
  });

  test("malformed, oversized or foreign-package payloads fail closed and write nothing", async () => {
    const b = new B1();
    const before = (await db.collection("rtdnDeliveries").get()).size;
    const bad = [
      null,
      { message: { data: "!!!!", messageId: "x1" } },
      { message: { data: "A".repeat(9_000), messageId: "x2" } },
      syntheticRtdnEnvelope({ messageId: "x3", packageName: "com.attacker", eventTimeMillis: 1, notification: { testNotification: {} } }),
    ];
    for (const e of bad) assert.equal((await processRtdnDelivery(b.deps, e)).kind, "REJECTED_MALFORMED");
    assert.equal((await db.collection("rtdnDeliveries").get()).size, before);
  });

  test("a liability hold is re-checked through the provider; test notifications are inert", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    b.api.script("get", token, 503, "OK");
    const caseId = (await b.close(verified(uid), await b.w.closeReq(uid, familyId))).data.closureCaseId;
    assert.equal((await caseDoc(caseId))["cancellationStatus"], "LIABILITY_UNRESOLVED");
    const d = await processRtdnDelivery(b.deps, b.rtdn("m-hold", token, 2));
    assert.equal(d.kind === "INSPECTED" && d.lifecycle, "CANCELLATION_REQUIRED");
    assert.equal((await caseDoc(caseId))["cancellationStatus"], "PENDING");
    assert.deepEqual(await processRtdnDelivery(b.deps, b.rtdn("m-test", null)), { kind: "TEST_NOTIFICATION" });
  });
});

describe("internal purchase binding and reservation reconciliation (PL-PP-WP03-36)", () => {
  test("binding records the token once and grants nothing: family state, trial and access unchanged", async () => {
    const b = new B1();
    const { uid, familyId } = await b.w.trialFamily("bind");
    const before = (await familyDoc(familyId))["trialEndsAt"];
    const token = b.subscribe(uid, familyId);
    const r = await recordVerifiedPurchase(b.bindDeps, { ownerUid: uid, familyId, purchaseToken: token, productId: PRODUCT });
    assert.deepEqual(r, { kind: "WRITTEN", status: "BOUND", purchaseRef: purchaseTokenRef(token) });
    const fam = await familyDoc(familyId);
    assert.equal(fam["lifecycleState"], "ACTIVE");
    assert.deepEqual(fam["trialEndsAt"], before, "no paid entitlement written");
    const binding = (await db.doc(`purchaseBindings/${purchaseTokenRef(token)}`).get()).data();
    assert.equal(binding?.["acknowledgementRequired"], true, "acknowledgement flagged for B2, never performed");
    assert.deepEqual(await recordVerifiedPurchase(b.bindDeps, { ownerUid: uid, familyId, purchaseToken: token, productId: PRODUCT }), {
      kind: "ALREADY_BOUND_THIS_FAMILY",
      purchaseRef: purchaseTokenRef(token),
    });
  });

  test("cross-UID, cross-family, wrong product/package, foreign and missing tokens are rejected without mutation", async () => {
    const b = new B1();
    const a = await b.w.trialFamily("own-a");
    const c = await b.w.trialFamily("own-c");
    const member = await b.w.member(a.familyId);
    const tokenA = b.subscribe(a.uid, a.familyId);
    const tokenOtherPkg = b.subscribe(a.uid, a.familyId, { packageName: "com.example.other" });
    const tokenWrongProduct = b.subscribe(a.uid, a.familyId, { productId: "synthetic.other.product" });
    const stateA = await snapshotState(a.uid, a.familyId);
    const stateC = await snapshotState(c.uid, c.familyId);
    const attempts: Array<[Record<string, unknown>, string]> = [
      [{ ownerUid: member, familyId: a.familyId, purchaseToken: tokenA }, "NOT_OWNER"],
      [{ ownerUid: c.uid, familyId: c.familyId, purchaseToken: tokenA }, "WRONG_ACCOUNT"],
      [{ ownerUid: a.uid, familyId: a.familyId, purchaseToken: tokenOtherPkg }, "NOT_FOUND"],
      [{ ownerUid: a.uid, familyId: a.familyId, purchaseToken: tokenWrongProduct }, "WRONG_PRODUCT"],
      [{ ownerUid: a.uid, familyId: a.familyId, purchaseToken: tokenA, productId: "not.configured" }, "WRONG_PRODUCT"],
      [{ ownerUid: a.uid, familyId: a.familyId, purchaseToken: undefined }, "INVALID_TOKEN"],
      [{ ownerUid: a.uid, familyId: a.familyId, purchaseToken: "" }, "INVALID_TOKEN"],
      [{ ownerUid: a.uid, familyId: "noSuchFamily000000000", purchaseToken: tokenA }, "FAMILY_NOT_FOUND"],
    ];
    for (const [over, reason] of attempts) {
      const r = await recordVerifiedPurchase(b.bindDeps, { productId: PRODUCT, ...over } as never);
      assert.deepEqual(r, { kind: "REJECTED", reason }, JSON.stringify({ reason }));
    }
    assert.equal(await snapshotState(a.uid, a.familyId), stateA);
    assert.equal(await snapshotState(c.uid, c.familyId), stateC);
    assert.equal((await db.doc(`familyBilling/${a.familyId}`).get()).exists, false);
    assert.equal((await db.doc(`purchaseBindings/${purchaseTokenRef(tokenA)}`).get()).exists, false);
  });

  test("an already-bound token cannot attach to another family; a closed family cannot bind", async () => {
    const b = new B1();
    const { uid, familyId, token } = await b.paidFamily();
    const other = await b.w.trialFamily("other");
    assert.deepEqual(await recordVerifiedPurchase(b.bindDeps, { ownerUid: other.uid, familyId: other.familyId, purchaseToken: token, productId: PRODUCT }), {
      kind: "REJECTED",
      reason: "ALREADY_BOUND_ELSEWHERE",
    });
    const closedFam = await b.w.trialFamily("closed");
    await b.w.closed(closedFam.uid, closedFam.familyId);
    const t2 = b.subscribe(closedFam.uid, closedFam.familyId);
    assert.deepEqual(await recordVerifiedPurchase(b.bindDeps, { ownerUid: closedFam.uid, familyId: closedFam.familyId, purchaseToken: t2, productId: PRODUCT }), {
      kind: "REJECTED",
      reason: "FAMILY_CLOSED",
    });
    assert.equal((await db.doc(`purchaseBindings/${purchaseTokenRef(token)}`).get()).get("familyId"), familyId);
    assert.ok(uid);
  });

  test("concurrent binding of one token: exactly one write", async () => {
    const b = new B1();
    const { uid, familyId } = await b.w.trialFamily("race");
    const token = b.subscribe(uid, familyId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => recordVerifiedPurchase(b.bindDeps, { ownerUid: uid, familyId, purchaseToken: token, productId: PRODUCT })),
    );
    assert.equal(results.filter((r) => r.kind === "WRITTEN").length, 1, JSON.stringify(results));
    assert.ok(results.every((r) => r.kind === "WRITTEN" || r.kind === "ALREADY_BOUND_THIS_FAMILY"));
  });

  test("hour-26 late settlement is held for reconciliation: no activation, no second family claim", async () => {
    const b = new B1();
    const { uid, familyId } = await b.reservation();
    const token = b.subscribe(uid, familyId);
    b.w.clock.advance(RESERVATION_TTL_MS + 2 * 3_600_000);
    const r = await recordVerifiedPurchase(b.bindDeps, { ownerUid: uid, familyId, purchaseToken: token, productId: PRODUCT });
    assert.deepEqual(r, { kind: "WRITTEN", status: "HELD_LATE_SETTLEMENT", purchaseRef: purchaseTokenRef(token) });
    assert.equal((await db.doc(`familyBilling/${familyId}`).get()).get("purchaseState"), "PENDING");
    // D46: the verified late payment is reconciled to the ORIGINAL reservation only (3A disposition);
    // activation stays with the unratified billing.verifyPurchase contract.
    assert.equal(await reconcileReservation(b.deps, familyId), "PAYMENT_VERIFIED_ORIGINAL_RESERVATION");
    assert.equal((await db.doc(`reservationCases/${familyId}`).get()).get("originalPurchaseRef"), purchaseTokenRef(token));
    assert.equal((await familyDoc(familyId))["lifecycleState"], "UNENTITLED_AWAITING_PAYMENT");
    assert.equal(await claimOf(uid), familyId);
    await expectDomainError(b.w.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} }), "OWNER_ALREADY_HAS_FAMILY");
    assert.equal(await nonterminalOwned(uid), 1);
  });

  test("a pending purchase is held, never entitlement", async () => {
    const b = new B1();
    const { uid, familyId } = await b.reservation();
    const token = b.subscribe(uid, familyId, { state: "SUBSCRIPTION_STATE_PENDING" });
    const r = await recordVerifiedPurchase(b.bindDeps, { ownerUid: uid, familyId, purchaseToken: token, productId: PRODUCT });
    assert.equal(r.kind === "WRITTEN" && r.status, "PENDING_PAYMENT");
    assert.equal((await familyDoc(familyId))["lifecycleState"], "UNENTITLED_AWAITING_PAYMENT");
  });
});

describe("redaction: no raw purchase token outside the binding record (PL-PP-WP03-33)", () => {
  test("logs, RTDN records, cases and billing records never contain the token", async () => {
    const captured: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    const tap = (chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    };
    process.stdout.write = tap as typeof process.stdout.write;
    process.stderr.write = tap as typeof process.stderr.write;
    let token = "";
    let familyId = "";
    let caseId = "";
    try {
      const b = new B1();
      const p = await b.paidFamily();
      token = p.token;
      familyId = p.familyId;
      caseId = await b.closePaid(p.uid, p.familyId);
      b.api.script("cancel", token, 503, "OK");
      await processCancellationCase(b.deps, caseId);
      await processRtdnDelivery(b.deps, b.rtdn("m-redact", token, 3));
      await processRtdnDelivery(b.deps, { message: { data: Buffer.from(JSON.stringify({ leak: token })).toString("base64"), messageId: "m-bad" } });
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }
    assert.equal(captured.join("").includes(token), false, "no token in process output");
    const docs = [
      (await db.doc(`closureCases/${caseId}`).get()).data(),
      (await db.doc(`familyBilling/${familyId}`).get()).data(),
      ...(await db.collection("rtdnDeliveries").get()).docs.map((d) => d.data()),
      ...(await db.collection("idempotency").get()).docs.map((d) => d.data()),
      ...(await db.collection("ownershipReleaseAudits").get()).docs.map((d) => d.data()),
    ];
    assert.equal(JSON.stringify(docs).includes(token), false, "token stored only in purchaseBindings");
    assert.equal((await db.doc(`purchaseBindings/${purchaseTokenRef(token)}`).get()).get("purchaseToken"), token);
  });
});
