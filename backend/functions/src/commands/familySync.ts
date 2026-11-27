/**
 * BC-FAMILY-SYNC-01 (Sync Contract Rev 2; emulator-only milestone): invites.create, invites.accept,
 * items.add, items.edit, items.delete and items.undoDelete.
 *
 * Evaluation order for family mutations, following the W-02 pipeline of the lifecycle commands
 * (lifecycleCommon.ts), with ACTIVE membership in place of the immutable-owner check:
 *   1 authentication (adapter) -> 2 verified email -> 3 schema/version -> [transaction:
 *   4 idempotency lookup (a mismatch is rejected now, a match is held back) -> 5 family exists and
 *   the caller's membership is ACTIVE (a committed replay is returned only here, after current
 *   authorization) -> 6 server familyEpoch -> 7 lifecycle and access mode -> 8 command checks ->
 *   atomic commit of the authoritative record, the client read model and the idempotency record].
 *
 * Read model (Rev 2 §1): `families/{fid}/listItems/{itemId}` holds live items only, with display
 * fields only, and `families/{fid}/listMeta/current` holds the current familyEpoch. Both are written
 * only here (and listMeta by families.restore), always in the same transaction as the change.
 * Authoritative `items/{itemId}` documents keep tombstones and stay server-only.
 */
import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { successEnvelope } from "../contract/envelope.js";
import type { SuccessEnvelope } from "../contract/envelope.js";
import { DomainError } from "../contract/errors.js";
import type { DomainErrorCode } from "../contract/errors.js";
import {
  parseInviteAcceptRequest,
  parseInviteCreateRequest,
  parseItemAddRequest,
  parseItemDeleteRequest,
  parseItemEditRequest,
  parseItemUndoDeleteRequest,
} from "../contract/validate.js";
import type { FamilyMutationRequest, ItemCategory, ItemPatch } from "../contract/validate.js";
import type { Clock } from "../domain/clock.js";
import { toRfc3339 } from "../domain/clock.js";
import { accessModeFor } from "../domain/family.js";
import { IDEMPOTENCY_RETENTION_MS, idempotencyKey, requestHash } from "../persistence/idempotency.js";
import { familyLifecycleFrom } from "../persistence/lifecycleStore.js";
import type { FamilyLifecycle } from "../persistence/lifecycleStore.js";
import { paths } from "../persistence/paths.js";
import type { Actor } from "./familiesCreate.js";
import { MAX_TRANSACTION_ATTEMPTS } from "./lifecycleCommon.js";

export interface SyncDeps {
  readonly db: Firestore;
  readonly clock: Clock;
}

/** Invites are single-use and short-lived (API v0.4 invites.create). */
export const INVITE_TTL_MS = 24 * 3_600_000;
/** API v0.4 invites.accept: capacity max six, subject to billing. */
export const FAMILY_MEMBER_CAPACITY = 6;

const LIFECYCLE_REJECTIONS: Readonly<Record<string, DomainErrorCode>> = {
  UNENTITLED_AWAITING_PAYMENT: "UNENTITLED_AWAITING_PAYMENT",
  CLOSURE_PENDING_BILLING: "FAMILY_CLOSURE_PENDING",
  CLOSING: "FAMILY_CLOSING",
  DELETION_PENDING: "FAMILY_DELETION_PENDING",
};

function requireVerifiedEmail(actor: Actor): void {
  if (!actor.emailVerified) throw new DomainError("EMAIL_VERIFICATION_REQUIRED");
}

function idempotencyRecord(actor: Actor, command: string, opId: string, hash: string, response: unknown, nowMillis: number) {
  return {
    actorUid: actor.uid,
    opId,
    command,
    requestHash: hash,
    responseJson: JSON.stringify(response),
    committedAt: Timestamp.fromMillis(nowMillis),
    retainUntil: Timestamp.fromMillis(nowMillis + IDEMPOTENCY_RETENTION_MS),
  };
}

interface MemberGateProceed {
  readonly kind: "PROCEED";
  readonly family: FamilyLifecycle;
  readonly member: DocumentSnapshot;
  readonly listMeta: DocumentSnapshot;
  readonly idemRef: DocumentReference;
  readonly extra: DocumentSnapshot[];
}

type MemberGate<T> = { readonly kind: "REPLAY"; readonly response: SuccessEnvelope<T> } | MemberGateProceed;

/** Steps 4-7 inside the caller's transaction. `extra` documents are read in the same getAll. */
async function gateMemberMutation<T>(
  db: Firestore,
  tx: Transaction,
  actor: Actor,
  command: string,
  hash: string,
  request: FamilyMutationRequest,
  extra: readonly DocumentReference[],
  nowMillis: number,
): Promise<MemberGate<T>> {
  const idemRef = db.doc(paths.idempotency(idempotencyKey(actor.uid, request.opId)));
  const [idem, familySnap, member, listMeta, ...rest] = await tx.getAll(
    idemRef,
    db.doc(paths.family(request.familyId)),
    db.doc(paths.familyMember(request.familyId, actor.uid)),
    db.doc(paths.familyListMeta(request.familyId)),
    ...extra,
  );

  // Step 4.
  const matched = idem?.exists === true;
  if (matched && (idem.get("command") !== command || idem.get("requestHash") !== hash)) {
    throw new DomainError("IDEMPOTENCY_KEY_REUSED");
  }

  // Step 5. A non-member gets the same NOT_FOUND as a missing family, so nothing is disclosed.
  const family = familyLifecycleFrom(familySnap);
  if (family === null || !member?.exists) throw new DomainError("NOT_FOUND");
  if (member.get("state") !== "ACTIVE") throw new DomainError("MEMBERSHIP_REVOKED");
  if (matched) return { kind: "REPLAY", response: JSON.parse(idem.get("responseJson") as string) as SuccessEnvelope<T> };

  // Step 6.
  if (request.familyEpoch !== family.familyEpoch) throw new DomainError("STALE_EPOCH_REJECTED");

  // Step 7. Only an ACTIVE family with read-write access may change.
  const rejection = LIFECYCLE_REJECTIONS[family.lifecycleState];
  if (rejection !== undefined) throw new DomainError(rejection);
  const trialEndsAt = familySnap?.get("trialEndsAt");
  const access = accessModeFor(
    { lifecycleState: family.lifecycleState, trialEndsAtMillis: trialEndsAt instanceof Timestamp ? trialEndsAt.toMillis() : null },
    nowMillis,
  );
  if (access === "READ_ONLY") throw new DomainError("READ_ONLY");
  if (access !== "READ_WRITE") throw new DomainError("INTERNAL");

  return { kind: "PROCEED", family, member, listMeta: listMeta as DocumentSnapshot, idemRef, extra: rest };
}

/** Keeps `listMeta/current` equal to the family's epoch, in the same transaction as the change. */
function writeListMeta(db: Firestore, tx: Transaction, gate: MemberGateProceed): void {
  if (gate.listMeta.exists && gate.listMeta.get("familyEpoch") === gate.family.familyEpoch) return;
  tx.set(db.doc(paths.familyListMeta(gate.family.familyId)), { familyEpoch: gate.family.familyEpoch });
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

export interface ItemData {
  readonly itemId: string;
  readonly name: string;
  readonly category: ItemCategory;
  readonly checked: boolean;
  readonly deleted: boolean;
  readonly rev: number;
  readonly deleteOpId?: string;
}

interface StoredItem {
  readonly name: string;
  readonly category: ItemCategory;
  readonly checked: boolean;
  readonly deleted: boolean;
  readonly rev: number;
  readonly deleteOpId: string | null;
  readonly restoredFromDeleteOpId: string | null;
}

function storedItemFrom(snap: DocumentSnapshot | undefined): StoredItem | null {
  if (!snap?.exists) return null;
  const d = snap.data() ?? {};
  if (
    typeof d["name"] !== "string" ||
    typeof d["category"] !== "string" ||
    typeof d["checked"] !== "boolean" ||
    typeof d["deleted"] !== "boolean" ||
    typeof d["rev"] !== "number" ||
    !Number.isSafeInteger(d["rev"])
  ) {
    throw new DomainError("INTERNAL");
  }
  return {
    name: d["name"],
    category: d["category"] as ItemCategory,
    checked: d["checked"],
    deleted: d["deleted"],
    rev: d["rev"],
    deleteOpId: typeof d["deleteOpId"] === "string" ? d["deleteOpId"] : null,
    restoredFromDeleteOpId: typeof d["restoredFromDeleteOpId"] === "string" ? d["restoredFromDeleteOpId"] : null,
  };
}

function itemData(itemId: string, item: StoredItem): ItemData {
  return {
    itemId,
    name: item.name,
    category: item.category,
    checked: item.checked,
    deleted: item.deleted,
    rev: item.rev,
    ...(item.deleted && item.deleteOpId !== null ? { deleteOpId: item.deleteOpId } : {}),
  };
}

/** The client read model: display fields only (Rev 2 §1). No actor UIDs, op IDs or tombstones. */
function listItemDoc(item: StoredItem, now: Timestamp) {
  return { name: item.name, category: item.category, checked: item.checked, rev: item.rev, updatedAt: now };
}

type ItemDecision =
  | { readonly kind: "UNCHANGED"; readonly item: StoredItem }
  | { readonly kind: "WRITE"; readonly item: StoredItem; readonly authoritative: Record<string, unknown>; readonly create: boolean };

/** Shared commit for the four item commands: authoritative record, read model, listMeta, idempotency. */
function itemHandler<R extends FamilyMutationRequest & { readonly itemId: string }>(
  deps: SyncDeps,
  command: string,
  parse: (data: unknown) => { request: R; raw: Record<string, unknown> },
  decide: (request: R, existing: StoredItem | null) => ItemDecision,
) {
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<ItemData>> => {
    requireVerifiedEmail(actor);
    const { request, raw } = parse(data);
    const hash = requestHash(command, raw);
    const db = deps.db;
    const itemRef = db.doc(paths.familyItem(request.familyId, request.itemId));
    const listItemRef = db.doc(paths.familyListItem(request.familyId, request.itemId));

    return db.runTransaction(
      async (tx) => {
        const nowMillis = deps.clock.nowMillis();
        const gate = await gateMemberMutation<ItemData>(db, tx, actor, command, hash, request, [itemRef], nowMillis);
        if (gate.kind === "REPLAY") return gate.response;

        const decision = decide(request, storedItemFrom(gate.extra[0]));
        const now = Timestamp.fromMillis(nowMillis);
        const response = successEnvelope(request.opId, toRfc3339(nowMillis), itemData(request.itemId, decision.item));

        if (decision.kind === "WRITE") {
          const authoritative = { ...decision.authoritative, updatedAt: now, lastOpId: request.opId, lastActorUid: actor.uid };
          if (decision.create) tx.set(itemRef, { ...authoritative, createdAt: now, createdBy: actor.uid });
          else tx.update(itemRef, authoritative);
          if (decision.item.deleted) tx.delete(listItemRef);
          else tx.set(listItemRef, listItemDoc(decision.item, now));
          writeListMeta(db, tx, gate);
        }
        tx.set(gate.idemRef, idempotencyRecord(actor, command, request.opId, hash, response, nowMillis));
        return response;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}

export function itemsAddHandler(deps: SyncDeps) {
  return itemHandler(deps, "items.add", parseItemAddRequest, (request, existing) => {
    // The client chose the UUID; a different operation already holds it.
    if (existing !== null) throw new DomainError("ITEM_ID_CONFLICT");
    const item: StoredItem = {
      name: request.name,
      category: request.category,
      checked: false,
      deleted: false,
      rev: 1,
      deleteOpId: null,
      restoredFromDeleteOpId: null,
    };
    return {
      kind: "WRITE",
      item,
      create: true,
      authoritative: { name: item.name, category: item.category, checked: false, deleted: false, rev: 1, deleteOpId: null, restoredFromDeleteOpId: null },
    };
  });
}

export function itemsEditHandler(deps: SyncDeps) {
  return itemHandler(deps, "items.edit", parseItemEditRequest, (request, existing) => {
    if (existing === null) throw new DomainError("ITEM_NOT_FOUND");
    if (existing.deleted) throw new DomainError("ITEM_DELETED");
    // Field-level: only the fields in the patch change; last server-accepted write wins per field.
    const patch: ItemPatch = request.patch;
    const item: StoredItem = { ...existing, ...patch, rev: existing.rev + 1 };
    return { kind: "WRITE", item, create: false, authoritative: { ...patch, rev: item.rev } };
  });
}

export function itemsDeleteHandler(deps: SyncDeps) {
  return itemHandler(deps, "items.delete", parseItemDeleteRequest, (request, existing) => {
    if (existing === null) throw new DomainError("ITEM_NOT_FOUND");
    // API v0.4: a redundant delete is satisfied without a second tombstone.
    if (existing.deleted) return { kind: "UNCHANGED", item: existing };
    const item: StoredItem = { ...existing, deleted: true, deleteOpId: request.opId, rev: existing.rev + 1 };
    return { kind: "WRITE", item, create: false, authoritative: { deleted: true, deleteOpId: request.opId, rev: item.rev } };
  });
}

export function itemsUndoDeleteHandler(deps: SyncDeps) {
  return itemHandler(deps, "items.undoDelete", parseItemUndoDeleteRequest, (request, existing) => {
    if (existing === null) throw new DomainError("ITEM_NOT_FOUND");
    if (!existing.deleted) {
      // Already undone by this same delete: satisfied. Anything else is a conflicting undo.
      if (existing.restoredFromDeleteOpId === request.deleteOpId) return { kind: "UNCHANGED", item: existing };
      throw new DomainError("UNDO_CONFLICT");
    }
    if (existing.deleteOpId !== request.deleteOpId) throw new DomainError("UNDO_CONFLICT");
    const item: StoredItem = { ...existing, deleted: false, deleteOpId: null, restoredFromDeleteOpId: request.deleteOpId, rev: existing.rev + 1 };
    return {
      kind: "WRITE",
      item,
      create: false,
      authoritative: { deleted: false, deleteOpId: null, restoredFromDeleteOpId: request.deleteOpId, rev: item.rev },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 16 Crockford base32 characters from 80 random bits. */
export function newInviteCode(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let code = "";
  for (let i = 15; i >= 0; i--) code += CROCKFORD.charAt(Number((bits >> BigInt(i * 5)) & 31n));
  return code;
}

/** Only this hash is stored; the code itself is never persisted (API v0.4: hashed). */
export function inviteCodeHash(code: string): string {
  return createHash("sha256").update(`invite:${code}`, "utf8").digest("hex");
}

export interface InviteCreateData {
  readonly familyId: string;
  readonly expiresAt: string;
  /**
   * The code, returned once. A committed replay returns null: the idempotency record keeps the response
   * without the code, so the code exists only in the first response (CODI interpretation for GAI D4).
   */
  readonly code: string | null;
}

export function invitesCreateHandler(deps: SyncDeps, codeSource: () => string = newInviteCode) {
  const command = "invites.create";
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<InviteCreateData>> => {
    requireVerifiedEmail(actor);
    const { request, raw } = parseInviteCreateRequest(data);
    const hash = requestHash(command, raw);
    const db = deps.db;
    return db.runTransaction(
      async (tx) => {
        const nowMillis = deps.clock.nowMillis();
        const gate = await gateMemberMutation<InviteCreateData>(db, tx, actor, command, hash, request, [], nowMillis);
        if (gate.kind === "REPLAY") return gate.response;
        // API v0.4: invites are created by the owner only.
        if (gate.family.ownerUid !== actor.uid || gate.member.get("role") !== "OWNER") throw new DomainError("OWNER_REQUIRED");

        const expiresAtMillis = nowMillis + INVITE_TTL_MS;
        const code = codeSource();
        const now = Timestamp.fromMillis(nowMillis);
        tx.create(db.doc(paths.invite(inviteCodeHash(code))), {
          familyId: request.familyId,
          familyEpoch: gate.family.familyEpoch,
          createdBy: actor.uid,
          createdAt: now,
          expiresAt: Timestamp.fromMillis(expiresAtMillis),
          consumedBy: null,
          consumedAt: null,
        });
        writeListMeta(db, tx, gate);
        const data = { familyId: request.familyId, expiresAt: toRfc3339(expiresAtMillis) };
        const stored = successEnvelope(request.opId, toRfc3339(nowMillis), { ...data, code: null });
        tx.set(gate.idemRef, idempotencyRecord(actor, command, request.opId, hash, stored, nowMillis));
        return successEnvelope(request.opId, toRfc3339(nowMillis), { ...data, code });
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}

export interface InviteAcceptData {
  readonly familyId: string;
  readonly familyEpoch: number;
  readonly role: "MEMBER";
}

export function invitesAcceptHandler(deps: SyncDeps) {
  const command = "invites.accept";
  return async (actor: Actor, data: unknown): Promise<SuccessEnvelope<InviteAcceptData>> => {
    requireVerifiedEmail(actor);
    const { request, raw } = parseInviteAcceptRequest(data);
    const hash = requestHash(command, raw);
    const db = deps.db;
    const idemRef = db.doc(paths.idempotency(idempotencyKey(actor.uid, request.opId)));
    const inviteRef = db.doc(paths.invite(inviteCodeHash(request.code)));

    return db.runTransaction(
      async (tx) => {
        const [idem, invite] = await tx.getAll(idemRef, inviteRef);
        if (idem?.exists) {
          if (idem.get("command") !== command || idem.get("requestHash") !== hash) throw new DomainError("IDEMPOTENCY_KEY_REUSED");
          // A replay is returned only while the membership it created is still ACTIVE.
          const cached = JSON.parse(idem.get("responseJson") as string) as SuccessEnvelope<InviteAcceptData>;
          const member = await tx.get(db.doc(paths.familyMember(cached.data.familyId, actor.uid)));
          if (member.get("state") !== "ACTIVE") throw new DomainError("MEMBERSHIP_REVOKED");
          return cached;
        }

        const nowMillis = deps.clock.nowMillis();
        // Unknown, consumed, expired or stale invites all give the same INVITE_INVALID.
        if (!invite?.exists || invite.get("consumedBy") !== null) throw new DomainError("INVITE_INVALID");
        const expiresAt = invite.get("expiresAt");
        if (!(expiresAt instanceof Timestamp) || nowMillis >= expiresAt.toMillis()) throw new DomainError("INVITE_INVALID");
        const familyId = invite.get("familyId") as string;

        const familyRef = db.doc(paths.family(familyId));
        const memberRef = db.doc(paths.familyMember(familyId, actor.uid));
        const [familySnap, member, listMeta] = await tx.getAll(familyRef, memberRef, db.doc(paths.familyListMeta(familyId)));
        const family = familyLifecycleFrom(familySnap);
        if (family === null || family.lifecycleState !== "ACTIVE" || invite.get("familyEpoch") !== family.familyEpoch) {
          throw new DomainError("INVITE_INVALID");
        }
        if (family.ownerUid === actor.uid || member?.get("state") === "ACTIVE") throw new DomainError("ALREADY_MEMBER");
        const members = await tx.get(db.collection(paths.familyMembers(familyId)));
        if (members.docs.filter((m) => m.get("state") === "ACTIVE").length >= FAMILY_MEMBER_CAPACITY) throw new DomainError("FAMILY_FULL");

        const now = Timestamp.fromMillis(nowMillis);
        const response = successEnvelope(request.opId, toRfc3339(nowMillis), {
          familyId,
          familyEpoch: family.familyEpoch,
          role: "MEMBER" as const,
        });
        const edge = { role: "MEMBER", state: "ACTIVE", joinedAt: now, invitedBy: invite.get("createdBy") as string };
        tx.set(memberRef, edge);
        tx.set(db.doc(paths.userMembership(actor.uid, familyId)), edge);
        tx.update(inviteRef, { consumedBy: actor.uid, consumedAt: now });
        if (!listMeta?.exists || listMeta.get("familyEpoch") !== family.familyEpoch) {
          tx.set(db.doc(paths.familyListMeta(familyId)), { familyEpoch: family.familyEpoch });
        }
        tx.set(idemRef, idempotencyRecord(actor, command, request.opId, hash, response, nowMillis));
        return response;
      },
      { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
    );
  };
}
