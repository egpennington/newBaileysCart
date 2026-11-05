/**
 * Reservation reconciler (G-01, D46) for Substage 3A: records the disposition of an expired
 * UNENTITLED_AWAITING_PAYMENT reservation in `reservationCases/{familyId}`. It never changes the
 * family, the owner claim or the trial ledger. Emulator/test-driven only; not scheduled or exported.
 */
import { Timestamp } from "firebase-admin/firestore";
import { checkLiabilitySafely } from "../billing/provider.js";
import { decideReservationDisposition, TERMINAL_DISPOSITIONS } from "../domain/reservation.js";
import type { ReservationDisposition } from "../domain/reservation.js";
import { localBillingFrom, sameBilling } from "../persistence/lifecycleStore.js";
import { SCHEMA_VERSION, paths } from "../persistence/paths.js";
import type { WorkerDeps } from "./lifecycleWorkers.js";

export async function reconcileReservation(deps: WorkerDeps, familyId: string): Promise<ReservationDisposition | null> {
  const { db } = deps;
  const familyRef = db.doc(paths.family(familyId));
  const caseRef = db.doc(paths.reservationCase(familyId));
  const billingRef = db.doc(paths.familyBilling(familyId));

  const pre = await db.runTransaction(async (tx) => tx.getAll(familyRef, billingRef, caseRef), { readOnly: true });
  const [familySnap, billingSnap] = pre;
  if (!familySnap?.exists || familySnap.get("lifecycleState") !== "UNENTITLED_AWAITING_PAYMENT") return null;
  const ownerUid = familySnap.get("ownerUid") as string;
  const billingBefore = localBillingFrom(billingSnap);
  const provider = await checkLiabilitySafely(deps.provider, { familyId, ownerUid, purchaseRef: billingBefore.purchaseRef });

  return db.runTransaction(async (tx) => {
    const [family, billingSnapNow, existing] = await tx.getAll(familyRef, billingRef, caseRef);
    if (!family?.exists || family.get("lifecycleState") !== "UNENTITLED_AWAITING_PAYMENT") return null;
    const expiresAt = family.get("reservationExpiresAt");
    if (!(expiresAt instanceof Timestamp)) return null;
    const prior = existing?.exists ? (existing.get("disposition") as ReservationDisposition) : null;
    if (prior !== null && TERMINAL_DISPOSITIONS.includes(prior)) return prior;

    const billing = localBillingFrom(billingSnapNow);
    const nowMillis = deps.clock.nowMillis();
    const held = prior === "RESERVATION_RECONCILIATION_PENDING";
    const originalPurchaseRef = held ? ((existing?.get("originalPurchaseRef") as string | null) ?? null) : billing.purchaseRef;
    const disposition = decideReservationDisposition({
      reservationExpiresAtMillis: expiresAt.toMillis(),
      nowMillis,
      local: billing.purchaseState,
      // A billing change between the provider call and now makes the provider answer unusable.
      provider: sameBilling(billingBefore, billing) ? provider : "UNRESOLVED",
      originalPurchaseRef,
      currentPurchaseRef: billing.purchaseRef,
      held,
    });
    if (disposition === null) return null;
    const now = Timestamp.fromMillis(nowMillis);
    tx.set(caseRef, {
      familyId,
      ownerUid: family.get("ownerUid"),
      reservationCreatedAt: family.get("reservationCreatedAt"),
      reservationExpiresAt: expiresAt,
      originalPurchaseRef,
      disposition,
      ...(existing?.exists ? {} : { firstReconciledAt: now }),
      lastReconciledAt: now,
      providerSource: deps.provider.source,
      schemaVersion: SCHEMA_VERSION,
    }, { merge: true });
    return disposition;
  });
}
