/**
 * D3: BC-FAMILY-SYNC-01 end to end on the Emulator Suite (Sync Contract Rev 2). Three Auth-emulator
 * users, each in its own client SDK app: A (owner) and B (invited member) share family F1; C owns F2.
 * Writes go through the deployed-to-emulator callables; reads go to the Firestore emulator REST API
 * with each user's real emulator ID token, so the listItems/listMeta rules are exercised as clients
 * meet them. The Android listener integration is the next step (not covered here).
 */
import { strict as assert } from "node:assert";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp } from "@firebase/app";
import type { FirebaseApp } from "@firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "@firebase/auth";
import type { User } from "@firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "@firebase/functions";
import type { Functions } from "@firebase/functions";
import { AUTH_HOST, FIRESTORE_HOST, PROJECT, adminAuth, clearAuth, clearFirestore, newOpId } from "../support/emulator.js";

const REGION = "us-central1";
const DOCS = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const V = "v0.4";

interface Client {
  readonly app: FirebaseApp;
  readonly functions: Functions;
  readonly user: User;
}

const clients: Client[] = [];

async function newClient(label: string): Promise<Client> {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-api-key", appId: `demo-sync-${label}` }, `sync-${label}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const cred = await createUserWithEmailAndPassword(auth, `${label}-${newOpId().slice(0, 8)}@example.com`, "sync-password-1");
  await adminAuth.updateUser(cred.user.uid, { emailVerified: true });
  await cred.user.getIdToken(true);
  const client = { app, functions, user: cred.user };
  clients.push(client);
  return client;
}

async function call<T>(c: Client, name: string, data: unknown): Promise<T> {
  const res = await httpsCallable(c.functions, name)(data);
  return (res.data as { data: T }).data;
}

/** The domain code from the API v0.4 rejection envelope carried in HttpsError.details. */
async function rejectedCode(c: Client, name: string, data: unknown): Promise<string> {
  try {
    await httpsCallable(c.functions, name)(data);
  } catch (err) {
    return (err as { details: { error: { code: string } } }).details.error.code;
  }
  assert.fail(`${name} unexpectedly succeeded`);
}

async function read(c: Client, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${DOCS}/${path}`, { headers: { Authorization: `Bearer ${await c.user.getIdToken()}` } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

interface ListedItem {
  readonly name: string;
  readonly checked: boolean;
}

async function list(c: Client, familyId: string): Promise<Record<string, ListedItem>> {
  const r = await read(c, `families/${familyId}/listItems`);
  assert.equal(r.status, 200);
  const docs = (r.body["documents"] ?? []) as { name: string; fields: Record<string, { stringValue?: string; booleanValue?: boolean }> }[];
  return Object.fromEntries(
    docs.map((d) => [d.name.split("/").pop() ?? "", { name: d.fields["name"]?.stringValue ?? "", checked: d.fields["checked"]?.booleanValue ?? false }]),
  );
}

let A: Client;
let B: Client;
let C: Client;
let F1 = "";
let F2 = "";
let code = "";
const milk = newOpId();

before(async () => {
  await clearFirestore();
  await clearAuth();
  A = await newClient("a");
  B = await newClient("b");
  C = await newClient("c");
});

after(async () => {
  for (const c of clients) await deleteApp(c.app);
});

describe("the defining experience over the callable wire", () => {
  test("A creates family F1 and an invite; B accepts it", async () => {
    F1 = (await call<{ familyId: string }>(A, "familiesCreate", { apiVersion: V, opId: newOpId(), payload: {} })).familyId;
    const inv = await call<{ code: string | null }>(A, "invitesCreate", { apiVersion: V, opId: newOpId(), familyId: F1, familyEpoch: 1 });
    assert.ok(inv.code !== null);
    code = inv.code;
    const joined = await call<{ familyId: string; role: string }>(B, "invitesAccept", { apiVersion: V, opId: newOpId(), code });
    assert.deepEqual(joined, { familyId: F1, familyEpoch: 1, role: "MEMBER" });
  });

  test("A adds milk; B reads it from the shared list", async () => {
    await call(A, "itemsAdd", { apiVersion: V, opId: newOpId(), familyId: F1, familyEpoch: 1, itemId: milk, name: "Milk", category: "DAIRY" });
    assert.deepEqual((await list(B, F1))[milk], { name: "Milk", checked: false });
  });

  test("B checks milk off; A and B both see it checked", async () => {
    await call(B, "itemsEdit", { apiVersion: V, opId: newOpId(), familyId: F1, familyEpoch: 1, itemId: milk, patch: { checked: true } });
    assert.equal((await list(A, F1))[milk]?.checked, true);
    assert.equal((await list(B, F1))[milk]?.checked, true);
  });

  test("B can read listMeta/current (the family epoch)", async () => {
    const r = await read(B, `families/${F1}/listMeta/current`);
    assert.equal(r.status, 200);
  });
});

describe("household C is isolated from F1", () => {
  test("C has its own family and list", async () => {
    F2 = (await call<{ familyId: string }>(C, "familiesCreate", { apiVersion: V, opId: newOpId(), payload: {} })).familyId;
    await call(C, "itemsAdd", { apiVersion: V, opId: newOpId(), familyId: F2, familyEpoch: 1, itemId: newOpId(), name: "C bread", category: "DRY" });
    assert.deepEqual(Object.values(await list(C, F2)).map((i) => i.name), ["C bread"]);
    assert.ok(!Object.values(await list(A, F1)).some((i) => i.name === "C bread"));
  });

  test("C's reads of F1 are denied by the rules; A's and B's reads of F2 likewise", async () => {
    assert.equal((await read(C, `families/${F1}/listItems`)).status, 403);
    assert.equal((await read(C, `families/${F1}/listItems/${milk}`)).status, 403);
    assert.equal((await read(C, `families/${F1}/listMeta/current`)).status, 403);
    assert.equal((await read(A, `families/${F2}/listItems`)).status, 403);
    assert.equal((await read(B, `families/${F2}/listItems`)).status, 403);
  });

  test("C's writes to F1 are rejected (NOT_FOUND) and the used invite is INVITE_INVALID", async () => {
    const base = { apiVersion: V, familyId: F1, familyEpoch: 1 };
    assert.equal(await rejectedCode(C, "itemsAdd", { ...base, opId: newOpId(), itemId: newOpId(), name: "x", category: "MISC" }), "NOT_FOUND");
    assert.equal(await rejectedCode(C, "itemsEdit", { ...base, opId: newOpId(), itemId: milk, patch: { checked: false } }), "NOT_FOUND");
    assert.equal(await rejectedCode(C, "itemsDelete", { ...base, opId: newOpId(), itemId: milk }), "NOT_FOUND");
    assert.equal(await rejectedCode(C, "invitesCreate", { ...base, opId: newOpId() }), "NOT_FOUND");
    assert.equal(await rejectedCode(C, "invitesAccept", { apiVersion: V, opId: newOpId(), code }), "INVITE_INVALID");
    assert.equal((await list(A, F1))[milk]?.checked, true);
  });
});
