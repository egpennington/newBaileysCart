/**
 * families.restore (R-04 §4/§5 D43-D44; matrix rows 47-50, 78; Work Package v0.2 §A2.3, S3-D07).
 * One transaction: W-02 steps 4-7, then restore to ACTIVE and advance familyEpoch by exactly one.
 *
 * Owner-only restore: every non-owner membership is revoked in the same transaction, so no member
 * access is revived (matrix row 48). Access afterwards is derived from the family's own trial
 * timestamps (accessModeFor), never from an assumed paid entitlement. Pre-restore work carries the old
 * epoch and is rejected STALE_EPOCH_REJECTED from now on.
 */
import { Timestamp } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import { parseFamilyMutation } from "../contract/validate.js";
import { toRfc3339 } from "../domain/clock.js";
import { accessModeFor } from "../domain/family.js";
import type { AccessMode } from "../domain/family.js";
import { assertRestorable } from "../domain/lifecycle.js";
import { requestHash } from "../persistence/idempotency.js";
import { caseFrom, writeCase } from "../persistence/lifecycleStore.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";
import { MAX_TRANSACTION_ATTEMPTS, gateMutation, requireVerifiedEmail, writeIdempotency } from "./lifecycleCommon.js";
import type { LifecycleDeps, MutationIdentity } from "./lifecycleCommon.js";

export const COMMAND = "families.restore";

export interface RestoreFamilyData {
  readonly familyId: string;
  readonly lifecycleState: "ACTIVE";
  readonly familyEpoch: number;
  readonly accessMode: AccessMode;
}

export function familiesRestoreHandler(deps: LifecycleDeps) {
  const { db } = deps;
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<RestoreFamilyData>> => {
    requireVerifiedEmail(actor);
    const { request, raw } = parseFamilyMutation(data);
    const id: MutationIdentity = {
      command: COMMAND,
      opId: request.opId,
      requestHash: requestHash(COMMAND, raw),
      familyId: request.familyId,
      familyEpoch: request.familyEpoch,
    };

    return db.runTransaction(
      async (tx) => {
        const { gate } = await gateMutation<RestoreFamilyData>(db, tx, actor, id);
        if (gate.kind === "REPLAY") return gate.response;
        const { family, familySnap } = gate;
        if (family.closureCaseId === null) throw new DomainError("FAMILY_NOT_CLOSED");

        const caseSnap = await tx.get(db.doc(paths.closureCase(family.closureCaseId)));
        const members = await tx.get(db.collection(paths.familyMembers(family.familyId)));
        const others = members.docs.filter((m) => m.id !== family.ownerUid && m.get("state") === "ACTIVE");
        const reverse = others.length > 0 ? await tx.getAll(...others.map((m) => db.doc(paths.userMembership(m.id, family.familyId)))) : [];

        const nowMillis = deps.clock.nowMillis();
        const closure = family.lifecycleState === "ACTIVE" || family.lifecycleState === "UNENTITLED_AWAITING_PAYMENT" ? null : caseFrom(caseSnap);
        if (closure !== null && closure.familyId !== family.familyId) throw new DomainError("INTERNAL");
        const restorable = assertRestorable(family.lifecycleState, closure, nowMillis);

        const trialEndsAt = familySnap.get("trialEndsAt");
        const accessMode = accessModeFor(
          { lifecycleState: "ACTIVE", trialEndsAtMillis: trialEndsAt instanceof Timestamp ? trialEndsAt.toMillis() : null },
          nowMillis,
        );
        const newEpoch = family.familyEpoch + 1;
        const response = successEnvelope(request.opId, toRfc3339(nowMillis), {
          familyId: family.familyId,
          lifecycleState: "ACTIVE" as const,
          familyEpoch: newEpoch,
          accessMode,
        });

        const now = Timestamp.fromMillis(nowMillis);
        tx.update(db.doc(paths.family(family.familyId)), {
          lifecycleState: "ACTIVE",
          familyEpoch: newEpoch,
          closureCaseId: null,
          restoredAt: now,
          lifecycleRevision: family.lifecycleRevision + 1,
        });
        writeCase(db, tx, { ...restorable, restoredAtMillis: nowMillis, nextAttemptAtMillis: null, revision: restorable.revision + 1 });
        others.forEach((m, i) => {
          tx.update(m.ref, { state: "REVOKED", revokedAt: now });
          const edge = reverse[i];
          if (edge?.exists) tx.update(edge.ref, { state: "REVOKED", revokedAt: now });
        });
        writeIdempotency(tx, gate.idemRef, actor, id, response, nowMillis);
        return response;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}
