/**
 * D3 (local): the Slice 3 lifecycle callables deployed to the Functions emulator, invoked through
 * the official modular client SDK with signed-in emulator identities. Asserts the W-01 wire contract
 * (success envelope under `result`; rejections as HttpsError with the API v0.4 envelope in
 * `details`) for familiesClose, familiesGetClosureStatus, familiesRestore and familiesWaiveRecovery.
 *
 * Limits (stated, not hidden): the emulator does not verify token signatures (W-01 D-5); the billing
 * provider in the emulator is the deterministic fake; confirmation tokens are seeded server-side with
 * the Admin SDK because R-04 defines no token-issuing endpoint. No Android, Play or cloud evidence.
 */
import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp } from "@firebase/app";
import type { FirebaseApp } from "@firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from "@firebase/auth";
import type { Auth, User } from "@firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "@firebase/functions";
import type { Functions } from "@firebase/functions";
import type { ConfirmationAction } from "../../src/domain/confirmation.js";
import { issueConfirmationToken } from "../../src/persistence/lifecycleStore.js";
import { assertSessionDataConformsToA1, SLICE3_LIFECYCLE_STATES } from "../support/a1Schema.js";
import { AUTH_HOST, PROJECT, adminAuth, db, newOpId } from "../support/emulator.js";

const REGION = "us-central1";

let app: FirebaseApp;
let auth: Auth;
let functions: Functions;

interface SdkRejection {
  code: string;
  details: { apiVersion: string; opId: string | null; status: string; error: { code: string; retryable: boolean } };
}
type Result = { ok: true; data: Record<string, unknown> } | { ok: false; err: SdkRejection };

async function call(name: string, data: unknown): Promise<Result> {
  try {
    return { ok: true, data: (await httpsCallable(functions, name)(data)).data as Record<string, unknown> };
  } catch (err) {
    return { ok: false, err: err as SdkRejection };
  }
}

function rejected(r: Result, sdkCode: string, domainCode: string, opId: string | null): void {
  assert.equal(r.ok, false, `expected ${domainCode}`);
  if (r.ok) return;
  assert.equal(r.err.code, `functions/${sdkCode}`);
  assert.equal(r.err.details.status, "REJECTED");
  assert.equal(r.err.details.apiVersion, "v0.4");
  assert.equal(r.err.details.opId, opId);
  assert.equal(r.err.details.error.code, domainCode);
}

function committed(r: Result): Record<string, unknown> {
  assert.ok(r.ok, r.ok ? "" : `rejected: ${JSON.stringify(r.err.details)}`);
  assert.equal(r.data["status"], "COMMITTED");
  assert.equal(r.data["apiVersion"], "v0.4");
  return r.data["data"] as Record<string, unknown>;
}

async function signUp(label: string): Promise<User> {
  await signOut(auth);
  const cred = await createUserWithEmailAndPassword(auth, `${label}-${newOpId().slice(0, 8)}@example.com`, "e2e-password-1");
  await adminAuth.updateUser(cred.user.uid, { emailVerified: true });
  await cred.user.getIdToken(true);
  return cred.user;
}

async function token(uid: string, familyId: string, action: ConfirmationAction, familyEpoch: number): Promise<string> {
  return (await issueConfirmationToken(db, Date.now(), { uid, familyId, action, familyEpoch })).token;
}

async function newFamily(): Promise<string> {
  const d = committed(await call("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: {} }));
  return d["familyId"] as string;
}

before(() => {
  app = initializeApp({ projectId: PROJECT, apiKey: "demo-api-key", appId: "demo-e2e-lifecycle" }, "e2e-lifecycle");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
});

after(async () => {
  await signOut(auth);
  await deleteApp(app);
});

describe("Slice 3 lifecycle over the callable wire (D3 local)", () => {
  test("close -> status -> restore -> stale epoch -> re-close -> waive -> new reservation", async () => {
    const owner = await signUp("lc-owner");
    const familyId = await newFamily();

    const closeOp = newOpId();
    const closeReq = { apiVersion: "v0.4", opId: closeOp, familyId, familyEpoch: 1, confirmationToken: await token(owner.uid, familyId, "families.close", 1) };
    const closed = committed(await call("familiesClose", closeReq));
    assert.equal(closed["lifecycleState"], "CLOSING");
    assert.equal(closed["cancellationStatus"], "NOT_REQUIRED");
    assert.match(String(closed["recoverUntilAt"]), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const replay = await call("familiesClose", closeReq);
    assert.deepEqual(replay.ok && replay.data["data"], closed, "replay over the wire is logically identical");

    const session = committed(await call("accountGetSession", { apiVersion: "v0.4" }));
    assertSessionDataConformsToA1(session, SLICE3_LIFECYCLE_STATES);

    const status = committed(await call("familiesGetClosureStatus", { apiVersion: "v0.4", familyId }));
    assert.equal(status["closureStatus"], "RECOVERY_AVAILABLE");

    const restored = committed(await call("familiesRestore", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 1 }));
    assert.equal(restored["familyEpoch"], 2);
    assert.equal(restored["accessMode"], "READ_WRITE");

    const staleOp = newOpId();
    rejected(
      await call("familiesClose", { apiVersion: "v0.4", opId: staleOp, familyId, familyEpoch: 1, confirmationToken: await token(owner.uid, familyId, "families.close", 1) }),
      "failed-precondition",
      "STALE_EPOCH_REJECTED",
      staleOp,
    );

    committed(await call("familiesClose", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 2, confirmationToken: await token(owner.uid, familyId, "families.close", 2) }));
    const waived = committed(
      await call("familiesWaiveRecovery", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 2, confirmationToken: await token(owner.uid, familyId, "families.waiveRecovery", 2) }),
    );
    assert.equal(waived["disposition"], "DELETION_PENDING");
    const restoreOp = newOpId();
    rejected(await call("familiesRestore", { apiVersion: "v0.4", opId: restoreOp, familyId, familyEpoch: 2 }), "failed-precondition", "RECOVERY_ALREADY_WAIVED", restoreOp);

    const next = committed(await call("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: {} }));
    assert.equal(next["lifecycleState"], "UNENTITLED_AWAITING_PAYMENT", "trial stays consumed after release");
  });

  test("paid family: pending cancellation, restore refused, waiver intent only", async () => {
    const owner = await signUp("lc-paid");
    const familyId = await newFamily();
    await db.doc(`familyBilling/${familyId}`).set({ purchaseState: "ACTIVE", purchaseRef: `fake-paid-${familyId}` });
    const closed = committed(
      await call("familiesClose", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 1, confirmationToken: await token(owner.uid, familyId, "families.close", 1) }),
    );
    assert.equal(closed["lifecycleState"], "CLOSURE_PENDING_BILLING");
    const op = newOpId();
    rejected(await call("familiesRestore", { apiVersion: "v0.4", opId: op, familyId, familyEpoch: 1 }), "failed-precondition", "CLOSURE_CANCELLATION_IN_PROGRESS", op);
    const waived = committed(
      await call("familiesWaiveRecovery", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 1, confirmationToken: await token(owner.uid, familyId, "families.waiveRecovery", 1) }),
    );
    assert.equal(waived["disposition"], "WAIVER_RECORDED_PENDING_BILLING");
    const status = committed(await call("familiesGetClosureStatus", { apiVersion: "v0.4", familyId }));
    assert.deepEqual(status, { familyId, lifecycleState: "CLOSURE_PENDING_BILLING", closureStatus: "PROCESSING_CANCELLATION", waiverRecorded: true });
  });

  test("authorization and confirmation rejections map to the proposed transport codes", async () => {
    const owner = await signUp("lc-auth-owner");
    const familyId = await newFamily();
    const ownerToken = await token(owner.uid, familyId, "families.close", 1);

    const intruder = await signUp("lc-auth-intruder");
    const op1 = newOpId();
    rejected(
      await call("familiesClose", { apiVersion: "v0.4", opId: op1, familyId, familyEpoch: 1, confirmationToken: await token(intruder.uid, familyId, "families.close", 1) }),
      "permission-denied",
      "OWNER_REQUIRED",
      op1,
    );
    rejected(await call("familiesGetClosureStatus", { apiVersion: "v0.4", familyId }), "permission-denied", "OWNER_REQUIRED", null);
    rejected(await call("familiesGetClosureStatus", { apiVersion: "v0.4", familyId: "missingFamily0000000" }), "not-found", "NOT_FOUND", null);

    await signOut(auth);
    const op2 = newOpId();
    rejected(await call("familiesClose", { apiVersion: "v0.4", opId: op2, familyId, familyEpoch: 1, confirmationToken: ownerToken }), "unauthenticated", "UNAUTHENTICATED", op2);

    await signOut(auth);
    const cred = await createUserWithEmailAndPassword(auth, `lc-unverified-${newOpId().slice(0, 8)}@example.com`, "e2e-password-1");
    assert.ok(cred.user.uid);
    rejected(await call("familiesRestore", { nonsense: true }), "failed-precondition", "EMAIL_VERIFICATION_REQUIRED", null);

    // Owner again: a foreign-family token and a missing token.
    await signOut(auth);
    const owner2 = await signUp("lc-auth-owner2");
    const family2 = await newFamily();
    const op3 = newOpId();
    rejected(
      await call("familiesClose", { apiVersion: "v0.4", opId: op3, familyId: family2, familyEpoch: 1, confirmationToken: await token(owner2.uid, familyId, "families.close", 1) }),
      "failed-precondition",
      "CONFIRMATION_REQUIRED",
      op3,
    );
    const op4 = newOpId();
    rejected(await call("familiesClose", { apiVersion: "v0.4", opId: op4, familyId: family2, familyEpoch: 1 }), "invalid-argument", "VALIDATION_FAILED", op4);
  });
});
