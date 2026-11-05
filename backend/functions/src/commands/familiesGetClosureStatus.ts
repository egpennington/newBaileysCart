/**
 * families.getClosureStatus (R-04 §4; Work Package v0.2 §A2.2 read-only exception to W-02):
 * authentication, verified email, request validation, family lookup and current owner
 * authorization, then a sanitized projection. No mutation opId, idempotency lookup or commit.
 * Members get OWNER_REQUIRED: R-04 grants no member-visible status projection.
 */
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import { parseClosureStatusRequest } from "../contract/validate.js";
import { toRfc3339 } from "../domain/clock.js";
import type { LifecycleState } from "../domain/family.js";
import { closureStatusView } from "../domain/lifecycle.js";
import type { ClosureStatus } from "../domain/lifecycle.js";
import { caseFrom, familyLifecycleFrom } from "../persistence/lifecycleStore.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";
import { requireVerifiedEmail } from "./lifecycleCommon.js";
import type { LifecycleDeps } from "./lifecycleCommon.js";

export const COMMAND = "families.getClosureStatus";

export interface ClosureStatusData {
  readonly familyId: string;
  readonly lifecycleState: LifecycleState;
  readonly closureStatus: ClosureStatus;
  readonly waiverRecorded: boolean;
  readonly recoverUntilAt?: string;
}

export function familiesGetClosureStatusHandler(deps: Pick<LifecycleDeps, "db" | "clock">) {
  const { db } = deps;
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<ClosureStatusData>> => {
    requireVerifiedEmail(actor);
    const request = parseClosureStatusRequest(data);
    return db.runTransaction(
      async (tx) => {
        const family = familyLifecycleFrom(await tx.get(db.doc(paths.family(request.familyId))));
        if (family === null) throw new DomainError("NOT_FOUND");
        if (family.ownerUid !== actor.uid) throw new DomainError("OWNER_REQUIRED");
        const closure =
          family.closureCaseId === null ? null : caseFrom(await tx.get(db.doc(paths.closureCase(family.closureCaseId))));
        if (closure !== null && closure.familyId !== family.familyId) throw new DomainError("INTERNAL");
        const nowMillis = deps.clock.nowMillis();
        const view = closureStatusView(family.lifecycleState, closure, nowMillis);
        return successEnvelope(request.opId, toRfc3339(nowMillis), {
          familyId: family.familyId,
          lifecycleState: view.lifecycleState,
          closureStatus: view.closureStatus,
          waiverRecorded: view.waiverRecorded,
          ...(view.recoverUntilAtMillis !== undefined ? { recoverUntilAt: toRfc3339(view.recoverUntilAtMillis) } : {}),
        });
      },
      { readOnly: true },
    );
  };
}
