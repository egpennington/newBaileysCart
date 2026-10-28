/**
 * DISPOSABLE NEGATIVE CONTROL — branch feature/wp03-s1-gate-negative ONLY. NEVER MERGE.
 * FORGE gate-integrity check (PL authorization "WP-03 Slice 1 CI Gate Integrity Repair"):
 * this deliberate failure must make `npm run test:emulator` exit nonzero, fail the
 * backend-emulator job through the `tee` pipeline, and fail the FORGE gate.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("FORGE-GATE-NEGATIVE-CONTROL: deliberate failure", () => {
  assert.fail("FORGE-GATE-NEGATIVE-CONTROL: deliberate failure (disposable branch; must turn the gate red)");
});
