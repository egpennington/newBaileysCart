/**
 * API v0.4 §3 envelopes. On the callable wire the success envelope is the `result`
 * payload, and the rejection envelope travels as `HttpsError.details` (W-01 D-1, D-2).
 */
import { ERROR_SPECS } from "./errors.js";
import type { DomainErrorCode } from "./errors.js";

export const API_VERSION = "v0.4";

export interface SuccessEnvelope<T> {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string | null;
  readonly status: "COMMITTED";
  readonly serverTime: string;
  readonly data: T;
}

export interface RejectionEnvelope {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string | null;
  readonly status: "REJECTED";
  readonly error: {
    readonly code: DomainErrorCode;
    readonly retryable: boolean;
    readonly details: Readonly<Record<string, string | number | boolean>>;
  };
}

export function successEnvelope<T>(opId: string | null, serverTime: string, data: T): SuccessEnvelope<T> {
  return { apiVersion: API_VERSION, opId, status: "COMMITTED", serverTime, data };
}

export function rejectionEnvelope(
  opId: string | null,
  code: DomainErrorCode,
  details: Readonly<Record<string, string | number | boolean>> = {},
): RejectionEnvelope {
  return {
    apiVersion: API_VERSION,
    opId,
    status: "REJECTED",
    error: { code, retryable: ERROR_SPECS[code].retryable, details },
  };
}
