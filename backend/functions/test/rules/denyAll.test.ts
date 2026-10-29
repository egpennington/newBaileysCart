/**
 * D2 rules: every client read, list, query and write is denied (PL-PP-WP03-14 partial).
 * Uses the Firestore emulator REST API with unsigned test tokens instead of
 * @firebase/rules-unit-testing, which would add the full `firebase` JS SDK (W-01 D-11).
 * The emulator does not verify token signatures (W-01 D-5): these tests prove rule
 * evaluation, not production token verification.
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { FIRESTORE_HOST, PROJECT, clearFirestore, db } from "../support/emulator.js";

const BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = "rules-owner";
const FAMILY = "rules-family";

function unsignedToken(uid: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    email: `${uid}@example.com`,
    email_verified: true,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

const callers: Record<string, string | null> = {
  unauthenticated: null,
  "the owner": OWNER,
  "another user": "rules-stranger",
};

async function call(method: string, url: string, token: string | null, body?: unknown): Promise<number> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  await res.text();
  return res.status;
}

const seeded: Record<string, Record<string, unknown>> = {
  [`families/${FAMILY}`]: { ownerUid: OWNER, lifecycleState: "ACTIVE", familyEpoch: 1 },
  [`families/${FAMILY}/members/${OWNER}`]: { role: "OWNER", state: "ACTIVE" },
  [`users/${OWNER}`]: { ownedFamilyId: FAMILY },
  [`users/${OWNER}/memberships/${FAMILY}`]: { role: "OWNER", state: "ACTIVE" },
  [`trialLedger/${OWNER}`]: { familyId: FAMILY, consumedAt: Timestamp.fromMillis(0) },
  ["idempotency/rules-key"]: { actorUid: OWNER, responseJson: "{}" },
};

before(async () => {
  await clearFirestore();
  for (const [path, data] of Object.entries(seeded)) await db.doc(path).set(data);
});

describe("firestore.rules: deny all direct client access", () => {
  for (const [who, uid] of Object.entries(callers)) {
    const token = uid ? unsignedToken(uid) : null;
    describe(`as ${who}`, () => {
      for (const path of Object.keys(seeded)) {
        test(`get ${path} denied`, async () => assert.equal(await call("GET", `${BASE}/${path}`, token), 403));
        test(`update ${path} denied`, async () =>
          assert.equal(await call("PATCH", `${BASE}/${path}`, token, { fields: { hacked: { booleanValue: true } } }), 403));
        test(`delete ${path} denied`, async () => assert.equal(await call("DELETE", `${BASE}/${path}`, token), 403));
      }
      for (const collection of ["families", `families/${FAMILY}/members`, "users", `users/${OWNER}/memberships`, "trialLedger", "idempotency"]) {
        test(`list ${collection} denied`, async () => assert.equal(await call("GET", `${BASE}/${collection}`, token), 403));
        test(`create in ${collection} denied`, async () =>
          assert.equal(await call("POST", `${BASE}/${collection}`, token, { fields: { x: { stringValue: "y" } } }), 403));
      }
      test("collection-group query on members denied", async () =>
        assert.equal(
          await call("POST", `${BASE}:runQuery`, token, {
            structuredQuery: { from: [{ collectionId: "members", allDescendants: true }] },
          }),
          403,
        ));
      test("write to an unlisted collection denied", async () =>
        assert.equal(await call("POST", `${BASE}/anything`, token, { fields: {} }), 403));
    });
  }

  test("seeded data is unchanged after all attempts", async () => {
    for (const [path, data] of Object.entries(seeded)) {
      assert.deepEqual((await db.doc(path).get()).data(), data, path);
    }
    assert.equal((await db.collection("anything").get()).size, 0);
  });
});
