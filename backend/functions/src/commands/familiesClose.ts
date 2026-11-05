/**
 * families.close (R-04 §4; D44; Work Package v0.2 §A2.1, S3-D09; GAI-S3-BLK-01/02).
 *
 * The liability check is a provider call, so it cannot run inside a Firestore transaction:
 *   1. read-only transaction: W-02 steps 4-7 without writing (no provider call for a request that
 *      would be rejected anyway, and no token is consumed);
 *   2. provider liability check, outside any transaction;
 *   3. commit transaction: every step is evaluated again from fresh reads. If the local billing
 *      record changed since step 1, liability is UNRESOLVED (hold), never ZERO_VERIFIED.
 * A verified paid obligation enters CLOSURE_PENDING_BILLING with a durable cancellation case for the
 * worker; verified zero liability enters CLOSING with the 30-day clock and no cancellation; anything
 * else enters CLOSURE_PENDING_BILLING under a reconciliation hold. Shopping access ends at commit for
 * everyone, because every state other than ACTIVE has accessMode NONE.
 */
import { Timestamp } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { parseConfirmedFamilyMutation } from "../contract/validate.js";
import { checkLiabilitySafely } from "../billing/provider.js";
import { toRfc3339 } from "../domain/clock.js";
import { assertClosable, combineLiability, decideCloseOutcome } from "../domain/lifecycle.js";
import type { CancellationStatus, ClosureCase, ProviderLiability } from "../domain/lifecycle.js";
import { requestHash } from "../persistence/idempotency.js";
import { caseToDoc, localBillingFrom, sameBilling } from "../persistence/lifecycleStore.js";
import type { LocalBilling } from "../persistence/lifecycleStore.js";
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

export const COMMAND = "families.close";

export interface CloseFamilyData {
  readonly familyId: string;
  readonly lifecycleState: "CLOSURE_PENDING_BILLING" | "CLOSING";
  readonly familyEpoch: number;
  readonly cancellationStatus: Extract<CancellationStatus, "NOT_REQUIRED" | "PENDING" | "LIABILITY_UNRESOLVED">;
  readonly closureCaseId: string;
  /** Present only when the recovery clock started at this commit (verified zero liability). */
  readonly recoverUntilAt?: string;
}

/** Test hook: runs between the provider call and the commit transaction (race injection). */
export interface CloseDeps extends LifecycleDeps {
  readonly afterLiabilityCheck?: () => Promise<void>;
}

export function familiesCloseHandler(deps: CloseDeps) {
  const { db } = deps;
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<CloseFamilyData>> => {
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
    const billingRef = db.doc(paths.familyBilling(request.familyId));

    /** Steps 4-7 on fresh reads; returns a replay, or the facts the commit needs. */
    const evaluate = async (tx: Transaction) => {
      const { gate, extra } = await gateMutation<CloseFamilyData>(db, tx, actor, id, [tokenRef, billingRef]);
      if (gate.kind === "REPLAY") return { replay: gate.response } as const;
      const nowMillis = deps.clock.nowMillis();
      assertClosable(gate.family.lifecycleState);
      requireConfirmation(extra[0], actor, COMMAND, gate.family, nowMillis);
      return { gate, billing: localBillingFrom(extra[1]), nowMillis } as const;
    };

    const pre = await db.runTransaction(evaluate, { readOnly: true });
    if ("replay" in pre) return pre.replay;

    const providerLiability: ProviderLiability = await checkLiabilitySafely(deps.provider, {
      familyId: request.familyId,
      ownerUid: pre.gate.family.ownerUid,
      purchaseRef: pre.billing.purchaseRef,
    });
    await deps.afterLiabilityCheck?.();

    return db.runTransaction(
      async (tx) => {
        const now = await evaluate(tx);
        if ("replay" in now) return now.replay;
        const { gate, nowMillis } = now;
        const billingSeen: LocalBilling = pre.billing;
        const liability = sameBilling(billingSeen, now.billing)
          ? combineLiability(providerLiability, now.billing.purchaseState)
          : "UNRESOLVED";
        const outcome = decideCloseOutcome(liability, nowMillis);

        const caseRef = db.collection(paths.closureCasesCollection).doc();
        const closure: ClosureCase = {
          caseId: caseRef.id,
          familyId: gate.family.familyId,
          ownerUid: gate.family.ownerUid,
          sourceEpoch: gate.family.familyEpoch,
          cancellationStatus: outcome.cancellationStatus,
          closedAtMillis: nowMillis,
          closureConfirmedAtMillis: outcome.closureConfirmedAtMillis,
          recoverUntilAtMillis: outcome.recoverUntilAtMillis,
          waiverCommittedAtMillis: null,
          attempts: 0,
          // Durable cancellation intent: the worker picks up PENDING cases that are due.
          nextAttemptAtMillis: outcome.dispatchCancellation || liability === "UNRESOLVED" ? nowMillis : null,
          lastProviderSequence: 0,
          releaseBlockedReason: null,
          deletionPendingAtMillis: null,
          ownershipReleasedAtMillis: null,
          restoredAtMillis: null,
          revision: 1,
        };

        const responseData: CloseFamilyData = {
          familyId: gate.family.familyId,
          lifecycleState: outcome.lifecycleState,
          familyEpoch: gate.family.familyEpoch,
          cancellationStatus: outcome.cancellationStatus,
          closureCaseId: closure.caseId,
          ...(outcome.recoverUntilAtMillis !== null ? { recoverUntilAt: toRfc3339(outcome.recoverUntilAtMillis) } : {}),
        };
        const response = successEnvelope(request.opId, toRfc3339(nowMillis), responseData);

        tx.update(db.doc(paths.family(gate.family.familyId)), {
          lifecycleState: outcome.lifecycleState,
          closureCaseId: closure.caseId,
          closedAt: Timestamp.fromMillis(nowMillis),
          lifecycleRevision: gate.family.lifecycleRevision + 1,
        });
        tx.create(caseRef, { ...caseToDoc(closure), liabilitySource: deps.provider.source });
        consumeConfirmation(tx, tokenRef, request.opId, nowMillis);
        writeIdempotency(tx, gate.idemRef, actor, id, response, nowMillis);
        return response;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}
