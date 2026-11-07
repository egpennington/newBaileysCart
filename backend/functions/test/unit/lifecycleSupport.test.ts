/**
 * D1: confirmation tokens, request schemas, the fake billing provider and reservation
 * reconciliation decisions (WP-03 Slice 3, Substage 3A).
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { FakeBillingProvider } from "../../src/billing/fakeProvider.js";
import { checkLiabilitySafely, requestCancellationSafely, unavailableBillingProvider } from "../../src/billing/provider.js";
import { DomainError } from "../../src/contract/errors.js";
import { parseClosureStatusRequest, parseConfirmedFamilyMutation, parseFamilyMutation } from "../../src/contract/validate.js";
import { CONFIRMATION_TOKEN_TTL_MS, checkConfirmation } from "../../src/domain/confirmation.js";
import type { ConfirmationRecord } from "../../src/domain/confirmation.js";
import { RESERVATION_TTL_MS } from "../../src/domain/family.js";
import { assertCheckoutAllowed, decideReservationDisposition } from "../../src/domain/reservation.js";

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0, 0);
const OP = "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const TOKEN = "A".repeat(43);

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DomainError);
    return `${err.code}:${String(err.details["field"] ?? "")}:${String(err.details["reason"] ?? "")}`;
  }
  return "OK";
}

describe("confirmation token rule (S3-D06; PL-PP-WP03-16/-27 D1)", () => {
  const binding = { uid: "u1", familyId: "f1", action: "families.waiveRecovery", familyEpoch: 2 } as const;
  const rec: ConfirmationRecord = { ...binding, issuedAtMillis: T0, expiresAtMillis: T0 + CONFIRMATION_TOKEN_TTL_MS, consumedAtMillis: null };

  test("TTL is 15 minutes", () => assert.equal(CONFIRMATION_TOKEN_TTL_MS, 900_000));
  test("valid: right owner, family, action, epoch, within TTL", () => {
    assert.deepEqual(checkConfirmation(rec, binding, T0, false), { ok: true });
    assert.deepEqual(checkConfirmation(rec, binding, T0 + CONFIRMATION_TOKEN_TTL_MS - 1, false), { ok: true });
  });
  test("expiry boundary: at and after expiresAt -> CONFIRMATION_EXPIRED", () => {
    assert.deepEqual(checkConfirmation(rec, binding, T0 + CONFIRMATION_TOKEN_TTL_MS, false), { ok: false, code: "CONFIRMATION_EXPIRED" });
  });
  const mismatches: Record<string, Partial<typeof binding> | object> = {
    "another owner": { uid: "u2" },
    "another family (cross-family token)": { familyId: "f2" },
    "another action": { action: "families.close" },
    "another epoch (stale or post-restore)": { familyEpoch: 3 },
  };
  for (const [name, over] of Object.entries(mismatches)) {
    test(`${name} -> CONFIRMATION_REQUIRED, even when also expired`, () => {
      const expected = { ...binding, ...over } as typeof binding;
      assert.deepEqual(checkConfirmation(rec, expected, T0, false), { ok: false, code: "CONFIRMATION_REQUIRED" });
      assert.deepEqual(checkConfirmation(rec, expected, T0 + 10 * CONFIRMATION_TOKEN_TTL_MS, false), { ok: false, code: "CONFIRMATION_REQUIRED" });
    });
  }
  test("unknown or already consumed (single use) -> CONFIRMATION_REQUIRED", () => {
    assert.deepEqual(checkConfirmation(null, binding, T0, false), { ok: false, code: "CONFIRMATION_REQUIRED" });
    assert.deepEqual(checkConfirmation({ ...rec, consumedAtMillis: T0 }, binding, T0 + 1, false), { ok: false, code: "CONFIRMATION_REQUIRED" });
  });
  test("issued in the future (clock skew/forgery) -> CONFIRMATION_REQUIRED", () => {
    assert.deepEqual(checkConfirmation(rec, binding, T0 - 1, false), { ok: false, code: "CONFIRMATION_REQUIRED" });
  });
});

describe("lifecycle request schemas (W-02 step 3)", () => {
  const close = { apiVersion: "v0.4", opId: OP, familyId: "abcDEF0123456789wxyz", familyEpoch: 1, confirmationToken: TOKEN };
  test("valid close / waive request", () => assert.equal(parseConfirmedFamilyMutation(close).request.familyEpoch, 1));
  const cases: Record<string, [unknown, string]> = {
    "token missing": [{ ...close, confirmationToken: undefined }, "VALIDATION_FAILED:confirmationToken:MISSING"],
    "token malformed": [{ ...close, confirmationToken: "short" }, "VALIDATION_FAILED:confirmationToken:MALFORMED"],
    "familyId with a path separator": [{ ...close, familyId: "a/b" }, "VALIDATION_FAILED:familyId:MALFORMED"],
    "familyId missing": [{ ...close, familyId: undefined }, "VALIDATION_FAILED:familyId:MISSING"],
    "epoch zero": [{ ...close, familyEpoch: 0 }, "VALIDATION_FAILED:familyEpoch:NOT_A_POSITIVE_INTEGER"],
    "epoch fractional": [{ ...close, familyEpoch: 1.5 }, "VALIDATION_FAILED:familyEpoch:NOT_A_POSITIVE_INTEGER"],
    "epoch as string": [{ ...close, familyEpoch: "1" }, "VALIDATION_FAILED:familyEpoch:NOT_A_POSITIVE_INTEGER"],
    "uppercase opId": [{ ...close, opId: OP.toUpperCase() }, "VALIDATION_FAILED:opId:NOT_A_UUID_V4"],
    "body ownerUid (forged)": [{ ...close, ownerUid: "u1" }, "VALIDATION_FAILED:ownerUid:UNKNOWN_FIELD"],
    "wrong api version": [{ ...close, apiVersion: "v0.3" }, "API_VERSION_UNSUPPORTED::"],
  };
  for (const [name, [data, want]] of Object.entries(cases)) {
    test(`close: ${name} -> ${want}`, () => {
      const normalized = JSON.parse(JSON.stringify(data)) as unknown;
      assert.equal(fieldOf(() => parseConfirmedFamilyMutation(normalized)), want);
    });
  }
  test("restore rejects a confirmationToken field (not in its contract)", () => {
    assert.equal(fieldOf(() => parseFamilyMutation(close)), "VALIDATION_FAILED:confirmationToken:UNKNOWN_FIELD");
  });
  test("getClosureStatus: opId optional, familyEpoch not accepted", () => {
    assert.equal(parseClosureStatusRequest({ apiVersion: "v0.4", familyId: "f1" }).opId, null);
    assert.equal(fieldOf(() => parseClosureStatusRequest({ apiVersion: "v0.4", familyId: "f1", familyEpoch: 1 })), "VALIDATION_FAILED:familyEpoch:UNKNOWN_FIELD");
  });
});

describe("fake billing provider (deterministic; never real Play evidence)", () => {
  test("default answers follow the purchase reference", async () => {
    const p = new FakeBillingProvider();
    assert.equal(p.source, "FAKE_PROVIDER");
    assert.equal(await p.checkLiability({ familyId: "f", ownerUid: "u", purchaseRef: null }), "NONE");
    assert.equal(await p.checkLiability({ familyId: "f", ownerUid: "u", purchaseRef: "fake-paid-1" }), "ACTIVE_OBLIGATION");
    assert.equal(await p.checkLiability({ familyId: "f", ownerUid: "u", purchaseRef: "other" }), "UNRESOLVED");
  });
  test("scripted outage and timeout are UNRESOLVED liability through the safe wrapper", async () => {
    const p = new FakeBillingProvider().scriptLiability("f", "OUTAGE", "TIMEOUT", "NONE");
    const q = { familyId: "f", ownerUid: "u", purchaseRef: null };
    assert.equal(await checkLiabilitySafely(p, q), "UNRESOLVED");
    assert.equal(await checkLiabilitySafely(p, q), "UNRESOLVED");
    assert.equal(await checkLiabilitySafely(p, q), "NONE");
    assert.equal(await checkLiabilitySafely(p, q), "NONE", "last step repeats");
  });
  test("cancellation: outage is RETRYABLE with no effect; timeout is AMBIGUOUS with a possible effect; idempotent by case", async () => {
    const p = new FakeBillingProvider().scriptCancellation("f", "OUTAGE", "TIMEOUT", "VERIFIED");
    const r = { caseId: "c1", familyId: "f", purchaseRef: "fake-paid-1" };
    assert.deepEqual(await requestCancellationSafely(p, r), { kind: "RETRYABLE_FAILURE", sequence: 0 });
    assert.equal(p.effects.get("c1"), undefined);
    assert.deepEqual(await requestCancellationSafely(p, r), { kind: "AMBIGUOUS", sequence: 0 });
    assert.equal(p.effects.get("c1"), 1);
    assert.deepEqual(await requestCancellationSafely(p, r), { kind: "VERIFIED", sequence: 0 });
    assert.equal(p.effects.get("c1"), 1, "a retry after timeout does not cancel twice");
  });
  test("events carry increasing sequences", () => {
    const p = new FakeBillingProvider();
    const a = p.event("PENDING");
    const b = p.event("VERIFIED");
    assert.ok(b.sequence > a.sequence);
  });
  test("the non-emulator provider fails closed", async () => {
    assert.equal(await unavailableBillingProvider.checkLiability({ familyId: "f", ownerUid: "u", purchaseRef: null }), "UNRESOLVED");
    assert.deepEqual(await requestCancellationSafely(unavailableBillingProvider, { caseId: "c", familyId: "f", purchaseRef: null }), {
      kind: "RETRYABLE_FAILURE",
      sequence: 0,
    });
  });
});

describe("reservation reconciliation decisions (D46; PL-PP-WP03-24/-26 D1)", () => {
  const exp = T0 + RESERVATION_TTL_MS;
  const f = (over: Partial<Parameters<typeof decideReservationDisposition>[0]> = {}) => ({
    reservationExpiresAtMillis: exp,
    nowMillis: exp,
    local: "NONE" as const,
    provider: "NONE" as const,
    originalPurchaseRef: null,
    currentPurchaseRef: null,
    held: false,
    ...over,
  });
  test("before the TTL: no action; at the TTL: decided", () => {
    assert.equal(decideReservationDisposition(f({ nowMillis: exp - 1 })), null);
    assert.equal(decideReservationDisposition(f()), "EXPIRED_NO_PURCHASE_FOUND");
  });
  test("hour 24 purchase pending -> hold; hour 26 provider-verified for the original -> verified", () => {
    assert.equal(decideReservationDisposition(f({ local: "PENDING", currentPurchaseRef: "p1", originalPurchaseRef: "p1" })), "RESERVATION_RECONCILIATION_PENDING");
    assert.equal(
      decideReservationDisposition(f({ nowMillis: exp + 2 * 3_600_000, local: "PENDING", provider: "ACTIVE_OBLIGATION", originalPurchaseRef: "p1", currentPurchaseRef: "p1", held: true })),
      "PAYMENT_VERIFIED_ORIGINAL_RESERVATION",
    );
  });
  test("provider unavailable -> hold, never a no-purchase release", () => {
    assert.equal(decideReservationDisposition(f({ provider: "UNRESOLVED" })), "RESERVATION_RECONCILIATION_PENDING");
  });
  test("a different purchase correlation after the hold -> REMEDIATION_REQUIRED (no rebinding)", () => {
    assert.equal(
      decideReservationDisposition(f({ held: true, originalPurchaseRef: "p1", currentPurchaseRef: "p2", provider: "ACTIVE_OBLIGATION" })),
      "REMEDIATION_REQUIRED",
    );
  });
  test("checkout at and after expiry -> RESERVATION_EXPIRED", () => {
    assert.doesNotThrow(() => assertCheckoutAllowed(exp, exp - 1));
    assert.throws(() => assertCheckoutAllowed(exp, exp), (e: unknown) => e instanceof DomainError && e.code === "RESERVATION_EXPIRED");
  });
});
