/**
 * Shared setup for D2/D3 tests. Runs only under `firebase emulators:exec` (demo project);
 * refuses to start if the emulator hosts are not set, so no test can reach a real project.
 */
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { DomainError } from "../../src/contract/errors.js";
import type { DomainErrorCode } from "../../src/contract/errors.js";
import type { Clock } from "../../src/domain/clock.js";

export const PROJECT = "demo-newbaileyscart";
export const FIRESTORE_HOST = process.env["FIRESTORE_EMULATOR_HOST"];
export const AUTH_HOST = process.env["FIREBASE_AUTH_EMULATOR_HOST"];
if (!FIRESTORE_HOST || !AUTH_HOST) {
  throw new Error("Emulator hosts not set: run via `npm run test:emulator` (firebase emulators:exec).");
}

if (getApps().length === 0) initializeApp({ projectId: PROJECT });
export const db = getFirestore();
export const adminAuth = getAuth();

export async function clearFirestore(): Promise<void> {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  assert.equal(res.status, 200, "clear Firestore emulator");
}

export async function clearAuth(): Promise<void> {
  const res = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  assert.equal(res.status, 200, "clear Auth emulator");
}

export class FakeClock implements Clock {
  constructor(public millis: number) {}
  nowMillis(): number {
    return this.millis;
  }
  advance(ms: number): void {
    this.millis += ms;
  }
}

export const newOpId = (): string => randomUUID();
export const uniqueUid = (label: string): string => `${label}-${randomUUID().slice(0, 8)}`;

export async function expectDomainError(promise: Promise<unknown>, code: DomainErrorCode): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof DomainError, `expected DomainError ${code}, got ${String(err)}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected DomainError ${code}, but the call succeeded`);
}

/** Every document Slice 1 could have written for this UID, by path. */
export async function docsForUid(uid: string): Promise<string[]> {
  const found: string[] = [];
  const families = await db.collection("families").where("ownerUid", "==", uid).get();
  for (const f of families.docs) {
    found.push(f.ref.path);
    const members = await f.ref.collection("members").get();
    found.push(...members.docs.map((d) => d.ref.path));
  }
  for (const path of [`users/${uid}`, `trialLedger/${uid}`]) {
    if ((await db.doc(path).get()).exists) found.push(path);
  }
  const edges = await db.collection(`users/${uid}/memberships`).get();
  found.push(...edges.docs.map((d) => d.ref.path));
  const idem = await db.collection("idempotency").where("actorUid", "==", uid).get();
  found.push(...idem.docs.map((d) => d.ref.path));
  return found.sort();
}
