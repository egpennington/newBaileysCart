/**
 * Pure families.create decision (P4-D10, P4-D11, D42, D45, D46). The transaction gathers
 * the facts; this function decides. Idempotent replay is handled before this is called.
 */
import { DomainError } from "../contract/errors.js";
import { INITIAL_FAMILY_EPOCH, RESERVATION_TTL_MS, TRIAL_DURATION_MS } from "./family.js";
import type { LifecycleState } from "./family.js";

export interface CreateFacts {
  readonly emailVerified: boolean;
  /** Set while the caller owns any unreleased family or reservation (PL-2: expiry does not release). */
  readonly ownedFamilyId: string | null;
  readonly trialConsumed: boolean;
  readonly nowMillis: number;
}

export type CreateOutcome =
  | {
      readonly kind: "TRIAL";
      readonly lifecycleState: Extract<LifecycleState, "ACTIVE">;
      readonly familyEpoch: number;
      readonly trialStartedAtMillis: number;
      readonly trialEndsAtMillis: number;
    }
  | {
      readonly kind: "RESERVATION";
      readonly lifecycleState: Extract<LifecycleState, "UNENTITLED_AWAITING_PAYMENT">;
      readonly familyEpoch: number;
      readonly reservationCreatedAtMillis: number;
      readonly reservationExpiresAtMillis: number;
    };

export function decideCreate(facts: CreateFacts): CreateOutcome {
  if (!facts.emailVerified) throw new DomainError("EMAIL_VERIFICATION_REQUIRED");
  if (facts.ownedFamilyId !== null) throw new DomainError("OWNER_ALREADY_HAS_FAMILY");
  if (!facts.trialConsumed) {
    return {
      kind: "TRIAL",
      lifecycleState: "ACTIVE",
      familyEpoch: INITIAL_FAMILY_EPOCH,
      trialStartedAtMillis: facts.nowMillis,
      trialEndsAtMillis: facts.nowMillis + TRIAL_DURATION_MS,
    };
  }
  return {
    kind: "RESERVATION",
    lifecycleState: "UNENTITLED_AWAITING_PAYMENT",
    familyEpoch: INITIAL_FAMILY_EPOCH,
    reservationCreatedAtMillis: facts.nowMillis,
    reservationExpiresAtMillis: facts.nowMillis + RESERVATION_TTL_MS,
  };
}
