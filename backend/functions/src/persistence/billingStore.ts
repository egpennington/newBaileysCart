/**
 * Storage mapping for the Slice 3B Stage B1 records. All are server-only (firestore.rules denies
 * every client read and write):
 *   purchaseBindings/{sha256(token)}  the only place a raw purchase token is stored (needed for Play calls)
 *   rtdnDeliveries/{sha256(messageId)} deduplication and disposition; token hash only, never the token
 * Readers fail closed: a malformed binding is treated as absent, so no provider effect can follow.
 */
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { BindingLookup, BoundPurchase } from "../billing/playProvider.js";
import { BINDING_STATUSES } from "../billing/binding.js";
import type { BindingStatus } from "../billing/binding.js";
import { paths } from "./paths.js";

export interface StoredBinding extends BoundPurchase {
  readonly status: BindingStatus;
}

const str = (v: unknown): v is string => typeof v === "string" && v !== "";

export function bindingFrom(snap: DocumentSnapshot | undefined): StoredBinding | null {
  if (!snap?.exists) return null;
  const f = (k: string) => snap.get(k);
  const status = f("status");
  const fields = ["purchaseToken", "packageName", "productId", "ownerUid", "familyId", "obfuscatedAccountId", "obfuscatedProfileId"];
  if (!fields.every((k) => str(f(k))) || !BINDING_STATUSES.includes(status as BindingStatus)) return null;
  return {
    purchaseRef: snap.id,
    purchaseToken: f("purchaseToken") as string,
    packageName: f("packageName") as string,
    productId: f("productId") as string,
    ownerUid: f("ownerUid") as string,
    familyId: f("familyId") as string,
    obfuscatedAccountId: f("obfuscatedAccountId") as string,
    obfuscatedProfileId: f("obfuscatedProfileId") as string,
    status: status as BindingStatus,
  };
}

/** Binding lookup for the Play adapter. Reads outside a transaction, before any provider call. */
export function firestoreBindingLookup(db: Firestore): BindingLookup {
  return async (purchaseRef) => bindingFrom(await db.doc(paths.purchaseBinding(purchaseRef)).get());
}
