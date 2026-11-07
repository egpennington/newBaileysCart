/**
 * Confirmation-token rule for irreversible owner actions (R-04 §4 families.close; D47 and S3-D06
 * families.waiveRecovery; GAI-S3-BLK-01). A token is bound to the owner UID, the family, the action
 * and the family epoch; it is single-use and valid for 15 minutes from issue.
 *
 * Mismatch is checked before consumption and expiry, so a token for another family, owner or action
 * reveals nothing about that token's state: every such case is CONFIRMATION_REQUIRED.
 *
 * A2-D4 (families.prepareLifecycleConfirmation): at most one token per family is active. The family
 * pointer `lifecycleConfirmations/{familyId}` names it; any other token is superseded, which is also
 * CONFIRMATION_REQUIRED (checked with consumption, before expiry).
 */
export const CONFIRMATION_TOKEN_TTL_MS = 15 * 60_000;

export type ConfirmationAction = "families.close" | "families.waiveRecovery";

export interface ConfirmationBinding {
  readonly uid: string;
  readonly familyId: string;
  readonly action: ConfirmationAction;
  readonly familyEpoch: number;
}

/** `confirmationTokens/{sha256(token)}` in domain form. The raw token is never stored. */
export interface ConfirmationRecord extends ConfirmationBinding {
  readonly issuedAtMillis: number;
  readonly expiresAtMillis: number;
  readonly consumedAtMillis: number | null;
}

export type ConfirmationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "CONFIRMATION_REQUIRED" | "CONFIRMATION_EXPIRED" };

/**
 * `superseded` is true unless the family's active-token pointer names this exact token. Callers pass
 * it explicitly (no default), so a forgotten pointer read cannot fail open.
 */
export function checkConfirmation(
  record: ConfirmationRecord | null,
  expected: ConfirmationBinding,
  nowMillis: number,
  superseded: boolean,
): ConfirmationCheck {
  if (
    record === null ||
    record.uid !== expected.uid ||
    record.familyId !== expected.familyId ||
    record.action !== expected.action ||
    record.familyEpoch !== expected.familyEpoch
  ) {
    return { ok: false, code: "CONFIRMATION_REQUIRED" };
  }
  if (record.consumedAtMillis !== null) return { ok: false, code: "CONFIRMATION_REQUIRED" };
  if (superseded) return { ok: false, code: "CONFIRMATION_REQUIRED" };
  // Not yet issued (clock skew) is treated as invalid, like an unknown token.
  if (nowMillis < record.issuedAtMillis) return { ok: false, code: "CONFIRMATION_REQUIRED" };
  if (nowMillis >= record.expiresAtMillis) return { ok: false, code: "CONFIRMATION_EXPIRED" };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// A2-D4 issuance rules (families.prepareLifecycleConfirmation). Pure; persistence is in
// persistence/lifecycleStore.ts and the transaction in commands/familiesPrepareLifecycleConfirmation.ts.
// ---------------------------------------------------------------------------------------------

/** Wire value of `action` (A2-D4 request) and the command whose token it prepares. */
export type PrepareAction = "CLOSE" | "WAIVE_RECOVERY";

export const PREPARE_ACTIONS: Readonly<Record<PrepareAction, ConfirmationAction>> = {
  CLOSE: "families.close",
  WAIVE_RECOVERY: "families.waiveRecovery",
};

/** Raw token entropy. 32 bytes base64url without padding is 43 characters. */
export const CONFIRMATION_TOKEN_BYTES = 32;

/**
 * Sprint policy (handoff §2.3; not a ratified number): the ID token's `auth_time` must be within the
 * last 5 minutes at issuance. Age 0 <= age < 5 min passes; missing, future or older fails.
 */
export const RECENT_AUTH_MAX_AGE_MS = 5 * 60_000;

export function isRecentAuth(authTimeSeconds: number | undefined, nowMillis: number): boolean {
  if (authTimeSeconds === undefined || !Number.isSafeInteger(authTimeSeconds) || authTimeSeconds < 0) return false;
  const age = nowMillis - authTimeSeconds * 1000;
  return age >= 0 && age < RECENT_AUTH_MAX_AGE_MS;
}

/**
 * Sprint policy (handoff §2.4; not a ratified number): at most 5 successful issuances per family
 * (the owner is fixed per family) in a rolling 15-minute window, across both actions.
 */
export const ISSUANCE_LIMIT = 5;
export const ISSUANCE_WINDOW_MS = 15 * 60_000;

/** Issuances still inside the window at `nowMillis`; a future-dated entry counts (fail closed). */
export function issuancesInWindow(issuedAtMillis: readonly number[], nowMillis: number): number[] {
  return issuedAtMillis.filter((t) => nowMillis - t < ISSUANCE_WINDOW_MS);
}

export function issuanceAllowed(issuedAtMillis: readonly number[], nowMillis: number): boolean {
  return issuancesInWindow(issuedAtMillis, nowMillis).length < ISSUANCE_LIMIT;
}
