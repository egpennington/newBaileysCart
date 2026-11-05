/**
 * Deterministic, scriptable fake of the Play subscriptions API (Slice 3B Stage B1; emulator and
 * tests only). It holds synthetic subscriptions in memory, keyed by package and token, and models:
 *   - cancel acknowledgement separate from finality: `settleAfterGets` delays the visible state
 *     change, so a cancel can be accepted while `get` still shows renewal on;
 *   - stop-renewal keeps current entitlement until expiry (cancellation is not expiration or refund);
 *   - scripted faults per token and operation: 429, 5xx, 403, 404/410 and timeouts (before or after
 *     the effect);
 *   - idempotent cancel: repeated requests for one token have one provider effect.
 * Its answers prove domain behavior only. They are never Google Play evidence.
 */
import { obfuscatedAccountIdFor, obfuscatedProfileIdFor } from "./play.js";
import type { PlayLineItem, PlaySubscriptionSnapshot, PlaySubscriptionState } from "./play.js";
import { PlayApiHttpError, PlayApiTimeoutError } from "./playApi.js";
import type { PlayCancelRequest, PlayGetRequest, PlaySubscriptionsApi } from "./playApi.js";

/** A scripted step: OK proceeds normally; a number is an HTTP status; TIMEOUT_* are deadline faults. */
export type FakePlayStep = "OK" | number | "TIMEOUT_BEFORE_EFFECT" | "TIMEOUT_AFTER_EFFECT";

export interface FakeSubscriptionSeed {
  readonly packageName: string;
  readonly purchaseToken: string;
  readonly productId: string;
  readonly ownerUid: string;
  readonly familyId: string;
  readonly state?: PlaySubscriptionState;
  readonly expiryMillis: number;
  readonly autoRenewEnabled?: boolean;
  /** Plan shape override for unsupported-plan tests. */
  readonly plan?: "AUTO_RENEWING" | "INSTALLMENT" | "PREPAID";
  readonly acknowledged?: boolean;
  /** Override the identifiers the client set at purchase (cross-account tests). */
  readonly obfuscatedAccountId?: string;
  readonly obfuscatedProfileId?: string;
  /** After an accepted cancel, this many further `get` calls still show the old state. */
  readonly settleAfterGets?: number;
}

interface FakeSub {
  seed: FakeSubscriptionSeed;
  state: PlaySubscriptionState;
  autoRenewEnabled: boolean;
  cancelEffects: number;
  pendingSettleGets: number | null;
}

export interface FakePlayCall {
  readonly op: "get" | "cancel";
  /** Token reference only: the fake never records raw tokens in its call log. */
  readonly tokenSuffix: string;
  readonly step: string;
}

const key = (packageName: string, token: string) => `${packageName}\u0000${token}`;

export class FakePlayApi implements PlaySubscriptionsApi {
  readonly source = "FAKE_PLAY_API" as const;
  readonly calls: FakePlayCall[] = [];
  private readonly subs = new Map<string, FakeSub>();
  private readonly scripts = new Map<string, FakePlayStep[]>();

  seed(seed: FakeSubscriptionSeed): this {
    this.subs.set(key(seed.packageName, seed.purchaseToken), {
      seed,
      state: seed.state ?? "SUBSCRIPTION_STATE_ACTIVE",
      autoRenewEnabled: seed.autoRenewEnabled ?? true,
      cancelEffects: 0,
      pendingSettleGets: null,
    });
    return this;
  }

  /** Script the next answers for one operation on one token; the last step repeats. */
  script(op: "get" | "cancel", purchaseToken: string, ...steps: FakePlayStep[]): this {
    this.scripts.set(`${op}:${purchaseToken}`, steps);
    return this;
  }

  /** Change the subscription out of band (user action, renewal, expiry, account hold). */
  mutate(packageName: string, purchaseToken: string, change: { state?: PlaySubscriptionState; autoRenewEnabled?: boolean }): void {
    const sub = this.subs.get(key(packageName, purchaseToken));
    if (sub === undefined) throw new Error("no such fake subscription");
    if (change.state !== undefined) sub.state = change.state;
    if (change.autoRenewEnabled !== undefined) sub.autoRenewEnabled = change.autoRenewEnabled;
  }

  cancelEffects(packageName: string, purchaseToken: string): number {
    return this.subs.get(key(packageName, purchaseToken))?.cancelEffects ?? 0;
  }

  private step(op: "get" | "cancel", token: string): FakePlayStep {
    const list = this.scripts.get(`${op}:${token}`);
    if (list === undefined || list.length === 0) return "OK";
    const s = list.length === 1 ? list[0] : list.shift();
    return s ?? "OK";
  }

  private record(op: "get" | "cancel", token: string, step: FakePlayStep): void {
    this.calls.push({ op, tokenSuffix: token.slice(-4), step: String(step) });
  }

  private snapshot(sub: FakeSub): PlaySubscriptionSnapshot {
    const { seed } = sub;
    const plan = seed.plan ?? "AUTO_RENEWING";
    const item: PlayLineItem = {
      productId: seed.productId,
      expiryTime: new Date(seed.expiryMillis).toISOString(),
      ...(plan === "PREPAID"
        ? { prepaidPlan: {} }
        : {
            autoRenewingPlan: {
              autoRenewEnabled: sub.autoRenewEnabled,
              ...(plan === "INSTALLMENT" ? { installmentDetails: { initialCommittedPaymentsCount: 12 } } : {}),
            },
          }),
    };
    return {
      subscriptionState: sub.state,
      acknowledgementState: seed.acknowledged === true ? "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" : "ACKNOWLEDGEMENT_STATE_PENDING",
      lineItems: [item],
      externalAccountIdentifiers: {
        obfuscatedExternalAccountId: seed.obfuscatedAccountId ?? obfuscatedAccountIdFor(seed.ownerUid),
        obfuscatedExternalProfileId: seed.obfuscatedProfileId ?? obfuscatedProfileIdFor(seed.familyId),
      },
      ...(sub.state === "SUBSCRIPTION_STATE_CANCELED" ? { canceledStateContext: { developerInitiatedCancellation: {} } } : {}),
      testPurchase: {},
    };
  }

  async get(request: PlayGetRequest): Promise<PlaySubscriptionSnapshot> {
    const step = this.step("get", request.purchaseToken);
    this.record("get", request.purchaseToken, step);
    if (typeof step === "number") throw new PlayApiHttpError(step);
    if (step !== "OK") throw new PlayApiTimeoutError();
    const sub = this.subs.get(key(request.packageName, request.purchaseToken));
    // Play scopes tokens to a package: an unknown token, or one from another package, is 404.
    if (sub === undefined) throw new PlayApiHttpError(404);
    if (sub.pendingSettleGets !== null) {
      if (sub.pendingSettleGets > 0) {
        sub.pendingSettleGets -= 1;
        return { ...this.snapshot(sub), subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: this.renewingItems(sub) };
      }
      sub.pendingSettleGets = null;
    }
    return this.snapshot(sub);
  }

  private renewingItems(sub: FakeSub): PlayLineItem[] {
    return this.snapshot({ ...sub, autoRenewEnabled: true }).lineItems.map((i) => ({ ...i }));
  }

  async cancel(request: PlayCancelRequest): Promise<void> {
    const step = this.step("cancel", request.purchaseToken);
    this.record("cancel", request.purchaseToken, step);
    if (typeof step === "number") throw new PlayApiHttpError(step);
    if (step === "TIMEOUT_BEFORE_EFFECT") throw new PlayApiTimeoutError();
    const sub = this.subs.get(key(request.packageName, request.purchaseToken));
    if (sub === undefined) throw new PlayApiHttpError(404);
    if (request.cancellationType !== "USER_REQUESTED_STOP_RENEWALS") throw new PlayApiHttpError(400);
    // Idempotent: a subscription whose renewal is already off gets no second effect.
    if (sub.autoRenewEnabled) {
      sub.autoRenewEnabled = false;
      sub.cancelEffects += 1;
      if (sub.state === "SUBSCRIPTION_STATE_ACTIVE") sub.state = "SUBSCRIPTION_STATE_CANCELED";
      if (sub.seed.settleAfterGets !== undefined && sub.seed.settleAfterGets > 0) sub.pendingSettleGets = sub.seed.settleAfterGets;
    }
    if (step === "TIMEOUT_AFTER_EFFECT") throw new PlayApiTimeoutError();
  }
}
