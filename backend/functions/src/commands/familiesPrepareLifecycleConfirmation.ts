/**
 * families.prepareLifecycleConfirmation (API v0.4 A2 controlled amendment §A2-D4; PL D-4, 2026-11-05;
 * sprint WP03-D4-ISSUER-LOCAL-GATE-C-GO). Issues the single-use confirmation token that
 * families.close and families.waiveRecovery consume. Minting a token is not final consent: both
 * commands re-evaluate everything in their own commit transaction.
 *
 * Order: 0 local-only barrier -> 1 authentication (adapter) -> 2 verified email -> 2a recent sign-in
 * -> 3 schema/version -> [transaction: 4 idempotency lookup -> 5 family and immutable owner ->
 * same-opId retry -> 7 eligibility of the target command -> throttle -> 8 commit].
 *
 * One transaction writes the token digest record, the family pointer (which supersedes every earlier
 * unconsumed token for the family, either action) and the idempotency record. A rejection writes
 * nothing, except that an identical retry of a committed preparation clears the pointer if it still
 * names that preparation's token. The plaintext token exists only in this function's memory and in
 * the one successful response; it is never stored, logged or replayed.
 *
 * Randomness and the clock are read once, outside the retryable transaction callback, so a Firestore
 * retry re-runs the same intended issuance (same digest, same instant) instead of a new one.
 */
import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import { parsePrepareConfirmationRequest } from "../contract/validate.js";
import type { PrepareConfirmationRequest } from "../contract/validate.js";
import { isEmulatorDemoRuntime } from "../billing/selectProvider.js";
import type { RuntimeEnv } from "../billing/selectProvider.js";
import { toRfc3339 } from "../domain/clock.js";
import {
  CONFIRMATION_TOKEN_BYTES,
  CONFIRMATION_TOKEN_TTL_MS,
  PREPARE_ACTIONS,
  isRecentAuth,
  issuanceAllowed,
  issuancesInWindow,
} from "../domain/confirmation.js";
import { assertClosable, decideWaive } from "../domain/lifecycle.js";
import { IDEMPOTENCY_RETENTION_MS, idempotencyKey, requestHash } from "../persistence/idempotency.js";
import {
  caseFrom,
  confirmationPointerFrom,
  confirmationTokenHash,
  familyLifecycleFrom,
  tokenDoc,
  writeConfirmationPointer,
} from "../persistence/lifecycleStore.js";
import { SCHEMA_VERSION, paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";
import { MAX_TRANSACTION_ATTEMPTS, requireVerifiedEmail } from "./lifecycleCommon.js";
import type { LifecycleDeps } from "./lifecycleCommon.js";

export const COMMAND = "families.prepareLifecycleConfirmation";

export interface PrepareConfirmationData {
  readonly confirmationToken: string;
  readonly expiresAt: string;
  readonly action: PrepareConfirmationRequest["action"];
  readonly familyId: string;
  readonly familyEpoch: number;
}

export interface PrepareDeps extends LifecycleDeps {
  /** Runtime environment for the local-only barrier; read on every call. */
  readonly env: RuntimeEnv;
  /** Test hook: token source (defaults to 32 CSPRNG bytes). */
  readonly randomToken?: () => string;
  /** Test hook: runs inside the transaction after the reads (race and failure injection). */
  readonly afterReads?: () => Promise<void>;
}

const csprngToken = (): string => randomBytes(CONFIRMATION_TOKEN_BYTES).toString("base64url");

type Outcome = { readonly kind: "ISSUED"; readonly response: SuccessEnvelope<PrepareConfirmationData> } | { readonly kind: "RETRY" };

export function familiesPrepareLifecycleConfirmationHandler(deps: PrepareDeps) {
  const { db } = deps;
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<PrepareConfirmationData>> => {
    // Step 0 (handoff §2.1): no token is minted or stored outside the emulator + demo- project.
    if (!isEmulatorDemoRuntime(deps.env)) throw new DomainError("INTERNAL");
    requireVerifiedEmail(actor);
    const nowMillis = deps.clock.nowMillis();
    // Step 2a (handoff §2.3, sprint policy): server-verified auth_time within 5 minutes.
    if (!isRecentAuth(actor.authTimeSeconds, nowMillis)) throw new DomainError("UNAUTHENTICATED");
    const { request, raw } = parsePrepareConfirmationRequest(data);
    const action = PREPARE_ACTIONS[request.action];

    const token = (deps.randomToken ?? csprngToken)();
    const tokenHash = confirmationTokenHash(token);
    const expiresAtMillis = nowMillis + CONFIRMATION_TOKEN_TTL_MS;
    const hash = requestHash(COMMAND, raw);

    const idemRef = db.doc(paths.idempotency(idempotencyKey(actor.uid, request.opId)));
    const familyRef = db.doc(paths.family(request.familyId));
    const pointerRef = db.doc(paths.confirmationPointer(request.familyId));
    const tokenRef = db.doc(paths.confirmationToken(tokenHash));

    const outcome = await db.runTransaction<Outcome>(
      async (tx) => {
        const [idem, familySnap, pointerSnap] = await tx.getAll(idemRef, familyRef, pointerRef);

        // Step 4: a changed request under this caller's opId changes nothing. The key includes the
        // caller's UID, so one owner's opId can never reach another owner's record or token.
        const matched = idem?.exists === true;
        if (matched && (idem.get("command") !== COMMAND || idem.get("requestHash") !== hash)) {
          throw new DomainError("IDEMPOTENCY_KEY_REUSED");
        }

        // Step 5: current immutable owner, read now (D-2: every non-owner gets OWNER_REQUIRED).
        const family = familyLifecycleFrom(familySnap);
        if (family === null) throw new DomainError("NOT_FOUND");
        if (family.ownerUid !== actor.uid) throw new DomainError("OWNER_REQUIRED");
        const pointer = confirmationPointerFrom(pointerSnap, family.familyId);

        // Same-opId retry (A2-D4, fail closed): no plaintext, no new token; invalidate this opId's
        // token only if the pointer still names it, so a late retry never touches a newer token.
        if (matched) {
          const issuedHash = idem.get("tokenHash");
          if (typeof issuedHash !== "string") throw new DomainError("INTERNAL");
          if (pointer.activeTokenHash !== null && pointer.activeTokenHash === issuedHash) {
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
          return { kind: "RETRY" };
        }

        // Step 7: the target command's own eligibility and its own rejection code.
        if (request.action === "CLOSE") {
          assertClosable(family.lifecycleState);
        } else {
          const closure =
            family.closureCaseId === null ? null : caseFrom(await tx.get(db.doc(paths.closureCase(family.closureCaseId))));
          if (closure !== null && closure.familyId !== family.familyId) throw new DomainError("INTERNAL");
          decideWaive(family.lifecycleState, closure, nowMillis);
        }

        // Throttle (handoff §2.4, sprint policy): persistent, in the pointer, counted across actions.
        if (!issuanceAllowed(pointer.issuedAtMillis, nowMillis)) throw new DomainError("RATE_LIMITED");

        await deps.afterReads?.();

        // Step 8: digest record, supersession and idempotency record, atomically.
        tx.create(tokenRef, tokenDoc({ uid: actor.uid, familyId: family.familyId, action, familyEpoch: family.familyEpoch }, request.opId, nowMillis));
        writeConfirmationPointer(
          db,
          tx,
          family.familyId,
          family.ownerUid,
          pointer,
          {
            activeTokenHash: tokenHash,
            activeOpId: request.opId,
            issuedAtMillis: [...issuancesInWindow(pointer.issuedAtMillis, nowMillis), nowMillis],
          },
          nowMillis,
        );
        // No responseJson: the only success response holds the plaintext and is never replayed.
        tx.set(idemRef, {
          actorUid: actor.uid,
          opId: request.opId,
          command: COMMAND,
          requestHash: hash,
          familyId: family.familyId,
          familyEpoch: family.familyEpoch,
          action: request.action,
          tokenHash,
          outcome: "ISSUED",
          committedAt: Timestamp.fromMillis(nowMillis),
          retainUntil: Timestamp.fromMillis(nowMillis + IDEMPOTENCY_RETENTION_MS),
          schemaVersion: SCHEMA_VERSION,
        });
        return {
          kind: "ISSUED",
          response: successEnvelope(request.opId, toRfc3339(nowMillis), {
            confirmationToken: token,
            expiresAt: toRfc3339(expiresAtMillis),
            action: request.action,
            familyId: family.familyId,
            familyEpoch: family.familyEpoch,
          }),
        };
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );

    // Thrown after the transaction so the retry's invalidation write commits.
    if (outcome.kind === "RETRY") throw new DomainError("CONFIRMATION_REQUIRED");
    return outcome.response;
  };
}
