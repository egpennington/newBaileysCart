/**
 * Lifecycle workers (Work Package v0.2 §A2.5; G-01/G-03 state invariants only). Substage 3A:
 * these are plain functions driven by D2 tests against the emulator. None is exported from
 * index.ts, scheduled, or connected to Pub/Sub/RTDN; nothing here calls a real provider or
 * deletes data. Each provider call happens outside a transaction, and its result is applied by a
 * transaction that re-reads the family and case (compare-and-set on the case revision), so duplicate,
 * reordered or concurrent deliveries have at most one logical effect.
 */
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { DomainError } from "../contract/errors.js";
import { checkLiabilitySafely, requestCancellationSafely } from "../billing/provider.js";
import type { BillingProvider } from "../billing/provider.js";
import type { Clock } from "../domain/clock.js";
import { applyCancellationOutcome, applyLiabilityRecheck, combineLiability } from "../domain/lifecycle.js";
import type { CancellationOutcome, CaseAdvance, ClosureCase } from "../domain/lifecycle.js";
import { releaseOrBlock } from "../commands/familiesWaiveRecovery.js";
import { caseFrom, familyLifecycleFrom, localBillingFrom, sameBilling, writeCase } from "../persistence/lifecycleStore.js";
import type { FamilyLifecycle, LocalBilling } from "../persistence/lifecycleStore.js";
import { paths } from "../persistence/paths.js";

export interface WorkerDeps {
  readonly db: Firestore;
  readonly clock: Clock;
  readonly provider: BillingProvider;
  /** B1: source of bounded retry jitter in [0, 1). Absent means none (deterministic 3A schedule). */
  readonly random?: () => number;
}

export type WorkerResult =
  | "NO_CHANGE"
  | "RETRY_SCHEDULED"
  | "MANUAL_REVIEW"
  | "CLOSING"
  | "DELETION_PENDING"
  | "RELEASE_BLOCKED"
  | "CANCELLATION_REQUIRED"
  | "NOT_DUE";

interface Loaded {
  readonly family: FamilyLifecycle;
  readonly closure: ClosureCase;
  readonly userData: Readonly<Record<string, unknown>> | undefined;
  readonly billing: LocalBilling;
}

/** Read the case, its family, the owner's user record and the billing record in one transaction. */
async function load(db: Firestore, tx: Transaction, caseId: string): Promise<Loaded | null> {
  const closure = caseFrom(await tx.get(db.doc(paths.closureCase(caseId))));
  const [familySnap, userSnap, billingSnap] = await tx.getAll(
    db.doc(paths.family(closure.familyId)),
    db.doc(paths.user(closure.ownerUid)),
    db.doc(paths.familyBilling(closure.familyId)),
  );
  const family = familyLifecycleFrom(familySnap);
  // The case is stale (restored, or a later closure owns the family): nothing to apply.
  if (family === null || family.closureCaseId !== caseId) return null;
  if (family.ownerUid !== closure.ownerUid) throw new DomainError("INTERNAL");
  return { family, closure, userData: userSnap?.exists ? userSnap.data() : undefined, billing: localBillingFrom(billingSnap) };
}

/** Persist a case advance: CLOSING on finality, then the release milestone if the owner already waived. */
function persistAdvance(db: Firestore, tx: Transaction, l: Loaded, advance: CaseAdvance, nowMillis: number): WorkerResult {
  if (!advance.changed) return "NO_CHANGE";
  const { closure } = advance;
  if (advance.lifecycleState === "CLOSING" && l.family.lifecycleState === "CLOSURE_PENDING_BILLING") {
    const closingFamily: FamilyLifecycle = { ...l.family, lifecycleState: "CLOSING", lifecycleRevision: l.family.lifecycleRevision + 1 };
    tx.update(db.doc(paths.family(l.family.familyId)), { lifecycleState: "CLOSING", lifecycleRevision: closingFamily.lifecycleRevision });
    if (closure.waiverCommittedAtMillis !== null) {
      const hold = l.billing.purchaseState === "PENDING";
      const r = releaseOrBlock(db, tx, closingFamily, closure, l.userData, hold, nowMillis, "WAIVER");
      return r.released ? "DELETION_PENDING" : "RELEASE_BLOCKED";
    }
    writeCase(db, tx, closure);
    return "CLOSING";
  }
  writeCase(db, tx, closure);
  if (closure.cancellationStatus === "MANUAL_REVIEW") return "MANUAL_REVIEW";
  if (closure.cancellationStatus === "PENDING" && advance.closure.attempts === 0) return "CANCELLATION_REQUIRED";
  return "RETRY_SCHEDULED";
}

/** One cancellation attempt for a due PENDING case (durable saga step). */
export async function processCancellationCase(deps: WorkerDeps, caseId: string): Promise<WorkerResult> {
  const { db } = deps;
  const before = await db.runTransaction((tx) => load(db, tx, caseId), { readOnly: true });
  if (before === null || before.closure.cancellationStatus !== "PENDING") return "NO_CHANGE";
  const due = before.closure.nextAttemptAtMillis;
  if (due === null || deps.clock.nowMillis() < due) return "NOT_DUE";

  const outcome = await requestCancellationSafely(deps.provider, {
    caseId,
    familyId: before.closure.familyId,
    purchaseRef: before.billing.purchaseRef,
  });

  return db.runTransaction(async (tx) => {
    const l = await load(db, tx, caseId);
    if (l === null || l.closure.revision !== before.closure.revision) return "NO_CHANGE";
    const nowMillis = deps.clock.nowMillis();
    return persistAdvance(db, tx, l, applyCancellationOutcome(l.closure, outcome, nowMillis, deps.random?.() ?? 0), nowMillis);
  });
}

/** An asynchronous provider completion event (duplicate and out-of-order deliveries are expected). */
export async function applyProviderEvent(deps: WorkerDeps, caseId: string, event: CancellationOutcome): Promise<WorkerResult> {
  const { db } = deps;
  return db.runTransaction(async (tx) => {
    const l = await load(db, tx, caseId);
    if (l === null) return "NO_CHANGE";
    const nowMillis = deps.clock.nowMillis();
    return persistAdvance(db, tx, l, applyCancellationOutcome(l.closure, event, nowMillis), nowMillis);
  });
}

/** Re-check a LIABILITY_UNRESOLVED hold. Zero liability starts the clock only now, never backdated. */
export async function recheckLiability(deps: WorkerDeps, caseId: string): Promise<WorkerResult> {
  const { db } = deps;
  const before = await db.runTransaction((tx) => load(db, tx, caseId), { readOnly: true });
  if (before === null || before.closure.cancellationStatus !== "LIABILITY_UNRESOLVED") return "NO_CHANGE";
  const provider = await checkLiabilitySafely(deps.provider, {
    familyId: before.closure.familyId,
    ownerUid: before.closure.ownerUid,
    purchaseRef: before.billing.purchaseRef,
  });
  return db.runTransaction(async (tx) => {
    const l = await load(db, tx, caseId);
    if (l === null || l.closure.revision !== before.closure.revision) return "NO_CHANGE";
    const nowMillis = deps.clock.nowMillis();
    const liability = sameBilling(before.billing, l.billing) ? combineLiability(provider, l.billing.purchaseState) : "UNRESOLVED";
    return persistAdvance(db, tx, l, applyLiabilityRecheck(l.closure, liability, nowMillis), nowMillis);
  });
}

/**
 * Recovery deadline (G-03 state transition only): at or after recoverUntilAt, enter DELETION_PENDING
 * when the release guards pass; otherwise record why and keep the claim. Also retries a waived case
 * whose release was blocked. Never purges.
 */
export async function processRecoveryDeadline(deps: WorkerDeps, familyId: string): Promise<WorkerResult> {
  const { db } = deps;
  return db.runTransaction(async (tx) => {
    const family = familyLifecycleFrom(await tx.get(db.doc(paths.family(familyId))));
    if (family === null || family.lifecycleState !== "CLOSING" || family.closureCaseId === null) return "NO_CHANGE";
    const l = await load(db, tx, family.closureCaseId);
    if (l === null) return "NO_CHANGE";
    const nowMillis = deps.clock.nowMillis();
    const c = l.closure;
    const recoveryOver = c.waiverCommittedAtMillis !== null || (c.recoverUntilAtMillis !== null && nowMillis >= c.recoverUntilAtMillis);
    if (!recoveryOver) return "NOT_DUE";
    const hold = l.billing.purchaseState === "PENDING";
    const trigger = c.waiverCommittedAtMillis !== null ? "WAIVER" : "DEADLINE";
    const r = releaseOrBlock(db, tx, l.family, c, l.userData, hold, nowMillis, trigger);
    return r.released ? "DELETION_PENDING" : "RELEASE_BLOCKED";
  });
}
