/**
 * Idempotency identity (API v0.4 §5): records bind (actorUid, opId, command, canonical request).
 * The document key is derived from (actorUid, opId) so the same opId used for a different
 * command or payload is detected as IDEMPOTENCY_KEY_REUSED rather than overwriting.
 */
import { createHash } from "node:crypto";

/** PL-8: at least 30 days after commit, plus a 7-day safety margin. */
export const IDEMPOTENCY_RETENTION_MS = 37 * 86_400_000;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** JSON with object keys sorted at every level, so key order does not change the hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function idempotencyKey(actorUid: string, opId: string): string {
  return sha256Hex(`${actorUid}:${opId}`);
}

export function requestHash(command: string, rawRequest: unknown): string {
  return sha256Hex(`${command}\n${canonicalJson(rawRequest)}`);
}
