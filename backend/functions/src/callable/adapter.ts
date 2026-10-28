/**
 * Callable adapter (W-01 decision D-2, Option A): domain rejections become native HttpsError
 * with the full API v0.4 rejection envelope as `details`. Unexpected failures are logged
 * server-side and returned as a sanitized INTERNAL rejection.
 */
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { rejectionEnvelope } from "../contract/envelope.js";
import { DomainError, ERROR_SPECS } from "../contract/errors.js";
import type { DomainErrorCode } from "../contract/errors.js";
import { echoableOpId } from "../contract/validate.js";
import type { Actor } from "../commands/familiesCreate.js";

/** The subset of CallableRequest the adapter reads; keeps the adapter testable without the runtime. */
export interface CallableInput {
  readonly auth?: { readonly uid?: unknown; readonly token?: Readonly<Record<string, unknown>> } | undefined;
  readonly data: unknown;
}

export type Handler<T> = (actor: Actor, data: unknown) => Promise<T>;

export function toHttpsError(code: DomainErrorCode, opId: string | null, details?: DomainError["details"]): HttpsError {
  const spec = ERROR_SPECS[code];
  return new HttpsError(spec.canonical, spec.message, rejectionEnvelope(opId, code, details));
}

/**
 * Fail closed: the emulator accepts forged and malformed tokens (W-01 D-5), and production
 * code must not assume a non-null auth context carries a usable uid.
 */
export function authenticate(input: CallableInput): Actor {
  const uid = input.auth?.uid;
  if (typeof uid !== "string" || uid.trim() === "") {
    throw new DomainError("UNAUTHENTICATED");
  }
  // Verified-email state comes only from the authenticated token, never from the request body.
  return { uid, emailVerified: input.auth?.token?.["email_verified"] === true };
}

export async function runCallable<T>(command: string, input: CallableInput, handler: Handler<T>): Promise<T> {
  const opId = echoableOpId(input.data);
  try {
    return await handler(authenticate(input), input.data);
  } catch (err) {
    if (err instanceof DomainError) throw toHttpsError(err.code, opId, err.details);
    logger.error("Unhandled callable failure", { command, error: err instanceof Error ? err.stack : String(err) });
    throw toHttpsError("INTERNAL", opId);
  }
}
