import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import { authenticate, runCallable } from "../../src/callable/adapter.js";
import { ERROR_SPECS } from "../../src/contract/errors.js";
import type { DomainErrorCode } from "../../src/contract/errors.js";
import { DomainError } from "../../src/contract/errors.js";
import type { Actor } from "../../src/commands/familiesCreate.js";

const OP = "3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b";
const verified = { uid: "u1", token: { email_verified: true } };

async function rejection(input: Parameters<typeof runCallable>[1], handler: (a: Actor) => Promise<unknown>) {
  try {
    await runCallable("test", input, handler);
  } catch (err) {
    assert.ok(err instanceof HttpsError, `expected HttpsError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected rejection");
}

describe("authenticate (fail closed, W-01 D-5)", () => {
  const cases: Record<string, Parameters<typeof authenticate>[0]> = {
    "no auth": { data: {} },
    "auth without uid (garbage bearer shape)": { auth: { token: { uid: undefined } }, data: {} },
    "empty uid": { auth: { uid: "", token: {} }, data: {} },
    "whitespace uid": { auth: { uid: "   ", token: {} }, data: {} },
    "numeric uid": { auth: { uid: 123, token: {} }, data: {} },
  };
  for (const [name, input] of Object.entries(cases)) {
    test(`${name} -> UNAUTHENTICATED`, () =>
      assert.throws(() => authenticate(input), (e: unknown) => e instanceof DomainError && e.code === "UNAUTHENTICATED"));
  }
  test("email_verified must be exactly true", () => {
    assert.equal(authenticate({ auth: verified, data: {} }).emailVerified, true);
    for (const v of [false, "true", 1, undefined]) {
      assert.equal(authenticate({ auth: { uid: "u1", token: { email_verified: v } }, data: {} }).emailVerified, false);
    }
    assert.equal(authenticate({ auth: { uid: "u1" }, data: {} }).emailVerified, false);
  });
  test("body fields cannot set identity or verification", async () => {
    let seen: Actor | undefined;
    await runCallable(
      "test",
      { auth: { uid: "u1", token: { email_verified: false } }, data: { uid: "attacker", email_verified: true } },
      async (a) => {
        seen = a;
      },
    );
    assert.deepEqual(seen, { uid: "u1", emailVerified: false });
  });
});

describe("rejection mapping (W-01 D-2, Option A)", () => {
  test("handler not invoked when unauthenticated", async () => {
    let called = false;
    const err = await rejection({ data: { opId: OP } }, async () => {
      called = true;
    });
    assert.equal(called, false);
    assert.equal(err.code, "unauthenticated");
    assert.deepEqual(err.details, {
      apiVersion: "v0.4",
      opId: OP,
      status: "REJECTED",
      error: { code: "UNAUTHENTICATED", retryable: false, details: {} },
    });
  });

  const codes = Object.keys(ERROR_SPECS) as DomainErrorCode[];
  for (const code of codes) {
    test(`${code} -> ${ERROR_SPECS[code].canonical}, retryable=${ERROR_SPECS[code].retryable}`, async () => {
      const err = await rejection({ auth: verified, data: { opId: OP } }, async () => {
        throw new DomainError(code, { field: "x" });
      });
      assert.equal(err.code, ERROR_SPECS[code].canonical);
      assert.equal(err.message, ERROR_SPECS[code].message);
      assert.deepEqual(err.details, {
        apiVersion: "v0.4",
        opId: OP,
        status: "REJECTED",
        error: { code, retryable: ERROR_SPECS[code].retryable, details: { field: "x" } },
      });
    });
  }

  test("retryable is not universally false", () => {
    const values = new Set(Object.values(ERROR_SPECS).map((s) => s.retryable));
    assert.deepEqual([...values].sort(), [false, true]);
  });

  test("invalid opId is never echoed", async () => {
    const err = await rejection({ auth: verified, data: { opId: "<img onerror>" } }, async () => {
      throw new DomainError("VALIDATION_FAILED");
    });
    assert.equal((err.details as { opId: unknown }).opId, null);
  });

  test("unexpected exception is sanitized to INTERNAL", async () => {
    const err = await rejection({ auth: verified, data: { opId: OP } }, async () => {
      throw new Error("db password=hunter2 at /srv/secret");
    });
    assert.equal(err.code, "internal");
    assert.equal(err.message, "Internal error.");
    const serialized = JSON.stringify(err.toJSON());
    assert.ok(!serialized.includes("hunter2"), serialized);
    assert.deepEqual(err.details, {
      apiVersion: "v0.4",
      opId: OP,
      status: "REJECTED",
      error: { code: "INTERNAL", retryable: true, details: {} },
    });
  });

  test("success passes the handler result through unchanged", async () => {
    const result = await runCallable("test", { auth: verified, data: {} }, async () => ({ ok: 1 }));
    assert.deepEqual(result, { ok: 1 });
  });
});
