# WP-03 Slice 1 — Hardening Backlog v1.1 (HB-1, HB-2, HB-3)

**Status:** BACKLOG. Requirements only, **not implemented**. HB-1 and HB-2 carry over unchanged from v1.0. **HB-3 is PL-APPROVED and mandatory.**
**Prepared by:** CODI · **Date:** 2026-10-29
**Supersedes:** `WP03_S1_F1_F2_HARDENING_BACKLOG_v1.0.md`, kept unmodified as history. Where they differ, v1.1 controls.
**Source:**
- API Amendment A1 v0.2 §A1.8 (F-1, F-2)
- `CODI_WP03_S1_A1_CONTRACT_TRACEABILITY_REPORT_v1.0.md` row 5.10 (F-3)
- `API_AMENDMENT_A1_v0.2_RATIFICATION_RECORD_v1.1.md` §3–§4
**Code under consideration:** `backend/functions/src/commands/accountGetSession.ts` @ `8d2bfa0` (unchanged since `d7beae8`).

## Changes from v1.0

| # | Change |
|---|---|
| 1 | HB-3 promoted from "proposed, not ratified" to **PL-APPROVED, mandatory before any additional family-record writer**, with the PL's four required properties. |
| 2 | F-3 recorded as an accepted limitation **only for the current Slice 1 sole-writer scope**. |
| 3 | The release dependency now names HB-1, HB-2 and HB-3. |
| 4 | The HB-3 expected-behavior text from v1.0, which reported other `ownerUid` matches as `MEMBER`, is **withdrawn as a chosen design**. It is retained below only as one candidate option. The fail-closed output is an open decision. |
| 5 | HB-1 and HB-2 requirements are unchanged; their text below is copied verbatim from v1.0. |

## Release dependency (applies to every item)

**HB-1, HB-2 and HB-3 MUST be merged, with D1/D2 tests, negative controls and a green FORGE run, before any additional family-record writer is merged.**

An additional writer is any path other than Slice 1 `families.create` that creates or updates `families/{id}` or its membership edges. Examples: `families.close`, `families.restore`, `families.waiveRecovery`, rename, `invites.accept` (member edges), migrations and admin tools.

**WP-03 Slice 2 introduces such writers.** Hardening is therefore a merge prerequisite for Slice 2.

Test fixtures that seed malformed or inconsistent documents through the Admin SDK in the emulator are **not** writers in this sense.

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


## HB-3 — F-3: storage-dependent cross-entry invariants (PL-APPROVED, mandatory)

**Acceptance boundary:** F-3 is accepted as a limitation **only** while Slice 1 `families.create` is the sole writer of family records and membership edges. It writes all of these records in one transaction. The acceptance ends when any additional writer is introduced, and HB-3 must be in place first.

| Aspect | Specification |
|---|---|
| **Contract statements** | A1 §A1.5: "a response contains at most one OWNER entry"; "for an OWNER entry, `ownedFamilyId` equals its `familyId`"; "`trialEndsAt` and `reservationExpiresAt` are never both present". |
| **Current behavior** (source-inspected, not tested) | `getSession` derives `ownedFamilyId` from `users/{uid}` (line 88) and OWNER entries from member edges plus `ownerUid` (line 65) independently. It emits `trialEndsAt` and `reservationExpiresAt` whenever each is stored (lines 81–82). These invariants hold for every Slice 1 write, because `families.create` writes all of these records in one transaction. Nothing re-checks them on read. |
| **Trigger** | Malformed or inconsistent storage. Examples: two families whose `ownerUid` and OWNER edges name the caller; an `ownedFamilyId` claim with no matching OWNER membership, or an OWNER membership with no matching claim; both lifecycle timestamps stored, or the timestamp that does not match `lifecycleState`. |
| **Required properties (PL decision)** | **(1)** At most one OWNER membership per UID is ever reported. **(2)** `ownedFamilyId` and the owner membership are consistent with each other. **(3)** Lifecycle timestamps are exclusive: at most one of `trialEndsAt` / `reservationExpiresAt`, consistent with `lifecycleState`. **(4)** Fail closed for inconsistent stored records: no access, owner-only field or selection suggestion may arise from an inconsistent record. Integrity events are logged server-side (identifiers only, no user data). |
| **Output: OPEN DECISION** | The exact output is **not chosen** in this backlog. It requires a CipherMuse/PL decision before implementation, together with HB-1's output decision. Candidate options include: **(a)** omit the inconsistent entries, which may need an A1 clarification because §A1.5 implies that an OWNER entry exists for `ownedFamilyId`; **(b)** emit the entry with `accessMode: "NONE"` and no owner-only fields; **(c)** fail the call with `INTERNAL`. v1.0's draft rule (report other `ownerUid` matches as `MEMBER`) remains a candidate only if it can be shown to satisfy property (4). A `MEMBER` entry's `accessMode` could otherwise be `READ_WRITE`. |
| **Required tests** | **D1:** a pure mapping function with seeded inconsistent inputs, for every property (1)–(4). **D2 (emulator):** inconsistent documents seeded through the Admin SDK; assert the chosen output, the A1 §A1.5 schema, the cross-entry rules and `accessMode`. |
| **Negative controls** | Remove each guard and confirm the D1/D2 tests fail. Record them like NC-1..NC-9. |
| **Verity** | PL-PP-WP03-14 (session isolation and response integrity; partial). Plus the proposed "getSession response integrity under malformed storage" ProofPoint; its ID is to be assigned by GAI from the master registry. CODI does not invent canonical IDs. |

## Delivery notes
- **Scope:** all items are read-path hardening in `accountGetSession.ts`, plus a pure mapping helper. There are no write-path or schema-migration changes.
- **Dependencies:** schema-conformance assertions use `ajv`. PL decision D-1 approved it as an exact-pinned direct devDependency for the Phase B test work; it is **not yet added**.
- **Order:** HB-2 (no contract change) → HB-1 (after its output decision) → HB-3 (after its output decision).
- **Open decisions:** HB-1 output and HB-3 output (CipherMuse/PL).
