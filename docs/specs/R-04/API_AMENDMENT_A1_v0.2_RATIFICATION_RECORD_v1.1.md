# Bailey's Cart — API Amendment A1 v0.2 Ratification Record v1.1

**Status:** RATIFIED by Project Lead decision for **WP-03 Slice 1 only**. v1.1 adds the PL decisions R-1 and F-3/HB-3. It changes no technical content of A1 v0.2.
**Prepared by:** CODI · **Date prepared:** 2026-10-29
**Authority:** Project Lead (penguinPrime)
**Workflow:** Pennington Labs Engineering Workflow v2.3
**Supersedes:** `API_AMENDMENT_A1_v0.2_RATIFICATION_RECORD_v1.0.md`, kept unmodified as history. Where v1.0 and v1.1 differ, v1.1 controls.

## Changes from v1.0

| # | Change | Source |
|---|---|---|
| 1 | R-1 approved as an interpretive clarification of §A1.6 (no API or runtime change), recorded in `API_AMENDMENT_A1_v0.2_CLARIFICATION_R1_v1.0.md` | PL decision R-1 |
| 2 | F-3 accepted as a limitation **for the current Slice 1 sole-writer scope only**. HB-3 added to the mandatory pre-writer hardening, alongside HB-1 and HB-2. This replaces v1.0 §3's statement "F-3 is not covered by this ratification". | PL decision F-3 / HB-3 |
| 3 | The hardening backlog reference moves to `WP03_S1_HARDENING_BACKLOG_v1.1.md` | — |
| 4 | Superseded draft A1 v0.1 explicitly labelled historical (§1) | — |

## 1. Ratified document

| Item | Value |
|---|---|
| Document | `docs/specs/R-04/API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.2.md` |
| Designation | **API Amendment A1, version 0.2** |
| SHA-256 (as ratified; file kept byte-identical) | `616bd0eb75b191aa6dc9b7157bf07557ad9067c6025870d2b874a794b3e30572` |
| Scope | WP-03 Slice 1 (`families.create`, `account.getSession`, and the transport, error and authentication rules they use) |
| Amends | `API_SPEC_v0.4_CANONICAL.md` §3, §4 (`account.getSession`), §8, as stated in A1 |
| Clarifications | R-1: `API_AMENDMENT_A1_v0.2_CLARIFICATION_R1_v1.0.md` (interpretive; §A1.6) |
| **Historical, not ratified** | `API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.1.md`. Superseded draft (SHA-256 `9982238fa1bed67a6d70edc8150c1b087141b3c39c9cf03ae0edd3b689c48529`), kept unmodified as history. **It has no normative force.** |

**Header note:**
- The ratified A1 v0.2 file still carries its pre-ratification header ("PROPOSED … Not ratified") and a blank approval table. It is **not edited**, so that its hash stays fixed. This record is the authority for its status.

## 2. Approval

| Field | Value |
|---|---|
| Decision | RATIFY API Amendment A1 v0.2 for WP-03 Slice 1 (unchanged from v1.0) |
| Approver | Project Lead (penguinPrime) |
| Ratification communicated | 2026-10-28, in the PL handoff "WP-03 Slice 1 Ratification Documentation and Contract Reconciliation" |
| R-1 and F-3/HB-3 decisions communicated | In the PL handoff "WP-03 Slice 1: R-1 / HB-3 Reconciliation and Test-Gap Plan", then executed under "WP-03 Slice 1 Phase A" authorization (2026-10-29) |
| Independent timestamp | None available. None is fabricated here. |
| Specification review | CipherMuse: CONDITIONAL APPROVAL of v0.1. v0.2 addressed conditions C-1 to C-3, and CipherMuse issued the ratification handoff. |
| Independent QA | The GAI final D4 report (`GAI_WP03_Slice1_Final_D4_Verification_Report.md`) endorsed **v0.1** sections A1.1–A1.6. **GAI has not reviewed the v0.1 → v0.2 delta** (C-1 to C-3, §A1.8), **nor this record's R-1 and F-3/HB-3 additions.** No GAI approval is claimed. |

### Conditions of approval
1. **Slice 1 only.** A1 v0.2 does not define error codes, response shapes or transport rules for later slices. Each later slice needs its own amendment.
2. **F-1, F-2 and F-3 accepted as limitations**, only within the Slice 1 sole-writer scope (§3).
3. **Mandatory hardening dependency:** HB-1, HB-2 and HB-3 must be delivered **before any additional family-record writer is introduced** (§4).
4. **R-1:** §A1.6 replay is read subject to §A1.2 precedence, per the R-1 clarification. This is not an API or runtime change.
5. **Unchanged:** E-1 to E-5, PL-1 to PL-10 and all existing R-04 decisions remain in force.

## 3. F-1, F-2 and F-3 acceptance boundaries

| ID | Accepted limitation | Boundary of acceptance |
|---|---|---|
| F-1 | If a stored `families/{id}` document lacks a valid `lifecycleState`, the caller's OWNER entry in `account.getSession` may carry `lifecycleState: null` (or an unvalidated value), violating the A1 §A1.5 schema. Access still fails closed (`accessMode: "NONE"`). | Accepted **only** while `families.create` is the sole writer of family records. It always writes a valid `lifecycleState` inside the same transaction as the rest of the family. |
| F-2 | If a stored family's `displayName` is `null`, non-string, empty, over 50 code points or contains PL-5-forbidden characters, `account.getSession` returns it as stored, violating §A1.5. | Accepted **only** while `families.create`, which validates `displayName` under PL-5, is the sole writer. |
| F-3 | `account.getSession` does not re-check the §A1.5 cross-entry invariants on read: at most one OWNER entry; `ownedFamilyId` equal to the OWNER entry's `familyId`; never both `trialEndsAt` and `reservationExpiresAt`. Inconsistent stored records could produce a response that violates them. | Accepted **only** while `families.create` is the sole writer. It writes the owner claim, the family, both membership edges and the lifecycle timestamps in one transaction. |

**Not covered by this acceptance:**
- any response-shape deviation that arises from data written by a validated Slice 1 path
- any deviation that weakens access control

## 4. Mandatory hardening dependency

- **Definition (unchanged from v1.0):** an "additional family-record writer" is any code path, other than `families.create` in Slice 1, that creates or updates `families/{familyId}` documents or their membership edges. That includes later commands (for example `families.close`, `families.restore`, `families.waiveRecovery`, a rename or `invites.accept`), migrations, back-office tools and repair scripts.
- **Requirement:** HB-1, HB-2 and HB-3 in `WP03_S1_HARDENING_BACKLOG_v1.1.md` must be implemented, tested at D1 and D2 with negative controls, and verified by FORGE **before** such a writer is merged.
- **HB-3 must cover, at minimum (PL decision):**
  1. at most one OWNER membership per UID
  2. consistency of `ownedFamilyId` and the owner membership
  3. required lifecycle timestamp exclusivity
  4. fail-closed behavior for inconsistent stored records
- **Open decision (not made here):** the exact fail-closed output for HB-1 and HB-3 remains open for CipherMuse/PL decision before those items are implemented.
- **Consequence for planning:** WP-03 Slice 2 (lifecycle) writes family records. The hardening is therefore a prerequisite of Slice 2's merge.

## 5. Remaining production-platform limitations (unchanged; A1 §A1.7)
- **W-01:**
  - Production ID-token signature verification and App Check are unevidenced; the emulators accept forged tokens (W-01 D-4, D-5).
  - Production request-size limits and deadlines are unevidenced (W-01 D-8).
  - The Android client SDK error surface is unevidenced (W-01 D-9).
- **Deployment:** the final region and deployment naming are still provisional (`us-central1`).
- **Transactions:** Firestore emulator contention is not production contention evidence.
- **Retention:** the idempotency retention (37 days) is recorded per document, but no TTL policy is configured, because no provisioning is authorized.

## 6. Canonical documents explicitly unchanged

Re-verified 2026-10-29 against the working tree and the committed blobs at `8d2bfa0`.

| Document | SHA-256 |
|---|---|
| `API_SPEC_v0.4_CANONICAL.md` | `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d` |
| `PRD_v1.0_R04_AMENDMENT.md` | `5e71e0b803ac04938314dc53d81a846c99feac3a5d6f39d4c3722b75a2d621b1` |
| `ARCHITECTURE_v1.1_R04_AMENDMENT.md` | `636161e493f6d600c07e5f3c5a9e8bfe371fa2c4259fb220b3f6fb1e19155455` |
| `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md` | `1890c589bc07caa8ee934e7bcedb1addc21081bb73ceaebc2ddcad3b2c4c8498` |

## 7. Open verification items

These are tracked here and are **not closed**:
- GAI review of the A1 v0.1 → v0.2 delta, and of R-1 and F-3/HB-3.
- Test gaps T-GAP-1, 3, 4, 5, 7, 8 and 10: planned for Phase B, not implemented.
- T-GAP-2, 6 and 9: deferred or awaiting acceptance (see `CODI_WP03_S1_R1_HB3_TEST_GAP_EXECUTION_PLAN_v1.0.md` §4.8).

## 8. What this record does not authorize

This record does **not** authorize:
- a push, merge, release or deployment
- cloud provisioning
- any code or test change, including the HB-1/HB-2/HB-3 hardening

Each needs a separate Project Lead authorization.
