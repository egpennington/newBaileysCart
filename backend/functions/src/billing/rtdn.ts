/**
 * Strict parser for synthetic Pub/Sub push envelopes carrying Google Play Real-Time Developer
 * Notifications (Slice 3B Stage B1, handoff task 4). Pure: no transport, no OIDC verification
 * (deferred to B2) and no receiver endpoint. A notification is a hint that something changed,
 * never payment proof: the processor (workers/rtdnWorker.ts) always asks the provider.
 *
 * Fail closed: anything outside the expected shape, size or package is rejected with a reason code.
 * Rejections never echo payload content, tokens or message IDs.
 */
import { createHash } from "node:crypto";

/** Upper bounds. Real RTDN payloads are a few hundred bytes. */
export const MAX_ENVELOPE_DATA_CHARS = 8_192;
export const MAX_DECODED_DATA_BYTES = 4_096;
export const MAX_PURCHASE_TOKEN_CHARS = 512;
export const MAX_MESSAGE_ID_CHARS = 128;

export type RtdnRejection =
  | "ENVELOPE_NOT_OBJECT"
  | "ENVELOPE_UNKNOWN_FIELD"
  | "MESSAGE_MISSING"
  | "MESSAGE_UNKNOWN_FIELD"
  | "MESSAGE_ID_INVALID"
  | "MESSAGE_ID_CONFLICT"
  | "DATA_MISSING"
  | "DATA_TOO_LARGE"
  | "DATA_NOT_BASE64"
  | "DATA_NOT_JSON"
  | "NOTIFICATION_UNKNOWN_FIELD"
  | "VERSION_UNSUPPORTED"
  | "PACKAGE_MISMATCH"
  | "EVENT_TIME_INVALID"
  | "NOTIFICATION_KIND_INVALID"
  | "SUBSCRIPTION_NOTIFICATION_INVALID"
  | "PURCHASE_TOKEN_INVALID";

export type RtdnKind = "SUBSCRIPTION" | "TEST" | "ONE_TIME_PRODUCT" | "VOIDED_PURCHASE";

export interface ParsedRtdn {
  /** SHA-256 of the Pub/Sub messageId: the deduplication key. */
  readonly deliveryRef: string;
  readonly kind: RtdnKind;
  readonly eventTimeMillis: number;
  /** Present for SUBSCRIPTION only. Informational: processing never depends on it. */
  readonly notificationType: number | null;
  /** Present for SUBSCRIPTION only. Handle it as a secret: never log or persist it outside the binding. */
  readonly purchaseToken: string | null;
}

export type RtdnParse = { readonly ok: true; readonly rtdn: ParsedRtdn } | { readonly ok: false; readonly reason: RtdnRejection };

const ENVELOPE_KEYS = new Set(["message", "subscription", "deliveryAttempt"]);
// Pub/Sub push sends both spellings of these fields.
const MESSAGE_KEYS = new Set(["data", "messageId", "message_id", "publishTime", "publish_time", "attributes", "orderingKey"]);
const NOTIFICATION_KEYS = new Set([
  "version",
  "packageName",
  "eventTimeMillis",
  "subscriptionNotification",
  "oneTimeProductNotification",
  "voidedPurchaseNotification",
  "testNotification",
]);
const SUBSCRIPTION_KEYS = new Set(["version", "notificationType", "purchaseToken", "subscriptionId"]);
const KIND_FIELDS: ReadonlyArray<readonly [string, RtdnKind]> = [
  ["subscriptionNotification", "SUBSCRIPTION"],
  ["testNotification", "TEST"],
  ["oneTimeProductNotification", "ONE_TIME_PRODUCT"],
  ["voidedPurchaseNotification", "VOIDED_PURCHASE"],
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, allowed: ReadonlySet<string>): boolean => Object.keys(o).every((k) => allowed.has(k));
const MESSAGE_ID = /^[0-9A-Za-z._-]+$/;
const TOKEN = /^[0-9A-Za-z._-]+$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function deliveryRefFor(messageId: string): string {
  return createHash("sha256").update(`rtdn:${messageId}`, "utf8").digest("hex");
}

const fail = (reason: RtdnRejection): RtdnParse => ({ ok: false, reason });

export function parseRtdnEnvelope(envelope: unknown, expectedPackageName: string): RtdnParse {
  if (!isRecord(envelope)) return fail("ENVELOPE_NOT_OBJECT");
  if (!onlyKeys(envelope, ENVELOPE_KEYS)) return fail("ENVELOPE_UNKNOWN_FIELD");
  const message = envelope["message"];
  if (!isRecord(message)) return fail("MESSAGE_MISSING");
  if (!onlyKeys(message, MESSAGE_KEYS)) return fail("MESSAGE_UNKNOWN_FIELD");

  const id = message["messageId"] ?? message["message_id"];
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_MESSAGE_ID_CHARS || !MESSAGE_ID.test(id)) {
    return fail("MESSAGE_ID_INVALID");
  }
  if (message["messageId"] !== undefined && message["message_id"] !== undefined && message["messageId"] !== message["message_id"]) {
    return fail("MESSAGE_ID_CONFLICT");
  }

  const data = message["data"];
  if (typeof data !== "string" || data.length === 0) return fail("DATA_MISSING");
  if (data.length > MAX_ENVELOPE_DATA_CHARS) return fail("DATA_TOO_LARGE");
  if (data.length % 4 !== 0 || !BASE64.test(data)) return fail("DATA_NOT_BASE64");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_DECODED_DATA_BYTES) return fail("DATA_TOO_LARGE");

  let n: unknown;
  try {
    n = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("DATA_NOT_JSON");
  }
  if (!isRecord(n)) return fail("DATA_NOT_JSON");
  if (!onlyKeys(n, NOTIFICATION_KEYS)) return fail("NOTIFICATION_UNKNOWN_FIELD");
  if (n["version"] !== "1.0") return fail("VERSION_UNSUPPORTED");
  if (n["packageName"] !== expectedPackageName) return fail("PACKAGE_MISMATCH");

  const t = n["eventTimeMillis"];
  if (typeof t !== "string" || !/^[0-9]{1,15}$/.test(t)) return fail("EVENT_TIME_INVALID");
  const eventTimeMillis = Number(t);
  if (!Number.isSafeInteger(eventTimeMillis) || eventTimeMillis <= 0) return fail("EVENT_TIME_INVALID");

  const present = KIND_FIELDS.filter(([field]) => n[field] !== undefined);
  if (present.length !== 1) return fail("NOTIFICATION_KIND_INVALID");
  const [field, kind] = present[0] as readonly [string, RtdnKind];
  const body = n[field];
  if (!isRecord(body)) return fail("NOTIFICATION_KIND_INVALID");

  const deliveryRef = deliveryRefFor(id);
  if (kind !== "SUBSCRIPTION") return { ok: true, rtdn: { deliveryRef, kind, eventTimeMillis, notificationType: null, purchaseToken: null } };

  if (!onlyKeys(body, SUBSCRIPTION_KEYS) || body["version"] !== "1.0") return fail("SUBSCRIPTION_NOTIFICATION_INVALID");
  const type = body["notificationType"];
  if (typeof type !== "number" || !Number.isSafeInteger(type) || type < 1 || type > 99) return fail("SUBSCRIPTION_NOTIFICATION_INVALID");
  if (body["subscriptionId"] !== undefined && typeof body["subscriptionId"] !== "string") return fail("SUBSCRIPTION_NOTIFICATION_INVALID");
  const token = body["purchaseToken"];
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_PURCHASE_TOKEN_CHARS || !TOKEN.test(token)) {
    return fail("PURCHASE_TOKEN_INVALID");
  }
  return { ok: true, rtdn: { deliveryRef, kind, eventTimeMillis, notificationType: type, purchaseToken: token } };
}

/** Build a synthetic envelope (tests and emulator fixtures only). */
export function syntheticRtdnEnvelope(o: {
  messageId: string;
  packageName: string;
  eventTimeMillis: number;
  notification: Record<string, unknown>;
}): Record<string, unknown> {
  const data = Buffer.from(
    JSON.stringify({ version: "1.0", packageName: o.packageName, eventTimeMillis: String(o.eventTimeMillis), ...o.notification }),
    "utf8",
  ).toString("base64");
  return {
    message: { data, messageId: o.messageId, message_id: o.messageId, publishTime: new Date(o.eventTimeMillis).toISOString() },
    subscription: "projects/demo-newbaileyscart/subscriptions/synthetic-rtdn",
  };
}
