/**
 * D3: the deployed-to-emulator callables, invoked through the official modular client SDK
 * (@firebase/app, @firebase/auth, @firebase/functions) and as raw HTTP. Asserts the W-01
 * wire contract: success envelope under `result`, rejections as HttpsError carrying the
 * API v0.4 envelope in `details`. Clients branch on details.error.code, never HTTP status.
 */
import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp } from "@firebase/app";
import type { FirebaseApp } from "@firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from "@firebase/auth";
import type { Auth, User } from "@firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "@firebase/functions";
import type { Functions } from "@firebase/functions";
import { assertSessionDataConformsToA1 } from "../support/a1Schema.js";
import { AUTH_HOST, PROJECT, adminAuth, clearAuth, clearFirestore, db, newOpId } from "../support/emulator.js";

const FUNCTIONS_ORIGIN = "http://127.0.0.1:5001";
const REGION = "us-central1";
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let app: FirebaseApp;
let auth: Auth;
let functions: Functions;

interface SdkRejection {
  code: string;
  details: { apiVersion: string; opId: string | null; status: string; error: { code: string; retryable: boolean } };
}

async function callSdk(name: string, data: unknown): Promise<{ ok: true; data: unknown } | { ok: false; err: SdkRejection }> {
  try {
    return { ok: true, data: (await httpsCallable(functions, name)(data)).data };
  } catch (err) {
    return { ok: false, err: err as SdkRejection };
  }
}

async function callRaw(name: string, data: unknown, idToken?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(`${FUNCTIONS_ORIGIN}/${PROJECT}/${REGION}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: await res.json() };
}

async function signUp(label: string, verify: boolean): Promise<User> {
  await signOut(auth);
  const cred = await createUserWithEmailAndPassword(auth, `${label}-${newOpId().slice(0, 8)}@example.com`, "e2e-password-1");
  if (verify) {
    await adminAuth.updateUser(cred.user.uid, { emailVerified: true });
    await cred.user.getIdToken(true);
  }
  return cred.user;
}

before(async () => {
  await clearFirestore();
  await clearAuth();
  app = initializeApp({ projectId: PROJECT, apiKey: "demo-api-key", appId: "demo-e2e-app" }, "e2e");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
});

after(async () => {
  await signOut(auth);
  await deleteApp(app);
});

describe("families.create over the callable wire", () => {
  test("unauthenticated: functions/unauthenticated with UNAUTHENTICATED envelope", async () => {
    await signOut(auth);
    const opId = newOpId();
    const r = await callSdk("familiesCreate", { apiVersion: "v0.4", opId, payload: {} });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.err.code, "functions/unauthenticated");
    assert.deepEqual(r.err.details, {
      apiVersion: "v0.4",
      opId,
      status: "REJECTED",
      error: { code: "UNAUTHENTICATED", retryable: false, details: {} },
    });
  });

  test("unverified email: functions/failed-precondition with EMAIL_VERIFICATION_REQUIRED", async () => {
    const user = await signUp("unverified", false);
    const r = await callSdk("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.err.code, "functions/failed-precondition");
    assert.equal(r.err.details.error.code, "EMAIL_VERIFICATION_REQUIRED");
    assert.equal((await db.doc(`users/${user.uid}`).get()).exists, false);
  });

  test("body cannot claim verification: email_verified in payload is rejected as unknown", async () => {
    await signUp("bodyclaim", false);
    const r = await callSdk("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: { email_verified: true } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.err.details.error.code, "VALIDATION_FAILED");
  });

  test("malformed opId: invalid-argument, VALIDATION_FAILED, opId not echoed", async () => {
    await signUp("badop", true);
    const r = await callSdk("familiesCreate", { apiVersion: "v0.4", opId: "not-a-uuid", payload: {} });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.err.code, "functions/invalid-argument");
    assert.equal(r.err.details.error.code, "VALIDATION_FAILED");
    assert.equal(r.err.details.opId, null);
  });

  test("verified create, replay, owner limit, and session, end to end", async () => {
    const user = await signUp("owner", true);
    const opId = newOpId();
    const request = { apiVersion: "v0.4", opId, payload: { displayName: " E2E Family " } };

    const created = await callSdk("familiesCreate", request);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const env = created.data as {
      apiVersion: string;
      opId: string;
      status: string;
      serverTime: string;
      data: Record<string, unknown>;
    };
    assert.equal(env.apiVersion, "v0.4");
    assert.equal(env.opId, opId);
    assert.equal(env.status, "COMMITTED");
    assert.match(env.serverTime, RFC3339_UTC);
    assert.equal(env.data["lifecycleState"], "ACTIVE");
    assert.equal(env.data["familyEpoch"], 1);
    assert.equal(env.data["displayName"], "E2E Family");
    assert.match(env.data["trialStartedAt"] as string, RFC3339_UTC);
    assert.equal(
      Date.parse(env.data["trialEndsAt"] as string) - Date.parse(env.data["trialStartedAt"] as string),
      21 * 86_400_000,
    );

    const replay = await callSdk("familiesCreate", request);
    assert.deepEqual(replay, created);

    const again = await callSdk("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    assert.equal(again.ok, false);
    if (!again.ok) {
      assert.equal(again.err.code, "functions/failed-precondition");
      assert.equal(again.err.details.error.code, "OWNER_ALREADY_HAS_FAMILY");
    }

    const reused = await callSdk("familiesCreate", { ...request, payload: { displayName: "Changed" } });
    assert.equal(reused.ok, false);
    if (!reused.ok) {
      assert.equal(reused.err.code, "functions/invalid-argument");
      assert.equal(reused.err.details.error.code, "IDEMPOTENCY_KEY_REUSED");
    }

    const session = await callSdk("accountGetSession", { apiVersion: "v0.4" });
    assert.equal(session.ok, true);
    if (!session.ok) return;
    const s = (session.data as { data: Record<string, unknown> }).data;
    assertSessionDataConformsToA1(s); // T-GAP-1, over the callable wire
    assert.equal(s["ownedFamilyId"], env.data["familyId"]);
    assert.equal(s["trialEligible"], false);
    assert.equal((await db.doc(`users/${user.uid}`).get()).get("ownedFamilyId"), env.data["familyId"]);
  });
});

describe("email verification over the callable wire", () => {
  test("rejected while unverified, then verified: the same opId commits, then replays (A1 §A1.4; R-1 case 3; T-GAP-4)", async () => {
    const user = await signUp("verifylater", false);
    const request = { apiVersion: "v0.4", opId: newOpId(), payload: {} };

    const rejected = await callSdk("familiesCreate", request);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.err.code, "functions/failed-precondition");
    assert.equal(rejected.err.details.error.code, "EMAIL_VERIFICATION_REQUIRED");

    await adminAuth.updateUser(user.uid, { emailVerified: true });
    await user.getIdToken(true);
    const committed = await callSdk("familiesCreate", request);
    assert.equal(committed.ok, true);
    if (!committed.ok) return;
    const env = committed.data as { opId: string; status: string; data: { familyId: string; lifecycleState: string } };
    assert.equal(env.status, "COMMITTED");
    assert.equal(env.opId, request.opId);
    assert.equal(env.data.lifecycleState, "ACTIVE");

    assert.deepEqual(await callSdk("familiesCreate", request), committed);
    assert.equal((await db.collection("families").where("ownerUid", "==", user.uid).get()).size, 1);
  });

  test("account.getSession succeeds for an unverified caller (A1 §A1.5; T-GAP-5)", async () => {
    await signUp("sessionunverified", false);
    const r = await callSdk("accountGetSession", { apiVersion: "v0.4" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const env = r.data as { status: string; opId: string | null; data: unknown };
    assert.equal(env.status, "COMMITTED");
    assert.equal(env.opId, null);
    assertSessionDataConformsToA1(env.data); // T-GAP-1, over the callable wire
    assert.deepEqual(env.data, { ownedFamilyId: null, joinedFamilies: [], trialEligible: true, selectedFamilySuggestion: null });
  });
});

describe("raw wire shape (W-01 D-1, D-2, D-3)", () => {
  test("success: HTTP 200 with the v0.4 envelope under result", async () => {
    const user = await signUp("raw", true);
    const token = await user.getIdToken();
    const opId = newOpId();
    const r = await callRaw("familiesCreate", { apiVersion: "v0.4", opId, payload: {} }, token);
    assert.equal(r.status, 200);
    const result = (r.body as { result: { opId: string; status: string } }).result;
    assert.equal(result.opId, opId);
    assert.equal(result.status, "COMMITTED");
  });

  test("rejection: error.status canonical, error.details is the v0.4 envelope", async () => {
    const user = await signUp("rawerr", false);
    const opId = newOpId();
    const r = await callRaw("familiesCreate", { apiVersion: "v0.4", opId, payload: {} }, await user.getIdToken());
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, {
      error: {
        message: "Email verification required.",
        status: "FAILED_PRECONDITION",
        details: {
          apiVersion: "v0.4",
          opId,
          status: "REJECTED",
          error: { code: "EMAIL_VERIFICATION_REQUIRED", retryable: false, details: {} },
        },
      },
    });
  });

  test("shared HTTP 400: domain code distinguishes VALIDATION_FAILED from EMAIL_VERIFICATION_REQUIRED", async () => {
    const user = await signUp("shared", true);
    const r = await callRaw("familiesCreate", { apiVersion: "v0.3" }, await user.getIdToken());
    assert.equal(r.status, 400);
    const err = (r.body as { error: { status: string; details: { error: { code: string } } } }).error;
    assert.equal(err.status, "INVALID_ARGUMENT");
    assert.equal(err.details.error.code, "API_VERSION_UNSUPPORTED");
  });

  test("garbage bearer token (emulator accepts it, W-01 D-5): adapter fails closed with UNAUTHENTICATED", async () => {
    const r = await callRaw("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: {} }, "garbage");
    assert.equal(r.status, 401);
    const err = (r.body as { error: { status: string; details: { error: { code: string } } } }).error;
    assert.equal(err.status, "UNAUTHENTICATED");
    assert.equal(err.details.error.code, "UNAUTHENTICATED");
  });

  test("getSession without auth: UNAUTHENTICATED", async () => {
    const r = await callRaw("accountGetSession", { apiVersion: "v0.4" });
    assert.equal(r.status, 401);
  });
});

describe("account.getSession over malformed storage, over the wire (HB-1, HB-3; PL decision 2026-10-31)", () => {
  test("a corrupt owned family fails closed: functions/internal, retryable INTERNAL, no record data", async () => {
    const user = await signUp("hbwire", true);
    const created = await callSdk("familiesCreate", { apiVersion: "v0.4", opId: newOpId(), payload: { displayName: "Wire Home" } });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const familyId = (created.data as { data: { familyId: string } }).data.familyId;
    // Fixture only (Admin SDK): the owned family loses its lifecycle state (HB-1 trigger).
    await db.doc(`families/${familyId}`).update({ lifecycleState: null });

    const opId = newOpId();
    const r = await callRaw("accountGetSession", { apiVersion: "v0.4", opId }, await user.getIdToken());
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, {
      error: {
        message: "Internal error.",
        status: "INTERNAL",
        details: { apiVersion: "v0.4", opId, status: "REJECTED", error: { code: "INTERNAL", retryable: true, details: {} } },
      },
    });
    const wire = JSON.stringify(r.body);
    for (const leak of [familyId, user.uid, "Wire Home", "lifecycleState"]) assert.ok(!wire.includes(leak), `wire leaks ${leak}`);

    const sdk = await callSdk("accountGetSession", { apiVersion: "v0.4" });
    assert.equal(sdk.ok, false);
    if (sdk.ok) return;
    assert.equal(sdk.err.code, "functions/internal");
    assert.equal(sdk.err.details.error.code, "INTERNAL");
  });
});
