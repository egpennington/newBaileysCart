/**
 * D3 (local): familiesPrepareLifecycleConfirmation deployed to the Functions emulator and invoked with
 * the official modular client SDK by signed-in emulator identities, end to end with familiesClose and
 * familiesWaiveRecovery (PL-PP-WP03-32 D3). Tokens come only from the public issuer here.
 *
 * Limits (stated, not hidden): the emulator does not verify ID-token signatures (W-01 D-5), so the
 * recent-sign-in cases use unsigned tokens sent over raw HTTP; they prove the server reads auth_time
 * from the token and rejects stale/future values, not production token verification. App Check is not
 * enforced (W-01 D-4). No Android, Play or cloud evidence.
 */
import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp } from "@firebase/app";
import type { FirebaseApp } from "@firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from "@firebase/auth";
import type { Auth, User } from "@firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "@firebase/functions";
import type { Functions } from "@firebase/functions";
import { AUTH_HOST, PROJECT, adminAuth, db, newOpId } from "../support/emulator.js";

const REGION = "us-central1";
const FN_BASE = `http://127.0.0.1:5001/${PROJECT}/${REGION}`;

let app: FirebaseApp;
let auth: Auth;
let functions: Functions;

interface SdkRejection {
  code: string;
  details: { apiVersion: string; opId: string | null; status: string; error: { code: string; retryable: boolean; details: Record<string, unknown> } };
}
type Result = { ok: true; data: Record<string, unknown> } | { ok: false; err: SdkRejection };

async function call(name: string, data: unknown): Promise<Result> {
  try {
    return { ok: true, data: (await httpsCallable(functions, name)(data)).data as Record<string, unknown> };
  } catch (err) {
    return { ok: false, err: err as SdkRejection };
  }
}

function rejected(r: Result, sdkCode: string, domainCode: string, opId: string | null): SdkRejection {
  assert.equal(r.ok, false, `expected ${domainCode}`);
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.err.code, `functions/${sdkCode}`);
  assert.equal(r.err.details.status, "REJECTED");
  assert.equal(r.err.details.opId, opId);
  assert.equal(r.err.details.error.code, domainCode);
  return r.err;
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

async function newFamily(): Promise<string> {
  return committed(await call("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: {} }))["familyId"] as string;
}

const prep = (familyId: string, action: string, opId = newOpId()) => ({ apiVersion: "v0.4", opId, familyId, action });

/** Unsigned emulator ID token with a chosen auth_time (W-01 D-5: the emulator does not verify it). */
function unsignedToken(uid: string, authTimeSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: authTimeSeconds,
    email_verified: true,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

async function rawCall(name: string, idToken: string, data: unknown): Promise<{ status: number; body: { error?: { status: string; details: { error: { code: string } } } } }> {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: (await res.json()) as never };
}

before(() => {
  app = initializeApp({ projectId: PROJECT, apiKey: "demo-api-key", appId: "demo-e2e-prepare" }, "e2e-prepare");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
});

after(async () => {
  await signOut(auth);
  await deleteApp(app);
});

describe("familiesPrepareLifecycleConfirmation over the callable wire (D3 local)", () => {
  test("prepare CLOSE -> close; prepare WAIVE_RECOVERY -> waive; envelopes and token shape", async () => {
    const owner = await signUp("pc-owner");
    const familyId = await newFamily();
    const req = prep(familyId, "CLOSE");
    const r = await call("familiesPrepareLifecycleConfirmation", req);
    assert.ok(r.ok);
    assert.equal(r.data["opId"], req.opId);
    const d = committed(r);
    assert.deepEqual(Object.keys(d).sort(), ["action", "confirmationToken", "expiresAt", "familyEpoch", "familyId"]);
    const token = d["confirmationToken"] as string;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Date.parse(d["expiresAt"] as string) - Date.parse(r.data["serverTime"] as string), 900_000);
    assert.deepEqual([d["action"], d["familyId"], d["familyEpoch"]], ["CLOSE", familyId, 1]);

    const close = committed(await call("familiesClose", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 1, confirmationToken: token }));
    assert.equal(close["lifecycleState"], "CLOSING");
    // Single use across the wire.
    const op = newOpId();
    rejected(await call("familiesClose", { apiVersion: "v0.4", opId: op, familyId, familyEpoch: 1, confirmationToken: token }), "failed-precondition", "FAMILY_CLOSING", op);

    const w = committed(await call("familiesPrepareLifecycleConfirmation", prep(familyId, "WAIVE_RECOVERY")));
    assert.equal(w["action"], "WAIVE_RECOVERY");
    const waived = committed(await call("familiesWaiveRecovery", { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 1, confirmationToken: w["confirmationToken"] }));
    assert.equal(waived["disposition"], "DELETION_PENDING");
    assert.ok(owner.uid);
  });

  test("same-opId retry: CONFIRMATION_REQUIRED, retryable false, empty details, no token; changed payload reused", async () => {
    await signUp("pc-retry");
    const familyId = await newFamily();
    const req = prep(familyId, "CLOSE");
    const first = committed(await call("familiesPrepareLifecycleConfirmation", req));
    const err = rejected(await call("familiesPrepareLifecycleConfirmation", req), "failed-precondition", "CONFIRMATION_REQUIRED", req.opId);
    assert.equal(err.details.error.retryable, false);
    assert.deepEqual(err.details.error.details, {});
    assert.ok(!JSON.stringify(err).includes(first["confirmationToken"] as string));
    const op = newOpId();
    rejected(
      await call("familiesClose", { apiVersion: "v0.4", opId: op, familyId, familyEpoch: 1, confirmationToken: first["confirmationToken"] }),
      "failed-precondition",
      "CONFIRMATION_REQUIRED",
      op,
    );
    rejected(await call("familiesPrepareLifecycleConfirmation", { ...req, action: "WAIVE_RECOVERY" }), "invalid-argument", "IDEMPOTENCY_KEY_REUSED", req.opId);
  });

  test("superseded token over the wire; non-owner, unauthenticated, invalid input", async () => {
    const owner = await signUp("pc-sup");
    const familyId = await newFamily();
    const a = committed(await call("familiesPrepareLifecycleConfirmation", prep(familyId, "CLOSE")))["confirmationToken"];
    const b = committed(await call("familiesPrepareLifecycleConfirmation", prep(familyId, "CLOSE")))["confirmationToken"];
    const op = newOpId();
    rejected(await call("familiesClose", { apiVersion: "v0.4", opId: op, familyId, familyEpoch: 1, confirmationToken: a }), "failed-precondition", "CONFIRMATION_REQUIRED", op);

    const tokensBefore = (await db.collection("confirmationTokens").where("familyId", "==", familyId).get()).size;
    await signUp("pc-intruder");
    const ir = prep(familyId, "CLOSE");
    rejected(await call("familiesPrepareLifecycleConfirmation", ir), "permission-denied", "OWNER_REQUIRED", ir.opId);
    const bad = prep(familyId, "close");
    rejected(await call("familiesPrepareLifecycleConfirmation", bad), "invalid-argument", "VALIDATION_FAILED", bad.opId);
    const epoch = { ...prep(familyId, "CLOSE"), familyEpoch: 1 };
    rejected(await call("familiesPrepareLifecycleConfirmation", epoch), "invalid-argument", "VALIDATION_FAILED", epoch.opId);
    await signOut(auth);
    const un = prep(familyId, "CLOSE");
    rejected(await call("familiesPrepareLifecycleConfirmation", un), "unauthenticated", "UNAUTHENTICATED", un.opId);
    assert.equal((await db.collection("confirmationTokens").where("familyId", "==", familyId).get()).size, tokensBefore, "no token for any denial");

    // The owner's newest token is still the valid one.
    await signOut(auth);
    assert.ok(owner.uid);
    const ownerToken = unsignedToken(owner.uid, Math.floor(Date.now() / 1000));
    const res = await rawCall("familiesClose", ownerToken, { apiVersion: "v0.4", opId: newOpId(), familyId, familyEpoch: 1, confirmationToken: b });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("recent sign-in is read from the ID token: stale (5 min) and future auth_time are UNAUTHENTICATED", async () => {
    const owner = await signUp("pc-auth");
    const familyId = await newFamily();
    await signOut(auth);
    const now = Math.floor(Date.now() / 1000);
    for (const t of [now - 301, now - 3600, now + 120]) {
      const res = await rawCall("familiesPrepareLifecycleConfirmation", unsignedToken(owner.uid, t), prep(familyId, "CLOSE"));
      assert.equal(res.status, 401, `auth_time ${t - now}s`);
      assert.equal(res.body.error?.details.error.code, "UNAUTHENTICATED");
    }
    assert.equal((await db.collection("confirmationTokens").where("familyId", "==", familyId).get()).size, 0);
    const ok = await rawCall("familiesPrepareLifecycleConfirmation", unsignedToken(owner.uid, now - 5), prep(familyId, "CLOSE"));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});
