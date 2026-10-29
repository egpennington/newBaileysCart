/**
 * D1 for T-GAP-1: the A1 v0.2 §A1.5 schema copy has not drifted from the ratified document,
 * the documented examples conform, and the conformance check is not vacuous (known-invalid
 * samples are rejected). Live responses are checked in the D2 and D3 suites.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  A1_SESSION_DATA_SCHEMA,
  A1_V02_SHA256,
  jsonBlocksInSection,
  readA1Text,
  sessionDataViolations,
} from "../support/a1Schema.js";

const text = readA1Text();

describe("A1 v0.2 §A1.5 schema drift guard", () => {
  test("the ratified A1 v0.2 document is byte-identical to its ratified SHA-256", () => {
    assert.equal(createHash("sha256").update(text, "utf8").digest("hex"), A1_V02_SHA256);
  });

  test("the test schema equals the normative schema in A1 v0.2 §A1.5", () => {
    const blocks = jsonBlocksInSection(text, "Normative schema");
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], A1_SESSION_DATA_SCHEMA);
  });
});

describe("A1 v0.2 §A1.5 conformance check", () => {
  const examples = jsonBlocksInSection(text, "Examples");

  test("accepts the three documented examples", () => {
    assert.equal(examples.length, 3);
    for (const example of examples) assert.deepEqual(sessionDataViolations(example), []);
  });

  const F1 = "Aa1111111111111111111";
  const F2 = "Bb2222222222222222222";
  const owner = { familyId: F1, role: "OWNER", accessMode: "READ_WRITE", lifecycleState: "ACTIVE", trialEndsAt: "2026-11-18T12:00:00.000Z" };
  const member = { familyId: F2, role: "MEMBER", accessMode: "READ_WRITE" };
  const valid = { ownedFamilyId: F1, joinedFamilies: [owner, member], trialEligible: false, selectedFamilySuggestion: F1 };

  test("accepts the valid base sample", () => assert.deepEqual(sessionDataViolations(valid), []));

  const invalid: Record<string, unknown> = {
    "OWNER lifecycleState null": { ...valid, joinedFamilies: [{ ...owner, lifecycleState: null }, member] },
    "OWNER without lifecycleState": { ...valid, joinedFamilies: [{ familyId: F1, role: "OWNER", accessMode: "NONE" }, member] },
    "both trialEndsAt and reservationExpiresAt": {
      ...valid,
      joinedFamilies: [{ ...owner, reservationExpiresAt: "2026-10-29T12:00:00.000Z" }, member],
    },
    "lifecycleState on a MEMBER entry": { ...valid, joinedFamilies: [owner, { ...member, lifecycleState: "ACTIVE" }] },
    "trialEndsAt on a MEMBER entry": { ...valid, joinedFamilies: [owner, { ...member, trialEndsAt: "2026-11-18T12:00:00.000Z" }] },
    "extra data key": { ...valid, ownerUid: "u" },
    "extra entry key": { ...valid, joinedFamilies: [owner, { ...member, ownerUid: "u" }] },
    "displayName null": { ...valid, joinedFamilies: [owner, { ...member, displayName: null }] },
    "displayName empty": { ...valid, joinedFamilies: [owner, { ...member, displayName: "" }] },
    "displayName over 50 code points": { ...valid, joinedFamilies: [owner, { ...member, displayName: "x".repeat(51) }] },
    "missing always-present key": { ownedFamilyId: F1, joinedFamilies: [owner, member], trialEligible: false },
    "timestamp without milliseconds": { ...valid, joinedFamilies: [{ ...owner, trialEndsAt: "2026-11-18T12:00:00Z" }, member] },
    "unknown accessMode": { ...valid, joinedFamilies: [owner, { ...member, accessMode: "FULL" }] },
    "two OWNER entries": {
      ...valid,
      joinedFamilies: [owner, { ...member, role: "OWNER", lifecycleState: "ACTIVE" }],
    },
    "OWNER entry differs from ownedFamilyId": { ...valid, ownedFamilyId: F2, selectedFamilySuggestion: F2 },
    "OWNER lifecycleState outside Slice 1": { ...valid, joinedFamilies: [{ ...owner, lifecycleState: "CLOSING" }, member] },
    "joinedFamilies out of order": { ...valid, joinedFamilies: [member, owner] },
    "duplicate familyId": { ...valid, joinedFamilies: [owner, { ...member, familyId: F1 }] },
    "selection ignores a usable owned family": { ...valid, selectedFamilySuggestion: F2 },
    "selection suggests an unusable family": {
      ownedFamilyId: F1,
      joinedFamilies: [{ ...owner, accessMode: "NONE" }],
      trialEligible: false,
      selectedFamilySuggestion: F1,
    },
  };
  for (const [name, sample] of Object.entries(invalid)) {
    test(`rejects: ${name}`, () => assert.notDeepEqual(sessionDataViolations(sample), []));
  }
});
