/**
 * Confirmation-token rule for irreversible owner actions (R-04 §4 families.close; D47 and S3-D06
 * families.waiveRecovery; GAI-S3-BLK-01). A token is bound to the owner UID, the family, the action
 * and the family epoch; it is single-use and valid for 15 minutes from issue.
 *
 * Mismatch is checked before consumption and expiry, so a token for another family, owner or action
 * reveals nothing about that token's state: every such case is CONFIRMATION_REQUIRED.
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

export function checkConfirmation(
  record: ConfirmationRecord | null,
  expected: ConfirmationBinding,
  nowMillis: number,
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
  // Not yet issued (clock skew) is treated as invalid, like an unknown token.
  if (nowMillis < record.issuedAtMillis) return { ok: false, code: "CONFIRMATION_REQUIRED" };
  if (nowMillis >= record.expiresAtMillis) return { ok: false, code: "CONFIRMATION_EXPIRED" };
  return { ok: true };
}
