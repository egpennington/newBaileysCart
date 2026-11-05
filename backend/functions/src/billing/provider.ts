/**
 * Billing-provider adapter boundary (W-05; Work Package v0.2 §A2.5). Provider calls are always
 * made OUTSIDE Firestore transactions; their results are then applied transactionally.
 *
 * Substage 3A has no real provider. The only implementations are the deterministic fake
 * (billing/fakeProvider.ts, emulator and tests only) and `unavailableBillingProvider`, which every
 * non-emulator runtime uses and which fails closed: liability is never established and no
 * cancellation is ever reported as verified. A fake-provider result is never Google Play evidence.
 */
import type { CancellationOutcome, ProviderLiability } from "../domain/lifecycle.js";

export type ProviderSource = "FAKE_PROVIDER" | "UNAVAILABLE";

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
