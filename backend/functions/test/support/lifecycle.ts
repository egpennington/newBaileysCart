/**
 * Shared fixtures for the Slice 3 lifecycle D2 tests (emulator only). Families are created through
 * the real families.create handler so every Slice 1/2 invariant holds before a lifecycle command runs.
 */
import { strict as assert } from "node:assert";
import { Timestamp } from "firebase-admin/firestore";
import { FakeBillingProvider } from "../../src/billing/fakeProvider.js";
import { familiesCloseHandler } from "../../src/commands/familiesClose.js";
import type { CloseDeps } from "../../src/commands/familiesClose.js";
import { familiesCreateHandler } from "../../src/commands/familiesCreate.js";
import { familiesGetClosureStatusHandler } from "../../src/commands/familiesGetClosureStatus.js";
import { familiesRestoreHandler } from "../../src/commands/familiesRestore.js";
import { familiesWaiveRecoveryHandler } from "../../src/commands/familiesWaiveRecovery.js";
import { accountGetSessionHandler } from "../../src/commands/accountGetSession.js";
import type { ConfirmationAction } from "../../src/domain/confirmation.js";
import { issueConfirmationToken } from "../../src/persistence/lifecycleStore.js";
import { FakeClock, db, newOpId, uniqueUid } from "./emulator.js";

export const T0 = Date.UTC(2026, 10, 4, 12, 0, 0, 0);
export const verified = (uid: string) => ({ uid, emailVerified: true });

export class World {
  readonly clock = new FakeClock(T0);
  readonly provider = new FakeBillingProvider();
  afterLiabilityCheck: (() => Promise<void>) | undefined;

  private get deps(): CloseDeps {
    const hook = this.afterLiabilityCheck;
    return { db, clock: this.clock, provider: this.provider, ...(hook ? { afterLiabilityCheck: hook } : {}) };
  }
  get create() {
    return familiesCreateHandler({ db, clock: this.clock });
  }
  get close() {
    return familiesCloseHandler(this.deps);
  }
  get restore() {
    return familiesRestoreHandler(this.deps);
  }
  get waive() {
    return familiesWaiveRecoveryHandler(this.deps);
  }
  get status() {
    return familiesGetClosureStatusHandler(this.deps);
  }
  get session() {
    return accountGetSessionHandler({ db, clock: this.clock, integrityLog: () => undefined });
  }

  /** An ACTIVE trial family created through families.create. */
  async trialFamily(label = "own"): Promise<{ uid: string; familyId: string }> {
    const uid = uniqueUid(label);
    const res = await this.create(verified(uid), { apiVersion: "v0.4", opId: newOpId(), payload: {} });
    assert.equal(res.data.lifecycleState, "ACTIVE");
    return { uid, familyId: res.data.familyId };
  }

  /** Server-only local billing record (no purchase flow exists in 3A). */
  async billing(familyId: string, purchaseState: "NONE" | "ACTIVE" | "PENDING", purchaseRef: string | null): Promise<void> {
    await db.doc(`familyBilling/${familyId}`).set({ purchaseState, purchaseRef });
  }

  async paidFamily(label = "paid"): Promise<{ uid: string; familyId: string }> {
    const f = await this.trialFamily(label);
    await this.billing(f.familyId, "ACTIVE", `fake-paid-${f.familyId}`);
    return f;
  }

  async member(familyId: string, label = "mem"): Promise<string> {
    const uid = uniqueUid(label);
    const at = Timestamp.fromMillis(this.clock.nowMillis());
    await db.doc(`families/${familyId}/members/${uid}`).set({ role: "MEMBER", state: "ACTIVE", joinedAt: at });
    await db.doc(`users/${uid}/memberships/${familyId}`).set({ role: "MEMBER", state: "ACTIVE", joinedAt: at });
    return uid;
  }

  async token(uid: string, familyId: string, action: ConfirmationAction, familyEpoch = 1): Promise<string> {
    return (await issueConfirmationToken(db, this.clock.nowMillis(), { uid, familyId, action, familyEpoch })).token;
  }

  async closeReq(uid: string, familyId: string, epoch = 1, opId = newOpId()) {
    return { apiVersion: "v0.4", opId, familyId, familyEpoch: epoch, confirmationToken: await this.token(uid, familyId, "families.close", epoch) };
  }

  async waiveReq(uid: string, familyId: string, epoch = 1, opId = newOpId()) {
    return {
      apiVersion: "v0.4",
      opId,
      familyId,
      familyEpoch: epoch,
      confirmationToken: await this.token(uid, familyId, "families.waiveRecovery", epoch),
    };
  }

  restoreReq(familyId: string, epoch = 1, opId = newOpId()) {
    return { apiVersion: "v0.4", opId, familyId, familyEpoch: epoch };
  }

  /** Close and return the closure case id. */
  async closed(uid: string, familyId: string): Promise<string> {
    const res = await this.close(verified(uid), await this.closeReq(uid, familyId));
    return res.data.closureCaseId;
  }
}

export async function familyDoc(familyId: string): Promise<Record<string, unknown>> {
  const d = (await db.doc(`families/${familyId}`).get()).data();
  assert.ok(d, `family ${familyId} exists`);
  return d;
}

export async function caseDoc(caseId: string): Promise<Record<string, unknown>> {
  const d = (await db.doc(`closureCases/${caseId}`).get()).data();
  assert.ok(d, `case ${caseId} exists`);
  return d;
}

export async function claimOf(uid: string): Promise<unknown> {
  return (await db.doc(`users/${uid}`).get()).get("ownedFamilyId");
}

export async function casesFor(familyId: string): Promise<number> {
  return (await db.collection("closureCases").where("familyId", "==", familyId).get()).size;
}

/** Every document under a family plus its case, for "no state change" assertions. */
export async function snapshotState(uid: string, familyId: string): Promise<string> {
  const parts: unknown[] = [];
  parts.push((await db.doc(`families/${familyId}`).get()).data());
  parts.push((await db.doc(`users/${uid}`).get()).data());
  parts.push((await db.doc(`trialLedger/${uid}`).get()).data());
  const cases = await db.collection("closureCases").where("familyId", "==", familyId).get();
  parts.push(cases.docs.map((d) => [d.id, d.data()]));
  const members = await db.collection(`families/${familyId}/members`).get();
  parts.push(members.docs.map((d) => [d.id, d.data()]));
  return JSON.stringify(parts);
}

export const ms = (t: unknown): number => {
  assert.ok(t instanceof Timestamp, `expected Timestamp, got ${String(t)}`);
  return t.toMillis();
};
