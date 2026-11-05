/**
 * The Google Play Developer API surface B1 depends on, as an interface only (PL-3B-02):
 *   get    ~ purchases.subscriptionsv2.get    (authoritative subscription state)
 *   cancel ~ purchases.subscriptionsv2.cancel (request; acknowledgement is not finality)
 *
 * Stage B1 ships no network-capable implementation and no credential handling. The only
 * implementations are the deterministic fake (fakePlayApi.ts, emulator and tests) and
 * `disabledPlayApi`, a non-operational stub that fails closed on every call.
 */
import type { PlayCancellationType, PlaySubscriptionSnapshot } from "./play.js";

export type PlayApiSource = "FAKE_PLAY_API" | "DISABLED";

export interface PlayGetRequest {
  readonly packageName: string;
  readonly purchaseToken: string;
}

export interface PlayCancelRequest extends PlayGetRequest {
  readonly cancellationType: PlayCancellationType;
}

export interface PlaySubscriptionsApi {
  readonly source: PlayApiSource;
  get(request: PlayGetRequest): Promise<PlaySubscriptionSnapshot>;
  /** Resolves when Play accepted the request. It does not mean renewal has stopped. */
  cancel(request: PlayCancelRequest): Promise<void>;
}

/** An HTTP-level answer from the API (429, 5xx, 4xx). */
export class PlayApiHttpError extends Error {
  constructor(readonly httpStatus: number) {
    super(`play api http ${httpStatus}`);
    this.name = "PlayApiHttpError";
  }
}

/** The deadline elapsed; the request may or may not have taken effect. */
export class PlayApiTimeoutError extends Error {
  constructor() {
    super("play api timeout");
    this.name = "PlayApiTimeoutError";
  }
}

/** Stage B1 forbids live provider use: there is no live adapter to construct. */
export class LiveProviderDisabledError extends Error {
  constructor() {
    super("live billing provider is disabled in Stage B1");
    this.name = "LiveProviderDisabledError";
  }
}

export type PlayFailure = "RETRYABLE" | "AMBIGUOUS" | "NOT_FOUND" | "REJECTED";

/** 429 and 5xx retry; 404/410 mean no such purchase; other 4xx are permanent; anything else is ambiguous. */
export function classifyPlayFailure(err: unknown): PlayFailure {
  if (err instanceof PlayApiHttpError) {
    if (err.httpStatus === 429 || err.httpStatus >= 500) return "RETRYABLE";
    if (err.httpStatus === 404 || err.httpStatus === 410) return "NOT_FOUND";
    return "REJECTED";
  }
  if (err instanceof LiveProviderDisabledError) return "REJECTED";
  return "AMBIGUOUS";
}

/** Fail-closed stub: no network, no credentials, nothing is ever verified. */
export const disabledPlayApi: PlaySubscriptionsApi = {
  source: "DISABLED",
  get: async () => {
    throw new LiveProviderDisabledError();
  },
  cancel: async () => {
    throw new LiveProviderDisabledError();
  },
};

/**
 * The only constructor a later stage could wire for Google Play. In B1 it refuses every input,
 * including credentials, so a live adapter cannot be built by configuration alone.
 */
export function createLivePlayApi(_config?: unknown): never {
  throw new LiveProviderDisabledError();
}
