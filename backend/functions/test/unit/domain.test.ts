import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { DomainError } from "../../src/contract/errors.js";
import { toRfc3339 } from "../../src/domain/clock.js";
import { decideCreate } from "../../src/domain/createDecision.js";
import { RESERVATION_TTL_MS, TRIAL_DURATION_MS, accessModeFor, isReservationExpired } from "../../src/domain/family.js";
import { canonicalJson, idempotencyKey, requestHash } from "../../src/persistence/idempotency.js";

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0, 0);

describe("decideCreate (P4-D10, P4-D11, D42, D45, D46)", () => {
  const base = { emailVerified: true, ownedFamilyId: null, trialConsumed: false, nowMillis: NOW };

  test("eligible verified UID gets a 21-day trial family at epoch 1", () => {
    const out = decideCreate(base);
    assert.equal(out.kind, "TRIAL");
    assert.equal(out.lifecycleState, "ACTIVE");
    assert.equal(out.familyEpoch, 1);
    if (out.kind !== "TRIAL") return;
    assert.equal(out.trialStartedAtMillis, NOW);
    assert.equal(out.trialEndsAtMillis - out.trialStartedAtMillis, 21 * 86_400 * 1000);
  });
  test("consumed trial yields a 24-hour unentitled reservation at epoch 1", () => {
    const out = decideCreate({ ...base, trialConsumed: true });
    assert.equal(out.kind, "RESERVATION");
    assert.equal(out.lifecycleState, "UNENTITLED_AWAITING_PAYMENT");
    assert.equal(out.familyEpoch, 1);
    if (out.kind !== "RESERVATION") return;
    assert.equal(out.reservationCreatedAtMillis, NOW);
    assert.equal(out.reservationExpiresAtMillis - NOW, 86_400 * 1000);
  });
  test("unverified email rejected before any other rule", () => {
    assert.throws(
      () => decideCreate({ ...base, emailVerified: false, ownedFamilyId: "f1" }),
      (e: unknown) => e instanceof DomainError && e.code === "EMAIL_VERIFICATION_REQUIRED",
    );
  });
  test("owner limit applies regardless of trial state", () => {
    for (const trialConsumed of [false, true]) {
      assert.throws(
        () => decideCreate({ ...base, ownedFamilyId: "f1", trialConsumed }),
        (e: unknown) => e instanceof DomainError && e.code === "OWNER_ALREADY_HAS_FAMILY",
      );
    }
  });
});

describe("time arithmetic and access", () => {
  test("durations are exact elapsed seconds", () => {
    assert.equal(TRIAL_DURATION_MS, 1_814_400_000);
    assert.equal(RESERVATION_TTL_MS, 86_400_000);
  });
  test("RFC 3339 UTC with milliseconds", () => {
    assert.equal(toRfc3339(NOW), "2026-10-28T12:00:00.000Z");
    assert.equal(toRfc3339(NOW + RESERVATION_TTL_MS), "2026-10-29T12:00:00.000Z");
    assert.equal(toRfc3339(NOW + TRIAL_DURATION_MS), "2026-11-18T12:00:00.000Z");
  });
  test("reservation expiry boundary: valid strictly before, expired at and after", () => {
    const expires = NOW + RESERVATION_TTL_MS;
    assert.equal(isReservationExpired(expires, expires - 1), false);
    assert.equal(isReservationExpired(expires, expires), true);
    assert.equal(isReservationExpired(expires, expires + 1), true);
  });
  test("trial ACTIVE is READ_WRITE strictly before end, READ_ONLY from end", () => {
    const end = NOW + TRIAL_DURATION_MS;
    assert.equal(accessModeFor({ lifecycleState: "ACTIVE", trialEndsAtMillis: end }, end - 1), "READ_WRITE");
    assert.equal(accessModeFor({ lifecycleState: "ACTIVE", trialEndsAtMillis: end }, end), "READ_ONLY");
  });
  test("unpaid reservation has no access, before and after expiry", () => {
    for (const now of [NOW, NOW + 2 * RESERVATION_TTL_MS]) {
      assert.equal(accessModeFor({ lifecycleState: "UNENTITLED_AWAITING_PAYMENT", trialEndsAtMillis: null }, now), "NONE");
    }
  });
  test("unknown or closure states fail closed", () => {
    for (const s of ["CLOSURE_PENDING_BILLING", "CLOSING", "DELETION_PENDING", "", "active"]) {
      assert.equal(accessModeFor({ lifecycleState: s, trialEndsAtMillis: NOW + 1000 }, NOW), "NONE");
    }
  });
  test("ACTIVE without trial end fails closed", () =>
    assert.equal(accessModeFor({ lifecycleState: "ACTIVE", trialEndsAtMillis: null }, NOW), "NONE"));
});

describe("idempotency identity", () => {
  const req = { apiVersion: "v0.4", opId: "3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b", payload: { displayName: "A" } };
  test("canonical JSON sorts keys at every level", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }), '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });
  test("hash is stable under key reordering", () => {
    const reordered = { payload: { displayName: "A" }, opId: req.opId, apiVersion: "v0.4" };
    assert.equal(requestHash("families.create", req), requestHash("families.create", reordered));
  });
  test("hash changes with payload, including whitespace", () => {
    assert.notEqual(requestHash("families.create", req), requestHash("families.create", { ...req, payload: { displayName: "A " } }));
    assert.notEqual(requestHash("families.create", req), requestHash("families.create", { ...req, payload: {} }));
  });
  test("hash binds the command", () => {
    assert.notEqual(requestHash("families.create", req), requestHash("families.close", req));
  });
  test("key binds actor and opId", () => {
    assert.notEqual(idempotencyKey("u1", req.opId), idempotencyKey("u2", req.opId));
    assert.match(idempotencyKey("u1", req.opId), /^[0-9a-f]{64}$/);
  });
});
