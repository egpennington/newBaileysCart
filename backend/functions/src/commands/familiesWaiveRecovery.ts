/**
 * families.waiveRecovery (D47 normative addendum; matrix rows 74-80; Work Package v0.2 §A2.4,
 * S3-D05/S3-D06). Owner-only, online, current epoch, fresh single-use confirmation bound to
 * owner/family/action/epoch (15-minute TTL). Waiver never changes familyEpoch.
 *
 * - CLOSURE_PENDING_BILLING: record the irrevocable waiver only. No release; the cancellation worker
 *   moves the family straight to DELETION_PENDING once cancellation is verified.
 * - CLOSING (before the deadline): commit the waiver and, in the same transaction, the release
 *   milestone when every guard passes. If a guard fails (e.g. a new purchase hold), the waiver stays
 *   committed but the family stays CLOSING with its claim; the worker retries the milestone.
 */
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import { parseConfirmedFamilyMutation } from "../contract/validate.js";
import { toRfc3339 } from "../domain/clock.js";
import type { LifecycleState } from "../domain/family.js";
import { decideRelease, decideWaive } from "../domain/lifecycle.js";
import type { ClosureCase } from "../domain/lifecycle.js";
import { requestHash } from "../persistence/idempotency.js";
import { caseFrom, localBillingFrom, writeCase, writeReleaseMilestone } from "../persistence/lifecycleStore.js";
import type { FamilyLifecycle } from "../persistence/lifecycleStore.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";
import {
  MAX_TRANSACTION_ATTEMPTS,
  confirmationRef,
  consumeConfirmation,
  gateMutation,
  requireConfirmation,
  requireVerifiedEmail,
  writeIdempotency,
} from "./lifecycleCommon.js";
import type { LifecycleDeps, MutationIdentity } from "./lifecycleCommon.js";

export const COMMAND = "families.waiveRecovery";

export type WaiverDisposition =
  /** Pending cancellation: intent recorded, nothing released yet (privacy-safe pending result). */
  | "WAIVER_RECORDED_PENDING_BILLING"
  /** CLOSING but a release guard failed: waiver committed, release retried by the worker. */
  | "WAIVER_RECORDED_RELEASE_PENDING"
  /** Waiver committed and DELETION_PENDING entered with the owner claim released. */
  | "DELETION_PENDING";

export interface WaiveRecoveryData {
  readonly familyId: string;
  readonly lifecycleState: LifecycleState;
  readonly familyEpoch: number;
  readonly disposition: WaiverDisposition;
}

/**
 * Attempt the release milestone for a waived or expired case inside `tx`. Shared with the workers.
 * Reads must already be done: `userData` and `reconciliationHold` come from the same transaction.
 */
export function releaseOrBlock(
  db: Firestore,
  tx: Transaction,
  family: FamilyLifecycle,
  closure: ClosureCase,
  userData: Readonly<Record<string, unknown>> | undefined,
  reconciliationHold: boolean,
  nowMillis: number,
  trigger: "WAIVER" | "DEADLINE",
): { released: boolean; closure: ClosureCase } {
  const decision = decideRelease({
    closure,
    familyId: family.familyId,
    familyOwnerUid: family.ownerUid,
    claimedFamilyId: userData?.["ownedFamilyId"],
    reconciliationHold,
    nowMillis,
  });
  if (decision.ok && userData !== undefined) {
    return { released: true, closure: writeReleaseMilestone(db, tx, { family, closure, userData, nowMillis, trigger }) };
  }
  const blocked: ClosureCase = {
    ...closure,
    releaseBlockedReason: decision.ok ? "CLAIM_MISMATCH" : decision.reason,
    revision: closure.revision + 1,
  };
  writeCase(db, tx, blocked);
  tx.update(db.doc(paths.family(family.familyId)), { lifecycleRevision: family.lifecycleRevision + 1 });
  return { released: false, closure: blocked };
}

export function familiesWaiveRecoveryHandler(deps: LifecycleDeps) {
  const { db } = deps;
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<WaiveRecoveryData>> => {
    requireVerifiedEmail(actor);
    const { request, raw } = parseConfirmedFamilyMutation(data);
    const id: MutationIdentity = {
      command: COMMAND,
      opId: request.opId,
      requestHash: requestHash(COMMAND, raw),
      familyId: request.familyId,
      familyEpoch: request.familyEpoch,
    };
    const tokenRef = confirmationRef(db, request.confirmationToken);

    return db.runTransaction(
      async (tx) => {
        const { gate, extra } = await gateMutation<WaiveRecoveryData>(db, tx, actor, id, [
          tokenRef,
          db.doc(paths.user(actor.uid)),
          db.doc(paths.familyBilling(request.familyId)),
        ]);
        if (gate.kind === "REPLAY") return gate.response;
        const { family } = gate;
        const [tokenSnap, userSnap, billingSnap] = extra;
        const caseSnap = family.closureCaseId === null ? undefined : await tx.get(db.doc(paths.closureCase(family.closureCaseId)));

        const nowMillis = deps.clock.nowMillis();
        const closure = family.closureCaseId === null ? null : caseFrom(caseSnap);
        if (closure !== null && closure.familyId !== family.familyId) throw new DomainError("INTERNAL");
        const action = decideWaive(family.lifecycleState, closure, nowMillis);
        requireConfirmation(tokenSnap, actor, COMMAND, family, nowMillis);
        if (closure === null) throw new DomainError("INTERNAL");

        const waived: ClosureCase = { ...closure, waiverCommittedAtMillis: nowMillis, revision: closure.revision + 1 };
        let lifecycleState: LifecycleState = family.lifecycleState;
        let disposition: WaiverDisposition;
        if (action === "RECORD_INTENT") {
          writeCase(db, tx, waived);
          tx.update(db.doc(paths.family(family.familyId)), { lifecycleRevision: family.lifecycleRevision + 1 });
          disposition = "WAIVER_RECORDED_PENDING_BILLING";
        } else {
          const hold = localBillingFrom(billingSnap).purchaseState === "PENDING";
          const result = releaseOrBlock(db, tx, family, waived, userSnap?.exists ? userSnap.data() : undefined, hold, nowMillis, "WAIVER");
          if (result.released) lifecycleState = "DELETION_PENDING";
          disposition = result.released ? "DELETION_PENDING" : "WAIVER_RECORDED_RELEASE_PENDING";
        }

        const response = successEnvelope(request.opId, toRfc3339(nowMillis), {
          familyId: family.familyId,
          lifecycleState,
          familyEpoch: family.familyEpoch,
          disposition,
        });
        consumeConfirmation(tx, tokenRef, request.opId, nowMillis);
        writeIdempotency(tx, gate.idemRef, actor, id, response, nowMillis);
        return response;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}
