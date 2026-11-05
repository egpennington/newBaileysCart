/**
 * Play-semantics billing adapter (Slice 3B Stage B1, PL-3B-01). It implements the 3A
 * `BillingProvider` boundary in terms of `subscriptionsv2.get` and `subscriptionsv2.cancel`, so the
 * verified 3A lifecycle saga runs unchanged on top of it:
 *
 *   requestCancellation = get (authoritative) -> cancel (stop renewal; acknowledgement only)
 *                         -> get again (authoritative refresh). Only the refresh can say VERIFIED.
 *
 * Mapping to the saga's outcomes:
 *   VERIFIED          renewal provably stopped (play.ts stopRenewalVerified); the cancel request alone never is
 *   PENDING           Play accepted the cancel but the refresh does not yet show finality (or failed)
 *   RETRYABLE_FAILURE 429 / 5xx before any cancel was accepted (thrown as ProviderUnavailableError)
 *   AMBIGUOUS         timeout or unknown error: the cancel may have happened (thrown as ProviderTimeoutError)
 *   PERMANENT_FAILURE unsupported plan, binding mismatch, missing purchase, permanent 4xx: a hold for
 *                     manual billing action with `holdReason`; never success
 *
 * Every Play call happens outside Firestore transactions (callers' rule). Raw purchase tokens are
 * read from the server-only binding record and never returned, logged or stored elsewhere.
 */
import type { Clock } from "../domain/clock.js";
import type { BillingHoldReason, CancellationOutcome, ProviderLiability } from "../domain/lifecycle.js";
import type { BillingConfig } from "./config.js";
import { B1_CANCELLATION_TYPE, assessSubscription, obfuscatedAccountIdFor, obfuscatedProfileIdFor } from "./play.js";
import type { PurchaseExpectation, SubscriptionAssessment } from "./play.js";
import { classifyPlayFailure } from "./playApi.js";
import type { PlaySubscriptionsApi } from "./playApi.js";
import { ProviderTimeoutError, ProviderUnavailableError } from "./provider.js";
import type { BillingProvider, CancellationRequest, LiabilityQuery, ProviderSource, PurchaseInspection } from "./provider.js";

/** The server-only binding record for a purchase token (`purchaseBindings/{purchaseRef}`). */
export interface BoundPurchase extends PurchaseExpectation {
  readonly purchaseRef: string;
  readonly purchaseToken: string;
  readonly ownerUid: string;
  readonly familyId: string;
}

/** Reads a binding by its reference (the token hash). Null when absent or malformed. */
export type BindingLookup = (purchaseRef: string) => Promise<BoundPurchase | null>;

export type TokenVerification =
  | { readonly kind: "VERIFIED_ACTIVE"; readonly assessment: SubscriptionAssessment }
  | { readonly kind: "PENDING_PAYMENT"; readonly assessment: SubscriptionAssessment }
  | {
      readonly kind:
        | "WRONG_PRODUCT"
        | "WRONG_ACCOUNT"
        | "UNSUPPORTED_PLAN"
        | "NOT_ENTITLED"
        | "NOT_FOUND"
        | "UNRESOLVED";
    };

export interface TokenVerificationRequest {
  readonly purchaseToken: string;
  readonly productId: string;
  readonly ownerUid: string;
  readonly familyId: string;
}

type Got = { readonly ok: true; readonly a: SubscriptionAssessment } | { readonly ok: false; readonly failure: ReturnType<typeof classifyPlayFailure> };

export class PlayBillingProvider implements BillingProvider {
  readonly source: ProviderSource;

  constructor(
    private readonly api: PlaySubscriptionsApi,
    private readonly config: BillingConfig,
    private readonly lookup: BindingLookup,
    private readonly clock: Clock,
  ) {
    // A disabled API makes this adapter as fail-closed as `unavailableBillingProvider`.
    this.source = api.source === "FAKE_PLAY_API" ? "FAKE_PLAY_API" : "UNAVAILABLE";
  }

  get packageName(): string {
    return this.config.packageName;
  }

  /** The binding must exist, belong to this family and owner, and name a configured package/product. */
  private async binding(purchaseRef: string | null, familyId: string, ownerUid?: string): Promise<BoundPurchase | null> {
    if (purchaseRef === null) return null;
    const b = await this.lookup(purchaseRef);
    if (b === null || b.purchaseRef !== purchaseRef || b.familyId !== familyId) return null;
    if (ownerUid !== undefined && b.ownerUid !== ownerUid) return null;
    if (b.packageName !== this.config.packageName || !this.config.productIds.includes(b.productId)) return null;
    return b;
  }

  private async get(b: BoundPurchase): Promise<Got> {
    try {
      const snapshot = await this.api.get({ packageName: b.packageName, purchaseToken: b.purchaseToken });
      return { ok: true, a: assessSubscription(snapshot, b, this.clock.nowMillis()) };
    } catch (err) {
      return { ok: false, failure: classifyPlayFailure(err) };
    }
  }

  async checkLiability(query: LiabilityQuery): Promise<ProviderLiability> {
    // No bound purchase reference: no Play purchase can exist for this family (S3-D09 trial path).
    // combineLiability still requires the local record to agree before zero liability is verified.
    if (query.purchaseRef === null) return "NONE";
    const b = await this.binding(query.purchaseRef, query.familyId, query.ownerUid);
    if (b === null) return "UNRESOLVED";
    const got = await this.get(b);
    if (!got.ok || !got.a.bindingMatches || got.a.pendingPurchase) return "UNRESOLVED";
    if (got.a.state === "SUBSCRIPTION_STATE_UNSPECIFIED" || got.a.state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
      return "UNRESOLVED";
    }
    // Any real subscription, including one already stopped or expired, goes through the paid saga:
    // the cancellation step then verifies finality (or holds an unsupported plan) from fresh state.
    return "ACTIVE_OBLIGATION";
  }

  async requestCancellation(request: CancellationRequest): Promise<CancellationOutcome> {
    const hold = (holdReason: BillingHoldReason): CancellationOutcome => ({ kind: "PERMANENT_FAILURE", sequence: 0, holdReason });
    if (request.purchaseRef === null) return hold("NO_BOUND_PURCHASE");
    const b = await this.binding(request.purchaseRef, request.familyId);
    if (b === null) return hold("BINDING_MISMATCH");

    const before = await this.get(b);
    if (!before.ok) {
      if (before.failure === "RETRYABLE") throw new ProviderUnavailableError();
      if (before.failure === "NOT_FOUND") return hold("PURCHASE_NOT_FOUND");
      if (before.failure === "REJECTED") return hold("PROVIDER_REJECTED");
      throw new ProviderTimeoutError();
    }
    if (!before.a.bindingMatches) return hold("BINDING_MISMATCH");
    if (before.a.plan !== "AUTO_RENEWING") return hold("UNSUPPORTED_PLAN_TYPE");
    // Already stopped (an earlier attempt, the user, or Play itself): no second cancel request.
    if (before.a.stopRenewalVerified) return { kind: "VERIFIED", sequence: 0 };

    try {
      await this.api.cancel({ packageName: b.packageName, purchaseToken: b.purchaseToken, cancellationType: B1_CANCELLATION_TYPE });
    } catch (err) {
      const failure = classifyPlayFailure(err);
      if (failure === "RETRYABLE") throw new ProviderUnavailableError();
      if (failure === "NOT_FOUND") return hold("PURCHASE_NOT_FOUND");
      if (failure === "REJECTED") return hold("PROVIDER_REJECTED");
      throw new ProviderTimeoutError();
    }

    // Acknowledged. Finality comes only from a fresh authoritative read.
    const after = await this.get(b);
    if (after.ok && after.a.bindingMatches && after.a.stopRenewalVerified) return { kind: "VERIFIED", sequence: 0 };
    return { kind: "PENDING", sequence: 0 };
  }

  async inspectPurchase(query: LiabilityQuery): Promise<PurchaseInspection> {
    const b = await this.binding(query.purchaseRef, query.familyId, query.ownerUid);
    if (b === null) return "UNRESOLVED";
    const got = await this.get(b);
    if (!got.ok) return got.failure === "NOT_FOUND" ? "NOT_FOUND" : "UNRESOLVED";
    const a = got.a;
    if (!a.bindingMatches) return "BINDING_MISMATCH";
    if (a.plan !== "AUTO_RENEWING") return "UNSUPPORTED_PLAN";
    if (a.stopRenewalVerified) return "STOP_VERIFIED";
    if (a.paymentHold) return "PAYMENT_HOLD";
    if (a.renewal === "WILL_RENEW") return "WILL_RENEW";
    return "UNRESOLVED";
  }

  /**
   * Internal purchase verification for binding (B1 task 5). Not a public callable: R-04's
   * `billing.verifyPurchase` contract is not ratified for implementation. Never acknowledges.
   */
  async verifyPurchaseToken(r: TokenVerificationRequest): Promise<TokenVerification> {
    if (!this.config.productIds.includes(r.productId)) return { kind: "WRONG_PRODUCT" };
    const expected: PurchaseExpectation = {
      packageName: this.config.packageName,
      productId: r.productId,
      obfuscatedAccountId: obfuscatedAccountIdFor(r.ownerUid),
      obfuscatedProfileId: obfuscatedProfileIdFor(r.familyId),
    };
    let a: SubscriptionAssessment;
    try {
      const snapshot = await this.api.get({ packageName: this.config.packageName, purchaseToken: r.purchaseToken });
      a = assessSubscription(snapshot, expected, this.clock.nowMillis());
    } catch (err) {
      const failure = classifyPlayFailure(err);
      // Play scopes a token to a package: an unknown token for this package is NOT_FOUND.
      return { kind: failure === "NOT_FOUND" ? "NOT_FOUND" : "UNRESOLVED" };
    }
    if (a.bindingMismatch === "PRODUCT" || a.bindingMismatch === "LINE_ITEMS") return { kind: "WRONG_PRODUCT" };
    if (a.bindingMismatch === "ACCOUNT" || a.bindingMismatch === "PROFILE") return { kind: "WRONG_ACCOUNT" };
    if (a.plan !== "AUTO_RENEWING") return { kind: "UNSUPPORTED_PLAN" };
    if (a.pendingPurchase) return { kind: "PENDING_PAYMENT", assessment: a };
    if (a.state === "SUBSCRIPTION_STATE_ACTIVE" && a.currentEntitlement && a.renewal === "WILL_RENEW") {
      return { kind: "VERIFIED_ACTIVE", assessment: a };
    }
    return { kind: "NOT_ENTITLED" };
  }
}
