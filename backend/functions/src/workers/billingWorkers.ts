/**
 * Slice 3B Stage B1 billing workers: RTDN processing and internal purchase binding. Plain functions
 * driven by D2 tests against the emulator. None is exported from index.ts, scheduled, or connected to
 * Pub/Sub; there is no HTTP receiver and no OIDC verification (B2). Provider calls run outside
 * transactions; results are applied by transactions that re-read their facts.
 *
 * RTDN is a hint, never payment proof (handoff §4): every notification for a bound token leads to a
 * fresh provider inspection, and only that inspection can change lifecycle state, through the
 * verified 3A saga functions. No notification, client callback or missing local token ever grants
 * entitlement; this module has no entitlement or activation write at all.
 */
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { decideBinding, isPlausiblePurchaseToken, precheckBinding } from "../billing/binding.js";
import type { BindingDecision, BindingFamilyFacts, BindingRejection, BindingStatus } from "../billing/binding.js";
import type { BillingConfig } from "../billing/config.js";
import { obfuscatedAccountIdFor, obfuscatedProfileIdFor, purchaseTokenRef } from "../billing/play.js";
import type { PlayBillingProvider } from "../billing/playProvider.js";
import { inspectPurchaseSafely } from "../billing/provider.js";
import type { PurchaseInspection } from "../billing/provider.js";
import { parseRtdnEnvelope } from "../billing/rtdn.js";
import type { RtdnRejection } from "../billing/rtdn.js";
import { isLifecycleState } from "../domain/family.js";
import { bindingFrom } from "../persistence/billingStore.js";
import { caseFrom, familyLifecycleFrom, localBillingFrom } from "../persistence/lifecycleStore.js";
import { SCHEMA_VERSION, paths } from "../persistence/paths.js";
import { applyProviderEvent, recheckLiability } from "./lifecycleWorkers.js";
import type { WorkerDeps, WorkerResult } from "./lifecycleWorkers.js";

export interface BillingWorkerDeps extends WorkerDeps {
  readonly config: BillingConfig;
}

// ---------------------------------------------------------------------------------------------
// RTDN processing
// ---------------------------------------------------------------------------------------------

/** How long a delivery in progress blocks a concurrent duplicate before it may be reprocessed. */
export const RTDN_PROCESSING_LEASE_MS = 60_000;

export type RtdnDisposition =
  | { readonly kind: "REJECTED_MALFORMED"; readonly reason: RtdnRejection }
  | { readonly kind: "DUPLICATE" }
  | { readonly kind: "DUPLICATE_IN_PROGRESS" }
  | { readonly kind: "TEST_NOTIFICATION" }
  /** One-time product or voided-purchase notification: recorded, no effect (out of B1 scope). */
  | { readonly kind: "UNSUPPORTED_NOTIFICATION" }
  /** No server binding for the token: an RTDN alone never creates one. */
  | { readonly kind: "UNBOUND_PURCHASE" }
  /** Provider inspection result applied (or not) to the bound family's closure case. */
  | { readonly kind: "INSPECTED"; readonly inspection: PurchaseInspection; readonly lifecycle: WorkerResult | "NO_LIFECYCLE_EFFECT" };

type FinalKind = Exclude<RtdnDisposition["kind"], "REJECTED_MALFORMED" | "DUPLICATE" | "DUPLICATE_IN_PROGRESS">;

/**
 * Process one Pub/Sub push envelope. Duplicate deliveries (same messageId) have no second effect;
 * reordered deliveries are harmless because processing uses current provider state, never the
 * notification type. A crash mid-processing leaves the delivery RECEIVED, and a redelivery after the
 * lease reprocesses it idempotently.
 */
export async function processRtdnDelivery(deps: BillingWorkerDeps, envelope: unknown): Promise<RtdnDisposition> {
  const parsed = parseRtdnEnvelope(envelope, deps.config.packageName);
  if (!parsed.ok) return { kind: "REJECTED_MALFORMED", reason: parsed.reason };
  const { rtdn } = parsed;
  const { db } = deps;
  const deliveryRef = db.doc(paths.rtdnDelivery(rtdn.deliveryRef));
  const tokenRef = rtdn.purchaseToken === null ? null : purchaseTokenRef(rtdn.purchaseToken);

  // Claim the delivery (dedup by messageId hash).
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(deliveryRef);
    const nowMillis = deps.clock.nowMillis();
    if (snap.exists) {
      if (snap.get("status") === "COMPLETED") return "DUPLICATE" as const;
      const lease = snap.get("leaseUntil");
      if (lease instanceof Timestamp && nowMillis < lease.toMillis()) return "DUPLICATE_IN_PROGRESS" as const;
    }
    tx.set(deliveryRef, {
      status: "RECEIVED",
      kind: rtdn.kind,
      notificationType: rtdn.notificationType,
      eventTimeMillis: rtdn.eventTimeMillis,
      purchaseRef: tokenRef,
      receivedAt: (snap.exists ? (snap.get("receivedAt") as Timestamp | undefined) : undefined) ?? Timestamp.fromMillis(nowMillis),
      leaseUntil: Timestamp.fromMillis(nowMillis + RTDN_PROCESSING_LEASE_MS),
      attempts: ((snap.get("attempts") as number | undefined) ?? 0) + 1,
      schemaVersion: SCHEMA_VERSION,
    });
    return "CLAIMED" as const;
  });
  if (claim !== "CLAIMED") return { kind: claim };

  const disposition = await dispose(deps, rtdn.kind, tokenRef);
  await deliveryRef.set(
    {
      status: "COMPLETED",
      disposition: disposition.kind,
      ...(disposition.kind === "INSPECTED" ? { inspection: disposition.inspection, lifecycle: disposition.lifecycle } : {}),
      completedAt: Timestamp.fromMillis(deps.clock.nowMillis()),
      leaseUntil: null,
    },
    { merge: true },
  );
  return disposition;
}

async function dispose(deps: BillingWorkerDeps, kind: string, tokenRef: string | null): Promise<RtdnDisposition & { kind: FinalKind }> {
  if (kind === "TEST") return { kind: "TEST_NOTIFICATION" };
  if (kind !== "SUBSCRIPTION" || tokenRef === null) return { kind: "UNSUPPORTED_NOTIFICATION" };
  const { db } = deps;
  const binding = bindingFrom(await db.doc(paths.purchaseBinding(tokenRef)).get());
  if (binding === null) return { kind: "UNBOUND_PURCHASE" };

  // The notification says only "look again". Ask the provider for current state.
  const inspection = await inspectPurchaseSafely(deps.provider, {
    familyId: binding.familyId,
    ownerUid: binding.ownerUid,
    purchaseRef: tokenRef,
  });

  const family = familyLifecycleFrom(await db.doc(paths.family(binding.familyId)).get());
  if (family === null || family.closureCaseId === null || family.ownerUid !== binding.ownerUid) {
    return { kind: "INSPECTED", inspection, lifecycle: "NO_LIFECYCLE_EFFECT" };
  }
  const closure = caseFrom(await db.doc(paths.closureCase(family.closureCaseId)).get());
  if (closure.cancellationStatus === "LIABILITY_UNRESOLVED") {
    // A liability hold re-asks the provider through the verified 3A recheck.
    return { kind: "INSPECTED", inspection, lifecycle: await recheckLiability(deps, closure.caseId) };
  }
  if ((closure.cancellationStatus === "PENDING" || closure.cancellationStatus === "MANUAL_REVIEW") && inspection === "STOP_VERIFIED") {
    return { kind: "INSPECTED", inspection, lifecycle: await applyProviderEvent(deps, closure.caseId, { kind: "VERIFIED", sequence: 0 }) };
  }
  return { kind: "INSPECTED", inspection, lifecycle: "NO_LIFECYCLE_EFFECT" };
}

// ---------------------------------------------------------------------------------------------
// Internal purchase binding (no public callable; handoff task 5)
// ---------------------------------------------------------------------------------------------

export interface PurchaseBindingInput {
  /** Server-verified caller UID (a future ratified callable would pass the Auth context UID). */
  readonly ownerUid: string;
  readonly familyId: string;
  readonly purchaseToken: unknown;
  readonly productId: string;
}

export type BindingResult =
  | { readonly kind: "WRITTEN"; readonly status: BindingStatus; readonly purchaseRef: string }
  | { readonly kind: "ALREADY_BOUND_THIS_FAMILY"; readonly purchaseRef: string }
  | { readonly kind: "REJECTED"; readonly reason: BindingRejection };

export interface BindingDeps {
  readonly db: Firestore;
  readonly clock: { nowMillis(): number };
  readonly play: PlayBillingProvider;
  /** Test hook: runs between the provider verification and the commit transaction. */
  readonly afterVerification?: () => Promise<void>;
}

function familyFacts(snap: DocumentSnapshot | undefined): BindingFamilyFacts | null {
  if (!snap?.exists) return null;
  const ownerUid = snap.get("ownerUid");
  const state = snap.get("lifecycleState");
  const expires = snap.get("reservationExpiresAt");
  if (typeof ownerUid !== "string" || !isLifecycleState(state)) return null;
  return { ownerUid, lifecycleState: state, reservationExpiresAtMillis: expires instanceof Timestamp ? expires.toMillis() : null };
}

const asResult = (d: BindingDecision, purchaseRef: string): BindingResult | null =>
  d.kind === "REJECT"
    ? { kind: "REJECTED", reason: d.reason }
    : d.kind === "ALREADY_BOUND_THIS_FAMILY"
      ? { kind: "ALREADY_BOUND_THIS_FAMILY", purchaseRef }
      : null;

/**
 * Verify a purchase with the provider and record its binding. Never activates a family, grants
 * entitlement or acknowledges the purchase. A token is bound at most once (transactional create);
 * a late settlement after the reservation TTL is held for reconciliation, not attached elsewhere.
 */
export async function recordVerifiedPurchase(deps: BindingDeps, input: PurchaseBindingInput): Promise<BindingResult> {
  if (!isPlausiblePurchaseToken(input.purchaseToken)) return { kind: "REJECTED", reason: "INVALID_TOKEN" };
  const token = input.purchaseToken;
  const purchaseRef = purchaseTokenRef(token);
  const { db } = deps;
  const familyRef = db.doc(paths.family(input.familyId));
  const bindingRef = db.doc(paths.purchaseBinding(purchaseRef));
  const billingRef = db.doc(paths.familyBilling(input.familyId));

  const pre = await db.runTransaction(async (tx) => {
    const [f, b, l] = await tx.getAll(familyRef, bindingRef, billingRef);
    const existing = b?.exists ? { familyId: b.get("familyId") as string, ownerUid: b.get("ownerUid") as string } : null;
    return precheckBinding(familyFacts(f), input.ownerUid, input.familyId, existing, localBillingFrom(l), purchaseRef);
  }, { readOnly: true });
  if (pre !== null) return asResult(pre, purchaseRef) as BindingResult;

  const verification = await deps.play.verifyPurchaseToken({
    purchaseToken: token,
    productId: input.productId,
    ownerUid: input.ownerUid,
    familyId: input.familyId,
  });
  await deps.afterVerification?.();

  return db.runTransaction(async (tx) => {
    const [f, b, l] = await tx.getAll(familyRef, bindingRef, billingRef);
    const existing = b?.exists ? { familyId: b.get("familyId") as string, ownerUid: b.get("ownerUid") as string } : null;
    const nowMillis = deps.clock.nowMillis();
    const d = decideBinding(familyFacts(f), input.ownerUid, input.familyId, existing, localBillingFrom(l), purchaseRef, verification, nowMillis);
    const early = asResult(d, purchaseRef);
    if (early !== null || d.kind !== "WRITE") return early as BindingResult;
    const now = Timestamp.fromMillis(nowMillis);
    // create(): a concurrent binding of the same token makes this transaction retry and re-decide.
    tx.create(bindingRef, {
      purchaseToken: token,
      packageName: deps.play.packageName,
      productId: input.productId,
      ownerUid: input.ownerUid,
      familyId: input.familyId,
      obfuscatedAccountId: obfuscatedAccountIdFor(input.ownerUid),
      obfuscatedProfileId: obfuscatedProfileIdFor(input.familyId),
      status: d.status,
      acknowledgementRequired: verification.kind === "VERIFIED_ACTIVE" ? verification.assessment.acknowledgementPending : true,
      providerSource: deps.play.source,
      boundAt: now,
      schemaVersion: SCHEMA_VERSION,
    });
    tx.set(billingRef, { purchaseState: d.localPurchaseState, purchaseRef, updatedAt: now }, { merge: true });
    return { kind: "WRITTEN", status: d.status, purchaseRef };
  });
}
