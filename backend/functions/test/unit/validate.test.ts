import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { DomainError } from "../../src/contract/errors.js";
import {
  echoableOpId,
  isUuidV4,
  parseCreateFamilyRequest,
  parseGetSessionRequest,
  validateDisplayName,
} from "../../src/contract/validate.js";

const OP = "3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b";

function rejects(fn: () => unknown, code: string, details?: Record<string, unknown>): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DomainError, `expected DomainError, got ${String(err)}`);
    assert.equal(err.code, code);
    if (details) assert.deepEqual(err.details, details);
    return true;
  });
}

describe("opId (UUID v4)", () => {
  test("accepts lowercase canonical v4", () => assert.equal(isUuidV4(OP), true));
  for (const bad of [
    OP.toUpperCase(),
    "3f1c2a9e-8b7d-1e6f-9a1b-2c3d4e5f6a7b", // version 1
    "3f1c2a9e-8b7d-4e6f-7a1b-2c3d4e5f6a7b", // bad variant
    "3f1c2a9e8b7d4e6f9a1b2c3d4e5f6a7b",
    "",
    42,
    null,
  ]) {
    test(`rejects ${JSON.stringify(bad)}`, () => assert.equal(isUuidV4(bad), false));
  }
  test("echoes only a valid opId", () => {
    assert.equal(echoableOpId({ opId: OP }), OP);
    assert.equal(echoableOpId({ opId: "<script>" }), null);
    assert.equal(echoableOpId("not an object"), null);
    assert.equal(echoableOpId(null), null);
  });
});

describe("families.create request", () => {
  const ok = { apiVersion: "v0.4", opId: OP, payload: {} };
  test("minimal request parses", () => {
    assert.deepEqual(parseCreateFamilyRequest(ok).request, { apiVersion: "v0.4", opId: OP, payload: {} });
  });
  test("raw request is retained for hashing", () => {
    const raw = { apiVersion: "v0.4", opId: OP, payload: { displayName: "  Smiths " } };
    assert.equal(parseCreateFamilyRequest(raw).raw, raw);
    assert.equal(parseCreateFamilyRequest(raw).request.payload.displayName, "Smiths");
  });
  test("non-object request", () => rejects(() => parseCreateFamilyRequest("x"), "VALIDATION_FAILED"));
  test("array request", () => rejects(() => parseCreateFamilyRequest([]), "VALIDATION_FAILED"));
  test("missing apiVersion", () =>
    rejects(() => parseCreateFamilyRequest({ opId: OP, payload: {} }), "VALIDATION_FAILED", {
      field: "apiVersion",
      reason: "MISSING",
    }));
  test("unsupported apiVersion", () =>
    rejects(() => parseCreateFamilyRequest({ ...ok, apiVersion: "v0.3" }), "API_VERSION_UNSUPPORTED", {
      supported: "v0.4",
    }));
  test("missing opId", () =>
    rejects(() => parseCreateFamilyRequest({ apiVersion: "v0.4", payload: {} }), "VALIDATION_FAILED", {
      field: "opId",
      reason: "MISSING",
    }));
  test("malformed opId", () =>
    rejects(() => parseCreateFamilyRequest({ ...ok, opId: "abc" }), "VALIDATION_FAILED", {
      field: "opId",
      reason: "NOT_A_UUID_V4",
    }));
  test("missing payload", () =>
    rejects(() => parseCreateFamilyRequest({ apiVersion: "v0.4", opId: OP }), "VALIDATION_FAILED"));
  // Server-derived values cannot be supplied by the caller.
  for (const field of ["uid", "ownerUid", "familyId", "familyEpoch", "lifecycleState"]) {
    test(`top-level ${field} rejected`, () =>
      rejects(() => parseCreateFamilyRequest({ ...ok, [field]: "x" }), "VALIDATION_FAILED", {
        field,
        reason: "UNKNOWN_FIELD",
      }));
  }
  for (const field of ["ownerUid", "trialEndsAt", "email_verified"]) {
    test(`payload.${field} rejected`, () =>
      rejects(() => parseCreateFamilyRequest({ ...ok, payload: { [field]: true } }), "VALIDATION_FAILED", {
        field: `payload.${field}`,
        reason: "UNKNOWN_FIELD",
      }));
  }
});

describe("displayName (PL-5)", () => {
  const reason = (value: unknown) => {
    try {
      validateDisplayName(value);
      return "OK";
    } catch (err) {
      return (err as DomainError).details["reason"];
    }
  };
  test("trims leading and trailing spaces", () => assert.equal(validateDisplayName("  The Smiths  "), "The Smiths"));
  test("trims Unicode space separators", () => assert.equal(validateDisplayName("　Kim "), "Kim"));
  test("preserves internal spacing and spelling", () => assert.equal(validateDisplayName("Café  Crew"), "Café  Crew"));
  test("50 code points accepted", () => assert.equal(reason("a".repeat(50)), "OK"));
  test("51 code points rejected", () => assert.equal(reason("a".repeat(51)), "TOO_LONG"));
  test("counts code points, not UTF-16 units: 50 astral chars accepted", () => assert.equal(reason("😀".repeat(50)), "OK"));
  test("51 astral chars rejected", () => assert.equal(reason("😀".repeat(51)), "TOO_LONG"));
  test("length checked after trim", () => assert.equal(reason(` ${"a".repeat(50)} `), "OK"));
  test("combining marks count as code points, no normalization", () => {
    assert.equal(validateDisplayName("Café"), "Café");
    assert.equal(reason("é".repeat(25)), "OK");
    assert.equal(reason(`${"é".repeat(25)}x`), "TOO_LONG");
  });
  test("empty rejected", () => assert.equal(reason(""), "EMPTY"));
  test("whitespace-only rejected", () => assert.equal(reason("   "), "EMPTY"));
  test("non-string rejected", () => {
    assert.equal(reason(null), "NOT_A_STRING");
    assert.equal(reason(5), "NOT_A_STRING");
  });
  const forbidden: Record<string, string> = {
    "line feed": "A\nB",
    "carriage return": "A\rB",
    "trailing line feed": "AB\n",
    tab: "A\tB",
    NUL: "A\u0000B",
    DEL: "A\u007FB",
    "C1 control": "A\u0085B",
    "line separator": "A B",
    "paragraph separator": "A B",
    "zero-width space": "A​B",
    "zero-width joiner": "A‍B",
    "right-to-left override": "A‮B",
    BOM: "﻿AB",
    "soft hyphen": "A­B",
    "Hangul filler": "AㅤB",
    "lone surrogate": "A\uD800B",
  };
  for (const [name, value] of Object.entries(forbidden)) {
    test(`${name} rejected`, () => assert.equal(reason(value), "FORBIDDEN_CHARACTER"));
  }
});

describe("account.getSession request", () => {
  test("apiVersion only", () => assert.deepEqual(parseGetSessionRequest({ apiVersion: "v0.4" }), { apiVersion: "v0.4", opId: null }));
  test("valid opId preserved", () =>
    assert.deepEqual(parseGetSessionRequest({ apiVersion: "v0.4", opId: OP }), { apiVersion: "v0.4", opId: OP }));
  test("malformed opId rejected", () =>
    rejects(() => parseGetSessionRequest({ apiVersion: "v0.4", opId: "x" }), "VALIDATION_FAILED"));
  test("unknown field rejected", () =>
    rejects(() => parseGetSessionRequest({ apiVersion: "v0.4", uid: "other" }), "VALIDATION_FAILED"));
  test("unsupported version", () => rejects(() => parseGetSessionRequest({ apiVersion: "v9" }), "API_VERSION_UNSUPPORTED"));
});

describe("non-string apiVersion is VALIDATION_FAILED, never API_VERSION_UNSUPPORTED (A1 §A1.2; T-GAP-3)", () => {
  const nonStrings: Record<string, unknown> = { number: 4, null: null, boolean: true, array: ["v0.4"], object: {} };
  const details = { field: "apiVersion", reason: "NOT_A_STRING" };
  for (const [name, apiVersion] of Object.entries(nonStrings)) {
    test(`families.create: ${name}`, () =>
      rejects(() => parseCreateFamilyRequest({ apiVersion, opId: OP, payload: {} }), "VALIDATION_FAILED", details));
    test(`account.getSession: ${name}`, () => rejects(() => parseGetSessionRequest({ apiVersion }), "VALIDATION_FAILED", details));
  }
});
