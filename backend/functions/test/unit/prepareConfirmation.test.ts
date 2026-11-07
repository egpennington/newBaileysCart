/**
 * D1: families.prepareLifecycleConfirmation (A2-D4; PL-PP-WP03-32 D1). Pure decision tables for the
 * request schema, recent sign-in, the issuance throttle and supersession, plus the handler steps that
 * run before any Firestore access (local-only barrier, verified email, recent sign-in, validation).
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { authenticate } from "../../src/callable/adapter.js";
import { familiesPrepareLifecycleConfirmationHandler } from "../../src/commands/familiesPrepareLifecycleConfirmation.js";
import { DomainError } from "../../src/contract/errors.js";
import type { DomainErrorCode } from "../../src/contract/errors.js";
import { parsePrepareConfirmationRequest } from "../../src/contract/validate.js";
import {
  CONFIRMATION_TOKEN_BYTES,
  CONFIRMATION_TOKEN_TTL_MS,
  ISSUANCE_LIMIT,
  ISSUANCE_WINDOW_MS,
  PREPARE_ACTIONS,
  RECENT_AUTH_MAX_AGE_MS,
  checkConfirmation,
  isRecentAuth,
  issuanceAllowed,
  issuancesInWindow,
} from "../../src/domain/confirmation.js";
import type { ConfirmationRecord } from "../../src/domain/confirmation.js";
import { unavailableBillingProvider } from "../../src/billing/provider.js";
import { FakeFirestore } from "../support/fakeFirestore.js";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0, 0);
const OP = "3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const DEMO_ENV = { FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "demo-newbaileyscart" };
const valid = { apiVersion: "v0.4", opId: OP, familyId: "fam1", action: "CLOSE" };
const owner = { uid: "u1", emailVerified: true, authTimeSeconds: Math.floor(T0 / 1000) };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DomainError);
    return `${err.code}:${String(err.details["field"] ?? "")}:${String(err.details["reason"] ?? "")}`;
  }
  return "OK";
}

async function rejects(p: Promise<unknown>, code: DomainErrorCode): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);
}

function handler(env: Readonly<Record<string, string | undefined>>, fake = new FakeFirestore()) {
  return {
    fake,
    run: familiesPrepareLifecycleConfirmationHandler({
      db: fake.asFirestore,
      clock: { nowMillis: () => T0 },
      provider: unavailableBillingProvider,
      env,
    }),
  };
}

describe("prepare request schema (A2-D4)", () => {
  test("accepts exactly {apiVersion, opId, familyId, action} with CLOSE or WAIVE_RECOVERY", () => {
    assert.equal(codeOf(() => parsePrepareConfirmationRequest(valid)), "OK");
    assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, action: "WAIVE_RECOVERY" })), "OK");
    assert.deepEqual(parsePrepareConfirmationRequest(valid).request, valid);
  });
  test("rejects other actions, including the command names and lower case", () => {
    for (const action of ["close", "families.close", "WAIVE", "RESTORE", "", 1, null, ["CLOSE"]]) {
      assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, action })), "VALIDATION_FAILED:action:NOT_ALLOWED");
    }
    const { action: _a, ...noAction } = valid;
    assert.equal(codeOf(() => parsePrepareConfirmationRequest(noAction)), "VALIDATION_FAILED:action:MISSING");
  });
  test("no client epoch, uid, expiry, token or billing input is accepted", () => {
    for (const extra of ["familyEpoch", "uid", "ownerUid", "expiresAt", "confirmationToken", "issuedAt", "purchaseState", "auth_time"]) {
      assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, [extra]: 1 })), `VALIDATION_FAILED:${extra}:UNKNOWN_FIELD`);
    }
  });
  test("opId must be lowercase UUIDv4; familyId must be a plain id; apiVersion v0.4", () => {
    assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, opId: OP.toUpperCase() })), "VALIDATION_FAILED:opId:NOT_A_UUID_V4");
    assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, opId: undefined })), "VALIDATION_FAILED:opId:MISSING");
    assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, familyId: "a/b" })), "VALIDATION_FAILED:familyId:MALFORMED");
    assert.equal(codeOf(() => parsePrepareConfirmationRequest({ ...valid, apiVersion: "v0.3" })), "API_VERSION_UNSUPPORTED::");
    assert.equal(codeOf(() => parsePrepareConfirmationRequest([valid])), "VALIDATION_FAILED:request:NOT_AN_OBJECT");
  });
  test("action maps to the consuming command", () => {
    assert.deepEqual(PREPARE_ACTIONS, { CLOSE: "families.close", WAIVE_RECOVERY: "families.waiveRecovery" });
  });
});

describe("token shape and TTL constants", () => {
  test("32 random bytes; TTL exactly 900 s", () => {
    assert.equal(CONFIRMATION_TOKEN_BYTES, 32);
    assert.equal(CONFIRMATION_TOKEN_TTL_MS, 900_000);
  });
});

describe("supersession is checked with consumption, before expiry (A2-D4)", () => {
  const binding = { uid: "u1", familyId: "f1", action: "families.close", familyEpoch: 1 } as const;
  const rec: ConfirmationRecord = { ...binding, issuedAtMillis: T0, expiresAtMillis: T0 + CONFIRMATION_TOKEN_TTL_MS, consumedAtMillis: null };
  test("a superseded token is CONFIRMATION_REQUIRED, even when it is also expired", () => {
    assert.deepEqual(checkConfirmation(rec, binding, T0, true), { ok: false, code: "CONFIRMATION_REQUIRED" });
    assert.deepEqual(checkConfirmation(rec, binding, T0 + CONFIRMATION_TOKEN_TTL_MS, true), { ok: false, code: "CONFIRMATION_REQUIRED" });
  });
  test("the active token is valid at expiresAt - 1 ms and EXPIRED at expiresAt", () => {
    assert.deepEqual(checkConfirmation(rec, binding, T0 + CONFIRMATION_TOKEN_TTL_MS - 1, false), { ok: true });
    assert.deepEqual(checkConfirmation(rec, binding, T0 + CONFIRMATION_TOKEN_TTL_MS, false), { ok: false, code: "CONFIRMATION_EXPIRED" });
  });
});

describe("recent sign-in (sprint policy, 5 minutes)", () => {
  const s = Math.floor(T0 / 1000);
  test("boundary: age 0 and age 5 min - 1 ms pass; age 5 min fails", () => {
    assert.equal(RECENT_AUTH_MAX_AGE_MS, 300_000);
    assert.equal(isRecentAuth(s, T0), true);
    assert.equal(isRecentAuth(s, T0 + RECENT_AUTH_MAX_AGE_MS - 1), true);
    assert.equal(isRecentAuth(s, T0 + RECENT_AUTH_MAX_AGE_MS), false);
    assert.equal(isRecentAuth(s - 3600, T0), false);
  });
  test("missing, future, negative or non-integer auth_time fails", () => {
    assert.equal(isRecentAuth(undefined, T0), false);
    assert.equal(isRecentAuth(s + 1, T0), false);
    assert.equal(isRecentAuth(-1, T0), false);
    assert.equal(isRecentAuth(s + 0.5, T0), false);
    assert.equal(isRecentAuth(Number.NaN, T0), false);
  });
  test("the adapter takes auth_time only from the verified token, and only as a safe integer", () => {
    const tok = (auth_time: unknown) => authenticate({ auth: { uid: "u1", token: { email_verified: true, auth_time } }, data: { auth_time: s } });
    assert.equal(tok(s).authTimeSeconds, s);
    for (const bad of ["1700000000", 1.5, null, undefined, {}, Number.MAX_SAFE_INTEGER + 2]) {
      assert.equal("authTimeSeconds" in tok(bad), false, `auth_time ${String(bad)}`);
    }
  });
});

describe("issuance throttle (sprint policy, 5 per family per rolling 15 minutes)", () => {
  test("fifth issuance allowed, sixth refused; the window rolls", () => {
    assert.equal(ISSUANCE_LIMIT, 5);
    assert.equal(ISSUANCE_WINDOW_MS, 900_000);
    const four = [T0, T0 + 1, T0 + 2, T0 + 3];
    assert.equal(issuanceAllowed(four, T0 + 10), true);
    const five = [...four, T0 + 4];
    assert.equal(issuanceAllowed(five, T0 + 10), false);
    // The oldest leaves the window exactly 15 minutes after it was issued.
    assert.equal(issuanceAllowed(five, T0 + ISSUANCE_WINDOW_MS - 1), false);
    assert.equal(issuanceAllowed(five, T0 + ISSUANCE_WINDOW_MS), true);
    assert.deepEqual(issuancesInWindow(five, T0 + ISSUANCE_WINDOW_MS), [T0 + 1, T0 + 2, T0 + 3, T0 + 4]);
  });
  test("future-dated entries still count (fail closed)", () => {
    assert.equal(issuanceAllowed([T0 + 5, T0 + 6, T0 + 7, T0 + 8, T0 + 9], T0), false);
  });
});

describe("handler steps before Firestore (no read, no write, no token)", () => {
  test("local-only barrier: refuses outside the emulator or outside a demo- project", async () => {
    for (const env of [
      {},
      { FUNCTIONS_EMULATOR: "true" },
      { GCLOUD_PROJECT: "demo-newbaileyscart" },
      { FUNCTIONS_EMULATOR: "false", GCLOUD_PROJECT: "demo-newbaileyscart" },
      { FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "newbaileyscart-prod" },
      { FUNCTIONS_EMULATOR: "TRUE", GCLOUD_PROJECT: "demo-x" },
    ]) {
      const h = handler(env);
      await rejects(h.run(owner, valid), "INTERNAL");
      assert.equal(h.fake.transactionOptions.length, 0, JSON.stringify(env));
    }
  });
  test("unverified email, stale/missing/future auth_time and invalid input are rejected first", async () => {
    const cases: [typeof owner | { uid: string; emailVerified: boolean; authTimeSeconds?: number }, unknown, DomainErrorCode][] = [
      [{ ...owner, emailVerified: false }, valid, "EMAIL_VERIFICATION_REQUIRED"],
      [{ uid: "u1", emailVerified: true }, valid, "UNAUTHENTICATED"],
      [{ ...owner, authTimeSeconds: owner.authTimeSeconds - 300 }, valid, "UNAUTHENTICATED"],
      [{ ...owner, authTimeSeconds: owner.authTimeSeconds + 1 }, valid, "UNAUTHENTICATED"],
      [owner, { ...valid, familyEpoch: 1 }, "VALIDATION_FAILED"],
      [owner, { ...valid, action: "DELETE" }, "VALIDATION_FAILED"],
    ];
    for (const [actor, data, code] of cases) {
      const h = handler(DEMO_ENV);
      await rejects(h.run(actor, data), code);
      assert.equal(h.fake.transactionOptions.length, 0, code);
    }
  });
  test("a valid request reaches one transaction with maxAttempts 10", async () => {
    const h = handler(DEMO_ENV);
    await rejects(h.run(owner, valid), "NOT_FOUND");
    assert.deepEqual(h.fake.transactionOptions, [{ maxAttempts: 10 }]);
    assert.deepEqual(h.fake.transactionWrites, []);
  });
});
