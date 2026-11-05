/**
 * Family lifecycle and access rules (API v0.4 §2; Decisions 42-47).
 * families.create writes ACTIVE (trial) or UNENTITLED_AWAITING_PAYMENT. The WP-03 Slice 3
 * lifecycle commands add CLOSURE_PENDING_BILLING, CLOSING and DELETION_PENDING
 * (domain/lifecycle.ts). Every state other than ACTIVE gives no shopping access (fail closed).
 */
export const TRIAL_DURATION_MS = 21 * 86_400_000;
export const RESERVATION_TTL_MS = 86_400_000;
export const INITIAL_FAMILY_EPOCH = 1;
/** D44: recovery window, 30 elapsed days from verified cancellation or the no-liability close commit. */
export const RECOVERY_WINDOW_MS = 30 * 86_400_000;

export type LifecycleState =
  | "ACTIVE"
  | "UNENTITLED_AWAITING_PAYMENT"
  | "CLOSURE_PENDING_BILLING"
  | "CLOSING"
  | "DELETION_PENDING";

export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "ACTIVE",
  "UNENTITLED_AWAITING_PAYMENT",
  "CLOSURE_PENDING_BILLING",
  "CLOSING",
  "DELETION_PENDING",
];

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as readonly string[]).includes(value);
}
export type Role = "OWNER" | "MEMBER";

/** Provisional names (Slice 1 report §escalations): NONE per GAI; READ_ONLY per invariant 4. */
export type AccessMode = "READ_WRITE" | "READ_ONLY" | "NONE";

export interface FamilyAccessFacts {
  readonly lifecycleState: string;
  readonly trialEndsAtMillis: number | null;
}

export function accessModeFor(family: FamilyAccessFacts, nowMillis: number): AccessMode {
  if (family.lifecycleState !== "ACTIVE") return "NONE";
  // No paid entitlement exists yet (billing.verifyPurchase is not built), so ACTIVE access is
  // trial-derived. A restored family therefore never gains paid access (S3-D07). Trial is valid strictly before its end.
  if (family.trialEndsAtMillis === null) return "NONE";
  return nowMillis < family.trialEndsAtMillis ? "READ_WRITE" : "READ_ONLY";
}

export function isReservationExpired(reservationExpiresAtMillis: number, nowMillis: number): boolean {
  return nowMillis >= reservationExpiresAtMillis;
}
