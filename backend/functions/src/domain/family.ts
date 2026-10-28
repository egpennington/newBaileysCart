/**
 * Family lifecycle and access rules for Slice 1 (API v0.4 §2; Decisions 42, 43, 45, 46).
 * Only ACTIVE (trial) and UNENTITLED_AWAITING_PAYMENT are created in this slice; any
 * other state read from storage is treated as no access (fail closed).
 */
export const TRIAL_DURATION_MS = 21 * 86_400_000;
export const RESERVATION_TTL_MS = 86_400_000;
export const INITIAL_FAMILY_EPOCH = 1;

export type LifecycleState = "ACTIVE" | "UNENTITLED_AWAITING_PAYMENT";
export type Role = "OWNER" | "MEMBER";

/** Provisional names (Slice 1 report §escalations): NONE per GAI; READ_ONLY per invariant 4. */
export type AccessMode = "READ_WRITE" | "READ_ONLY" | "NONE";

export interface FamilyAccessFacts {
  readonly lifecycleState: string;
  readonly trialEndsAtMillis: number | null;
}

export function accessModeFor(family: FamilyAccessFacts, nowMillis: number): AccessMode {
  if (family.lifecycleState !== "ACTIVE") return "NONE";
  // Slice 1 has no paid entitlement, so ACTIVE means trial. Trial is valid strictly before its end.
  if (family.trialEndsAtMillis === null) return "NONE";
  return nowMillis < family.trialEndsAtMillis ? "READ_WRITE" : "READ_ONLY";
}

export function isReservationExpired(reservationExpiresAtMillis: number, nowMillis: number): boolean {
  return nowMillis >= reservationExpiresAtMillis;
}
