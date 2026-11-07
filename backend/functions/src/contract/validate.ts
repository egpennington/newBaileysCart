/**
 * Request validation for Slice 1 commands. Requests are strict: unknown keys are
 * rejected, so no body field can stand in for server-derived values (uid, epoch, state).
 */
import { API_VERSION } from "./envelope.js";
import { DomainError } from "./errors.js";

// Lowercase canonical form only, so one operation cannot have two idempotency keys.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const DISPLAY_NAME_MAX_CODE_POINTS = 50;

// PL-5: control characters (includes \t \n \r), format characters (includes ZWSP, ZWJ,
// bidi controls, BOM), line/paragraph separators, lone surrogates, and Hangul fillers
// that render as blank.
const FORBIDDEN_IN_DISPLAY_NAME = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}ᅟᅠㅤﾠ]/u;

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

/** The opId to echo in a response: only a valid caller-supplied value, never arbitrary input. */
export function echoableOpId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const opId = (data as Record<string, unknown>)["opId"];
  return isUuidV4(opId) ? opId : null;
}

function invalid(field: string, reason: string): DomainError {
  return new DomainError("VALIDATION_FAILED", { field, reason });
}

function asPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(field, "NOT_AN_OBJECT");
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw invalid(prefix ? `${prefix}.${key}` : key, "UNKNOWN_FIELD");
  }
}

function checkApiVersion(obj: Record<string, unknown>): void {
  const v = obj["apiVersion"];
  if (v === undefined) throw invalid("apiVersion", "MISSING");
  if (typeof v !== "string") throw invalid("apiVersion", "NOT_A_STRING");
  if (v !== API_VERSION) throw new DomainError("API_VERSION_UNSUPPORTED", { supported: API_VERSION });
}

export type DisplayNameCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: "NOT_A_STRING" | "FORBIDDEN_CHARACTER" | "EMPTY" | "TOO_LONG" };

/** PL-5, shared by request validation and by the stored-value check in account.getSession (HB-2). */
export function checkDisplayName(value: unknown): DisplayNameCheck {
  if (typeof value !== "string") return { ok: false, reason: "NOT_A_STRING" };
  if (FORBIDDEN_IN_DISPLAY_NAME.test(value)) return { ok: false, reason: "FORBIDDEN_CHARACTER" };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: "EMPTY" };
  if ([...trimmed].length > DISPLAY_NAME_MAX_CODE_POINTS) return { ok: false, reason: "TOO_LONG" };
  return { ok: true, value: trimmed };
}

export function validateDisplayName(value: unknown): string {
  const checked = checkDisplayName(value);
  if (!checked.ok) throw invalid("payload.displayName", checked.reason);
  return checked.value;
}

export interface CreateFamilyRequest {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string;
  readonly payload: { readonly displayName?: string };
}

/** Raw request kept alongside the parsed one: the idempotency hash covers what the caller sent. */
export interface Parsed<T> {
  readonly request: T;
  readonly raw: Record<string, unknown>;
}

export function parseCreateFamilyRequest(data: unknown): Parsed<CreateFamilyRequest> {
  const obj = asPlainObject(data, "request");
  checkApiVersion(obj);
  rejectUnknownKeys(obj, ["apiVersion", "opId", "payload"], "");
  if (!isUuidV4(obj["opId"])) throw invalid("opId", obj["opId"] === undefined ? "MISSING" : "NOT_A_UUID_V4");
  const payload = asPlainObject(obj["payload"], "payload");
  rejectUnknownKeys(payload, ["displayName"], "payload");
  const request: CreateFamilyRequest =
    "displayName" in payload
      ? { apiVersion: API_VERSION, opId: obj["opId"], payload: { displayName: validateDisplayName(payload["displayName"]) } }
      : { apiVersion: API_VERSION, opId: obj["opId"], payload: {} };
  return { request, raw: obj };
}

export interface GetSessionRequest {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string | null;
}

export function parseGetSessionRequest(data: unknown): GetSessionRequest {
  const obj = asPlainObject(data, "request");
  checkApiVersion(obj);
  rejectUnknownKeys(obj, ["apiVersion", "opId"], "");
  // Reads need no opId (API §3); one that is supplied must still be well-formed.
  if (obj["opId"] !== undefined && !isUuidV4(obj["opId"])) throw invalid("opId", "NOT_A_UUID_V4");
  return { apiVersion: API_VERSION, opId: (obj["opId"] as string | undefined) ?? null };
}

// --- WP-03 Slice 3 lifecycle requests (A2 candidate §A2.1-§A2.4). Flat fields as A2 lists them;
// strict like Slice 1, so no body field can stand in for a server-derived value. ---

/** Firestore auto-IDs are 20 alphanumerics; anything with "/" could address another document. */
const FAMILY_ID = /^[A-Za-z0-9]{1,128}$/;
/** 32 random bytes, base64url without padding (persistence/confirmationTokens.ts). */
const CONFIRMATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function checkFamilyId(obj: Record<string, unknown>): string {
  const v = obj["familyId"];
  if (v === undefined) throw invalid("familyId", "MISSING");
  if (typeof v !== "string" || !FAMILY_ID.test(v)) throw invalid("familyId", "MALFORMED");
  return v;
}

function checkFamilyEpoch(obj: Record<string, unknown>): number {
  const v = obj["familyEpoch"];
  if (v === undefined) throw invalid("familyEpoch", "MISSING");
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw invalid("familyEpoch", "NOT_A_POSITIVE_INTEGER");
  return v;
}

function checkOpId(obj: Record<string, unknown>): string {
  const v = obj["opId"];
  if (!isUuidV4(v)) throw invalid("opId", v === undefined ? "MISSING" : "NOT_A_UUID_V4");
  return v;
}

function checkConfirmationToken(obj: Record<string, unknown>): string {
  const v = obj["confirmationToken"];
  if (v === undefined) throw invalid("confirmationToken", "MISSING");
  if (typeof v !== "string" || !CONFIRMATION_TOKEN.test(v)) throw invalid("confirmationToken", "MALFORMED");
  return v;
}

export interface FamilyMutationRequest {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string;
  readonly familyId: string;
  readonly familyEpoch: number;
}

export interface ConfirmedFamilyMutationRequest extends FamilyMutationRequest {
  readonly confirmationToken: string;
}

/** families.close and families.waiveRecovery: `{apiVersion, opId, familyId, familyEpoch, confirmationToken}`. */
export function parseConfirmedFamilyMutation(data: unknown): Parsed<ConfirmedFamilyMutationRequest> {
  const obj = asPlainObject(data, "request");
  checkApiVersion(obj);
  rejectUnknownKeys(obj, ["apiVersion", "opId", "familyId", "familyEpoch", "confirmationToken"], "");
  const request: ConfirmedFamilyMutationRequest = {
    apiVersion: API_VERSION,
    opId: checkOpId(obj),
    familyId: checkFamilyId(obj),
    familyEpoch: checkFamilyEpoch(obj),
    confirmationToken: checkConfirmationToken(obj),
  };
  return { request, raw: obj };
}

/** families.restore: `{apiVersion, opId, familyId, familyEpoch}`. */
export function parseFamilyMutation(data: unknown): Parsed<FamilyMutationRequest> {
  const obj = asPlainObject(data, "request");
  checkApiVersion(obj);
  rejectUnknownKeys(obj, ["apiVersion", "opId", "familyId", "familyEpoch"], "");
  const request: FamilyMutationRequest = {
    apiVersion: API_VERSION,
    opId: checkOpId(obj),
    familyId: checkFamilyId(obj),
    familyEpoch: checkFamilyEpoch(obj),
  };
  return { request, raw: obj };
}

export interface ClosureStatusRequest {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string | null;
  readonly familyId: string;
}

/** families.getClosureStatus: `{apiVersion, familyId}`; a read, so `opId` is optional (API §3). */
export function parseClosureStatusRequest(data: unknown): ClosureStatusRequest {
  const obj = asPlainObject(data, "request");
  checkApiVersion(obj);
  rejectUnknownKeys(obj, ["apiVersion", "opId", "familyId"], "");
  if (obj["opId"] !== undefined && !isUuidV4(obj["opId"])) throw invalid("opId", "NOT_A_UUID_V4");
  return { apiVersion: API_VERSION, opId: (obj["opId"] as string | undefined) ?? null, familyId: checkFamilyId(obj) };
}

// --- A2-D4 families.prepareLifecycleConfirmation: `{apiVersion, opId, familyId, action}`. No
// familyEpoch: the token binds to the server epoch read at issuance. ---

export interface PrepareConfirmationRequest {
  readonly apiVersion: typeof API_VERSION;
  readonly opId: string;
  readonly familyId: string;
  readonly action: "CLOSE" | "WAIVE_RECOVERY";
}

export function parsePrepareConfirmationRequest(data: unknown): Parsed<PrepareConfirmationRequest> {
  const obj = asPlainObject(data, "request");
  checkApiVersion(obj);
  rejectUnknownKeys(obj, ["apiVersion", "opId", "familyId", "action"], "");
  const opId = checkOpId(obj);
  const familyId = checkFamilyId(obj);
  const action = obj["action"];
  if (action === undefined) throw invalid("action", "MISSING");
  if (action !== "CLOSE" && action !== "WAIVE_RECOVERY") throw invalid("action", "NOT_ALLOWED");
  return { request: { apiVersion: API_VERSION, opId, familyId, action }, raw: obj };
}
