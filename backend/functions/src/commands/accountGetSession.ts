/**
 * account.getSession (API v0.4 §4; GAI-R04-MIN-01). Returns only the caller's owned family,
 * the families the caller currently belongs to, and the caller's own trial eligibility (PL-9).
 * Owner-only lifecycle and timing fields are omitted for families the caller merely joined.
 */
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { parseGetSessionRequest } from "../contract/validate.js";
import type { Clock } from "../domain/clock.js";
import { toRfc3339 } from "../domain/clock.js";
import { accessModeFor } from "../domain/family.js";
import type { AccessMode, Role } from "../domain/family.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";

export interface FamilySummary {
  readonly familyId: string;
  readonly role: Role;
  readonly accessMode: AccessMode;
  readonly displayName?: string;
  /** Owner only. */
  readonly lifecycleState?: string;
  readonly trialEndsAt?: string;
  readonly reservationExpiresAt?: string;
}

export interface SessionData {
  readonly ownedFamilyId: string | null;
  readonly joinedFamilies: readonly FamilySummary[];
  readonly trialEligible: boolean;
  readonly selectedFamilySuggestion: string | null;
}

export interface SessionDeps {
  readonly db: Firestore;
  readonly clock: Clock;
}

const millisOf = (value: unknown): number | null => (value ? (value as Timestamp).toMillis() : null);

export function accountGetSessionHandler(deps: SessionDeps) {
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<SessionData>> => {
    const request = parseGetSessionRequest(data);
    const db = deps.db;

    return db.runTransaction(
      async (tx) => {
        const [user, ledger] = await tx.getAll(db.doc(paths.user(actor.uid)), db.doc(paths.trialLedger(actor.uid)));
        const edges = await tx.get(db.collection(paths.userMemberships(actor.uid)));
        const activeEdges = edges.docs.filter((d) => d.get("state") === "ACTIVE");
        const familyIds = activeEdges.map((d) => d.id).sort();

        const refs = familyIds.flatMap((id) => [db.doc(paths.family(id)), db.doc(paths.familyMember(id, actor.uid))]);
        const snaps = refs.length > 0 ? await tx.getAll(...refs) : [];
        const nowMillis = deps.clock.nowMillis();

        const joinedFamilies: FamilySummary[] = [];
        familyIds.forEach((familyId, i) => {
          const family = snaps[2 * i];
          const member = snaps[2 * i + 1];
          // The reverse index must be confirmed by the family's own membership edge.
          if (!family?.exists || !member?.exists || member.get("state") !== "ACTIVE") return;
          const role = member.get("role") as Role;
          const isOwner = role === "OWNER" && family.get("ownerUid") === actor.uid;
          const accessMode = accessModeFor(
            { lifecycleState: family.get("lifecycleState") as string, trialEndsAtMillis: millisOf(family.get("trialEndsAt")) },
            nowMillis,
          );
          const displayName = family.get("displayName") as string | undefined;
          const trialEndsAt = millisOf(family.get("trialEndsAt"));
          const reservationExpiresAt = millisOf(family.get("reservationExpiresAt"));
          joinedFamilies.push({
            familyId,
            role: isOwner ? "OWNER" : "MEMBER",
            accessMode,
            ...(displayName !== undefined ? { displayName } : {}),
            ...(isOwner
              ? {
                  lifecycleState: family.get("lifecycleState") as string,
                  ...(trialEndsAt !== null ? { trialEndsAt: toRfc3339(trialEndsAt) } : {}),
                  ...(reservationExpiresAt !== null ? { reservationExpiresAt: toRfc3339(reservationExpiresAt) } : {}),
                }
              : {}),
          });
        });

        const ownedFamilyId = (user?.get("ownedFamilyId") as string | undefined) ?? null;
        const usable = joinedFamilies.filter((f) => f.accessMode !== "NONE");
        const selectedFamilySuggestion =
          usable.find((f) => f.familyId === ownedFamilyId)?.familyId ?? usable[0]?.familyId ?? null;

        return successEnvelope(request.opId, toRfc3339(nowMillis), {
          ownedFamilyId,
          joinedFamilies,
          trialEligible: ledger?.exists !== true,
          selectedFamilySuggestion,
        });
      },
      { readOnly: true },
    );
  };
}
