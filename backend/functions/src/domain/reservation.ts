/**
 * Expired-reservation reconciliation (D46, INV-09, G-01; Work Package v0.2 §4 last three rows).
 * Substage 3A scope: decide and record the reconciliation disposition. It never releases the owner
 * claim (no reservation-release path is ratified) and never activates a family (activation belongs to
 * billing.verifyPurchase, outside 3A). A purchase is never rebound to a different family.
 */
import { DomainError } from "../contract/errors.js";
import { isReservationExpired } from "./family.js";
import type { LocalPurchaseState, ProviderLiability } from "./lifecycle.js";

export type ReservationDisposition =
  /** A purchase may be pending or delayed: hold, keep the original binding and the owner claim. */
  | "RESERVATION_RECONCILIATION_PENDING"
  /** Expired, provider and local record both show no purchase. The claim stays until a release path is ratified. */
  | "EXPIRED_NO_PURCHASE_FOUND"
  /** Provider-verified payment for the ORIGINAL reservation; activation itself is out of 3A scope. */
  | "PAYMENT_VERIFIED_ORIGINAL_RESERVATION"
  /** The purchase correlation changed or conflicts: approved remediation/refund path, never a rebind. */
  | "REMEDIATION_REQUIRED";

export const TERMINAL_DISPOSITIONS: readonly ReservationDisposition[] = [
  "EXPIRED_NO_PURCHASE_FOUND",
  "PAYMENT_VERIFIED_ORIGINAL_RESERVATION",
  "REMEDIATION_REQUIRED",
];

export interface ReservationFacts {
  readonly reservationExpiresAtMillis: number;
  readonly nowMillis: number;
  readonly local: LocalPurchaseState;
  readonly provider: ProviderLiability;
  /** Purchase correlation recorded when the hold was first entered (null if never held). */
  readonly originalPurchaseRef: string | null;
  readonly currentPurchaseRef: string | null;
  /** True once a hold was recorded: its correlation is immutable from then on. */
  readonly held: boolean;
}

/** Null before the TTL: the worker does nothing to a live reservation. */
export function decideReservationDisposition(f: ReservationFacts): ReservationDisposition | null {
  if (!isReservationExpired(f.reservationExpiresAtMillis, f.nowMillis)) return null;
  if (f.held && f.originalPurchaseRef !== f.currentPurchaseRef) return "REMEDIATION_REQUIRED";
  if (f.provider === "ACTIVE_OBLIGATION") return "PAYMENT_VERIFIED_ORIGINAL_RESERVATION";
  if (f.local === "PENDING" || f.provider === "UNRESOLVED" || f.local === "ACTIVE") return "RESERVATION_RECONCILIATION_PENDING";
  return "EXPIRED_NO_PURCHASE_FOUND";
}

/** D46: a new checkout attempt at or after the TTL is RESERVATION_EXPIRED (domain rule; no endpoint in 3A). */
export function assertCheckoutAllowed(reservationExpiresAtMillis: number, nowMillis: number): void {
  if (isReservationExpired(reservationExpiresAtMillis, nowMillis)) throw new DomainError("RESERVATION_EXPIRED");
}
