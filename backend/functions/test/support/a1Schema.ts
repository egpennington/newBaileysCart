/**
 * API Amendment A1 v0.2 §A1.5 conformance for account.getSession `data` (T-GAP-1).
 * The schema below is copied verbatim from the ratified A1 v0.2 document; a D1 drift guard
 * (test/unit/a1Schema.test.ts) checks the document hash and that this copy still matches it.
 * The cross-entry rules that JSON Schema cannot express are checked from A1 §A1.5 prose.
 * No emulator dependency: safe to import from D1, D2 and D3 tests.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

/** Repository path of the ratified A1 v0.2 document and its ratified SHA-256. */
export const A1_V02_PATH = fileURLToPath(
  new URL("../../../../../docs/specs/R-04/API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.2.md", import.meta.url),
);
export const A1_V02_SHA256 = "616bd0eb75b191aa6dc9b7157bf07557ad9067c6025870d2b874a794b3e30572";

export const A1_SESSION_DATA_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:baileyscart:api:v0.4:a1:account.getSession:data",
  type: "object",
  additionalProperties: false,
  required: ["ownedFamilyId", "joinedFamilies", "trialEligible", "selectedFamilySuggestion"],
  properties: {
    ownedFamilyId: { type: ["string", "null"], minLength: 1 },
    trialEligible: { type: "boolean" },
    selectedFamilySuggestion: { type: ["string", "null"], minLength: 1 },
    joinedFamilies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["familyId", "role", "accessMode"],
        properties: {
          familyId: { type: "string", minLength: 1 },
          role: { enum: ["OWNER", "MEMBER"] },
          accessMode: { enum: ["READ_WRITE", "READ_ONLY", "NONE"] },
          displayName: { type: "string", minLength: 1 },
          lifecycleState: { type: "string", minLength: 1 },
          trialEndsAt: { $ref: "#/$defs/rfc3339utc" },
          reservationExpiresAt: { $ref: "#/$defs/rfc3339utc" },
        },
        allOf: [
          {
            if: { properties: { role: { const: "MEMBER" } } },
            then: {
              not: {
                anyOf: [{ required: ["lifecycleState"] }, { required: ["trialEndsAt"] }, { required: ["reservationExpiresAt"] }],
              },
            },
          },
          {
            if: { properties: { role: { const: "OWNER" } } },
            then: { required: ["lifecycleState"] },
          },
          { not: { required: ["trialEndsAt", "reservationExpiresAt"] } },
        ],
      },
    },
  },
  $defs: {
    rfc3339utc: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" },
  },
} as const;

/** A1 §A1.5: Slice 1 lifecycle values for OWNER entries; PL-5 display-name limit. */
const SLICE1_LIFECYCLE_STATES = ["ACTIVE", "UNENTITLED_AWAITING_PAYMENT"];
const DISPLAY_NAME_MAX_CODE_POINTS = 50;

// Validator options only; the ratified schema is not changed:
// - allowUnionTypes: the schema uses `"type": ["string", "null"]`.
// - strictRequired off: the schema forbids owner-only keys on MEMBER entries with `not: {anyOf: [{required}]}`,
//   valid 2020-12 that Ajv's strictRequired lint rejects because those keys are declared one level up.
const validateSchema = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true }).compile(
  A1_SESSION_DATA_SCHEMA,
);

interface Entry {
  familyId: string;
  role: string;
  accessMode: string;
  displayName?: string;
  lifecycleState?: string;
}

/** Every A1 §A1.5 violation in `data`: schema errors first, then cross-entry prose rules. */
export function sessionDataViolations(data: unknown): string[] {
  if (!validateSchema(data)) {
    return (validateSchema.errors ?? []).map((e) => `schema: ${e.instancePath || "/"} ${e.message ?? ""} ${JSON.stringify(e.params)}`);
  }
  const d = data as { ownedFamilyId: string | null; joinedFamilies: Entry[]; selectedFamilySuggestion: string | null };
  const violations: string[] = [];
  const owners = d.joinedFamilies.filter((f) => f.role === "OWNER");
  if (owners.length > 1) violations.push(`more than one OWNER entry (${owners.length})`);
  for (const f of owners) {
    if (f.familyId !== d.ownedFamilyId) violations.push(`OWNER entry ${f.familyId} differs from ownedFamilyId ${String(d.ownedFamilyId)}`);
    if (!SLICE1_LIFECYCLE_STATES.includes(f.lifecycleState ?? "")) violations.push(`OWNER lifecycleState ${String(f.lifecycleState)}`);
  }
  // Plain string comparison is UTF-16 code-unit order, as A1 §A1.5 requires.
  for (let i = 1; i < d.joinedFamilies.length; i++) {
    const prev = d.joinedFamilies[i - 1]?.familyId ?? "";
    const cur = d.joinedFamilies[i]?.familyId ?? "";
    if (!(prev < cur)) violations.push(`joinedFamilies not strictly ascending: ${prev} before ${cur}`);
  }
  for (const f of d.joinedFamilies) {
    if (f.displayName !== undefined && [...f.displayName].length > DISPLAY_NAME_MAX_CODE_POINTS) {
      violations.push(`displayName over ${DISPLAY_NAME_MAX_CODE_POINTS} code points on ${f.familyId}`);
    }
  }
  const usable = d.joinedFamilies.filter((f) => f.accessMode !== "NONE");
  const expected = usable.find((f) => f.familyId === d.ownedFamilyId)?.familyId ?? usable[0]?.familyId ?? null;
  if (d.selectedFamilySuggestion !== expected) {
    violations.push(`selectedFamilySuggestion ${String(d.selectedFamilySuggestion)}, rule gives ${String(expected)}`);
  }
  return violations;
}

export function assertSessionDataConformsToA1(data: unknown): void {
  const violations = sessionDataViolations(data);
  assert.deepEqual(violations, [], `account.getSession data violates A1 v0.2 §A1.5:\n${violations.join("\n")}\n${JSON.stringify(data)}`);
}

/**
 * The ratified A1 v0.2 text, LF-normalized. The ratified file and its committed blob are LF-only;
 * normalizing keeps the hash check valid on a Windows checkout that converts to CRLF.
 */
export function readA1Text(): string {
  return readFileSync(A1_V02_PATH, "utf8").replace(/\r\n/g, "\n");
}

/** JSON code blocks of one A1 section, from its `### <heading>` up to the next heading of level 2 or 3. */
export function jsonBlocksInSection(text: string, heading: string): unknown[] {
  const start = text.indexOf(`\n### ${heading}`);
  assert.ok(start >= 0, `A1 section not found: ${heading}`);
  const rest = text.slice(start + 1);
  const next = rest.slice(4).search(/\n#{2,3} /);
  const section = next < 0 ? rest : rest.slice(0, next + 4);
  return [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] ?? "") as unknown);
}
