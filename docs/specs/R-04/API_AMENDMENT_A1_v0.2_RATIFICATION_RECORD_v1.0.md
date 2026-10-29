# Bailey's Cart — API Amendment A1 v0.2 Ratification Record v1.0

**Status:** RATIFIED by Project Lead decision for **WP-03 Slice 1 only**. This file records that decision; it is uncommitted and prepared by CODI for CipherMuse and PL review.
**Prepared by:** CODI · **Date prepared:** 2026-10-28
**Authority:** Project Lead (penguinPrime), on CipherMuse specification handoff
**Workflow:** Pennington Labs Engineering Workflow v2.4

## 1. Ratified document

| Item | Value |
|---|---|
| Document | `docs/specs/R-04/API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.2.md` |
| Designation | **API Amendment A1, version 0.2** |
| SHA-256 (as ratified; file kept byte-identical) | `616bd0eb75b191aa6dc9b7157bf07557ad9067c6025870d2b874a794b3e30572` |
| Scope | WP-03 Slice 1 (`families.create`, `account.getSession`, and the transport, error and authentication rules they use) |
| Amends | `API_SPEC_v0.4_CANONICAL.md` §3, §4 (`account.getSession`), §8, as stated in A1 |
| Superseded drafts | `API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.1.md`, kept unmodified as history |

**Header note:**
- The ratified file still carries its pre-ratification header ("PROPOSED … Not ratified") and a blank approval table. Like the R-04 v0.4 files, it is **not edited**, so that its hash stays fixed. This record is the authority for its status.
- This record does not change any technical content of A1 v0.2.

## 2. Approval

| Field | Value |
|---|---|
| Decision | RATIFY API Amendment A1 v0.2 for WP-03 Slice 1 |
| Approver | Project Lead (penguinPrime) |
| Approval communicated | 2026-10-28, in the PL handoff "WP-03 Slice 1 Ratification Documentation and Contract Reconciliation" |
| Independent timestamp | None available. None is fabricated here. |
| Specification review | CipherMuse: CONDITIONAL APPROVAL of v0.1. v0.2 addressed conditions C-1 to C-3, and CipherMuse issued the ratification handoff. |
| Independent QA | GAI final D4 report (`GAI_WP03_Slice1_Final_D4_Verification_Report.md`, untracked) endorsed **v0.1** sections A1.1–A1.6. **GAI has not separately reviewed the v0.1 → v0.2 delta** (C-1 to C-3 and §A1.8). |

### Conditions of approval
1. **Slice 1 only.** A1 v0.2 does not define error codes, response shapes or transport rules for later slices. Each later slice needs its own amendment.
2. **F-1 and F-2 accepted as limitations** for Slice 1 (§3).
3. **Mandatory hardening dependency:** F-1 and F-2 must be hardened **before any additional family-record writer is introduced** (§4).
4. **Unchanged:** E-1 to E-5, PL-1 to PL-10 and all existing R-04 decisions remain unchanged and in force.

## 3. F-1 and F-2 acceptance boundaries

| ID | Accepted limitation | Boundary of acceptance |
|---|---|---|
| F-1 | If a stored `families/{id}` document lacks a valid `lifecycleState`, the caller's OWNER entry in `account.getSession` may carry `lifecycleState: null` (or an unvalidated value), violating the A1 §A1.5 schema. Access still fails closed (`accessMode: "NONE"`). | Accepted **only** while `families.create` is the sole writer of family records. It always writes a valid `lifecycleState` inside the same transaction as the rest of the family. |
| F-2 | If a stored family's `displayName` is `null`, non-string, empty, over 50 code points or contains PL-5-forbidden characters, `account.getSession` returns it as stored, violating §A1.5. | Accepted **only** while `families.create`, which validates `displayName` under PL-5, is the sole writer. |

**Not covered by this acceptance:**
- any response-shape deviation that arises from data written by a validated Slice 1 path
- any deviation that weakens access control

The CODI traceability review (`CODI_WP03_S1_A1_CONTRACT_TRACEABILITY_REPORT_v1.0.md`) found a third behavior of the same class, labelled **F-3**: cross-entry consistency invariants depend on storage integrity. **F-3 is not covered by this ratification.** It is presented for a CipherMuse or PL decision.

## 4. Mandatory hardening dependency

- **Definition:** an "additional family-record writer" is any code path, other than `families.create` in Slice 1, that creates or updates `families/{familyId}` documents or their membership edges. That includes later commands (for example `families.close`, `families.restore`, `families.waiveRecovery` or a rename), migrations, back-office tools and repair scripts.
- **Requirement:** the F-1/F-2 hardening in `WP03_S1_F1_F2_HARDENING_BACKLOG_v1.0.md` must be implemented, tested at D1 and D2 with negative controls, and verified by FORGE **before** such a writer is merged.
- **Consequence for planning:** WP-03 Slice 2 (lifecycle) writes family records. **The hardening is therefore a prerequisite of Slice 2's merge**, and should be planned into Slice 2 or delivered before it.

## 5. Remaining production-platform limitations (unchanged; A1 §A1.7)
- **W-01:**
  - Production ID-token signature verification and App Check are unevidenced; the emulators accept forged tokens (W-01 D-4, D-5).
  - Production request-size limits and deadlines are unevidenced (W-01 D-8).
  - The Android client SDK error surface is unevidenced (W-01 D-9).
- **Deployment:** the final region and deployment naming are still provisional (`us-central1`).
- **Transactions:** Firestore emulator contention is not production contention evidence.
- **Retention:** the idempotency retention (37 days) is recorded per document, but no TTL policy is configured, because no provisioning is authorized.

## 6. Canonical documents explicitly unchanged

Verified 2026-10-28: no change between `f96e537` and HEAD `8d2bfa0`, and none in the working tree.

| Document | SHA-256 |
|---|---|
| `API_SPEC_v0.4_CANONICAL.md` | `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d` |
| `PRD_v1.0_R04_AMENDMENT.md` | `5e71e0b803ac04938314dc53d81a846c99feac3a5d6f39d4c3722b75a2d621b1` |
| `ARCHITECTURE_v1.1_R04_AMENDMENT.md` | `636161e493f6d600c07e5f3c5a9e8bfe371fa2c4259fb220b3f6fb1e19155455` |
| `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md` | `1890c589bc07caa8ee934e7bcedb1addc21081bb73ceaebc2ddcad3b2c4c8498` |

## 7. What this ratification does not authorize

This ratification does **not** authorize:
- a pull request, merge, release or deployment
- cloud provisioning
- committing A1 v0.2 or this record into the repository
- any code change, including the F-1/F-2 hardening

Each of these needs a separate Project Lead authorization.

**Gate status:** Gate C remains open for WP-03 Slice 1 only.
