/**
 * D1: T-GAP-2 (traceability row 4.4). families.create asks the SDK for at most 10 transaction
 * attempts, and when the SDK gives up with ABORTED the callable returns a sanitized, retryable
 * INTERNAL and logs the cause server-side (T-GAP-9). The SDK retry loop itself, and real
 * contention, are platform behavior that this fake does not model (A1 §A1.7).
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import { runCallable } from "../../src/callable/adapter.js";
import type { FailureLog } from "../../src/callable/adapter.js";
import { familiesCreateHandler } from "../../src/commands/familiesCreate.js";
import { FakeFirestore } from "../support/fakeFirestore.js";

const OP = "3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b";
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0, 0);

/** The shape the Firestore SDK rejects with once commit retries are exhausted (gRPC code 10). */
function abortedError(): Error {
  return Object.assign(new Error("10 ABORTED: Too much contention on these documents. Please try again."), { code: 10 });
}

describe("T-GAP-2: transaction contention exhaustion", () => {
  test("families.create requests maxAttempts 10; exhaustion becomes retryable INTERNAL and is logged", async () => {
    const fake = new FakeFirestore({ commitError: abortedError() });
    const logged: Array<Parameters<FailureLog>> = [];
    const handler = familiesCreateHandler({ db: fake.asFirestore, clock: { nowMillis: () => NOW } });

    const err = await runCallable(
      "families.create",
      { auth: { uid: "u1", token: { email_verified: true } }, data: { apiVersion: "v0.4", opId: OP, payload: { displayName: "Home" } } },
      handler,
      (message, record) => logged.push([message, record]),
    ).then(
      () => assert.fail("expected INTERNAL"),
      (e: unknown) => e,
    );

    assert.deepEqual(fake.transactionOptions, [{ maxAttempts: 10 }]);
    // The callback ran to its writes; the failure came from the commit, as with real contention.
    assert.ok(fake.transactionWrites.length > 0);

    assert.ok(err instanceof HttpsError);
    assert.equal(err.code, "internal");
    assert.equal(err.message, "Internal error.");
    assert.deepEqual(err.details, {
      apiVersion: "v0.4",
      opId: OP,
      status: "REJECTED",
      error: { code: "INTERNAL", retryable: true, details: {} },
    });
    const wire = JSON.stringify(err.toJSON());
    for (const leak of ["ABORTED", "contention", "families/", "u1"]) assert.ok(!wire.includes(leak), `client sees ${leak}: ${wire}`);

    assert.equal(logged.length, 1);
    const [message, record] = logged[0] ?? assert.fail("no log");
    assert.equal(message, "Unhandled callable failure");
    assert.equal(record.command, "families.create");
    assert.match(record.error ?? "", /ABORTED/);
  });
});
