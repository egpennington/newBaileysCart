/**
 * Domain error codes (API v0.4 §8; Slice 3 additions below) and their callable transport mapping.
 *
 * Canonical codes follow GAI's W-01 mapping table. `retryable` means "the identical
 * request (same opId and payload) may succeed later without user action"; values are
 * derived from the ratified contract where it speaks and are flagged for CipherMuse
 * confirmation in the Slice 1 report where it does not.
 */
import type { FunctionsErrorCode } from "firebase-functions/v2/https";

export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "OWNER_ALREADY_HAS_FAMILY"
  | "IDEMPOTENCY_KEY_REUSED"
  | "VALIDATION_FAILED"
  | "API_VERSION_UNSUPPORTED"
  | "RATE_LIMITED"
  | "INTERNAL"
  // WP-03 Slice 3 lifecycle (API v0.4 §6 list, D44/D47 addendum, A2 candidate §A2.6).
  | "NOT_FOUND"
  | "OWNER_REQUIRED"
  | "STALE_EPOCH_REJECTED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_EXPIRED"
  | "UNENTITLED_AWAITING_PAYMENT"
  | "FAMILY_CLOSURE_PENDING"
  | "FAMILY_CLOSING"
  | "FAMILY_DELETION_PENDING"
  | "FAMILY_NOT_CLOSED"
  | "CLOSURE_CANCELLATION_IN_PROGRESS"
  | "CLOSURE_RECOVERY_EXPIRED"
  | "RECOVERY_ALREADY_WAIVED"
  | "CLOSURE_NOT_ELIGIBLE_FOR_WAIVER"
  | "RESERVATION_EXPIRED";

interface ErrorSpec {
  readonly canonical: FunctionsErrorCode;
  readonly retryable: boolean;
  /** Fixed, non-sensitive transport message. Clients must use details.error.code instead. */
  readonly message: string;
}

export const ERROR_SPECS: Readonly<Record<DomainErrorCode, ErrorSpec>> = {
  // Requires a new sign-in; the same request cannot succeed unchanged.
  UNAUTHENTICATED: { canonical: "unauthenticated", retryable: false, message: "Authentication required." },
  // Matrix: "No family or trial claim". Requires user action (verify, refresh token).
  EMAIL_VERIFICATION_REQUIRED: {
    canonical: "failed-precondition",
    retryable: false,
    message: "Email verification required.",
  },
  // D42: permanent while the owned family or reservation is unreleased (PL-2).
  OWNER_ALREADY_HAS_FAMILY: {
    canonical: "failed-precondition",
    retryable: false,
    message: "Caller already owns a family.",
  },
  // API §5: replay with changed payload; the request itself is wrong.
  IDEMPOTENCY_KEY_REUSED: { canonical: "invalid-argument", retryable: false, message: "Operation ID reused." },
  VALIDATION_FAILED: { canonical: "invalid-argument", retryable: false, message: "Request validation failed." },
  // Matrix: "None; queue retained for upgrade". Not retryable until the client upgrades.
  API_VERSION_UNSUPPORTED: { canonical: "invalid-argument", retryable: false, message: "API version unsupported." },
  // Reserved; not raised in Slice 1. Backoff retry is the intended client behavior.
  RATE_LIMITED: { canonical: "resource-exhausted", retryable: true, message: "Rate limited." },
  // Matrix: outages retry the identical opId/payload; idempotency prevents duplicate effects.
  INTERNAL: { canonical: "internal", retryable: true, message: "Internal error." },

  // --- WP-03 Slice 3 (Substage 3A). Transport mappings are CODI proposals for GAI D4 and
  // CipherMuse A2 confirmation; the ratified matrix leaves them open (W-01/W-02). ---
  // W-02 step 5. Same response whatever the reason, so no family state is disclosed.
  NOT_FOUND: { canonical: "not-found", retryable: false, message: "Family not found." },
  OWNER_REQUIRED: { canonical: "permission-denied", retryable: false, message: "Family owner required." },
  // D43: the old work is quarantined; the client refreshes its session instead of retrying.
  STALE_EPOCH_REJECTED: { canonical: "failed-precondition", retryable: false, message: "Family epoch is stale." },
  // A fresh online confirmation is needed (user action), so the identical request cannot succeed.
  CONFIRMATION_REQUIRED: { canonical: "failed-precondition", retryable: false, message: "Confirmation required." },
  CONFIRMATION_EXPIRED: { canonical: "failed-precondition", retryable: false, message: "Confirmation expired." },
  // INV-05: a reservation follows its own contract; it is not closable as an ACTIVE family.
  UNENTITLED_AWAITING_PAYMENT: {
    canonical: "failed-precondition",
    retryable: false,
    message: "Family is awaiting payment.",
  },
  FAMILY_CLOSURE_PENDING: { canonical: "failed-precondition", retryable: false, message: "Family closure pending." },
  FAMILY_CLOSING: { canonical: "failed-precondition", retryable: false, message: "Family is closing." },
  FAMILY_DELETION_PENDING: { canonical: "failed-precondition", retryable: false, message: "Family deletion pending." },
  // PROVISIONAL (not in the R-04 §6 list): families.restore on a family that was never closed.
  FAMILY_NOT_CLOSED: { canonical: "failed-precondition", retryable: false, message: "Family is not closed." },
  // D44: the client shows processing status; no automatic retry (A2 §A2.6).
  CLOSURE_CANCELLATION_IN_PROGRESS: {
    canonical: "failed-precondition",
    retryable: false,
    message: "Closure cancellation in progress.",
  },
  CLOSURE_RECOVERY_EXPIRED: { canonical: "failed-precondition", retryable: false, message: "Recovery period expired." },
  RECOVERY_ALREADY_WAIVED: { canonical: "failed-precondition", retryable: false, message: "Recovery already waived." },
  CLOSURE_NOT_ELIGIBLE_FOR_WAIVER: {
    canonical: "failed-precondition",
    retryable: false,
    message: "Family is not eligible for waiver.",
  },
  // D46 / A2 §A2.6: no new checkout after the 24-hour TTL. Not raised by a callable in 3A
  // (no checkout endpoint exists); domain rule only (domain/reservation.ts).
  RESERVATION_EXPIRED: { canonical: "failed-precondition", retryable: false, message: "Reservation expired." },
};

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly details: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(code);
    this.name = "DomainError";
  }
}
