/**
 * Slice 1 domain error codes (API v0.4 §8) and their callable transport mapping.
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
  | "INTERNAL";

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
