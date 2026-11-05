/**
 * Deterministic, scriptable fake billing provider (Substage 3A only). It exists so D1/D2/D3 tests can
 * drive success, outage, timeout, permanent failure, duplicate and reordered completion. Its results
 * prove domain behavior only; they are never Google Play cancellation or financial verification.
 *
 * Without a script, answers follow the purchase reference so emulator (D3) runs stay deterministic:
 *   purchaseRef null            -> liability NONE
 *   "fake-paid-..."             -> ACTIVE_OBLIGATION; cancellation VERIFIED
 *   anything else               -> UNRESOLVED
 */
import type { CancellationOutcome, CancellationOutcomeKind, ProviderLiability } from "../domain/lifecycle.js";
import { ProviderTimeoutError, ProviderUnavailableError } from "./provider.js";
import type { BillingProvider, CancellationRequest, LiabilityQuery } from "./provider.js";

/** One scripted answer. OUTAGE throws with no effect; TIMEOUT throws after the effect may have happened. */
export type FakeLiabilityStep = ProviderLiability | "OUTAGE" | "TIMEOUT";
export type FakeCancellationStep = CancellationOutcomeKind | "OUTAGE" | "TIMEOUT";

export const FAKE_PAID_PREFIX = "fake-paid-";

export interface FakeCall {
  readonly op: "checkLiability" | "requestCancellation";
  readonly key: string;
  readonly answer: string;
}

export class FakeBillingProvider implements BillingProvider {
  readonly source = "FAKE_PROVIDER" as const;
  readonly calls: FakeCall[] = [];
  /** Provider-side cancellation effects per case; idempotent by caseId, so at most 1 each. */
  readonly effects = new Map<string, number>();
  private readonly liabilityScripts = new Map<string, FakeLiabilityStep[]>();
  private readonly cancellationScripts = new Map<string, FakeCancellationStep[]>();
  private sequence = 0;

  /** Script the next liability answers for a family; the last step repeats once the list is used up. */
  scriptLiability(familyId: string, ...steps: FakeLiabilityStep[]): this {
    this.liabilityScripts.set(familyId, steps);
    return this;
  }

  /** Script the next cancellation answers for a family; the last step repeats. */
  scriptCancellation(familyId: string, ...steps: FakeCancellationStep[]): this {
    this.cancellationScripts.set(familyId, steps);
    return this;
  }

  /** A provider completion event with a fresh, increasing sequence (for duplicate/reorder tests). */
  event(kind: CancellationOutcomeKind): CancellationOutcome {
    return { kind, sequence: ++this.sequence };
  }

  private static next<T>(script: T[] | undefined): T | undefined {
    if (script === undefined || script.length === 0) return undefined;
    return script.length === 1 ? script[0] : script.shift();
  }

  async checkLiability(query: LiabilityQuery): Promise<ProviderLiability> {
    const step: FakeLiabilityStep =
      FakeBillingProvider.next(this.liabilityScripts.get(query.familyId)) ??
      (query.purchaseRef === null ? "NONE" : query.purchaseRef.startsWith(FAKE_PAID_PREFIX) ? "ACTIVE_OBLIGATION" : "UNRESOLVED");
    this.calls.push({ op: "checkLiability", key: query.familyId, answer: step });
    if (step === "OUTAGE") throw new ProviderUnavailableError();
    if (step === "TIMEOUT") throw new ProviderTimeoutError();
    return step;
  }

  async requestCancellation(request: CancellationRequest): Promise<CancellationOutcome> {
    const step: FakeCancellationStep =
      FakeBillingProvider.next(this.cancellationScripts.get(request.familyId)) ??
      (request.purchaseRef?.startsWith(FAKE_PAID_PREFIX) ? "VERIFIED" : "PERMANENT_FAILURE");
    this.calls.push({ op: "requestCancellation", key: request.caseId, answer: step });
    if (step === "OUTAGE") throw new ProviderUnavailableError();
    // Idempotent by caseId: a retry after a timeout never cancels twice.
    if (step !== "RETRYABLE_FAILURE" && step !== "PERMANENT_FAILURE") this.effects.set(request.caseId, 1);
    if (step === "TIMEOUT") throw new ProviderTimeoutError();
    return { kind: step, sequence: 0 };
  }
}
