/**
 * D2 rules: BC-FAMILY-SYNC-01 read model (Sync Contract Rev 2 §1). Only a signed-in user with a
 * verified email and an ACTIVE membership in an ACTIVE family may get/list that family's
 * `listItems` and get its `listMeta/current`. Everything else stays denied, and no client writes.
 * Same technique as denyAll.test.ts: Firestore emulator REST API with unsigned test tokens, so these
 * tests prove rule evaluation, not production token verification (W-01 D-5).
 */
import { strict as assert } from "node:assert";
import { before, describe, test } from "node:test";
import { FIRESTORE_HOST, PROJECT, clearFirestore, db } from "../support/emulator.js";

const BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const F = "readFamilyA";
const G = "readFamilyClosing";
const H = "readFamilyC";
const OWNER = "read-owner";
const MEMBER = "read-member";
const REVOKED = "read-revoked";
const ODD_STATE = "read-odd-state";
const C_OWNER = "read-c-owner";
const G_MEMBER = "read-g-member";
const ITEM = "11111111-1111-4111-8111-111111111111";

function token(uid: string, emailVerified = true): string {
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
    email_verified: emailVerified,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

async function call(method: string, path: string, bearer: string | null, body?: unknown): Promise<number> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path.startsWith("http") ? path : `${BASE}/${path}`, init);
  await res.text();
  return res.status;
}

const seeded: Record<string, Record<string, unknown>> = {
  [`families/${F}`]: { ownerUid: OWNER, lifecycleState: "ACTIVE", familyEpoch: 1 },
  [`families/${F}/members/${OWNER}`]: { role: "OWNER", state: "ACTIVE" },
  [`families/${F}/members/${MEMBER}`]: { role: "MEMBER", state: "ACTIVE" },
  [`families/${F}/members/${REVOKED}`]: { role: "MEMBER", state: "REVOKED" },
  // A membership document without an ACTIVE state (existence alone must not grant access).
  [`families/${F}/members/${ODD_STATE}`]: { role: "MEMBER" },
  [`families/${F}/listItems/${ITEM}`]: { name: "Milk", category: "DAIRY", checked: false, rev: 1 },
  [`families/${F}/listMeta/current`]: { familyEpoch: 1 },
  [`families/${F}/listMeta/other`]: { familyEpoch: 1 },
  [`families/${F}/items/${ITEM}`]: { name: "Milk", deleted: false, createdBy: OWNER },
  [`invites/rules-invite-hash`]: { familyId: F, familyEpoch: 1, consumedBy: null },
  [`families/${G}`]: { ownerUid: "read-g-owner", lifecycleState: "CLOSING", familyEpoch: 1, closureCaseId: "c" },
  [`families/${G}/members/${G_MEMBER}`]: { role: "MEMBER", state: "ACTIVE" },
  [`families/${G}/listItems/${ITEM}`]: { name: "G item", category: "MISC", checked: false, rev: 1 },
  [`families/${H}`]: { ownerUid: C_OWNER, lifecycleState: "ACTIVE", familyEpoch: 1 },
  [`families/${H}/members/${C_OWNER}`]: { role: "OWNER", state: "ACTIVE" },
  [`families/${H}/listItems/${ITEM}`]: { name: "C item", category: "MISC", checked: false, rev: 1 },
};

before(async () => {
  await clearFirestore();
  for (const [path, data] of Object.entries(seeded)) await db.doc(path).set(data);
});

describe("ACTIVE members of an ACTIVE family can read their own list", () => {
  for (const uid of [OWNER, MEMBER]) {
    test(`${uid}: get listItem, list listItems, get listMeta/current are allowed`, async () => {
      assert.equal(await call("GET", `families/${F}/listItems/${ITEM}`, token(uid)), 200);
      assert.equal(await call("GET", `families/${F}/listItems`, token(uid)), 200);
      assert.equal(await call("GET", `families/${F}/listMeta/current`, token(uid)), 200);
    });
  }
});

describe("everyone else is denied the family list", () => {
  const denied: Record<string, string | null> = {
    unauthenticated: null,
    "an unverified email (ACTIVE member)": token(MEMBER, false),
    "a REVOKED member": token(REVOKED),
    "a membership document without ACTIVE state": token(ODD_STATE),
    "household C (another family's owner)": token(C_OWNER),
    "a user with no membership at all": token("read-stranger"),
  };
  for (const [who, bearer] of Object.entries(denied)) {
    test(`${who}: get, list and listMeta denied`, async () => {
      assert.equal(await call("GET", `families/${F}/listItems/${ITEM}`, bearer), 403);
      assert.equal(await call("GET", `families/${F}/listItems`, bearer), 403);
      assert.equal(await call("GET", `families/${F}/listMeta/current`, bearer), 403);
    });
  }

  test("an ACTIVE member of a family that is not ACTIVE is denied", async () => {
    assert.equal(await call("GET", `families/${G}/listItems/${ITEM}`, token(G_MEMBER)), 403);
    assert.equal(await call("GET", `families/${G}/listItems`, token(G_MEMBER)), 403);
  });

  test("household isolation both ways: A's member cannot read C's list, C cannot read A's", async () => {
    assert.equal(await call("GET", `families/${H}/listItems`, token(MEMBER)), 403);
    assert.equal(await call("GET", `families/${F}/listItems`, token(C_OWNER)), 403);
    assert.equal(await call("GET", `families/${H}/listItems`, token(C_OWNER)), 200);
  });
});

describe("nothing else became readable, and no client can write", () => {
  const m = () => token(MEMBER);
  test("other listMeta documents and listing listMeta are denied", async () => {
    assert.equal(await call("GET", `families/${F}/listMeta/other`, m()), 403);
    assert.equal(await call("GET", `families/${F}/listMeta`, m()), 403);
  });
  test("authoritative items, members, the family document and invites stay server-only", async () => {
    for (const path of [`families/${F}/items/${ITEM}`, `families/${F}/items`, `families/${F}/members/${MEMBER}`, `families/${F}/members`, `families/${F}`, "invites/rules-invite-hash", "invites"]) {
      assert.equal(await call("GET", path, m()), 403, path);
    }
  });
  test("collection-group queries on listItems are denied", async () => {
    const q = { structuredQuery: { from: [{ collectionId: "listItems", allDescendants: true }] } };
    assert.equal(await call("POST", `${BASE}:runQuery`, m(), q), 403);
  });
  for (const who of [OWNER, MEMBER]) {
    test(`${who}: create, update and delete of listItems and listMeta are denied`, async () => {
      const t = token(who);
      const fields = { fields: { name: { stringValue: "hacked" } } };
      assert.equal(await call("POST", `families/${F}/listItems`, t, fields), 403);
      assert.equal(await call("PATCH", `families/${F}/listItems/${ITEM}`, t, fields), 403);
      assert.equal(await call("DELETE", `families/${F}/listItems/${ITEM}`, t), 403);
      assert.equal(await call("PATCH", `families/${F}/listMeta/current`, t, { fields: { familyEpoch: { integerValue: "9" } } }), 403);
      assert.equal(await call("PATCH", `families/${F}/members/${REVOKED}`, t, { fields: { state: { stringValue: "ACTIVE" } } }), 403);
    });
  }
  test("seeded data is unchanged after all attempts", async () => {
    for (const [path, data] of Object.entries(seeded)) assert.deepEqual((await db.doc(path).get()).data(), data, path);
  });
});
