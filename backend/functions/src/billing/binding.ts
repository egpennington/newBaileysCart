/**
 * Purchase-token binding decisions (Slice 3B Stage B1, handoff task 5; API v0.4 §2 invariant 2,
 * D45/D46). Pure. A purchase token is bound at most once, to exactly one (ownerUid, familyId,
 * package, product). This module never activates a family or grants entitlement: activation belongs
 * to the R-04 `billing.verifyPurchase` contract, which is not ratified for implementation yet.
 */
import type { LifecycleState } from "../domain/family.js";
import { isReservationExpired } from "../domain/family.js";
import type { LocalBilling } from "../persistence/lifecycleStore.js";
import type { TokenVerification } from "./playProvider.js";

export type BindingStatus =
  /** Provider-verified active subscription for this owner/family/product. No activation in B1. */
  | "BOUND"
  /** Provider says payment is pending: hold, never entitlement. */
  | "PENDING_PAYMENT"
  /** Verified (or pending) settlement after the 24-hour reservation TTL: reconciliation hold (D46). */
  | "HELD_LATE_SETTLEMENT";

export const BINDING_STATUSES: readonly BindingStatus[] = ["BOUND", "PENDING_PAYMENT", "HELD_LATE_SETTLEMENT"];

export type BindingRejection =
  | "INVALID_TOKEN"
  | "FAMILY_NOT_FOUND"
  | "NOT_OWNER"
  | "FAMILY_CLOSED"
  | "ALREADY_BOUND_ELSEWHERE"
  | "FAMILY_HAS_OTHER_PURCHASE"
  | "WRONG_PRODUCT"
  | "WRONG_ACCOUNT"
  | "UNSUPPORTED_PLAN"
  | "NOT_ENTITLED"
  | "NOT_FOUND"
  | "PROVIDER_UNRESOLVED";

export type BindingDecision =
  | { readonly kind: "WRITE"; readonly status: BindingStatus; readonly localPurchaseState: "ACTIVE" | "PENDING" }
  | { readonly kind: "ALREADY_BOUND_THIS_FAMILY" }
  | { readonly kind: "REJECT"; readonly reason: BindingRejection };

export interface BindingFamilyFacts {
  readonly ownerUid: string;
  readonly lifecycleState: LifecycleState;
  /** Present on UNENTITLED_AWAITING_PAYMENT reservations. */
  readonly reservationExpiresAtMillis: number | null;
}

export interface ExistingBinding {
  readonly familyId: string;
  readonly ownerUid: string;
}

/** Checks that need no provider call (run before and again after it). */
export function precheckBinding(
  family: BindingFamilyFacts | null,
  callerUid: string,
  familyId: string,
  existing: ExistingBinding | null,
  billing: LocalBilling,
  purchaseRef: string,
): BindingDecision | null {
  if (family === null) return { kind: "REJECT", reason: "FAMILY_NOT_FOUND" };
  if (family.ownerUid !== callerUid) return { kind: "REJECT", reason: "NOT_OWNER" };
  if (existing !== null) {
    return existing.familyId === familyId && existing.ownerUid === callerUid
      ? { kind: "ALREADY_BOUND_THIS_FAMILY" }
      : { kind: "REJECT", reason: "ALREADY_BOUND_ELSEWHERE" };
  }
  if (family.lifecycleState !== "ACTIVE" && family.lifecycleState !== "UNENTITLED_AWAITING_PAYMENT") {
    return { kind: "REJECT", reason: "FAMILY_CLOSED" };
  }
  if (billing.purchaseRef !== null && billing.purchaseRef !== purchaseRef && billing.purchaseState !== "NONE") {
    return { kind: "REJECT", reason: "FAMILY_HAS_OTHER_PURCHASE" };
  }
  return null;
}

/** Final decision from the provider verification and fresh transactional facts. */
export function decideBinding(
  family: BindingFamilyFacts | null,
  callerUid: string,
  familyId: string,
  existing: ExistingBinding | null,
  billing: LocalBilling,
  purchaseRef: string,
  verification: TokenVerification,
  nowMillis: number,
): BindingDecision {
  const pre = precheckBinding(family, callerUid, familyId, existing, billing, purchaseRef);
  if (pre !== null) return pre;
  const f = family as BindingFamilyFacts;
  const late =
    f.lifecycleState === "UNENTITLED_AWAITING_PAYMENT" &&
    (f.reservationExpiresAtMillis === null || isReservationExpired(f.reservationExpiresAtMillis, nowMillis));

  switch (verification.kind) {
    case "VERIFIED_ACTIVE":
      return late
        ? { kind: "WRITE", status: "HELD_LATE_SETTLEMENT", localPurchaseState: "PENDING" }
        : { kind: "WRITE", status: "BOUND", localPurchaseState: "ACTIVE" };
    case "PENDING_PAYMENT":
      return { kind: "WRITE", status: late ? "HELD_LATE_SETTLEMENT" : "PENDING_PAYMENT", localPurchaseState: "PENDING" };
    case "WRONG_PRODUCT":
    case "WRONG_ACCOUNT":
    case "UNSUPPORTED_PLAN":
    case "NOT_ENTITLED":
    case "NOT_FOUND":
      return { kind: "REJECT", reason: verification.kind };
    case "UNRESOLVED":
      return { kind: "REJECT", reason: "PROVIDER_UNRESOLVED" };
  }
}

/** Opaque Play purchase tokens: bounded length, URL-safe characters only. */
export function isPlausiblePurchaseToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 16 && token.length <= 512 && /^[0-9A-Za-z._-]+$/.test(token);
}
