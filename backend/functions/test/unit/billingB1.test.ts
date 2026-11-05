/**
 * D1: Slice 3B Stage B1 billing engine (pure and adapter-level, no emulator). Play-semantics
 * assessment, the Play adapter over the deterministic fake Play API, provider isolation, the RTDN
 * parser, binding decisions and bounded jitter. ProofPoints: PL-PP-WP03-33, -34, -35, -36.
 * Fake-provider results prove domain behavior only; they are never Google Play evidence.
 */
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, test } from "node:test";
import { decideBinding, isPlausiblePurchaseToken, precheckBinding } from "../../src/billing/binding.js";
import { B1_SYNTHETIC_BILLING_CONFIG } from "../../src/billing/config.js";
import { FakeBillingProvider } from "../../src/billing/fakeProvider.js";
import { FakePlayApi } from "../../src/billing/fakePlayApi.js";
import type { FakeSubscriptionSeed } from "../../src/billing/fakePlayApi.js";
import { assessSubscription, obfuscatedAccountIdFor, obfuscatedProfileIdFor, purchaseTokenRef } from "../../src/billing/play.js";
import type { PlaySubscriptionSnapshot } from "../../src/billing/play.js";
import {
  LiveProviderDisabledError,
  PlayApiHttpError,
  PlayApiTimeoutError,
  classifyPlayFailure,
  createLivePlayApi,
  disabledPlayApi,
} from "../../src/billing/playApi.js";
import { PlayBillingProvider } from "../../src/billing/playProvider.js";
import type { BoundPurchase } from "../../src/billing/playProvider.js";
import { checkLiabilitySafely, inspectPurchaseSafely, requestCancellationSafely, unavailableBillingProvider } from "../../src/billing/provider.js";
import { MAX_DECODED_DATA_BYTES, deliveryRefFor, parseRtdnEnvelope, syntheticRtdnEnvelope } from "../../src/billing/rtdn.js";
import { isEmulatorDemoRuntime, selectBillingProvider } from "../../src/billing/selectProvider.js";
import {
  MAX_JITTER_FRACTION,
  applyCancellationOutcome,
  jitteredRetryDelayMs,
  retryDelayMs,
} from "../../src/domain/lifecycle.js";
import type { ClosureCase } from "../../src/domain/lifecycle.js";

const PKG = B1_SYNTHETIC_BILLING_CONFIG.packageName;
const PRODUCT = B1_SYNTHETIC_BILLING_CONFIG.productIds[0] as string;
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const DAY = 86_400_000;
const clock = { nowMillis: () => NOW };

function world(over: Partial<FakeSubscriptionSeed> = {}) {
  const api = new FakePlayApi();
  const token = `tok-${Math.random().toString(36).slice(2)}-0123456789abcdef`;
  const seed: FakeSubscriptionSeed = {
    packageName: PKG,
    purchaseToken: token,
    productId: PRODUCT,
    ownerUid: "owner-1",
    familyId: "fam-1",
    expiryMillis: NOW + 20 * DAY,
    ...over,
  };
  api.seed(seed);
  const ref = purchaseTokenRef(token);
  const binding: BoundPurchase = {
    purchaseRef: ref,
    purchaseToken: token,
    packageName: PKG,
    productId: PRODUCT,
    ownerUid: "owner-1",
    familyId: "fam-1",
    obfuscatedAccountId: obfuscatedAccountIdFor("owner-1"),
    obfuscatedProfileId: obfuscatedProfileIdFor("fam-1"),
  };
  const bindings = new Map<string, BoundPurchase>([[ref, binding]]);
  const provider = new PlayBillingProvider(api, B1_SYNTHETIC_BILLING_CONFIG, async (r) => bindings.get(r) ?? null, clock);
  const q = { familyId: "fam-1", ownerUid: "owner-1", purchaseRef: ref };
  const c = { caseId: "case-1", familyId: "fam-1", purchaseRef: ref };
  return { api, token, ref, provider, q, c, bindings };
}

describe("subscriptionsv2 assessment (PL-PP-WP03-34)", () => {
  const expected = {
    packageName: PKG,
    productId: PRODUCT,
    obfuscatedAccountId: obfuscatedAccountIdFor("u"),
    obfuscatedProfileId: obfuscatedProfileIdFor("f"),
  };
  const snap = (state: string, autoRenewEnabled: boolean | undefined, extra: Partial<PlaySubscriptionSnapshot> = {}): PlaySubscriptionSnapshot => ({
    subscriptionState: state,
    lineItems: [{ productId: PRODUCT, expiryTime: new Date(NOW + DAY).toISOString(), autoRenewingPlan: { ...(autoRenewEnabled === undefined ? {} : { autoRenewEnabled }) } }],
    externalAccountIdentifiers: { obfuscatedExternalAccountId: expected.obfuscatedAccountId, obfuscatedExternalProfileId: expected.obfuscatedProfileId },
    ...extra,
  });

  test("stop-renewal finality needs renewal off AND a canceled/expired state AND no payment hold", () => {
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_CANCELED", false), expected, NOW).stopRenewalVerified, true);
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_EXPIRED", false), expected, NOW).stopRenewalVerified, true);
    for (const state of ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_PENDING", "BOGUS"]) {
      assert.equal(assessSubscription(snap(state, false), expected, NOW).stopRenewalVerified, false, state);
    }
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_CANCELED", true), expected, NOW).stopRenewalVerified, false);
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_CANCELED", undefined), expected, NOW).stopRenewalVerified, false, "missing flag is UNKNOWN");
  });

  test("cancellation is not expiration: a stopped subscription keeps current entitlement until expiry", () => {
    const a = assessSubscription(snap("SUBSCRIPTION_STATE_CANCELED", false), expected, NOW);
    assert.equal(a.stopRenewalVerified, true);
    assert.equal(a.currentEntitlement, true);
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_CANCELED", false), expected, NOW + 2 * DAY).currentEntitlement, false);
  });

  test("payment holds are distinguished from entitlement and renewal", () => {
    const hold = assessSubscription(snap("SUBSCRIPTION_STATE_ON_HOLD", true), expected, NOW);
    assert.equal(hold.paymentHold, true);
    assert.equal(hold.currentEntitlement, false);
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_PENDING", true), expected, NOW).pendingPurchase, true);
  });

  test("binding mismatches: product, account, profile, line-item count; unknown plans", () => {
    const other = { ...expected, obfuscatedAccountId: obfuscatedAccountIdFor("someone-else") };
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_ACTIVE", true), other, NOW).bindingMismatch, "ACCOUNT");
    const otherFam = { ...expected, obfuscatedProfileId: obfuscatedProfileIdFor("other-family") };
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_ACTIVE", true), otherFam, NOW).bindingMismatch, "PROFILE");
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_ACTIVE", true), { ...expected, productId: "x" }, NOW).bindingMismatch, "PRODUCT");
    assert.equal(assessSubscription(snap("SUBSCRIPTION_STATE_ACTIVE", true, { lineItems: [] }), expected, NOW).bindingMismatch, "LINE_ITEMS");
    const noIds = assessSubscription(snap("SUBSCRIPTION_STATE_ACTIVE", true, { externalAccountIdentifiers: {} }), expected, NOW);
    assert.equal(noIds.bindingMismatch, "ACCOUNT", "missing identifiers never match");
    const installment = snap("SUBSCRIPTION_STATE_CANCELED", false, {
      lineItems: [{ productId: PRODUCT, autoRenewingPlan: { autoRenewEnabled: false, installmentDetails: {} } }],
    });
    assert.equal(assessSubscription(installment, expected, NOW).plan, "INSTALLMENT");
    assert.equal(assessSubscription(installment, expected, NOW).stopRenewalVerified, false);
    const both = snap("SUBSCRIPTION_STATE_ACTIVE", true, { lineItems: [{ productId: PRODUCT, autoRenewingPlan: {}, prepaidPlan: {} }] });
    assert.equal(assessSubscription(both, expected, NOW).plan, "UNKNOWN");
  });
});

describe("Play adapter: cancellation saga semantics (PL-PP-WP03-34)", () => {
  test("cancel acknowledgement then authoritative refresh -> VERIFIED, one effect", async () => {
    const w = world();
    assert.deepEqual(await w.provider.requestCancellation(w.c), { kind: "VERIFIED", sequence: 0 });
    assert.equal(w.api.cancelEffects(PKG, w.token), 1);
    assert.deepEqual(w.api.calls.map((c) => c.op), ["get", "cancel", "get"]);
  });

  test("acknowledged but refresh still shows renewal on -> PENDING (ack is not finality)", async () => {
    const w = world({ settleAfterGets: 2 });
    assert.equal((await w.provider.requestCancellation(w.c)).kind, "PENDING");
    // Next attempt: Play still settling -> get shows renewing, cancel is a no-op, refresh settles.
    assert.equal((await w.provider.requestCancellation(w.c)).kind, "VERIFIED");
    assert.equal(w.api.cancelEffects(PKG, w.token), 1);
  });

  test("already stopped: VERIFIED without issuing a cancel", async () => {
    const w = world({ state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    assert.equal((await w.provider.requestCancellation(w.c)).kind, "VERIFIED");
    assert.equal(w.api.calls.filter((c) => c.op === "cancel").length, 0);
  });

  test("429 and 5xx before any cancel -> RETRYABLE_FAILURE (no effect)", async () => {
    for (const status of [429, 500, 503]) {
      const w = world();
      w.api.script("get", w.token, status);
      assert.equal((await requestCancellationSafely(w.provider, w.c)).kind, "RETRYABLE_FAILURE", String(status));
      assert.equal(w.api.cancelEffects(PKG, w.token), 0);
    }
    const w = world();
    w.api.script("cancel", w.token, 503);
    assert.equal((await requestCancellationSafely(w.provider, w.c)).kind, "RETRYABLE_FAILURE");
    assert.equal(w.api.cancelEffects(PKG, w.token), 0);
  });

  test("timeouts are AMBIGUOUS; a retry after an effectful timeout verifies with one effect", async () => {
    const w = world();
    w.api.script("cancel", w.token, "TIMEOUT_AFTER_EFFECT", "OK");
    assert.equal((await requestCancellationSafely(w.provider, w.c)).kind, "AMBIGUOUS");
    assert.equal(w.api.cancelEffects(PKG, w.token), 1);
    assert.equal((await requestCancellationSafely(w.provider, w.c)).kind, "VERIFIED");
    assert.equal(w.api.cancelEffects(PKG, w.token), 1, "never cancels twice");
    const w2 = world();
    w2.api.script("get", w2.token, "TIMEOUT_BEFORE_EFFECT");
    assert.equal((await requestCancellationSafely(w2.provider, w2.c)).kind, "AMBIGUOUS");
  });

  test("refresh failure after an accepted cancel -> PENDING, never VERIFIED", async () => {
    const w = world();
    w.api.script("get", w.token, "OK", 503);
    assert.equal((await w.provider.requestCancellation(w.c)).kind, "PENDING");
  });

  test("unsupported plans, mismatches, missing purchases and permanent 4xx -> held with a reason", async () => {
    const cases: Array<[Partial<FakeSubscriptionSeed>, string]> = [
      [{ plan: "INSTALLMENT" }, "UNSUPPORTED_PLAN_TYPE"],
      [{ plan: "PREPAID" }, "UNSUPPORTED_PLAN_TYPE"],
      [{ obfuscatedAccountId: obfuscatedAccountIdFor("intruder") }, "BINDING_MISMATCH"],
      [{ productId: "synthetic.other.product" }, "BINDING_MISMATCH"],
    ];
    for (const [over, reason] of cases) {
      const w = world(over);
      const out = await w.provider.requestCancellation(w.c);
      assert.deepEqual(out, { kind: "PERMANENT_FAILURE", sequence: 0, holdReason: reason }, JSON.stringify(over));
      assert.equal(w.api.cancelEffects(PKG, w.token), 0, "never cancels an unsupported or foreign subscription");
    }
    const gone = world();
    gone.api.script("get", gone.token, 410);
    assert.equal((await gone.provider.requestCancellation(gone.c)).holdReason, "PURCHASE_NOT_FOUND");
    const denied = world();
    denied.api.script("cancel", denied.token, 403);
    assert.equal((await denied.provider.requestCancellation(denied.c)).holdReason, "PROVIDER_REJECTED");
    const noRef = world();
    assert.equal((await noRef.provider.requestCancellation({ ...noRef.c, purchaseRef: null })).holdReason, "NO_BOUND_PURCHASE");
    const otherFamily = world();
    assert.equal((await otherFamily.provider.requestCancellation({ ...otherFamily.c, familyId: "fam-2" })).holdReason, "BINDING_MISMATCH");
  });

  test("payment hold with renewal off is not finality", async () => {
    const w = world({ state: "SUBSCRIPTION_STATE_ON_HOLD" });
    w.api.mutate(PKG, w.token, { autoRenewEnabled: false });
    assert.equal((await w.provider.requestCancellation(w.c)).kind, "PENDING");
  });

  test("liability: no reference NONE; bound subscriptions ACTIVE_OBLIGATION; pending, unknown or failing UNRESOLVED", async () => {
    const w = world();
    assert.equal(await w.provider.checkLiability({ ...w.q, purchaseRef: null }), "NONE");
    assert.equal(await w.provider.checkLiability(w.q), "ACTIVE_OBLIGATION");
    assert.equal(await w.provider.checkLiability({ ...w.q, ownerUid: "owner-2" }), "UNRESOLVED", "cross-UID");
    assert.equal(await w.provider.checkLiability({ ...w.q, purchaseRef: "0".repeat(64) }), "UNRESOLVED", "unknown ref");
    w.api.script("get", w.token, 503);
    assert.equal(await checkLiabilitySafely(w.provider, w.q), "UNRESOLVED");
    const pending = world({ state: "SUBSCRIPTION_STATE_PENDING" });
    assert.equal(await pending.provider.checkLiability(pending.q), "UNRESOLVED");
  });

  test("inspection mirrors current provider state", async () => {
    const w = world();
    assert.equal(await w.provider.inspectPurchase(w.q), "WILL_RENEW");
    w.api.mutate(PKG, w.token, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    assert.equal(await w.provider.inspectPurchase(w.q), "STOP_VERIFIED");
    w.api.mutate(PKG, w.token, { state: "SUBSCRIPTION_STATE_ON_HOLD" });
    assert.equal(await w.provider.inspectPurchase(w.q), "PAYMENT_HOLD");
    w.api.script("get", w.token, 404);
    assert.equal(await w.provider.inspectPurchase(w.q), "NOT_FOUND");
    w.api.script("get", w.token, "TIMEOUT_BEFORE_EFFECT");
    assert.equal(await w.provider.inspectPurchase(w.q), "UNRESOLVED");
    assert.equal(await inspectPurchaseSafely(new FakeBillingProvider(), w.q), "UNRESOLVED", "providers without inspection never verify");
  });
});

describe("internal purchase verification (PL-PP-WP03-36)", () => {
  const req = (w: ReturnType<typeof world>, over: Record<string, string> = {}) => ({
    purchaseToken: w.token,
    productId: PRODUCT,
    ownerUid: "owner-1",
    familyId: "fam-1",
    ...over,
  });

  test("active subscription for this owner/family/product verifies; acknowledgement is flagged, never performed", async () => {
    const w = world();
    const v = await w.provider.verifyPurchaseToken(req(w));
    assert.equal(v.kind, "VERIFIED_ACTIVE");
    assert.ok(v.kind === "VERIFIED_ACTIVE" && v.assessment.acknowledgementPending);
  });

  test("cross-UID, cross-family, cross-product and cross-package tokens are rejected", async () => {
    const w = world();
    assert.equal((await w.provider.verifyPurchaseToken(req(w, { ownerUid: "owner-2" }))).kind, "WRONG_ACCOUNT");
    assert.equal((await w.provider.verifyPurchaseToken(req(w, { familyId: "fam-2" }))).kind, "WRONG_ACCOUNT");
    assert.equal((await w.provider.verifyPurchaseToken(req(w, { productId: "not.configured" }))).kind, "WRONG_PRODUCT");
    const foreignPkg = world({ packageName: "com.example.other" });
    assert.equal((await foreignPkg.provider.verifyPurchaseToken(req(foreignPkg))).kind, "NOT_FOUND");
    const wrongProduct = world({ productId: "synthetic.other.product" });
    assert.equal((await wrongProduct.provider.verifyPurchaseToken(req(wrongProduct))).kind, "WRONG_PRODUCT");
  });

  test("pending, canceled, unsupported and unreachable are never VERIFIED_ACTIVE", async () => {
    const pending = world({ state: "SUBSCRIPTION_STATE_PENDING" });
    assert.equal((await pending.provider.verifyPurchaseToken(req(pending))).kind, "PENDING_PAYMENT");
    const canceled = world({ state: "SUBSCRIPTION_STATE_CANCELED", autoRenewEnabled: false });
    assert.equal((await canceled.provider.verifyPurchaseToken(req(canceled))).kind, "NOT_ENTITLED");
    const inst = world({ plan: "INSTALLMENT" });
    assert.equal((await inst.provider.verifyPurchaseToken(req(inst))).kind, "UNSUPPORTED_PLAN");
    const down = world();
    down.api.script("get", down.token, 503);
    assert.equal((await down.provider.verifyPurchaseToken(req(down))).kind, "UNRESOLVED");
  });

  test("binding decisions: one binding per token, owner only, no closed families, late settlement held", () => {
    const fam = { ownerUid: "o", lifecycleState: "UNENTITLED_AWAITING_PAYMENT" as const, reservationExpiresAtMillis: NOW + 1000 };
    const none = { purchaseState: "NONE" as const, purchaseRef: null };
    const ok = { kind: "VERIFIED_ACTIVE" as const, assessment: {} as never };
    assert.deepEqual(decideBinding(fam, "o", "f", null, none, "r", ok, NOW), { kind: "WRITE", status: "BOUND", localPurchaseState: "ACTIVE" });
    assert.deepEqual(decideBinding(fam, "o", "f", null, none, "r", ok, NOW + 2 * DAY), {
      kind: "WRITE",
      status: "HELD_LATE_SETTLEMENT",
      localPurchaseState: "PENDING",
    });
    assert.deepEqual(decideBinding(fam, "x", "f", null, none, "r", ok, NOW), { kind: "REJECT", reason: "NOT_OWNER" });
    assert.deepEqual(decideBinding(null, "o", "f", null, none, "r", ok, NOW), { kind: "REJECT", reason: "FAMILY_NOT_FOUND" });
    assert.deepEqual(precheckBinding(fam, "o", "f", { familyId: "g", ownerUid: "o" }, none, "r"), { kind: "REJECT", reason: "ALREADY_BOUND_ELSEWHERE" });
    assert.deepEqual(precheckBinding(fam, "o", "f", { familyId: "f", ownerUid: "o" }, none, "r"), { kind: "ALREADY_BOUND_THIS_FAMILY" });
    assert.deepEqual(precheckBinding({ ...fam, lifecycleState: "CLOSING" }, "o", "f", null, none, "r"), { kind: "REJECT", reason: "FAMILY_CLOSED" });
    assert.deepEqual(precheckBinding(fam, "o", "f", null, { purchaseState: "ACTIVE", purchaseRef: "other" }, "r"), {
      kind: "REJECT",
      reason: "FAMILY_HAS_OTHER_PURCHASE",
    });
    assert.deepEqual(decideBinding(fam, "o", "f", null, none, "r", { kind: "UNRESOLVED" }, NOW), { kind: "REJECT", reason: "PROVIDER_UNRESOLVED" });
    assert.equal(isPlausiblePurchaseToken(""), false);
    assert.equal(isPlausiblePurchaseToken(undefined), false);
    assert.equal(isPlausiblePurchaseToken("a".repeat(513)), false);
    assert.equal(isPlausiblePurchaseToken("bad token with spaces!!"), false);
  });
});

describe("provider isolation: live provider use is impossible in B1 (PL-PP-WP03-33)", () => {
  test("only the Functions emulator with a demo- project selects the fake", () => {
    assert.equal(selectBillingProvider({ FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "demo-newbaileyscart" }).source, "FAKE_PROVIDER");
    for (const env of [
      {},
      { FUNCTIONS_EMULATOR: "true" },
      { FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "newbaileyscart-prod" },
      { FUNCTIONS_EMULATOR: "false", GCLOUD_PROJECT: "demo-x" },
      { GCLOUD_PROJECT: "demo-x" },
      { FUNCTIONS_EMULATOR: "1", GCLOUD_PROJECT: "demo-x" },
      { FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "xdemo-" },
    ]) {
      assert.equal(selectBillingProvider(env), unavailableBillingProvider, JSON.stringify(env));
      assert.equal(isEmulatorDemoRuntime(env), false);
    }
  });

  test("the disabled Play API and the live constructor fail closed for every input", async () => {
    await assert.rejects(disabledPlayApi.get({ packageName: PKG, purchaseToken: "t" }), LiveProviderDisabledError);
    await assert.rejects(disabledPlayApi.cancel({ packageName: PKG, purchaseToken: "t", cancellationType: "USER_REQUESTED_STOP_RENEWALS" }), LiveProviderDisabledError);
    for (const cfg of [undefined, {}, { credentials: { client_email: "x", private_key: "y" } }, { keyFile: "/tmp/key.json" }]) {
      assert.throws(() => createLivePlayApi(cfg), LiveProviderDisabledError);
    }
    const w = world();
    const p = new PlayBillingProvider(disabledPlayApi, B1_SYNTHETIC_BILLING_CONFIG, async () => w.bindings.get(w.ref) ?? null, clock);
    assert.equal(p.source, "UNAVAILABLE");
    assert.equal(await p.checkLiability(w.q), "UNRESOLVED");
    assert.equal((await p.requestCancellation(w.c)).holdReason, "PROVIDER_REJECTED");
    assert.equal(await p.inspectPurchase(w.q), "UNRESOLVED");
    assert.equal((await p.verifyPurchaseToken({ purchaseToken: w.token, productId: PRODUCT, ownerUid: "owner-1", familyId: "fam-1" })).kind, "UNRESOLVED");
    assert.equal(await checkLiabilitySafely(unavailableBillingProvider, w.q), "UNRESOLVED");
  });

  test("failure classification", () => {
    assert.equal(classifyPlayFailure(new PlayApiHttpError(429)), "RETRYABLE");
    assert.equal(classifyPlayFailure(new PlayApiHttpError(502)), "RETRYABLE");
    assert.equal(classifyPlayFailure(new PlayApiHttpError(404)), "NOT_FOUND");
    assert.equal(classifyPlayFailure(new PlayApiHttpError(410)), "NOT_FOUND");
    assert.equal(classifyPlayFailure(new PlayApiHttpError(401)), "REJECTED");
    assert.equal(classifyPlayFailure(new PlayApiTimeoutError()), "AMBIGUOUS");
    assert.equal(classifyPlayFailure(new Error("boom")), "AMBIGUOUS");
  });

  test("no source file can reach a network or load credentials; no Google client dependency", () => {
    const forbidden = [
      /from\s+["']node:(http|https|http2|net|tls|dgram)["']/,
      /from\s+["'](http|https|net|tls)["']/,
      /googleapis/,
      /google-auth-library/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /GOOGLE_APPLICATION_CREDENTIALS/,
      /private_key/,
      /androidpublisher/i,
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(resolve("src"));
    assert.ok(files.length > 20, "source tree found");
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of forbidden) assert.equal(re.test(text), false, `${f} matches ${re}`);
    }
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["firebase-admin", "firebase-functions"]);
  });
});

describe("RTDN parser (PL-PP-WP03-35)", () => {
  const sub = (token: string, notificationType = 3) => ({ subscriptionNotification: { version: "1.0", notificationType, purchaseToken: token } });
  const env = (o: Partial<{ messageId: string; packageName: string; eventTimeMillis: number; notification: Record<string, unknown> }> = {}) =>
    syntheticRtdnEnvelope({ messageId: "1234567890", packageName: PKG, eventTimeMillis: NOW, notification: sub("synthetic-token-0123456789"), ...o });
  const rawData = (obj: unknown) => ({ message: { data: Buffer.from(JSON.stringify(obj)).toString("base64"), messageId: "42" } });

  test("valid subscription, test, one-time and voided notifications", () => {
    const r = parseRtdnEnvelope(env(), PKG);
    assert.ok(r.ok);
    assert.equal(r.rtdn.kind, "SUBSCRIPTION");
    assert.equal(r.rtdn.notificationType, 3);
    assert.equal(r.rtdn.deliveryRef, deliveryRefFor("1234567890"));
    const t = parseRtdnEnvelope(env({ notification: { testNotification: { version: "1.0" } } }), PKG);
    assert.ok(t.ok && t.rtdn.kind === "TEST" && t.rtdn.purchaseToken === null);
    const v = parseRtdnEnvelope(env({ notification: { voidedPurchaseNotification: { purchaseToken: "x", orderId: "o", productType: 1 } } }), PKG);
    assert.ok(v.ok && v.rtdn.kind === "VOIDED_PURCHASE");
  });

  test("malformed, oversized and foreign payloads fail closed with a reason only", () => {
    const cases: Array<[unknown, string]> = [
      [null, "ENVELOPE_NOT_OBJECT"],
      [[], "ENVELOPE_NOT_OBJECT"],
      [{ ...env(), extra: 1 }, "ENVELOPE_UNKNOWN_FIELD"],
      [{ subscription: "s" }, "MESSAGE_MISSING"],
      [{ message: { ...(env()["message"] as object), injected: true } }, "MESSAGE_UNKNOWN_FIELD"],
      [{ message: { data: "e30=" } }, "MESSAGE_ID_INVALID"],
      [{ message: { data: "e30=", messageId: "a b" } }, "MESSAGE_ID_INVALID"],
      [{ message: { data: "e30=", messageId: "x".repeat(129) } }, "MESSAGE_ID_INVALID"],
      [{ message: { data: "e30=", messageId: "1", message_id: "2" } }, "MESSAGE_ID_CONFLICT"],
      [{ message: { messageId: "1" } }, "DATA_MISSING"],
      [{ message: { data: "A".repeat(8_196), messageId: "1" } }, "DATA_TOO_LARGE"],
      [{ message: { data: Buffer.alloc(MAX_DECODED_DATA_BYTES + 3, 0x20).toString("base64"), messageId: "1" } }, "DATA_TOO_LARGE"],
      [{ message: { data: "!!!!", messageId: "1" } }, "DATA_NOT_BASE64"],
      [{ message: { data: Buffer.from("not json").toString("base64"), messageId: "1" } }, "DATA_NOT_JSON"],
      [{ message: { data: Buffer.from([0xff, 0xfe, 0xfd]).toString("base64"), messageId: "1" } }, "DATA_NOT_JSON"],
      [rawData([1]), "DATA_NOT_JSON"],
      [rawData({ version: "1.0", packageName: PKG, eventTimeMillis: "1", evil: 1 }), "NOTIFICATION_UNKNOWN_FIELD"],
      [rawData({ version: "2.0", packageName: PKG, eventTimeMillis: "1" }), "VERSION_UNSUPPORTED"],
      [env({ packageName: "com.attacker.app" }), "PACKAGE_MISMATCH"],
      [rawData({ version: "1.0", packageName: PKG, eventTimeMillis: 5, testNotification: {} }), "EVENT_TIME_INVALID"],
      [rawData({ version: "1.0", packageName: PKG, eventTimeMillis: "0", testNotification: {} }), "EVENT_TIME_INVALID"],
      [rawData({ version: "1.0", packageName: PKG, eventTimeMillis: "1" }), "NOTIFICATION_KIND_INVALID"],
      [env({ notification: { ...sub("tok-0123456789abcdef"), testNotification: { version: "1.0" } } }), "NOTIFICATION_KIND_INVALID"],
      [env({ notification: { subscriptionNotification: { version: "1.0", notificationType: 3, purchaseToken: "t", x: 1 } } }), "SUBSCRIPTION_NOTIFICATION_INVALID"],
      [env({ notification: { subscriptionNotification: { version: "1.0", notificationType: "3", purchaseToken: "t" } } }), "SUBSCRIPTION_NOTIFICATION_INVALID"],
      [env({ notification: sub("") }), "PURCHASE_TOKEN_INVALID"],
      [env({ notification: sub("tok with spaces") }), "PURCHASE_TOKEN_INVALID"],
      [env({ notification: sub("t".repeat(513)) }), "PURCHASE_TOKEN_INVALID"],
    ];
    for (const [input, reason] of cases) {
      const r = parseRtdnEnvelope(input, PKG);
      assert.equal(r.ok, false, reason);
      assert.deepEqual(r, { ok: false, reason }, `expected ${reason}`);
      assert.deepEqual(Object.keys(r), ["ok", "reason"], "a rejection carries no payload content");
    }
  });
});

describe("bounded retry jitter (PL-PP-WP03-34)", () => {
  test("jitter never delays past the deterministic schedule and never shortens it by more than 20%", () => {
    for (let attempts = 1; attempts <= 12; attempts++) {
      const base = retryDelayMs(attempts);
      assert.equal(jitteredRetryDelayMs(attempts, 0), base);
      for (let i = 0; i < 200; i++) {
        const d = jitteredRetryDelayMs(attempts, Math.random());
        assert.ok(d <= base && d >= base * (1 - MAX_JITTER_FRACTION), `${attempts}: ${d} vs ${base}`);
      }
      for (const bad of [-1, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(jitteredRetryDelayMs(attempts, bad), base);
    }
  });

  test("the saga records the hold reason on PERMANENT_FAILURE and applies jitter on retries", () => {
    const c: ClosureCase = {
      caseId: "c",
      familyId: "f",
      ownerUid: "o",
      sourceEpoch: 1,
      cancellationStatus: "PENDING",
      closedAtMillis: NOW,
      closureConfirmedAtMillis: null,
      recoverUntilAtMillis: null,
      waiverCommittedAtMillis: null,
      attempts: 0,
      nextAttemptAtMillis: NOW,
      lastProviderSequence: 0,
      releaseBlockedReason: null,
      deletionPendingAtMillis: null,
      ownershipReleasedAtMillis: null,
      restoredAtMillis: null,
      revision: 1,
    };
    const held = applyCancellationOutcome(c, { kind: "PERMANENT_FAILURE", sequence: 0, holdReason: "UNSUPPORTED_PLAN_TYPE" }, NOW);
    assert.ok(held.changed && held.closure.cancellationStatus === "MANUAL_REVIEW" && held.closure.billingHoldReason === "UNSUPPORTED_PLAN_TYPE");
    assert.ok(held.changed && held.closure.recoverUntilAtMillis === null);
    const r = applyCancellationOutcome(c, { kind: "RETRYABLE_FAILURE", sequence: 0 }, NOW, 0.5);
    assert.ok(r.changed && r.closure.nextAttemptAtMillis === NOW + jitteredRetryDelayMs(1, 0.5));
    const pending = applyCancellationOutcome(c, { kind: "PENDING", sequence: 0 }, NOW);
    assert.ok(pending.changed && pending.lifecycleState === "CLOSURE_PENDING_BILLING" && pending.closure.recoverUntilAtMillis === null);
  });
});
