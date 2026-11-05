/**
 * Pure family-lifecycle transition engine (WP-03 Slice 3, Substage 3A; Work Package v0.2 §§3-6,
 * Decisions 43, 44, 46, 47, S3-D05/D07/D09). Transactions gather facts and persist results; these
 * functions only decide. A transition that is not listed here is rejected (fail closed).
 *
 * Time is server milliseconds. `familyEpoch` is never changed here except by restore (D43).
 */
import { DomainError } from "../contract/errors.js";
import { RECOVERY_WINDOW_MS } from "./family.js";
import type { LifecycleState } from "./family.js";

/** Financial liability established for a close, from the billing adapter plus the local billing record. */
export type Liability =
  /** Authoritatively established: no purchase obligation and no pending purchase (S3-D09). */
  | "ZERO_VERIFIED"
  /** Verified active purchase obligation: provider cancellation is required (D44). */
  | "PAID_OBLIGATION"
  /** Anything else, including provider outage and a missing local token alone (INV-05). */
  | "UNRESOLVED";

export type CancellationStatus =
  /** Zero liability verified at close; no cancellation is dispatched. */
  | "NOT_REQUIRED"
  /** Paid: provider cancellation requested or awaiting finality. */
  | "PENDING"
  /** Close committed with uncertain liability: reconciliation hold (INV-05, INV-09). */
  | "LIABILITY_UNRESOLVED"
  /** Provider-verified cancellation finality. */
  | "VERIFIED"
  /** Permanent failure or retries exhausted: escalated, never treated as success. */
  | "MANUAL_REVIEW";

export const CANCELLATION_STATUSES: readonly CancellationStatus[] = [
  "NOT_REQUIRED",
  "PENDING",
  "LIABILITY_UNRESOLVED",
  "VERIFIED",
  "MANUAL_REVIEW",
];

/** Cancellation or liability states that satisfy the financial-finality guard of the release milestone. */
const FINANCIALLY_FINAL: readonly CancellationStatus[] = ["NOT_REQUIRED", "VERIFIED"];

/** Retry policy for the cancellation and reconciliation workers. Deterministic: no jitter in 3A. */
export const MAX_PROVIDER_ATTEMPTS = 8;
export const BASE_RETRY_DELAY_MS = 60_000;
export const MAX_RETRY_DELAY_MS = 6 * 3_600_000;

export function retryDelayMs(attempts: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_MS);
}

/** The server-only closure case, in domain form (persistence/closureCases.ts maps it to storage). */
export interface ClosureCase {
  readonly caseId: string;
  readonly familyId: string;
  /** Immutable original owner, copied from the family at close. */
  readonly ownerUid: string;
  /** familyEpoch when the family was closed. */
  readonly sourceEpoch: number;
  readonly cancellationStatus: CancellationStatus;
  readonly closedAtMillis: number;
  /** Verified cancellation completion, or the no-liability verification (canonical `closureConfirmedAt`). */
  readonly closureConfirmedAtMillis: number | null;
  /** `closureConfirmedAt + 30 days`; null until financial finality (no clock on ambiguity). */
  readonly recoverUntilAtMillis: number | null;
  /** Irrevocable owner waiver (D47). */
  readonly waiverCommittedAtMillis: number | null;
  readonly attempts: number;
  readonly nextAttemptAtMillis: number | null;
  /** Highest provider event sequence applied; older events are ignored (reordering). */
  readonly lastProviderSequence: number;
  /** Why the release milestone was last refused, for the worker and GAI evidence; never shown to clients. */
  readonly releaseBlockedReason: ReleaseBlockedReason | null;
  readonly deletionPendingAtMillis: number | null;
  readonly ownershipReleasedAtMillis: number | null;
  readonly restoredAtMillis: number | null;
  /** Monotonic case version for compare-and-set; separate from familyEpoch. */
  readonly revision: number;
}

// ---------------------------------------------------------------------------------------------
// families.close
// ---------------------------------------------------------------------------------------------

/** W-02 step 7 for close: only an ACTIVE family can be closed. */
export function assertClosable(state: LifecycleState): void {
  switch (state) {
    case "ACTIVE":
      return;
    case "UNENTITLED_AWAITING_PAYMENT":
      throw new DomainError("UNENTITLED_AWAITING_PAYMENT");
    case "CLOSURE_PENDING_BILLING":
      throw new DomainError("FAMILY_CLOSURE_PENDING");
    case "CLOSING":
      throw new DomainError("FAMILY_CLOSING");
    case "DELETION_PENDING":
      throw new DomainError("FAMILY_DELETION_PENDING");
  }
}

export interface CloseOutcome {
  readonly lifecycleState: Extract<LifecycleState, "CLOSURE_PENDING_BILLING" | "CLOSING">;
  readonly cancellationStatus: Extract<CancellationStatus, "NOT_REQUIRED" | "PENDING" | "LIABILITY_UNRESOLVED">;
  readonly closureConfirmedAtMillis: number | null;
  readonly recoverUntilAtMillis: number | null;
  /** True only for a paid obligation: the cancellation worker must act. */
  readonly dispatchCancellation: boolean;
}

/** INV-05 / S3-D09 / GAI-S3-BLK-02. */
export function decideCloseOutcome(liability: Liability, nowMillis: number): CloseOutcome {
  switch (liability) {
    case "ZERO_VERIFIED":
      return {
        lifecycleState: "CLOSING",
        cancellationStatus: "NOT_REQUIRED",
        closureConfirmedAtMillis: nowMillis,
        recoverUntilAtMillis: nowMillis + RECOVERY_WINDOW_MS,
        dispatchCancellation: false,
      };
    case "PAID_OBLIGATION":
      return {
        lifecycleState: "CLOSURE_PENDING_BILLING",
        cancellationStatus: "PENDING",
        closureConfirmedAtMillis: null,
        recoverUntilAtMillis: null,
        dispatchCancellation: true,
      };
    case "UNRESOLVED":
      return {
        lifecycleState: "CLOSURE_PENDING_BILLING",
        cancellationStatus: "LIABILITY_UNRESOLVED",
        closureConfirmedAtMillis: null,
        recoverUntilAtMillis: null,
        dispatchCancellation: false,
      };
  }
}

/** What the billing adapter reported for a liability check, before the local record is considered. */
export type ProviderLiability = "NONE" | "ACTIVE_OBLIGATION" | "UNRESOLVED";

/** The server-only local billing record for a family (`familyBilling/{familyId}`), if any. */
export type LocalPurchaseState = "NONE" | "ACTIVE" | "PENDING";

/**
 * Combine the provider answer with the local billing record. A missing local purchase token alone
 * never proves zero liability: the provider must also say NONE, and the local record must agree.
 */
export function combineLiability(provider: ProviderLiability, local: LocalPurchaseState): Liability {
  if (local === "PENDING") return "UNRESOLVED";
  if (provider === "ACTIVE_OBLIGATION") return "PAID_OBLIGATION";
  if (provider === "NONE" && local === "NONE") return "ZERO_VERIFIED";
  return "UNRESOLVED";
}

// ---------------------------------------------------------------------------------------------
// families.restore
// ---------------------------------------------------------------------------------------------

/**
 * D44 / INV-06 / D47 restore guard. Pending cancellation wins over waiver (matrix row 78/84);
 * the deadline is exclusive (`now >= recoverUntilAt` is expired).
 */
export function assertRestorable(state: LifecycleState, closure: ClosureCase | null, nowMillis: number): ClosureCase {
  if (state === "ACTIVE" || state === "UNENTITLED_AWAITING_PAYMENT") throw new DomainError("FAMILY_NOT_CLOSED");
  if (closure === null) throw new DomainError("INTERNAL");
  if (state === "CLOSURE_PENDING_BILLING") throw new DomainError("CLOSURE_CANCELLATION_IN_PROGRESS");
  if (closure.waiverCommittedAtMillis !== null) throw new DomainError("RECOVERY_ALREADY_WAIVED");
  if (state === "DELETION_PENDING") throw new DomainError("CLOSURE_RECOVERY_EXPIRED");
  // CLOSING: a recovery clock must exist, and only financial finality starts it.
  if (closure.recoverUntilAtMillis === null || !FINANCIALLY_FINAL.includes(closure.cancellationStatus)) {
    throw new DomainError("INTERNAL");
  }
  if (nowMillis >= closure.recoverUntilAtMillis) throw new DomainError("CLOSURE_RECOVERY_EXPIRED");
  return closure;
}

// ---------------------------------------------------------------------------------------------
// families.waiveRecovery
// ---------------------------------------------------------------------------------------------

export type WaiveAction =
  /** CLOSURE_PENDING_BILLING: persist irrevocable intent only; no release (D47). */
  | "RECORD_INTENT"
  /** CLOSING: commit the waiver and attempt the release milestone in the same transaction. */
  | "COMMIT_AND_RELEASE";

export function decideWaive(state: LifecycleState, closure: ClosureCase | null, nowMillis: number): WaiveAction {
  if (state === "ACTIVE" || state === "UNENTITLED_AWAITING_PAYMENT") {
    throw new DomainError("CLOSURE_NOT_ELIGIBLE_FOR_WAIVER");
  }
  if (closure === null) throw new DomainError("INTERNAL");
  if (closure.waiverCommittedAtMillis !== null) throw new DomainError("RECOVERY_ALREADY_WAIVED");
  if (state === "DELETION_PENDING") throw new DomainError("CLOSURE_RECOVERY_EXPIRED");
  if (state === "CLOSURE_PENDING_BILLING") return "RECORD_INTENT";
  if (closure.recoverUntilAtMillis === null) throw new DomainError("INTERNAL");
  if (nowMillis >= closure.recoverUntilAtMillis) throw new DomainError("CLOSURE_RECOVERY_EXPIRED");
  return "COMMIT_AND_RELEASE";
}

// ---------------------------------------------------------------------------------------------
// Release milestone: entry to DELETION_PENDING (GAI-S3-BLK-03, INV-08, S3-D05)
// ---------------------------------------------------------------------------------------------

export type ReleaseBlockedReason =
  /** Neither an irrevocable waiver nor an elapsed deadline. */
  | "RECOVERY_OPEN"
  /** No verified cancellation and no verified zero liability. */
  | "FINANCIAL_FINALITY_MISSING"
  /** A pending purchase or reservation reconciliation hold exists. */
  | "RECONCILIATION_HOLD"
  /** users/{ownerUid}.ownedFamilyId does not name this family, or the owner does not match. */
  | "CLAIM_MISMATCH";

export interface ReleaseFacts {
  readonly closure: ClosureCase;
  readonly familyId: string;
  /** families/{familyId}.ownerUid as read in the transaction. */
  readonly familyOwnerUid: string;
  /** users/{ownerUid}.ownedFamilyId as read in the transaction. */
  readonly claimedFamilyId: unknown;
  /** True when the local billing record shows a pending purchase (reconciliation hold). */
  readonly reconciliationHold: boolean;
  readonly nowMillis: number;
}

export type ReleaseDecision = { readonly ok: true } | { readonly ok: false; readonly reason: ReleaseBlockedReason };

/** All four guards must pass, or nothing is released and the state does not advance. */
export function decideRelease(f: ReleaseFacts): ReleaseDecision {
  const c = f.closure;
  const recoveryClosed =
    c.waiverCommittedAtMillis !== null || (c.recoverUntilAtMillis !== null && f.nowMillis >= c.recoverUntilAtMillis);
  if (!recoveryClosed) return { ok: false, reason: "RECOVERY_OPEN" };
  if (!FINANCIALLY_FINAL.includes(c.cancellationStatus)) return { ok: false, reason: "FINANCIAL_FINALITY_MISSING" };
  if (f.reconciliationHold) return { ok: false, reason: "RECONCILIATION_HOLD" };
  if (c.ownerUid !== f.familyOwnerUid || c.familyId !== f.familyId || f.claimedFamilyId !== f.familyId) {
    return { ok: false, reason: "CLAIM_MISMATCH" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Provider outcomes (fake-provider in 3A; never real Play evidence)
// ---------------------------------------------------------------------------------------------

export type CancellationOutcomeKind =
  /** Provider-confirmed cancellation finality. */
  | "VERIFIED"
  /** Accepted by the provider but not final yet. */
  | "PENDING"
  /** Outage or throttling: retry later. */
  | "RETRYABLE_FAILURE"
  /** Timeout or unknown result: the request may or may not have taken effect. */
  | "AMBIGUOUS"
  /** Provider refused permanently: escalate, never success. */
  | "PERMANENT_FAILURE";

export interface CancellationOutcome {
  readonly kind: CancellationOutcomeKind;
  /** Provider event order; 0 for synchronous worker results. */
  readonly sequence: number;
}

export type CaseAdvance =
  | { readonly changed: false; readonly why: "ALREADY_FINAL" | "STALE_EVENT" | "NOT_APPLICABLE" }
  | {
      readonly changed: true;
      readonly closure: ClosureCase;
      /** CLOSING when finality is reached; the caller then checks the release milestone if waived. */
      readonly lifecycleState: Extract<LifecycleState, "CLOSURE_PENDING_BILLING" | "CLOSING">;
    };

function retried(c: ClosureCase, nowMillis: number, sequence: number): ClosureCase {
  const attempts = c.attempts + 1;
  const exhausted = attempts >= MAX_PROVIDER_ATTEMPTS;
  return {
    ...c,
    attempts,
    cancellationStatus: exhausted ? "MANUAL_REVIEW" : c.cancellationStatus,
    nextAttemptAtMillis: exhausted ? null : nowMillis + retryDelayMs(attempts),
    lastProviderSequence: Math.max(c.lastProviderSequence, sequence),
    revision: c.revision + 1,
  };
}

function finalized(c: ClosureCase, nowMillis: number, status: "VERIFIED" | "NOT_REQUIRED", sequence: number): ClosureCase {
  return {
    ...c,
    cancellationStatus: status,
    closureConfirmedAtMillis: nowMillis,
    recoverUntilAtMillis: nowMillis + RECOVERY_WINDOW_MS,
    nextAttemptAtMillis: null,
    lastProviderSequence: Math.max(c.lastProviderSequence, sequence),
    revision: c.revision + 1,
  };
}

/**
 * Apply one cancellation outcome to a paid case (PENDING or MANUAL_REVIEW). Duplicate and late
 * events are no-ops; a VERIFIED outcome is accepted whatever its sequence, because finality is
 * authoritative; any other outcome older than the last applied one is ignored (reordering).
 */
export function applyCancellationOutcome(
  c: ClosureCase,
  outcome: CancellationOutcome,
  nowMillis: number,
): CaseAdvance {
  if (c.restoredAtMillis !== null || c.deletionPendingAtMillis !== null) return { changed: false, why: "NOT_APPLICABLE" };
  if (c.cancellationStatus === "VERIFIED" || c.cancellationStatus === "NOT_REQUIRED") {
    return { changed: false, why: "ALREADY_FINAL" };
  }
  if (c.cancellationStatus === "LIABILITY_UNRESOLVED") return { changed: false, why: "NOT_APPLICABLE" };
  if (outcome.kind === "VERIFIED") {
    return { changed: true, closure: finalized(c, nowMillis, "VERIFIED", outcome.sequence), lifecycleState: "CLOSING" };
  }
  if (outcome.sequence !== 0 && outcome.sequence <= c.lastProviderSequence) return { changed: false, why: "STALE_EVENT" };
  if (c.cancellationStatus === "MANUAL_REVIEW") return { changed: false, why: "ALREADY_FINAL" };
  if (outcome.kind === "PERMANENT_FAILURE") {
    return {
      changed: true,
      closure: {
        ...c,
        cancellationStatus: "MANUAL_REVIEW",
        nextAttemptAtMillis: null,
        lastProviderSequence: Math.max(c.lastProviderSequence, outcome.sequence),
        revision: c.revision + 1,
      },
      lifecycleState: "CLOSURE_PENDING_BILLING",
    };
  }
  return { changed: true, closure: retried(c, nowMillis, outcome.sequence), lifecycleState: "CLOSURE_PENDING_BILLING" };
}

/** Re-check of a LIABILITY_UNRESOLVED hold (reconciliation worker). */
export function applyLiabilityRecheck(c: ClosureCase, liability: Liability, nowMillis: number): CaseAdvance {
  if (c.restoredAtMillis !== null || c.deletionPendingAtMillis !== null) return { changed: false, why: "NOT_APPLICABLE" };
  if (c.cancellationStatus !== "LIABILITY_UNRESOLVED") return { changed: false, why: "NOT_APPLICABLE" };
  switch (liability) {
    case "ZERO_VERIFIED":
      return { changed: true, closure: finalized(c, nowMillis, "NOT_REQUIRED", 0), lifecycleState: "CLOSING" };
    case "PAID_OBLIGATION":
      return {
        changed: true,
        closure: { ...c, cancellationStatus: "PENDING", attempts: 0, nextAttemptAtMillis: nowMillis, revision: c.revision + 1 },
        lifecycleState: "CLOSURE_PENDING_BILLING",
      };
    case "UNRESOLVED":
      return { changed: true, closure: retried(c, nowMillis, 0), lifecycleState: "CLOSURE_PENDING_BILLING" };
  }
}

// ---------------------------------------------------------------------------------------------
// families.getClosureStatus projection (A2 §A2.2)
// ---------------------------------------------------------------------------------------------

export type ClosureStatus =
  | "NOT_CLOSED"
  | "PROCESSING_CANCELLATION"
  | "MANUAL_BILLING_ACTION_REQUIRED"
  | "RECOVERY_AVAILABLE"
  | "RECOVERY_EXPIRED"
  | "WAIVER_RECORDED"
  | "DELETION_PENDING";

export interface ClosureStatusView {
  readonly lifecycleState: LifecycleState;
  readonly closureStatus: ClosureStatus;
  readonly waiverRecorded: boolean;
  /** Present only while recovery is available. */
  readonly recoverUntilAtMillis?: number;
}

/** Sanitized: no provider references, attempts, case IDs or other members' data. */
export function closureStatusView(state: LifecycleState, c: ClosureCase | null, nowMillis: number): ClosureStatusView {
  if (state === "ACTIVE" || state === "UNENTITLED_AWAITING_PAYMENT") {
    return { lifecycleState: state, closureStatus: "NOT_CLOSED", waiverRecorded: false };
  }
  if (c === null) throw new DomainError("INTERNAL");
  const waiverRecorded = c.waiverCommittedAtMillis !== null;
  if (state === "DELETION_PENDING") return { lifecycleState: state, closureStatus: "DELETION_PENDING", waiverRecorded };
  if (state === "CLOSURE_PENDING_BILLING") {
    const closureStatus = c.cancellationStatus === "MANUAL_REVIEW" ? "MANUAL_BILLING_ACTION_REQUIRED" : "PROCESSING_CANCELLATION";
    return { lifecycleState: state, closureStatus, waiverRecorded };
  }
  if (waiverRecorded) return { lifecycleState: state, closureStatus: "WAIVER_RECORDED", waiverRecorded };
  if (c.recoverUntilAtMillis !== null && nowMillis < c.recoverUntilAtMillis) {
    return { lifecycleState: state, closureStatus: "RECOVERY_AVAILABLE", waiverRecorded, recoverUntilAtMillis: c.recoverUntilAtMillis };
  }
  return { lifecycleState: state, closureStatus: "RECOVERY_EXPIRED", waiverRecorded };
}
