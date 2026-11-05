/**
 * Billing-provider adapter boundary (W-05; Work Package v0.2 §A2.5). Provider calls are always
 * made OUTSIDE Firestore transactions; their results are then applied transactionally.
 *
 * Substage 3A has no real provider. Slice 3B Stage B1 adds a Play-semantics adapter
 * (playProvider.ts) that runs only over the deterministic fake Play API; there is still no live
 * adapter, no network path and no credential handling (PL-3B-02).
 * The other implementations are the 3A deterministic fake
 * (billing/fakeProvider.ts, emulator and tests only) and `unavailableBillingProvider`, which every
 * non-emulator runtime uses and which fails closed: liability is never established and no
 * cancellation is ever reported as verified. A fake-provider result is never Google Play evidence.
 */
import type { CancellationOutcome, ProviderLiability } from "../domain/lifecycle.js";

/** FAKE_PLAY_API: the B1 Play-semantics adapter over the deterministic fake Play API. */
export type ProviderSource = "FAKE_PROVIDER" | "FAKE_PLAY_API" | "UNAVAILABLE";

/**
 * Current authoritative state of a bound purchase (B1; `subscriptionsv2.get` semantics). Used by the
 * RTDN processor, which treats a notification only as a hint and always asks the provider.
 */
export type PurchaseInspection =
  /** Renewal provably stopped for a supported plan with no payment hold (PL-3B-01 finality). */
  | "STOP_VERIFIED"
  | "WILL_RENEW"
  | "PAYMENT_HOLD"
  | "NOT_FOUND"
  | "BINDING_MISMATCH"
  | "UNSUPPORTED_PLAN"
  /** Outage, timeout, no binding or anything else: no effect may follow. */
  | "UNRESOLVED";

export interface LiabilityQuery {
  readonly familyId: string;
  readonly ownerUid: string;
  /** Opaque server-held purchase correlation from `familyBilling/{familyId}`; never a raw Play token in 3A. */
  readonly purchaseRef: string | null;
}

export interface CancellationRequest {
  /** Provider-side idempotency key: retries of one case never produce a second effect. */
  readonly caseId: string;
  readonly familyId: string;
  readonly purchaseRef: string | null;
}

export interface BillingProvider {
  readonly source: ProviderSource;
  checkLiability(query: LiabilityQuery): Promise<ProviderLiability>;
  requestCancellation(request: CancellationRequest): Promise<CancellationOutcome>;
  /** Optional (B1). Providers without it are treated as UNRESOLVED. */
  inspectPurchase?(query: LiabilityQuery): Promise<PurchaseInspection>;
}

/** The provider could not be reached; the request had no effect. */
export class ProviderUnavailableError extends Error {
  constructor() {
    super("billing provider unavailable");
    this.name = "ProviderUnavailableError";
  }
}

/** The adapter deadline elapsed; the request may or may not have taken effect. */
export class ProviderTimeoutError extends Error {
  constructor() {
    super("billing provider timeout");
    this.name = "ProviderTimeoutError";
  }
}

/** Fail-closed default outside the emulator: nothing is ever verified. */
export const unavailableBillingProvider: BillingProvider = {
  source: "UNAVAILABLE",
  checkLiability: async () => "UNRESOLVED",
  requestCancellation: async () => {
    throw new ProviderUnavailableError();
  },
};

/** Any failure of a liability check means liability is unresolved (INV-05). */
export async function checkLiabilitySafely(provider: BillingProvider, query: LiabilityQuery): Promise<ProviderLiability> {
  try {
    return await provider.checkLiability(query);
  } catch {
    return "UNRESOLVED";
  }
}

/** Outage is retryable; a timeout or unknown error is ambiguous (the effect may have happened). */
export async function requestCancellationSafely(
  provider: BillingProvider,
  request: CancellationRequest,
): Promise<CancellationOutcome> {
  try {
    return await provider.requestCancellation(request);
  } catch (err) {
    return { kind: err instanceof ProviderUnavailableError ? "RETRYABLE_FAILURE" : "AMBIGUOUS", sequence: 0 };
  }
}

/** Any failure, or a provider that cannot inspect, is UNRESOLVED: no effect may follow. */
export async function inspectPurchaseSafely(provider: BillingProvider, query: LiabilityQuery): Promise<PurchaseInspection> {
  if (provider.inspectPurchase === undefined) return "UNRESOLVED";
  try {
    return await provider.inspectPurchase(query);
  } catch {
    return "UNRESOLVED";
  }
}
