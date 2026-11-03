/**
 * account.getSession (API v0.4 §4; GAI-R04-MIN-01). Returns only the caller's owned family,
 * the families the caller currently belongs to, and the caller's own trial eligibility (PL-9).
 * Owner-only lifecycle and timing fields are omitted for families the caller merely joined.
 * Stored records are checked before they are reported (HB-1..HB-3, see domain/session.ts).
 */
import type { Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import { parseGetSessionRequest } from "../contract/validate.js";
import type { Clock } from "../domain/clock.js";
import { toRfc3339 } from "../domain/clock.js";
import { buildSession } from "../domain/session.js";
import type { IntegrityEvent, SessionData, StoredEntry } from "../domain/session.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";

export type { FamilySummary, SessionData } from "../domain/session.js";

export const COMMAND = "account.getSession";

/** Server-side integrity log; the record carries identifiers only (HB-1..HB-3). */
export type IntegrityLog = (event: IntegrityEvent) => void;

/** The structured log record: command, reason and familyId only; no UID, name or stored values. */
export function integrityLogRecord(event: IntegrityEvent): { command: string; reason: string; familyId: string | null } {
  return { command: COMMAND, reason: event.reason, familyId: event.familyId };
}

const defaultIntegrityLog: IntegrityLog = (event) => {
  if (event.fatal) logger.error("Family record integrity violation", integrityLogRecord(event));
  else logger.warn("Family record integrity violation", integrityLogRecord(event));
};

export interface SessionDeps {
  readonly db: Firestore;
  readonly clock: Clock;
  readonly integrityLog?: IntegrityLog;
}

export function accountGetSessionHandler(deps: SessionDeps) {
  const log = deps.integrityLog ?? defaultIntegrityLog;
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<SessionData>> => {
    const request = parseGetSessionRequest(data);
    const db = deps.db;

    // All reads come from one read-only snapshot (A1 §A1.5); logging waits until it is done.
    const { built, nowMillis } = await db.runTransaction(
      async (tx) => {
        const [user, ledger] = await tx.getAll(db.doc(paths.user(actor.uid)), db.doc(paths.trialLedger(actor.uid)));
        const edges = await tx.get(db.collection(paths.userMemberships(actor.uid)));
        const activeEdges = edges.docs.filter((d) => d.get("state") === "ACTIVE");
        const familyIds = activeEdges.map((d) => d.id).sort();

        const refs = familyIds.flatMap((id) => [db.doc(paths.family(id)), db.doc(paths.familyMember(id, actor.uid))]);
        const snaps = refs.length > 0 ? await tx.getAll(...refs) : [];
        const nowMillis = deps.clock.nowMillis();

        const entries: StoredEntry[] = [];
        familyIds.forEach((familyId, i) => {
          const family = snaps[2 * i];
          const member = snaps[2 * i + 1];
          // The reverse index must be confirmed by the family's own membership edge.
          if (!family?.exists || !member?.exists || member.get("state") !== "ACTIVE") return;
          entries.push({ familyId, family: family.data() ?? {}, memberRole: member.get("role") });
        });

        const built = buildSession(
          { uid: actor.uid, ownedFamilyId: user?.get("ownedFamilyId"), trialLedgerExists: ledger?.exists === true, entries },
          nowMillis,
        );
        return { built, nowMillis };
      },
      { readOnly: true },
    );

    for (const event of built.events) log(event);
    if (!built.ok) throw new DomainError("INTERNAL");
    return successEnvelope(request.opId, toRfc3339(nowMillis), built.data);
  };
}
