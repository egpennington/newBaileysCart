/**
 * families.create (API v0.4 §4). Precedence: authentication (adapter) -> request validation
 * -> verified email -> [transaction: idempotency replay/reuse -> owner limit -> trial or
 * reservation]. All records are written in one Firestore transaction.
 */
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import { parseCreateFamilyRequest } from "../contract/validate.js";
import type { Clock } from "../domain/clock.js";
import { toRfc3339 } from "../domain/clock.js";
import { decideCreate } from "../domain/createDecision.js";
import type { LifecycleState } from "../domain/family.js";
import { IDEMPOTENCY_RETENTION_MS, idempotencyKey, requestHash } from "../persistence/idempotency.js";
import { SCHEMA_VERSION, paths } from "../persistence/paths.js";

export const COMMAND = "families.create";
const MAX_TRANSACTION_ATTEMPTS = 10;

export interface Actor {
  readonly uid: string;
  readonly emailVerified: boolean;
}

export interface CreateFamilyData {
  readonly familyId: string;
  readonly lifecycleState: LifecycleState;
  readonly familyEpoch: number;
  readonly displayName?: string;
  readonly trialStartedAt?: string;
  readonly trialEndsAt?: string;
  readonly reservationCreatedAt?: string;
  readonly reservationExpiresAt?: string;
}

/** Write steps, in order. Tests use `beforeWrite` to inject a failure part-way (rollback evidence). */
export type CreateWriteStep =
  | "family"
  | "ownerMember"
  | "userOwnerClaim"
  | "reverseMembership"
  | "trialLedger"
  | "idempotency";

export interface CreateDeps {
  readonly db: Firestore;
  readonly clock: Clock;
  readonly beforeWrite?: (step: CreateWriteStep) => void;
}

export function familiesCreateHandler(deps: CreateDeps) {
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<CreateFamilyData>> => {
    const { request, raw } = parseCreateFamilyRequest(data);
    if (!actor.emailVerified) throw new DomainError("EMAIL_VERIFICATION_REQUIRED");

    const hash = requestHash(COMMAND, raw);
    const db = deps.db;
    const idemRef = db.doc(paths.idempotency(idempotencyKey(actor.uid, request.opId)));
    const userRef = db.doc(paths.user(actor.uid));
    const ledgerRef = db.doc(paths.trialLedger(actor.uid));

    return db.runTransaction(
      async (tx: Transaction) => {
        const [idem, user, ledger] = await tx.getAll(idemRef, userRef, ledgerRef);

        if (idem?.exists) {
          if (idem.get("command") === COMMAND && idem.get("requestHash") === hash) {
            return JSON.parse(idem.get("responseJson") as string) as SuccessEnvelope<CreateFamilyData>;
          }
          throw new DomainError("IDEMPOTENCY_KEY_REUSED");
        }

        const nowMillis = deps.clock.nowMillis();
        const outcome = decideCreate({
          emailVerified: actor.emailVerified,
          ownedFamilyId: (user?.get("ownedFamilyId") as string | undefined) ?? null,
          trialConsumed: ledger?.exists === true,
          nowMillis,
        });

        const familyRef = db.collection(paths.familiesCollection).doc();
        const familyId = familyRef.id;
        const now = Timestamp.fromMillis(nowMillis);
        const displayName = request.payload.displayName;

        const responseData: CreateFamilyData =
          outcome.kind === "TRIAL"
            ? {
                familyId,
                lifecycleState: outcome.lifecycleState,
                familyEpoch: outcome.familyEpoch,
                ...(displayName !== undefined ? { displayName } : {}),
                trialStartedAt: toRfc3339(outcome.trialStartedAtMillis),
                trialEndsAt: toRfc3339(outcome.trialEndsAtMillis),
              }
            : {
                familyId,
                lifecycleState: outcome.lifecycleState,
                familyEpoch: outcome.familyEpoch,
                ...(displayName !== undefined ? { displayName } : {}),
                reservationCreatedAt: toRfc3339(outcome.reservationCreatedAtMillis),
                reservationExpiresAt: toRfc3339(outcome.reservationExpiresAtMillis),
              };
        const response = successEnvelope(request.opId, toRfc3339(nowMillis), responseData);

        const write = (step: CreateWriteStep, ref: DocumentReference, value: Record<string, unknown>) => {
          deps.beforeWrite?.(step);
          tx.set(ref, value);
        };

        write("family", familyRef, {
          ownerUid: actor.uid,
          lifecycleState: outcome.lifecycleState,
          familyEpoch: outcome.familyEpoch,
          createdAt: now,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(outcome.kind === "TRIAL"
            ? {
                trialStartedAt: Timestamp.fromMillis(outcome.trialStartedAtMillis),
                trialEndsAt: Timestamp.fromMillis(outcome.trialEndsAtMillis),
              }
            : {
                reservationCreatedAt: Timestamp.fromMillis(outcome.reservationCreatedAtMillis),
                reservationExpiresAt: Timestamp.fromMillis(outcome.reservationExpiresAtMillis),
              }),
          schemaVersion: SCHEMA_VERSION,
        });
        write("ownerMember", db.doc(paths.familyMember(familyId, actor.uid)), {
          role: "OWNER",
          state: "ACTIVE",
          joinedAt: now,
        });
        write("userOwnerClaim", userRef, {
          ...(user?.exists ? user.data() : {}),
          ownedFamilyId: familyId,
          ownerClaimedAt: now,
          schemaVersion: SCHEMA_VERSION,
        });
        write("reverseMembership", db.doc(paths.userMembership(actor.uid, familyId)), {
          role: "OWNER",
          state: "ACTIVE",
          joinedAt: now,
        });
        if (outcome.kind === "TRIAL") {
          write("trialLedger", ledgerRef, { consumedAt: now, familyId, opId: request.opId });
        }
        write("idempotency", idemRef, {
          actorUid: actor.uid,
          opId: request.opId,
          command: COMMAND,
          requestHash: hash,
          responseJson: JSON.stringify(response),
          committedAt: now,
          retainUntil: Timestamp.fromMillis(nowMillis + IDEMPOTENCY_RETENTION_MS),
        });
        return response;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}
