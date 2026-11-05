/**
 * D1: pure family-lifecycle engine (WP-03 Slice 3, Substage 3A). ProofPoints PL-PP-WP03-17..20,
 * -27..-30 at depth D1. Exhaustive state x command matrices, exact time boundaries and
 * provider-outcome ordering. No Firebase dependency.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { DomainError, ERROR_SPECS } from "../../src/contract/errors.js";
import type { DomainErrorCode } from "../../src/contract/errors.js";
import { LIFECYCLE_STATES, RECOVERY_WINDOW_MS, accessModeFor } from "../../src/domain/family.js";
import type { LifecycleState } from "../../src/domain/family.js";
import {
  MAX_PROVIDER_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  applyCancellationOutcome,
  applyLiabilityRecheck,
  assertClosable,
  assertRestorable,
  closureStatusView,
  combineLiability,
  decideCloseOutcome,
  decideRelease,
  decideWaive,
  retryDelayMs,
} from "../../src/domain/lifecycle.js";
import type { CancellationOutcomeKind, ClosureCase, LocalPurchaseState, ProviderLiability } from "../../src/domain/lifecycle.js";

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0, 0);
const DEADLINE = T0 + RECOVERY_WINDOW_MS;

function code(fn: () => unknown): DomainErrorCode | "OK" {
  try {
    fn();
    return "OK";
  } catch (err) {
    assert.ok(err instanceof DomainError, String(err));
    return err.code;
  }
}

const base: ClosureCase = {
  caseId: "case1",
  familyId: "fam1",
  ownerUid: "owner1",
  sourceEpoch: 1,
  cancellationStatus: "NOT_REQUIRED",
  closedAtMillis: T0,
  closureConfirmedAtMillis: T0,
  recoverUntilAtMillis: DEADLINE,
  waiverCommittedAtMillis: null,
  attempts: 0,
  nextAttemptAtMillis: null,
  lastProviderSequence: 0,
  releaseBlockedReason: null,
  deletionPendingAtMillis: null,
  ownershipReleasedAtMillis: null,
  restoredAtMillis: null,
  revision: 1,
};
const pendingPaid: ClosureCase = {
  ...base,
  cancellationStatus: "PENDING",
  closureConfirmedAtMillis: null,
  recoverUntilAtMillis: null,
  nextAttemptAtMillis: T0,
};
const waived = (c: ClosureCase): ClosureCase => ({ ...c, waiverCommittedAtMillis: T0 + 1 });

describe("closure states give no shopping access to anyone (PL-PP-WP03-17 D1)", () => {
  for (const s of LIFECYCLE_STATES) {
    test(`${s}`, () => {
      const mode = accessModeFor({ lifecycleState: s, trialEndsAtMillis: T0 + 1_000_000 }, T0);
      assert.equal(mode, s === "ACTIVE" ? "READ_WRITE" : "NONE");
    });
  }
});

describe("families.close lifecycle guard: only ACTIVE closes", () => {
  const expected: Record<LifecycleState, DomainErrorCode | "OK"> = {
    ACTIVE: "OK",
    UNENTITLED_AWAITING_PAYMENT: "UNENTITLED_AWAITING_PAYMENT",
    CLOSURE_PENDING_BILLING: "FAMILY_CLOSURE_PENDING",
    CLOSING: "FAMILY_CLOSING",
    DELETION_PENDING: "FAMILY_DELETION_PENDING",
  };
  for (const s of LIFECYCLE_STATES) test(`${s} -> ${expected[s]}`, () => assert.equal(code(() => assertClosable(s)), expected[s]));
});

describe("close outcome by liability (S3-D09, GAI-S3-BLK-02; PL-PP-WP03-17/-18 D1)", () => {
  test("verified zero liability -> CLOSING, clock starts at commit, no cancellation", () => {
    assert.deepEqual(decideCloseOutcome("ZERO_VERIFIED", T0), {
      lifecycleState: "CLOSING",
      cancellationStatus: "NOT_REQUIRED",
      closureConfirmedAtMillis: T0,
      recoverUntilAtMillis: T0 + 30 * 86_400_000,
      dispatchCancellation: false,
    });
  });
  test("paid obligation -> CLOSURE_PENDING_BILLING, no clock, cancellation dispatched", () => {
    const o = decideCloseOutcome("PAID_OBLIGATION", T0);
    assert.equal(o.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(o.recoverUntilAtMillis, null);
    assert.equal(o.dispatchCancellation, true);
  });
  test("unresolved -> CLOSURE_PENDING_BILLING hold, no clock, no cancellation", () => {
    const o = decideCloseOutcome("UNRESOLVED", T0);
    assert.equal(o.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(o.cancellationStatus, "LIABILITY_UNRESOLVED");
    assert.equal(o.recoverUntilAtMillis, null);
    assert.equal(o.dispatchCancellation, false);
  });

  // Exhaustive: zero liability only when the provider says NONE AND the local record says NONE.
  const providers: ProviderLiability[] = ["NONE", "ACTIVE_OBLIGATION", "UNRESOLVED"];
  const locals: LocalPurchaseState[] = ["NONE", "ACTIVE", "PENDING"];
  for (const p of providers) {
    for (const l of locals) {
      const want = l === "PENDING" ? "UNRESOLVED" : p === "ACTIVE_OBLIGATION" ? "PAID_OBLIGATION" : p === "NONE" && l === "NONE" ? "ZERO_VERIFIED" : "UNRESOLVED";
      test(`provider ${p} + local ${l} -> ${want}`, () => assert.equal(combineLiability(p, l), want));
    }
  }
  test("a missing local token alone (local NONE) never proves zero liability without the provider", () => {
    assert.equal(combineLiability("UNRESOLVED", "NONE"), "UNRESOLVED");
  });
});

describe("families.restore guard (D44, matrix rows 47-50/78; PL-PP-WP03-19/-20 D1)", () => {
  test("ACTIVE / UNENTITLED -> FAMILY_NOT_CLOSED", () => {
    assert.equal(code(() => assertRestorable("ACTIVE", null, T0)), "FAMILY_NOT_CLOSED");
    assert.equal(code(() => assertRestorable("UNENTITLED_AWAITING_PAYMENT", null, T0)), "FAMILY_NOT_CLOSED");
  });
  test("pending cancellation -> CLOSURE_CANCELLATION_IN_PROGRESS, even after a waiver (matrix row 78/84)", () => {
    assert.equal(code(() => assertRestorable("CLOSURE_PENDING_BILLING", pendingPaid, T0)), "CLOSURE_CANCELLATION_IN_PROGRESS");
    assert.equal(code(() => assertRestorable("CLOSURE_PENDING_BILLING", waived(pendingPaid), T0)), "CLOSURE_CANCELLATION_IN_PROGRESS");
  });
  test("deadline boundary: 1 ms before succeeds; at and after is CLOSURE_RECOVERY_EXPIRED", () => {
    assert.equal(code(() => assertRestorable("CLOSING", base, DEADLINE - 1)), "OK");
    assert.equal(code(() => assertRestorable("CLOSING", base, DEADLINE)), "CLOSURE_RECOVERY_EXPIRED");
    assert.equal(code(() => assertRestorable("CLOSING", base, DEADLINE + 1)), "CLOSURE_RECOVERY_EXPIRED");
  });
  test("waived CLOSING or DELETION_PENDING -> RECOVERY_ALREADY_WAIVED", () => {
    assert.equal(code(() => assertRestorable("CLOSING", waived(base), T0)), "RECOVERY_ALREADY_WAIVED");
    assert.equal(code(() => assertRestorable("DELETION_PENDING", waived(base), T0)), "RECOVERY_ALREADY_WAIVED");
  });
  test("DELETION_PENDING by deadline -> CLOSURE_RECOVERY_EXPIRED", () => {
    assert.equal(code(() => assertRestorable("DELETION_PENDING", base, DEADLINE)), "CLOSURE_RECOVERY_EXPIRED");
  });
  test("fail closed: CLOSING without a clock or without financial finality is INTERNAL", () => {
    assert.equal(code(() => assertRestorable("CLOSING", { ...base, recoverUntilAtMillis: null }, T0)), "INTERNAL");
    assert.equal(code(() => assertRestorable("CLOSING", { ...base, cancellationStatus: "PENDING" }, T0)), "INTERNAL");
    assert.equal(code(() => assertRestorable("CLOSING", null, T0)), "INTERNAL");
  });
});

describe("families.waiveRecovery guard (D47, matrix rows 74-79; PL-PP-WP03-27/-28/-29 D1)", () => {
  test("ACTIVE / UNENTITLED -> CLOSURE_NOT_ELIGIBLE_FOR_WAIVER", () => {
    assert.equal(code(() => decideWaive("ACTIVE", null, T0)), "CLOSURE_NOT_ELIGIBLE_FOR_WAIVER");
    assert.equal(code(() => decideWaive("UNENTITLED_AWAITING_PAYMENT", null, T0)), "CLOSURE_NOT_ELIGIBLE_FOR_WAIVER");
  });
  test("pending cancellation -> RECORD_INTENT; CLOSING before deadline -> COMMIT_AND_RELEASE", () => {
    assert.equal(decideWaive("CLOSURE_PENDING_BILLING", pendingPaid, T0), "RECORD_INTENT");
    assert.equal(decideWaive("CLOSING", base, DEADLINE - 1), "COMMIT_AND_RELEASE");
  });
  test("repeat waiver (new opId) -> RECOVERY_ALREADY_WAIVED in every closed state", () => {
    for (const s of ["CLOSURE_PENDING_BILLING", "CLOSING", "DELETION_PENDING"] as const) {
      assert.equal(code(() => decideWaive(s, waived(s === "CLOSURE_PENDING_BILLING" ? pendingPaid : base), T0)), "RECOVERY_ALREADY_WAIVED");
    }
  });
  test("CLOSING at the deadline or DELETION_PENDING by deadline -> CLOSURE_RECOVERY_EXPIRED", () => {
    assert.equal(code(() => decideWaive("CLOSING", base, DEADLINE)), "CLOSURE_RECOVERY_EXPIRED");
    assert.equal(code(() => decideWaive("DELETION_PENDING", base, T0)), "CLOSURE_RECOVERY_EXPIRED");
  });
});

describe("release milestone guards (GAI-S3-BLK-03, INV-08; PL-PP-WP03-20/-29/-30 D1)", () => {
  const facts = (over: Partial<Parameters<typeof decideRelease>[0]> = {}) => ({
    closure: waived(base),
    familyId: "fam1",
    familyOwnerUid: "owner1",
    claimedFamilyId: "fam1" as unknown,
    reconciliationHold: false,
    nowMillis: T0 + 2,
    ...over,
  });
  test("all guards pass -> ok", () => assert.deepEqual(decideRelease(facts()), { ok: true }));
  test("no waiver and deadline not reached -> RECOVERY_OPEN; at the deadline -> ok", () => {
    assert.deepEqual(decideRelease(facts({ closure: base, nowMillis: DEADLINE - 1 })), { ok: false, reason: "RECOVERY_OPEN" });
    assert.deepEqual(decideRelease(facts({ closure: base, nowMillis: DEADLINE })), { ok: true });
  });
  for (const s of ["PENDING", "LIABILITY_UNRESOLVED", "MANUAL_REVIEW"] as const) {
    test(`waiver without financial finality (${s}) -> FINANCIAL_FINALITY_MISSING`, () => {
      assert.deepEqual(decideRelease(facts({ closure: waived({ ...base, cancellationStatus: s }) })), {
        ok: false,
        reason: "FINANCIAL_FINALITY_MISSING",
      });
    });
  }
  test("pending purchase hold -> RECONCILIATION_HOLD", () => {
    assert.deepEqual(decideRelease(facts({ reconciliationHold: true })), { ok: false, reason: "RECONCILIATION_HOLD" });
  });
  for (const [name, over] of Object.entries({
    "claim names another family": { claimedFamilyId: "famOther" },
    "claim already cleared": { claimedFamilyId: null },
    "claim malformed": { claimedFamilyId: 42 },
    "owner differs from case": { familyOwnerUid: "intruder" },
    "case for another family": { familyId: "famOther" },
  })) {
    test(`${name} -> CLAIM_MISMATCH (no cross-UID or cross-family release)`, () => {
      assert.deepEqual(decideRelease(facts(over)), { ok: false, reason: "CLAIM_MISMATCH" });
    });
  }
});

describe("cancellation outcomes: outage, timeout, permanent failure, duplicate, reorder (PL-PP-WP03-18 D1)", () => {
  test("VERIFIED -> CLOSING, clock = verification time + 30 d, exactly once", () => {
    const a = applyCancellationOutcome(pendingPaid, { kind: "VERIFIED", sequence: 0 }, T0 + 5);
    assert.ok(a.changed);
    assert.equal(a.lifecycleState, "CLOSING");
    assert.equal(a.closure.cancellationStatus, "VERIFIED");
    assert.equal(a.closure.recoverUntilAtMillis, T0 + 5 + RECOVERY_WINDOW_MS);
    const again = applyCancellationOutcome(a.closure, { kind: "VERIFIED", sequence: 0 }, T0 + 99);
    assert.deepEqual(again, { changed: false, why: "ALREADY_FINAL" });
  });
  for (const kind of ["PENDING", "RETRYABLE_FAILURE", "AMBIGUOUS"] as CancellationOutcomeKind[]) {
    test(`${kind}: stays pending, no clock, bounded backoff`, () => {
      const a = applyCancellationOutcome(pendingPaid, { kind, sequence: 0 }, T0);
      assert.ok(a.changed);
      assert.equal(a.lifecycleState, "CLOSURE_PENDING_BILLING");
      assert.equal(a.closure.cancellationStatus, "PENDING");
      assert.equal(a.closure.recoverUntilAtMillis, null);
      assert.equal(a.closure.attempts, 1);
      assert.equal(a.closure.nextAttemptAtMillis, T0 + retryDelayMs(1));
    });
  }
  test("retries exhaust to MANUAL_REVIEW; never success", () => {
    let c = pendingPaid;
    for (let i = 0; i < MAX_PROVIDER_ATTEMPTS; i++) {
      const a = applyCancellationOutcome(c, { kind: "RETRYABLE_FAILURE", sequence: 0 }, T0 + i);
      assert.ok(a.changed);
      c = a.closure;
    }
    assert.equal(c.cancellationStatus, "MANUAL_REVIEW");
    assert.equal(c.recoverUntilAtMillis, null);
    assert.equal(c.nextAttemptAtMillis, null);
  });
  test("backoff is monotone and capped", () => {
    for (let n = 1; n < 30; n++) assert.ok(retryDelayMs(n + 1) >= retryDelayMs(n));
    assert.equal(retryDelayMs(40), MAX_RETRY_DELAY_MS);
  });
  test("PERMANENT_FAILURE -> MANUAL_REVIEW, no clock, family stays pending", () => {
    const a = applyCancellationOutcome(pendingPaid, { kind: "PERMANENT_FAILURE", sequence: 1 }, T0);
    assert.ok(a.changed);
    assert.equal(a.closure.cancellationStatus, "MANUAL_REVIEW");
    assert.equal(a.lifecycleState, "CLOSURE_PENDING_BILLING");
    assert.equal(a.closure.recoverUntilAtMillis, null);
  });
  test("reordered: an older non-final event after a newer one is ignored", () => {
    const a = applyCancellationOutcome(pendingPaid, { kind: "PENDING", sequence: 5 }, T0);
    assert.ok(a.changed);
    assert.deepEqual(applyCancellationOutcome(a.closure, { kind: "PERMANENT_FAILURE", sequence: 3 }, T0), { changed: false, why: "STALE_EVENT" });
  });
  test("reordered: a late PENDING after VERIFIED cannot regress", () => {
    const v = applyCancellationOutcome(pendingPaid, { kind: "VERIFIED", sequence: 7 }, T0);
    assert.ok(v.changed);
    assert.deepEqual(applyCancellationOutcome(v.closure, { kind: "PENDING", sequence: 9 }, T0), { changed: false, why: "ALREADY_FINAL" });
  });
  test("VERIFIED after MANUAL_REVIEW is accepted (authoritative finality)", () => {
    const m = applyCancellationOutcome(pendingPaid, { kind: "PERMANENT_FAILURE", sequence: 1 }, T0);
    assert.ok(m.changed);
    const v = applyCancellationOutcome(m.closure, { kind: "VERIFIED", sequence: 2 }, T0 + 10);
    assert.ok(v.changed);
    assert.equal(v.closure.cancellationStatus, "VERIFIED");
  });
  test("zero-liability cases never take cancellation outcomes", () => {
    assert.deepEqual(applyCancellationOutcome(base, { kind: "VERIFIED", sequence: 0 }, T0), { changed: false, why: "ALREADY_FINAL" });
  });
  test("restored or deletion-pending cases are inert", () => {
    assert.deepEqual(applyCancellationOutcome({ ...pendingPaid, restoredAtMillis: T0 }, { kind: "VERIFIED", sequence: 0 }, T0), {
      changed: false,
      why: "NOT_APPLICABLE",
    });
  });
});

describe("liability re-check of a reconciliation hold", () => {
  const hold: ClosureCase = { ...pendingPaid, cancellationStatus: "LIABILITY_UNRESOLVED" };
  test("ZERO_VERIFIED -> CLOSING; the clock starts at the re-check, not at close", () => {
    const a = applyLiabilityRecheck(hold, "ZERO_VERIFIED", T0 + 1000);
    assert.ok(a.changed);
    assert.equal(a.lifecycleState, "CLOSING");
    assert.equal(a.closure.recoverUntilAtMillis, T0 + 1000 + RECOVERY_WINDOW_MS);
  });
  test("PAID_OBLIGATION -> PENDING cancellation, due now", () => {
    const a = applyLiabilityRecheck(hold, "PAID_OBLIGATION", T0 + 1);
    assert.ok(a.changed);
    assert.equal(a.closure.cancellationStatus, "PENDING");
    assert.equal(a.closure.nextAttemptAtMillis, T0 + 1);
  });
  test("UNRESOLVED -> still held, retry scheduled, no clock", () => {
    const a = applyLiabilityRecheck(hold, "UNRESOLVED", T0);
    assert.ok(a.changed);
    assert.equal(a.closure.cancellationStatus, "LIABILITY_UNRESOLVED");
    assert.equal(a.closure.recoverUntilAtMillis, null);
  });
});

describe("getClosureStatus projection is sanitized (AC-S3-10)", () => {
  test("RECOVERY_AVAILABLE carries the deadline; nothing provider-related", () => {
    const v = closureStatusView("CLOSING", base, T0);
    assert.deepEqual(v, { lifecycleState: "CLOSING", closureStatus: "RECOVERY_AVAILABLE", waiverRecorded: false, recoverUntilAtMillis: DEADLINE });
  });
  test("every state maps to a status; DELETION_PENDING is never PURGED", () => {
    assert.equal(closureStatusView("ACTIVE", null, T0).closureStatus, "NOT_CLOSED");
    assert.equal(closureStatusView("CLOSURE_PENDING_BILLING", pendingPaid, T0).closureStatus, "PROCESSING_CANCELLATION");
    assert.equal(
      closureStatusView("CLOSURE_PENDING_BILLING", { ...pendingPaid, cancellationStatus: "MANUAL_REVIEW" }, T0).closureStatus,
      "MANUAL_BILLING_ACTION_REQUIRED",
    );
    assert.equal(closureStatusView("CLOSING", base, DEADLINE).closureStatus, "RECOVERY_EXPIRED");
    assert.equal(closureStatusView("CLOSING", waived(base), T0).closureStatus, "WAIVER_RECORDED");
    assert.equal(closureStatusView("DELETION_PENDING", waived(base), T0).closureStatus, "DELETION_PENDING");
  });
});

describe("Slice 3 error transport mapping (proposed; GAI D4)", () => {
  const expected: Partial<Record<DomainErrorCode, string>> = {
    NOT_FOUND: "not-found",
    OWNER_REQUIRED: "permission-denied",
    STALE_EPOCH_REJECTED: "failed-precondition",
    CONFIRMATION_REQUIRED: "failed-precondition",
    CONFIRMATION_EXPIRED: "failed-precondition",
    CLOSURE_CANCELLATION_IN_PROGRESS: "failed-precondition",
    CLOSURE_RECOVERY_EXPIRED: "failed-precondition",
    RECOVERY_ALREADY_WAIVED: "failed-precondition",
  };
  for (const [c, canonical] of Object.entries(expected)) {
    test(`${c} -> ${canonical}, not retryable`, () => {
      const spec = ERROR_SPECS[c as DomainErrorCode];
      assert.equal(spec.canonical, canonical);
      assert.equal(spec.retryable, false);
    });
  }
});
