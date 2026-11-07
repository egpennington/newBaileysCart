/**
 * W-02 evaluation pipeline shared by the Slice 3 lifecycle mutations (Work Package v0.2 §A2.0,
 * ratified as S3-D03):
 *   1 authentication (adapter) -> 2 verified email -> 3 schema/version -> 4 idempotency lookup
 *   (internal only) -> 5 family lookup and immutable-owner authorization -> [committed replay is
 *   returned only here, after current authorization] -> 6 server epoch -> 7 lifecycle and
 *   confirmation guards (per command) -> 8 atomic commit with the idempotency record.
 *
 * Replay rule (CODI interpretation for GAI D4): a cached result is returned only to the family's
 * current immutable owner. The request hash covers familyEpoch, so a replay is always bound to the
 * epoch it was first committed under; step 6 is not re-applied to it, so a restore replayed after its
 * own epoch increment returns the original result instead of STALE_EPOCH_REJECTED and never
 * increments again (AC-S3-02).
 */
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import type { BillingProvider } from "../billing/provider.js";
import type { Clock } from "../domain/clock.js";
import { checkConfirmation } from "../domain/confirmation.js";
import type { ConfirmationAction } from "../domain/confirmation.js";
import { IDEMPOTENCY_RETENTION_MS, idempotencyKey } from "../persistence/idempotency.js";
import {
  confirmationPointerFrom,
  confirmationRecordFrom,
  confirmationTokenHash,
  familyLifecycleFrom,
  writeConfirmationPointer,
} from "../persistence/lifecycleStore.js";
import type { ConfirmationPointer, FamilyLifecycle } from "../persistence/lifecycleStore.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";

export const MAX_TRANSACTION_ATTEMPTS = 10;

export interface LifecycleDeps {
  readonly db: Firestore;
  readonly clock: Clock;
  readonly provider: BillingProvider;
}

/** Step 2: before the request body is examined (W-02 order). */
export function requireVerifiedEmail(actor: Actor): void {
  if (!actor.emailVerified) throw new DomainError("EMAIL_VERIFICATION_REQUIRED");
}

export interface MutationIdentity {
  readonly command: string;
  readonly opId: string;
  readonly requestHash: string;
  readonly familyId: string;
  readonly familyEpoch: number;
}

export type Gate<T> =
  | { readonly kind: "REPLAY"; readonly response: SuccessEnvelope<T> }
  | { readonly kind: "PROCEED"; readonly family: FamilyLifecycle; readonly familySnap: DocumentSnapshot; readonly idemRef: DocumentReference };

/**
 * Steps 4-6 inside the caller's transaction. `extra` documents are read in the same getAll so that
 * every read precedes every write; their snapshots are returned in order.
 */
export async function gateMutation<T>(
  db: Firestore,
  tx: Transaction,
  actor: Actor,
  id: MutationIdentity,
  extra: readonly DocumentReference[] = [],
): Promise<{ gate: Gate<T>; extra: DocumentSnapshot[] }> {
  const idemRef = db.doc(paths.idempotency(idempotencyKey(actor.uid, id.opId)));
  const familyRef = db.doc(paths.family(id.familyId));
  const [idem, familySnap, ...rest] = await tx.getAll(idemRef, familyRef, ...extra);

  // Step 4: mismatch is decided now; a match is held back until authorization is re-checked.
  const matched = idem?.exists === true;
  if (matched && (idem.get("command") !== id.command || idem.get("requestHash") !== id.requestHash)) {
    throw new DomainError("IDEMPOTENCY_KEY_REUSED");
  }

  // Step 5: the family and its immutable owner, read now, never from the cached record.
  const family = familyLifecycleFrom(familySnap);
  if (family === null) throw new DomainError("NOT_FOUND");
  if (family.ownerUid !== actor.uid) throw new DomainError("OWNER_REQUIRED");

  if (matched) {
    return { gate: { kind: "REPLAY", response: JSON.parse(idem.get("responseJson") as string) as SuccessEnvelope<T> }, extra: rest };
  }

  // Step 6.
  if (id.familyEpoch !== family.familyEpoch) throw new DomainError("STALE_EPOCH_REJECTED");
  return { gate: { kind: "PROCEED", family, familySnap: familySnap as DocumentSnapshot, idemRef }, extra: rest };
}

/**
 * Step 7 (confirmation part). The token document and the family's active-token pointer (A2-D4) are
 * read in the commit transaction itself, so consumption and a racing preparation serialize: the
 * token authorizes only if the pointer still names it at commit.
 */
export interface ConfirmationRefs {
  readonly token: DocumentReference;
  readonly pointer: DocumentReference;
  readonly tokenHash: string;
}

export function confirmationRefs(db: Firestore, familyId: string, token: string): ConfirmationRefs {
  const tokenHash = confirmationTokenHash(token);
  return {
    token: db.doc(paths.confirmationToken(tokenHash)),
    pointer: db.doc(paths.confirmationPointer(familyId)),
    tokenHash,
  };
}

/** Returns the pointer as read, for consumeConfirmation. Malformed pointer = INTERNAL (fail closed). */
export function requireConfirmation(
  tokenSnap: DocumentSnapshot | undefined,
  pointerSnap: DocumentSnapshot | undefined,
  refs: ConfirmationRefs,
  actor: Actor,
  action: ConfirmationAction,
  family: FamilyLifecycle,
  nowMillis: number,
): ConfirmationPointer {
  const pointer = confirmationPointerFrom(pointerSnap, family.familyId);
  const check = checkConfirmation(
    confirmationRecordFrom(tokenSnap),
    { uid: actor.uid, familyId: family.familyId, action, familyEpoch: family.familyEpoch },
    nowMillis,
    pointer.activeTokenHash !== refs.tokenHash,
  );
  if (!check.ok) throw new DomainError(check.code);
  return pointer;
}

/** Single use: mark the token consumed and clear the pointer, in the lifecycle commit transaction. */
export function consumeConfirmation(
  db: Firestore,
  tx: Transaction,
  refs: ConfirmationRefs,
  pointer: ConfirmationPointer,
  family: FamilyLifecycle,
  opId: string,
  nowMillis: number,
): void {
  tx.update(refs.token, { consumedAt: Timestamp.fromMillis(nowMillis), consumedByOpId: opId });
  writeConfirmationPointer(
    db,
    tx,
    family.familyId,
    family.ownerUid,
    pointer,
    { activeTokenHash: null, activeOpId: null, issuedAtMillis: pointer.issuedAtMillis },
    nowMillis,
  );
}

/** Step 8: the idempotency record, written in the same transaction as the state change. */
export function writeIdempotency(
  tx: Transaction,
  idemRef: DocumentReference,
  actor: Actor,
  id: MutationIdentity,
  response: SuccessEnvelope<unknown>,
  nowMillis: number,
): void {
  tx.set(idemRef, {
    actorUid: actor.uid,
    opId: id.opId,
    command: id.command,
    requestHash: id.requestHash,
    familyId: id.familyId,
    familyEpoch: id.familyEpoch,
    responseJson: JSON.stringify(response),
    committedAt: Timestamp.fromMillis(nowMillis),
    retainUntil: Timestamp.fromMillis(nowMillis + IDEMPOTENCY_RETENTION_MS),
  });
}
