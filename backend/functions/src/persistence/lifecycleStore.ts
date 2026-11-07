/**
 * Storage mapping for the Slice 3 lifecycle records, plus the transactional write helpers that
 * several commands and workers share. Every reader fails closed: a malformed stored record is
 * INTERNAL, never a guessed default (A1 F-1/F-2, HB-1..HB-3 discipline for new writers).
 */
import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { DomainError } from "../contract/errors.js";
import { CONFIRMATION_TOKEN_BYTES, CONFIRMATION_TOKEN_TTL_MS } from "../domain/confirmation.js";
import type { ConfirmationBinding, ConfirmationRecord } from "../domain/confirmation.js";
import { isLifecycleState } from "../domain/family.js";
import type { LifecycleState } from "../domain/family.js";
import { BILLING_HOLD_REASONS, CANCELLATION_STATUSES } from "../domain/lifecycle.js";
import type { BillingHoldReason, CancellationStatus, ClosureCase, LocalPurchaseState, ReleaseBlockedReason } from "../domain/lifecycle.js";
import { SCHEMA_VERSION, paths } from "./paths.js";

// ---------------------------------------------------------------------------------------------
// families/{familyId}: the lifecycle fields
// ---------------------------------------------------------------------------------------------

export interface FamilyLifecycle {
  readonly familyId: string;
  readonly ownerUid: string;
  readonly lifecycleState: LifecycleState;
  readonly familyEpoch: number;
  readonly closureCaseId: string | null;
  /** Monotonic lifecycle version (compare-and-set evidence); absent on Slice 1 records means 0. */
  readonly lifecycleRevision: number;
}

/** Null when the family does not exist; INTERNAL when it exists but is malformed. */
export function familyLifecycleFrom(snap: DocumentSnapshot | undefined): FamilyLifecycle | null {
  if (!snap?.exists) return null;
  const ownerUid = snap.get("ownerUid");
  const lifecycleState = snap.get("lifecycleState");
  const familyEpoch = snap.get("familyEpoch");
  const closureCaseId = snap.get("closureCaseId") ?? null;
  const lifecycleRevision = snap.get("lifecycleRevision") ?? 0;
  if (
    typeof ownerUid !== "string" ||
    ownerUid === "" ||
    !isLifecycleState(lifecycleState) ||
    typeof familyEpoch !== "number" ||
    !Number.isSafeInteger(familyEpoch) ||
    familyEpoch < 1 ||
    (closureCaseId !== null && (typeof closureCaseId !== "string" || closureCaseId === "")) ||
    typeof lifecycleRevision !== "number" ||
    !Number.isSafeInteger(lifecycleRevision)
  ) {
    throw new DomainError("INTERNAL");
  }
  // A closed family must reference its case; an open one must not.
  const closed = lifecycleState !== "ACTIVE" && lifecycleState !== "UNENTITLED_AWAITING_PAYMENT";
  if (closed !== (closureCaseId !== null)) throw new DomainError("INTERNAL");
  return { familyId: snap.id, ownerUid, lifecycleState, familyEpoch, closureCaseId, lifecycleRevision };
}

// ---------------------------------------------------------------------------------------------
// closureCases/{caseId}
// ---------------------------------------------------------------------------------------------

const ts = (millis: number | null): Timestamp | null => (millis === null ? null : Timestamp.fromMillis(millis));

function millisField(snap: DocumentSnapshot, field: string): number | null {
  const v = snap.get(field);
  if (v === null || v === undefined) return null;
  if (!(v instanceof Timestamp)) throw new DomainError("INTERNAL");
  return v.toMillis();
}

function requiredMillis(snap: DocumentSnapshot, field: string): number {
  const v = millisField(snap, field);
  if (v === null) throw new DomainError("INTERNAL");
  return v;
}

function intField(snap: DocumentSnapshot, field: string): number {
  const v = snap.get(field);
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new DomainError("INTERNAL");
  return v;
}

function stringField(snap: DocumentSnapshot, field: string): string {
  const v = snap.get(field);
  if (typeof v !== "string" || v === "") throw new DomainError("INTERNAL");
  return v;
}

export function caseToDoc(c: ClosureCase): Record<string, unknown> {
  return {
    familyId: c.familyId,
    ownerUid: c.ownerUid,
    sourceEpoch: c.sourceEpoch,
    cancellationStatus: c.cancellationStatus,
    closedAt: Timestamp.fromMillis(c.closedAtMillis),
    closureConfirmedAt: ts(c.closureConfirmedAtMillis),
    recoverUntilAt: ts(c.recoverUntilAtMillis),
    waiverCommittedAt: ts(c.waiverCommittedAtMillis),
    attempts: c.attempts,
    nextAttemptAt: ts(c.nextAttemptAtMillis),
    lastProviderSequence: c.lastProviderSequence,
    releaseBlockedReason: c.releaseBlockedReason,
    deletionPendingAt: ts(c.deletionPendingAtMillis),
    ownershipReleasedAt: ts(c.ownershipReleasedAtMillis),
    restoredAt: ts(c.restoredAtMillis),
    revision: c.revision,
    ...(c.billingHoldReason !== undefined && c.billingHoldReason !== null ? { billingHoldReason: c.billingHoldReason } : {}),
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Update an existing case; merge keeps write-once fields such as `liabilitySource`. */
export function writeCase(db: Firestore, tx: Transaction, c: ClosureCase): void {
  tx.set(db.doc(paths.closureCase(c.caseId)), caseToDoc(c), { merge: true });
}

const RELEASE_BLOCKED_REASONS: readonly ReleaseBlockedReason[] = [
  "RECOVERY_OPEN",
  "FINANCIAL_FINALITY_MISSING",
  "RECONCILIATION_HOLD",
  "CLAIM_MISMATCH",
];

/** INTERNAL when missing or malformed: a closed family without a valid case fails closed. */
export function caseFrom(snap: DocumentSnapshot | undefined): ClosureCase {
  if (!snap?.exists) throw new DomainError("INTERNAL");
  const status = snap.get("cancellationStatus");
  const blocked = snap.get("releaseBlockedReason") ?? null;
  const holdReason = snap.get("billingHoldReason") ?? null;
  if (holdReason !== null && !BILLING_HOLD_REASONS.includes(holdReason as BillingHoldReason)) throw new DomainError("INTERNAL");
  if (!CANCELLATION_STATUSES.includes(status as CancellationStatus)) throw new DomainError("INTERNAL");
  if (blocked !== null && !RELEASE_BLOCKED_REASONS.includes(blocked as ReleaseBlockedReason)) throw new DomainError("INTERNAL");
  const sourceEpoch = intField(snap, "sourceEpoch");
  if (sourceEpoch < 1) throw new DomainError("INTERNAL");
  return {
    caseId: snap.id,
    familyId: stringField(snap, "familyId"),
    ownerUid: stringField(snap, "ownerUid"),
    sourceEpoch,
    cancellationStatus: status as CancellationStatus,
    closedAtMillis: requiredMillis(snap, "closedAt"),
    closureConfirmedAtMillis: millisField(snap, "closureConfirmedAt"),
    recoverUntilAtMillis: millisField(snap, "recoverUntilAt"),
    waiverCommittedAtMillis: millisField(snap, "waiverCommittedAt"),
    attempts: intField(snap, "attempts"),
    nextAttemptAtMillis: millisField(snap, "nextAttemptAt"),
    lastProviderSequence: intField(snap, "lastProviderSequence"),
    releaseBlockedReason: blocked as ReleaseBlockedReason | null,
    deletionPendingAtMillis: millisField(snap, "deletionPendingAt"),
    ownershipReleasedAtMillis: millisField(snap, "ownershipReleasedAt"),
    restoredAtMillis: millisField(snap, "restoredAt"),
    revision: intField(snap, "revision"),
    ...(holdReason !== null ? { billingHoldReason: holdReason as BillingHoldReason } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// familyBilling/{familyId}: server-only local billing record (seeded in 3A; no purchase flow yet)
// ---------------------------------------------------------------------------------------------

export interface LocalBilling {
  readonly purchaseState: LocalPurchaseState;
  readonly purchaseRef: string | null;
}

/** Absent record = NONE with no reference. A malformed record is PENDING (hold), never NONE. */
export function localBillingFrom(snap: DocumentSnapshot | undefined): LocalBilling {
  if (!snap?.exists) return { purchaseState: "NONE", purchaseRef: null };
  const state = snap.get("purchaseState");
  const ref = snap.get("purchaseRef") ?? null;
  if ((state !== "NONE" && state !== "ACTIVE" && state !== "PENDING") || (ref !== null && typeof ref !== "string")) {
    return { purchaseState: "PENDING", purchaseRef: null };
  }
  return { purchaseState: state, purchaseRef: ref };
}

export function sameBilling(a: LocalBilling, b: LocalBilling): boolean {
  return a.purchaseState === b.purchaseState && a.purchaseRef === b.purchaseRef;
}

// ---------------------------------------------------------------------------------------------
// confirmationTokens/{sha256(token)}
// ---------------------------------------------------------------------------------------------

export function confirmationTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function confirmationRecordFrom(snap: DocumentSnapshot | undefined): ConfirmationRecord | null {
  if (!snap?.exists) return null;
  const uid = snap.get("uid");
  const familyId = snap.get("familyId");
  const action = snap.get("action");
  const familyEpoch = snap.get("familyEpoch");
  const issuedAt = snap.get("issuedAt");
  const expiresAt = snap.get("expiresAt");
  const consumedAt = snap.get("consumedAt") ?? null;
  if (
    typeof uid !== "string" ||
    typeof familyId !== "string" ||
    (action !== "families.close" && action !== "families.waiveRecovery") ||
    typeof familyEpoch !== "number" ||
    !(issuedAt instanceof Timestamp) ||
    !(expiresAt instanceof Timestamp) ||
    (consumedAt !== null && !(consumedAt instanceof Timestamp))
  ) {
    return null; // Malformed: treated as no valid token (CONFIRMATION_REQUIRED).
  }
  return {
    uid,
    familyId,
    action,
    familyEpoch,
    issuedAtMillis: issuedAt.toMillis(),
    expiresAtMillis: expiresAt.toMillis(),
    consumedAtMillis: consumedAt === null ? null : consumedAt.toMillis(),
  };
}

// ---------------------------------------------------------------------------------------------
// lifecycleConfirmations/{familyId}: the A2-D4 active-token pointer (server-only)
// ---------------------------------------------------------------------------------------------

/**
 * The family's only active confirmation token, by digest, and the bounded issuance window used by the
 * throttle. Every issuance and every consumption reads and writes this one document in its own
 * transaction, so issuance, supersession and consumption serialize (no collection scan, no fan-out).
 * Superseded token documents are left as history; they fail at use because the pointer no longer
 * names them.
 */
export interface ConfirmationPointer {
  readonly exists: boolean;
  readonly activeTokenHash: string | null;
  /** opId of the preparation that issued the active token; null for the internal seeder. */
  readonly activeOpId: string | null;
  /** Issuance instants inside the throttle window when last written (at most ISSUANCE_LIMIT). */
  readonly issuedAtMillis: readonly number[];
  readonly revision: number;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Absent = no active token. Malformed = INTERNAL: issuance and consumption both fail closed. */
export function confirmationPointerFrom(snap: DocumentSnapshot | undefined, familyId: string): ConfirmationPointer {
  if (!snap?.exists) return { exists: false, activeTokenHash: null, activeOpId: null, issuedAtMillis: [], revision: 0 };
  const active = snap.get("activeTokenHash") ?? null;
  const opId = snap.get("activeOpId") ?? null;
  const issued = snap.get("issuedAt");
  const revision = snap.get("revision");
  if (
    snap.get("familyId") !== familyId ||
    (active !== null && (typeof active !== "string" || !SHA256_HEX.test(active))) ||
    (opId !== null && typeof opId !== "string") ||
    !Array.isArray(issued) ||
    !issued.every((t) => t instanceof Timestamp) ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw new DomainError("INTERNAL");
  }
  return {
    exists: true,
    activeTokenHash: active,
    activeOpId: opId,
    issuedAtMillis: (issued as Timestamp[]).map((t) => t.toMillis()),
    revision,
  };
}

export function writeConfirmationPointer(
  db: Firestore,
  tx: Transaction,
  familyId: string,
  ownerUid: string,
  previous: ConfirmationPointer,
  next: { activeTokenHash: string | null; activeOpId: string | null; issuedAtMillis: readonly number[] },
  nowMillis: number,
): void {
  tx.set(db.doc(paths.confirmationPointer(familyId)), {
    familyId,
    ownerUid,
    activeTokenHash: next.activeTokenHash,
    activeOpId: next.activeOpId,
    issuedAt: next.issuedAtMillis.map((t) => Timestamp.fromMillis(t)),
    revision: previous.revision + 1,
    updatedAt: Timestamp.fromMillis(nowMillis),
    schemaVersion: SCHEMA_VERSION,
  });
}

/** The token document; only the digest names it and no field holds the plaintext. */
export function tokenDoc(binding: ConfirmationBinding, issuedByOpId: string | null, nowMillis: number): Record<string, unknown> {
  return {
    uid: binding.uid,
    familyId: binding.familyId,
    action: binding.action,
    familyEpoch: binding.familyEpoch,
    issuedAt: Timestamp.fromMillis(nowMillis),
    expiresAt: Timestamp.fromMillis(nowMillis + CONFIRMATION_TOKEN_TTL_MS),
    consumedAt: null,
    consumedByOpId: null,
    issuedByOpId,
    schemaVersion: SCHEMA_VERSION,
  };
}

/**
 * Internal, test-only seeder (3A). Since A2-D4 it supersedes like a real preparation: it records the
 * new digest as the family's active token in the same transaction. It does not count toward the
 * issuance throttle and runs no authorization; the public issuer is families.prepareLifecycleConfirmation.
 */
export async function issueConfirmationToken(
  db: Firestore,
  nowMillis: number,
  binding: ConfirmationBinding,
): Promise<{ token: string; expiresAtMillis: number }> {
  const token = randomBytes(CONFIRMATION_TOKEN_BYTES).toString("base64url");
  const hash = confirmationTokenHash(token);
  const pointerRef = db.doc(paths.confirmationPointer(binding.familyId));
  await db.runTransaction(async (tx) => {
    const previous = confirmationPointerFrom(await tx.get(pointerRef), binding.familyId);
    tx.create(db.doc(paths.confirmationToken(hash)), tokenDoc(binding, null, nowMillis));
    writeConfirmationPointer(
      db,
      tx,
      binding.familyId,
      binding.uid,
      previous,
      { activeTokenHash: hash, activeOpId: null, issuedAtMillis: previous.issuedAtMillis },
      nowMillis,
    );
  }, { maxAttempts: 10 });
  return { token, expiresAtMillis: nowMillis + CONFIRMATION_TOKEN_TTL_MS };
}

// ---------------------------------------------------------------------------------------------
// Release milestone write (GAI-S3-BLK-03): one transaction, caller has already run decideRelease.
// ---------------------------------------------------------------------------------------------

export interface ReleaseWrite {
  readonly family: FamilyLifecycle;
  readonly closure: ClosureCase;
  /** users/{ownerUid} as read in this transaction; it must name this family (checked by decideRelease). */
  readonly userData: Readonly<Record<string, unknown>>;
  readonly nowMillis: number;
  /** "WAIVER" or "DEADLINE", for the audit record. */
  readonly trigger: "WAIVER" | "DEADLINE";
}

/**
 * Enter DELETION_PENDING: compare-and-clear the owner claim, retire the owner's membership edges
 * (so account.getSession HB-3 stays consistent), write the release audit and leave the trial
 * ledger untouched. DELETION_PENDING is not PURGED: no family data is deleted here.
 */
export function writeReleaseMilestone(db: Firestore, tx: Transaction, w: ReleaseWrite): ClosureCase {
  const { family, closure, nowMillis } = w;
  const now = Timestamp.fromMillis(nowMillis);
  const released: ClosureCase = {
    ...closure,
    deletionPendingAtMillis: nowMillis,
    ownershipReleasedAtMillis: nowMillis,
    releaseBlockedReason: null,
    nextAttemptAtMillis: null,
    revision: closure.revision + 1,
  };
  tx.update(db.doc(paths.family(family.familyId)), {
    lifecycleState: "DELETION_PENDING",
    lifecycleRevision: family.lifecycleRevision + 1,
  });
  writeCase(db, tx, released);
  tx.set(db.doc(paths.user(family.ownerUid)), {
    ...w.userData,
    ownedFamilyId: null,
    ownerClaimReleasedAt: now,
  });
  tx.update(db.doc(paths.familyMember(family.familyId, family.ownerUid)), { state: "RELEASED", releasedAt: now });
  tx.update(db.doc(paths.userMembership(family.ownerUid, family.familyId)), { state: "RELEASED", releasedAt: now });
  tx.create(db.doc(paths.ownershipReleaseAudit(closure.caseId)), {
    ownerUid: family.ownerUid,
    familyId: family.familyId,
    caseId: closure.caseId,
    trigger: w.trigger,
    financialFinality: closure.cancellationStatus,
    releasedAt: now,
    trialLedgerReset: false,
    schemaVersion: SCHEMA_VERSION,
  });
  return released;
}
