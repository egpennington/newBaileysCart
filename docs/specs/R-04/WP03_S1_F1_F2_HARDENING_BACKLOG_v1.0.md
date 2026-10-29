# WP-03 Slice 1 — F-1/F-2 Hardening Backlog v1.0

**Status:** BACKLOG. Requirements only, **not implemented**. Prepared by CODI on 2026-10-28 for CipherMuse and PL review. Uncommitted.
**Source:** API Amendment A1 v0.2 §A1.8, ratified for Slice 1 with F-1 and F-2 accepted as limitations (`API_AMENDMENT_A1_v0.2_RATIFICATION_RECORD_v1.0.md`).
**Code under consideration:** `backend/functions/src/commands/accountGetSession.ts` @ `8d2bfa0` (unchanged since `d7beae8`).

## Release dependency (applies to every item)

**Hardening MUST be merged, with D1/D2 tests, negative controls and a green FORGE run, before any additional family-record writer is merged.**

An additional writer is any path other than Slice 1 `families.create` that creates or updates `families/{id}` or its membership edges. Examples: `families.close`, `families.restore`, `families.waiveRecovery`, rename, `invites.accept` (member edges), migrations and admin tools.

**WP-03 Slice 2 introduces such writers.** Hardening is therefore a merge prerequisite for Slice 2.

## HB-1 — F-1: malformed stored `lifecycleState`

| Aspect | Specification |
|---|---|
| **Trigger** | A `families/{id}` document read by `account.getSession` for an entry where the caller is the owner (member edge `OWNER` **and** `ownerUid` equals the caller) has `lifecycleState` that is missing, `null`, non-string, empty, or not a lifecycle value the API recognizes. |
| **Current behavior** (source-inspected, not tested) | `accountGetSession.ts:80` writes `lifecycleState: family.get("lifecycleState") as string` without validation. A missing field becomes `undefined`, which the callable serializer sends as `null` (W-01 evidence D-7). Other bad values pass through. Access is safe: `accessModeFor` (`family.ts:22`) returns `"NONE"` for anything other than `"ACTIVE"`, so the entry is never usable and is never suggested. |
| **Expected behavior after hardening** | **(1)** The response always conforms to the A1 §A1.5 schema; no `null` or invalid `lifecycleState` is ever emitted. **(2)** Access stays fail-closed. **(3)** A server-side integrity event is logged with `familyId` (no user data), so the corruption is visible operationally. **(4)** The precise output needs a CipherMuse decision, because each option has a contract consequence. |
| **Output options** | **(a)** Omit the integrity-invalid entry from `joinedFamilies`, but keep reporting `ownedFamilyId`. This needs a one-line A1 clarification, because §A1.5 currently implies that an OWNER entry exists for `ownedFamilyId`. **(b)** Fail the whole `getSession` call with `INTERNAL` (retryable, indeterminate). No contract change, but one corrupt family blocks the user's session. **(c)** Emit a reserved sentinel such as `"UNKNOWN"`. This needs a contract change to the value set. **CODI recommends (a):** the least disruptive option, and it never exposes an invalid value. |
| **Required tests** | **D1:** extract the entry-mapping logic into a pure function and test it with every trigger value (missing, `null`, `""`, `42`, `"active"`, `"CLOSING"`); assert schema conformance and the chosen output. **D2 (emulator):** seed malformed family documents through the Admin SDK for an owner and assert the `getSession` output and `accessMode`. **Schema conformance:** validate every `getSession` response produced in the D2 and D3 suites against the A1 §A1.5 JSON Schema (this closes traceability gap T-GAP-1). |
| **Negative controls** | Remove the `lifecycleState` validation guard and confirm the D1/D2 malformed-data tests fail. Remove the schema-conformance assertion's input and confirm it is detected. Record both like NC-1..NC-9. |
| **Verity** | PL-PP-WP03-14 (session isolation and response integrity; still partial). Proposed new ProofPoint "getSession response integrity under malformed storage". Its ID is to be assigned by GAI from the master registry; CODI does not invent canonical IDs. |

## HB-2 — F-2: malformed stored `displayName`

| Aspect | Specification |
|---|---|
| **Trigger** | A stored family's `displayName` is `null`, non-string, empty after trimming, over 50 code points, or contains PL-5-forbidden characters (Cc, Cf, Zl, Zp, Cs, Hangul fillers). This applies to both OWNER and MEMBER entries. |
| **Current behavior** (source-inspected, not tested) | `accountGetSession.ts:70,77` read `displayName` and include it whenever it is not `undefined`. `null` is emitted as `"displayName": null`; other invalid values pass through unchanged. Access is unaffected. |
| **Expected behavior after hardening** | `displayName` is emitted **only** when it passes the same PL-5 validator used on input (`validateDisplayName` in `validate.ts:51`), applied to the stored value. Otherwise the key is **omitted** (the family is treated as unnamed) and an integrity event is logged. This needs **no contract change**, because §A1.5 already makes `displayName` conditional and forbids `null`. |
| **Required tests** | **D1:** the pure mapping function with each trigger value, asserting the key is absent and the output conforms to the schema. **D2:** seeded malformed documents for both OWNER and MEMBER entries. Schema conformance as in HB-1. |
| **Negative controls** | Remove the stored-value validation and confirm the D1/D2 tests fail. |
| **Verity** | PL-PP-WP03-14, plus the proposed response-integrity ProofPoint (HB-1). |

## HB-3 (proposed, not ratified) — F-3: storage-dependent cross-entry invariants

Found during the A1 traceability review. Presented for decision; it is **not** part of the PL's F-1/F-2 acceptance.

| Aspect | Specification |
|---|---|
| **Contract statements** | A1 §A1.5: "a response contains at most one OWNER entry"; "for an OWNER entry, `ownedFamilyId` equals its `familyId`"; "`trialEndsAt` and `reservationExpiresAt` are never both present". |
| **Current behavior** | `getSession` derives `ownedFamilyId` from `users/{uid}` (line 88) and OWNER entries from member edges plus `ownerUid` (line 65) independently. It emits `trialEndsAt` and `reservationExpiresAt` whenever each is stored (lines 81–82). These invariants hold for every Slice 1 write, because `families.create` writes all of these records in one transaction. Nothing re-checks them on read. |
| **Trigger** | Malformed or inconsistent storage: two families with `ownerUid` equal to the caller, an owner claim with no matching OWNER edge, or both timestamps stored. |
| **Expected behavior after hardening** | Enforce on read. Emit at most one OWNER entry, the one whose `familyId` equals `ownedFamilyId`; treat any other `ownerUid` match as `MEMBER`, without owner-only fields; emit only the timestamp matching `lifecycleState`; log integrity events. |
| **Tests / negative controls / Verity** | As HB-1: D1 and D2 with seeded inconsistent data, schema plus cross-entry assertions, guard-removal negative controls. PL-PP-WP03-14 plus the proposed response-integrity ProofPoint. |
| **Decision needed** | CipherMuse/PL: accept as a Slice 1 limitation alongside F-1/F-2, or add it to the same pre-writer hardening dependency (CODI recommendation). |

## Delivery notes
- **Scope:** all items are read-path hardening in `accountGetSession.ts`, plus a pure mapping helper. There are no write-path or schema-migration changes.
- **Dependencies:** a schema-conformance test needs a JSON Schema validator as a **dev** dependency. `ajv` is already present transitively. Adding it directly would require a version-record entry and the existing osv and npm-audit gates.
- **Order:** HB-2 (no contract change) → HB-1 after the CipherMuse output decision → HB-3 after the acceptance decision.
