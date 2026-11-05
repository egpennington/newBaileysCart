/**
 * Google Play subscription model for Slice 3B Stage B1 (PL-3B-01). Provider-independent and pure:
 * the shape follows `purchases.subscriptionsv2` (SubscriptionPurchaseV2), but nothing here calls a
 * network or reads credentials. Stage B1 drives it only with the deterministic fake Play API.
 *
 * A fake-provider result is never Google Play evidence. The field names follow the public REST
 * reference; behavior that the reference does not pin down is decided here fail-closed.
 */
import { createHash } from "node:crypto";

/** `subscriptionState` values of SubscriptionPurchaseV2. Any other value is treated as UNSPECIFIED. */
export type PlaySubscriptionState =
  | "SUBSCRIPTION_STATE_UNSPECIFIED"
  | "SUBSCRIPTION_STATE_PENDING"
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_EXPIRED"
  | "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";

export type PlayAcknowledgementState = "ACKNOWLEDGEMENT_STATE_UNSPECIFIED" | "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";

/** One line item. Exactly one plan kind is expected; anything else is UNKNOWN (unsupported). */
export interface PlayLineItem {
  readonly productId: string;
  /** RFC 3339 UTC. */
  readonly expiryTime?: string;
  readonly autoRenewingPlan?: { readonly autoRenewEnabled?: boolean; readonly installmentDetails?: unknown };
  readonly prepaidPlan?: Readonly<Record<string, unknown>>;
}

/** The subset of SubscriptionPurchaseV2 that B1 relies on. */
export interface PlaySubscriptionSnapshot {
  readonly subscriptionState: string;
  readonly acknowledgementState?: string;
  readonly lineItems: readonly PlayLineItem[];
  readonly linkedPurchaseToken?: string;
  readonly externalAccountIdentifiers?: {
    readonly obfuscatedExternalAccountId?: string;
    readonly obfuscatedExternalProfileId?: string;
  };
  readonly canceledStateContext?: Readonly<Record<string, unknown>>;
  readonly testPurchase?: Readonly<Record<string, unknown>>;
}

/**
 * `subscriptionsv2.cancel` cancellation types. B1 models only the stop-renewal strategy for ordinary
 * auto-renewing plans (PL-3B-01); DEVELOPER_REQUESTED_STOP_PAYMENTS is never issued.
 */
export type PlayCancellationType = "USER_REQUESTED_STOP_RENEWALS";
export const B1_CANCELLATION_TYPE: PlayCancellationType = "USER_REQUESTED_STOP_RENEWALS";

/** Server-side expectation for a bound purchase: what the snapshot must match. */
export interface PurchaseExpectation {
  readonly packageName: string;
  readonly productId: string;
  readonly obfuscatedAccountId: string;
  readonly obfuscatedProfileId: string;
}

export type PlanKind = "AUTO_RENEWING" | "INSTALLMENT" | "PREPAID" | "UNKNOWN";
export type RenewalStatus = "WILL_RENEW" | "STOPPED" | "UNKNOWN";

export interface SubscriptionAssessment {
  /** The snapshot belongs to the expected owner/family/product. */
  readonly bindingMatches: boolean;
  readonly bindingMismatch: "PRODUCT" | "ACCOUNT" | "PROFILE" | "LINE_ITEMS" | null;
  readonly plan: PlanKind;
  readonly renewal: RenewalStatus;
  /** Play still grants access now (current entitlement). Cancellation does not end it. */
  readonly currentEntitlement: boolean;
  /** Pending payment, grace period or account hold: money is not settled. */
  readonly paymentHold: boolean;
  /** Purchase still awaiting settlement (SUBSCRIPTION_STATE_PENDING). */
  readonly pendingPurchase: boolean;
  /** Verified stop-renewal finality for a supported plan (PL-3B-01): renewal off, no payment hold. */
  readonly stopRenewalVerified: boolean;
  readonly acknowledgementPending: boolean;
  readonly state: PlaySubscriptionState;
}

const STATES: readonly PlaySubscriptionState[] = [
  "SUBSCRIPTION_STATE_UNSPECIFIED",
  "SUBSCRIPTION_STATE_PENDING",
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_PAUSED",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_ON_HOLD",
  "SUBSCRIPTION_STATE_CANCELED",
  "SUBSCRIPTION_STATE_EXPIRED",
  "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
];

export function normalizeState(value: unknown): PlaySubscriptionState {
  return typeof value === "string" && (STATES as readonly string[]).includes(value)
    ? (value as PlaySubscriptionState)
    : "SUBSCRIPTION_STATE_UNSPECIFIED";
}

/** Obfuscated identifiers the client must set on the purchase (64 hex chars, within Play's limit). */
export function obfuscatedAccountIdFor(ownerUid: string): string {
  return createHash("sha256").update(`bc-owner:${ownerUid}`, "utf8").digest("hex");
}
export function obfuscatedProfileIdFor(familyId: string): string {
  return createHash("sha256").update(`bc-family:${familyId}`, "utf8").digest("hex");
}

/** Server-side reference for a purchase token. The raw token never leaves the binding record. */
export function purchaseTokenRef(purchaseToken: string): string {
  return createHash("sha256").update(purchaseToken, "utf8").digest("hex");
}

function planOf(item: PlayLineItem): PlanKind {
  const auto = item.autoRenewingPlan !== undefined;
  const prepaid = item.prepaidPlan !== undefined;
  if (auto === prepaid) return "UNKNOWN";
  if (prepaid) return "PREPAID";
  // Installment commitments: no B1 policy may be inferred (handoff §1). Unsupported.
  return item.autoRenewingPlan?.installmentDetails !== undefined ? "INSTALLMENT" : "AUTO_RENEWING";
}

function parseMillis(rfc3339: string | undefined): number | null {
  if (rfc3339 === undefined) return null;
  const t = Date.parse(rfc3339);
  return Number.isFinite(t) ? t : null;
}

/** Decide everything B1 needs from one authoritative snapshot. Unknown shapes fail closed. */
export function assessSubscription(
  s: PlaySubscriptionSnapshot,
  expected: PurchaseExpectation,
  nowMillis: number,
): SubscriptionAssessment {
  const state = normalizeState(s.subscriptionState);
  const items = Array.isArray(s.lineItems) ? s.lineItems : [];

  let bindingMismatch: SubscriptionAssessment["bindingMismatch"] = null;
  if (items.length !== 1) bindingMismatch = "LINE_ITEMS";
  else if (items[0]?.productId !== expected.productId) bindingMismatch = "PRODUCT";
  else if (s.externalAccountIdentifiers?.obfuscatedExternalAccountId !== expected.obfuscatedAccountId) bindingMismatch = "ACCOUNT";
  else if (s.externalAccountIdentifiers?.obfuscatedExternalProfileId !== expected.obfuscatedProfileId) bindingMismatch = "PROFILE";

  const item = items.length === 1 ? items[0] : undefined;
  const plan: PlanKind = item === undefined ? "UNKNOWN" : planOf(item);
  const autoRenew = item?.autoRenewingPlan?.autoRenewEnabled;
  const renewal: RenewalStatus = plan !== "AUTO_RENEWING" || typeof autoRenew !== "boolean" ? "UNKNOWN" : autoRenew ? "WILL_RENEW" : "STOPPED";

  const expiry = parseMillis(item?.expiryTime);
  const entitledState =
    state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || state === "SUBSCRIPTION_STATE_CANCELED";
  const currentEntitlement = entitledState && expiry !== null && nowMillis < expiry;
  const paymentHold =
    state === "SUBSCRIPTION_STATE_PENDING" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || state === "SUBSCRIPTION_STATE_ON_HOLD";
  const pendingPurchase = state === "SUBSCRIPTION_STATE_PENDING";
  const bindingMatches = bindingMismatch === null;

  // Stop-renewal finality: supported plan, renewal provably off, and Play reports the subscription
  // as canceled or already expired. A cancel acknowledgement alone never satisfies this.
  const stopRenewalVerified =
    bindingMatches &&
    plan === "AUTO_RENEWING" &&
    renewal === "STOPPED" &&
    !paymentHold &&
    (state === "SUBSCRIPTION_STATE_CANCELED" || state === "SUBSCRIPTION_STATE_EXPIRED");

  return {
    bindingMatches,
    bindingMismatch,
    plan,
    renewal,
    currentEntitlement,
    paymentHold,
    pendingPurchase,
    stopRenewalVerified,
    acknowledgementPending: s.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    state,
  };
}
