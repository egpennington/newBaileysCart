/**
 * account.getSession response mapping (API Amendment A1 v0.2 §A1.5), kept pure so D1 tests can
 * drive it with malformed storage. Read-path hardening (WP03_S1_HARDENING_BACKLOG_v1.1.md):
 * - HB-2: a stored displayName that fails PL-5 is omitted (the family is treated as unnamed).
 * - HB-1, HB-3: an OWNER entry without a recognized lifecycleState, or records that break the
 *   cross-entry invariants, fail the whole call (PL output decision 2026-10-31: INTERNAL).
 * Every finding is reported as an integrity event carrying identifiers only, never user data.
 */
import { Timestamp } from "firebase-admin/firestore";
import { checkDisplayName } from "../contract/validate.js";
import { toRfc3339 } from "./clock.js";
import { accessModeFor } from "./family.js";
import type { AccessMode, LifecycleState, Role } from "./family.js";

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

/** A family the caller is in: both membership edges exist and are ACTIVE. */
export interface StoredEntry {
  readonly familyId: string;
  /** `families/{familyId}` fields as stored. */
  readonly family: Readonly<Record<string, unknown>>;
  /** `families/{familyId}/members/{uid}.role` as stored. */
  readonly memberRole: unknown;
}

export interface StoredSession {
  readonly uid: string;
  /** `users/{uid}.ownedFamilyId` as stored (absent is `undefined`). */
  readonly ownedFamilyId: unknown;
  readonly trialLedgerExists: boolean;
  /** Ascending by familyId (UTF-16 code units). */
  readonly entries: readonly StoredEntry[];
}

export type IntegrityReason =
  /** HB-2: omitted, the call continues. */
  | "DISPLAY_NAME_INVALID"
  /** HB-1. */
  | "OWNER_LIFECYCLE_STATE_INVALID"
  /** HB-3 (3): a lifecycle timestamp that is not a Firestore Timestamp. */
  | "LIFECYCLE_TIMESTAMP_MALFORMED"
  /** HB-3 (3): both timestamps, or a timestamp that does not match lifecycleState. */
  | "LIFECYCLE_TIMESTAMPS_INCONSISTENT"
  /** HB-3 (1). */
  | "MULTIPLE_OWNER_ENTRIES"
  /** HB-3 (2): an OWNER membership that ownedFamilyId does not name. */
  | "OWNER_ENTRY_WITHOUT_CLAIM"
  /** HB-3 (2): an ownedFamilyId with no matching OWNER membership, or a malformed one. */
  | "CLAIM_WITHOUT_OWNER_ENTRY";

export interface IntegrityEvent {
  readonly reason: IntegrityReason;
  readonly familyId: string | null;
  /** True when the call must fail closed with INTERNAL. */
  readonly fatal: boolean;
}

export type SessionBuild =
  | { readonly ok: true; readonly data: SessionData; readonly events: readonly IntegrityEvent[] }
  | { readonly ok: false; readonly events: readonly IntegrityEvent[] };

/** Lifecycle values A1 §A1.5 allows on OWNER entries in Slice 1. */
export const RECOGNIZED_LIFECYCLE_STATES: readonly LifecycleState[] = ["ACTIVE", "UNENTITLED_AWAITING_PAYMENT"];

const MALFORMED = Symbol("malformed");

/** Absent (`undefined` or `null`) is no timestamp; anything other than a Timestamp is malformed. */
function millisOf(value: unknown): number | null | typeof MALFORMED {
  if (value === undefined || value === null) return null;
  return value instanceof Timestamp ? value.toMillis() : MALFORMED;
}

export function buildSession(stored: StoredSession, nowMillis: number): SessionBuild {
  const events: IntegrityEvent[] = [];
  const fail = (reason: IntegrityReason, familyId: string | null) => events.push({ reason, familyId, fatal: true });
  const joinedFamilies: FamilySummary[] = [];

  for (const { familyId, family, memberRole } of stored.entries) {
    const isOwner = memberRole === "OWNER" && family["ownerUid"] === stored.uid;
    const lifecycleState = family["lifecycleState"];
    const trialEndsAt = millisOf(family["trialEndsAt"]);
    const reservationExpiresAt = millisOf(family["reservationExpiresAt"]);

    // HB-3 (3), checked for every entry because accessMode is derived from these fields.
    if (trialEndsAt === MALFORMED || reservationExpiresAt === MALFORMED) {
      fail("LIFECYCLE_TIMESTAMP_MALFORMED", familyId);
      continue;
    }
    if (
      (trialEndsAt !== null && reservationExpiresAt !== null) ||
      (lifecycleState === "ACTIVE" && reservationExpiresAt !== null) ||
      (lifecycleState === "UNENTITLED_AWAITING_PAYMENT" && (trialEndsAt !== null || reservationExpiresAt === null))
    ) {
      fail("LIFECYCLE_TIMESTAMPS_INCONSISTENT", familyId);
    }
    // HB-1. MEMBER entries carry no lifecycleState; an unknown state there already yields NONE.
    if (isOwner && !RECOGNIZED_LIFECYCLE_STATES.includes(lifecycleState as LifecycleState)) {
      fail("OWNER_LIFECYCLE_STATE_INVALID", familyId);
    }

    // HB-2: present only when the stored value passes PL-5.
    let displayName: string | undefined;
    if (family["displayName"] !== undefined) {
      const checked = checkDisplayName(family["displayName"]);
      if (checked.ok) displayName = checked.value;
      else events.push({ reason: "DISPLAY_NAME_INVALID", familyId, fatal: false });
    }

    const accessMode = accessModeFor(
      { lifecycleState: typeof lifecycleState === "string" ? lifecycleState : "", trialEndsAtMillis: trialEndsAt },
      nowMillis,
    );
    joinedFamilies.push({
      familyId,
      role: isOwner ? "OWNER" : "MEMBER",
      accessMode,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(isOwner
        ? {
            lifecycleState: lifecycleState as string,
            ...(trialEndsAt !== null ? { trialEndsAt: toRfc3339(trialEndsAt) } : {}),
            ...(reservationExpiresAt !== null ? { reservationExpiresAt: toRfc3339(reservationExpiresAt) } : {}),
          }
        : {}),
    });
  }

  // HB-3 (1) and (2): the owner claim and the OWNER memberships must name the same single family.
  const owners = joinedFamilies.filter((f) => f.role === "OWNER");
  if (owners.length > 1) for (const f of owners) fail("MULTIPLE_OWNER_ENTRIES", f.familyId);
  const claim = stored.ownedFamilyId;
  let ownedFamilyId: string | null = null;
  if (typeof claim === "string" && claim !== "") ownedFamilyId = claim;
  else if (claim !== undefined && claim !== null) fail("CLAIM_WITHOUT_OWNER_ENTRY", null);
  for (const f of owners) if (f.familyId !== ownedFamilyId) fail("OWNER_ENTRY_WITHOUT_CLAIM", f.familyId);
  if (ownedFamilyId !== null && !owners.some((f) => f.familyId === ownedFamilyId)) {
    fail("CLAIM_WITHOUT_OWNER_ENTRY", ownedFamilyId);
  }

  if (events.some((e) => e.fatal)) return { ok: false, events };

  const usable = joinedFamilies.filter((f) => f.accessMode !== "NONE");
  const selectedFamilySuggestion = usable.find((f) => f.familyId === ownedFamilyId)?.familyId ?? usable[0]?.familyId ?? null;
  return {
    ok: true,
    events,
    data: { ownedFamilyId, joinedFamilies, trialEligible: !stored.trialLedgerExists, selectedFamilySuggestion },
  };
}
