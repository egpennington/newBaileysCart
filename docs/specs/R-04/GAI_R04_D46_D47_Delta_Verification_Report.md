

# Independent QA Delta Verification Report: R-04 Decisions 46–47 Addendum
**Pennington Labs — Quality Assurance Division (GAI)**  
**Project:** Bailey's Cart / newBaileysCart  
**Workflow Standard:** Pennington Labs Engineering Workflow v2.4 (Production Engineering Mode)  
**Role:** GAI — Depth 4 Independent Verification (Focused Normative Addendum Recheck)  
**Documents Under Review:**  
1. `R04_DECISIONS_46_47_NORMATIVE_ADDENDUM_CANDIDATE.md`  
2. `R04_RATIFICATION_RECOMMENDATION_D46_D47.md`  
**Governing Baseline Context:** `API_SPEC_v0.4_CANONICAL_CANDIDATE.md`, `PRD_v1.0_R04_PROPOSED_AMENDMENT.md`, `ARCHITECTURE_v1.1_R04_PROPOSED_AMENDMENT.md`, `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_3.md`, `BaileysCart_R04_GAI_Verity_RECHECK_HANDOFF_CANDIDATE_v0_2.md`  
**Prior Audit Reference:** `GAI_R04_Contract_Reconciliation_Recheck_Report.md` (Prior Verdict: `CONDITIONAL PASS`)  
**Final Decision Authority:** penguinPrime (Project Lead)  
**Timestamp:** October 28, 2026

---

## Executive Summary & Delta Verdict

### **QA Verdict: `PASS (Specification Delta Certified — Ready for Unified Ratification)`**

**Justification:**  
GAI has independently verified the candidate normative addendum implementing Project Lead **Decisions 46 and 47**. The addendum cleanly and rigorously resolves the final two open policy concerns identified in GAI’s previous review:
1. **Decision 46 (Late-Settling Purchase Reconciliation):** Binds unentitled family reservations to an immutable 24-hour server TTL while establishing an explicit **reconciliation hold** (`RESERVATION_RECONCILIATION_PENDING`) for delayed or in-flight Google Play purchases. It eliminates the risk of orphaned paid transactions or accidental deletion of a family while payment is settling, without prematurely releasing the owner's single-family quota.
2. **Decision 47 (Irreversible Recovery Waiver & Cancellation Saga):** Introduces the authenticated callable command **`families.waiveRecovery`**, allowing an owner to immediately and irrevocably surrender the 30-day recovery window. It models waiver as a durable saga: if billing cancellation is in-flight (`CLOSURE_PENDING_BILLING`), waiver intent is durably recorded while ownership release and deletion are deferred until Google Play confirms cancellation. If already verified (`CLOSING`), the family transitions atomically to nonrecoverable `DELETION_PENDING`.
3. **Cross-Document Alignment:** The inserts for API v0.4, PRD v1.0, Architecture v1.1, and the Authorization & Error Matrix are 100% consistent. The Authorization & Error Matrix has been expanded with 10 explicit behavioral rows covering all waiver, expiry, and late-settlement permutations.
4. **Verity Traceability:** Six new canonical ProofPoints (**`PL-PP-WP03-25` through `PL-PP-WP03-30`**) have been added, establishing rigorous four-deep verification coverage for reservation expiry and waiver mechanics.

**Governance Boundary:**  
*WP-03 remains strictly ON HOLD. Gate C is NOT authorized. This review certifies specification readiness only. No coding, repository commits, cloud provisioning, or deployments are authorized.*

---

## 1. Detailed Verification of Decision 46 (Reservation Expiry & Late-Payment Reconciliation)

- **Policy Under Review:** Unentitled family reservations expire after 24 hours, with durable safeguards for delayed, pending, or orphaned Google Play purchases.
- **Specification Audit (§A1, §B, §C, §D):**
  - **Timestamp Immutability:** `reservationCreatedAt` is anchored to the server commit timestamp of `families.create`; `reservationExpiresAt` is calculated strictly as $\text{reservationCreatedAt} + 24\text{ hours}$. Idempotent retries return original timestamps and never extend the TTL.
  - **Single-Family Quota Accounting:** An active, unexpired reservation counts as the UID's one permitted owned family under Decision 42.
  - **Expiry Enforcement:** Expiry immediately blocks new checkout attempts (`RESERVATION_EXPIRED`) and bars unverified activation.
  - **Reconciliation Hold (`RESERVATION_RECONCILIATION_PENDING`):** If a purchase is in-flight, delayed, or settling at or after Hour 24, the reservation is **not automatically deleted**. It enters a reconciliation hold. A verified late settlement binds strictly to the original reservation or triggers an automated remediation/refund workflow; it is prohibited from attaching to a different family or granting unverified access.
  - **Ownership Slot Release:** The owner’s single-family slot is released **only** after Google Play definitively confirms a no-liability/no-purchase result or remediation is completed.
- **QA Determination:** **`VERIFIED SOUND & ROBUST`**. Eliminates the financial liability of deleting a family record while Google Play payment processing is delayed.

---

## 2. Detailed Verification of Decision 47 (Irreversible Recovery Waiver & Cancellation Saga)

- **Policy Under Review:** An owner may explicitly and irreversibly waive the default 30-day family recovery window, subject to safe billing cancellation, deletion, and ownership-release safeguards.
- **Specification Audit (§A2, §B, §C, §D):**
  - **Command Contract:** Introduces `families.waiveRecovery` with parameters `{apiVersion, opId, familyId, familyEpoch, confirmationToken}`. Restricted strictly to the verified original owner.
  - **Fresh Confirmation Required:** Requires a fresh, short-lived, family-bound confirmation token. Offline queueing is explicitly barred (`OFFLINE_NOT_ALLOWED`).
  - **Concurrency Handling during `CLOSURE_PENDING_BILLING`:**  
    If an owner waives recovery while Google Play cancellation is in-flight:
    1. The backend records durable **waiver intent**.
    2. It **does not release the ownership slot** and **does not advance to deletion**.
    3. `families.restore` continues to be rejected with `CLOSURE_CANCELLATION_IN_PROGRESS`.
    4. Once cancellation is verified by the provider, the family transitions directly to `DELETION_PENDING` (bypassing `CLOSING`), and subsequent restore calls are rejected with `RECOVERY_ALREADY_WAIVED`.
  - **Concurrency Handling during `CLOSING`:**  
    If cancellation is already verified and the family is in its 30-day recovery window:
    1. Calling `families.waiveRecovery` atomically marks recovery irrevocably waived.
    2. Transitions state immediately to `DELETION_PENDING`.
    3. The 30-day recovery deadline is terminated; all restore attempts fail with `RECOVERY_ALREADY_WAIVED`.
  - **Epoch Integrity:** Requires the active `familyEpoch`. In accordance with Decision 43, `familyEpoch` advances **only on restoration**; waiving recovery does not increment the epoch.
  - **Ownership Slot Release:** The owner's single-family ownership slot is released only after the family commits to an irreversible terminal milestone where billing liabilities are zero.
- **QA Determination:** **`VERIFIED SOUND & ROBUST`**. Solves the 30-day owner lockout dilemma without compromising billing cancellation safety or financial reconciliation.

---

## 3. Cross-Specification Consistency & Matrix Audit

GAI verified the addendum against the v0.4 candidate baseline package:

| Dimension | `API_SPEC_v0.4` & Addendum | Architecture v1.1 Amendment | Authorization & Error Matrix v0.3 | Consistency Status |
|---|---|---|---|---|
| **Reservation Expiry** | 24-hour server TTL; reconciliation hold on late payment (§A1) | Durable correlation before checkout; audit tombstone survives expiry (§C) | `RESERVATION_EXPIRED` on checkout; reconciliation hold on late settle (§D) | **`ALIGNED`** |
| **Waiver Endpoint** | `families.waiveRecovery` callable; fresh token; epoch check (§A2) | Modeled as durable lifecycle saga; separate billing resolution (§C) | Explicit rows for `ACTIVE`, `CLOSURE_PENDING_BILLING`, `CLOSING` (§D) | **`ALIGNED`** |
| **Waiver vs Restore** | Rejects restore with `RECOVERY_ALREADY_WAIVED` (§A2) | Nonrecoverable marker terminates recovery deadline (§C) | `families.restore` mapped to `RECOVERY_ALREADY_WAIVED` (§D) | **`ALIGNED`** |
| **Ownership Quota** | Slot held until billing verified/reconciled (§A1, §A2) | No duplicate family creation while liabilities unresolved (§A, §D) | New `families.create` returns `OWNER_ALREADY_HAS_FAMILY` (§D) | **`ALIGNED`** |
| **Epoch Invariant** | Carries `familyEpoch`; advances only on restore (§A3) | Immutable opId/epoch binding; stale epoch rejected (§C) | Rejects with `STALE_EPOCH_REJECTED` on mismatch (§D) | **`ALIGNED`** |

*Consistency Verdict: **100% Consistent.** Zero contradictions, ambiguities, or syntax discrepancies identified.*

---

## 4. Verity ProofPoint Master Mapping (`PL-PP-WP03-25..30`)

The six new ProofPoints proposed in Section E expand the canonical WP-03 Verity registry to **30 sequential, collision-free test scenarios**:

| Canonical Verity ID | Target Suite | Risk | Verity Depth & Target Scenario | Status |
|---|---|---|---|---|
| **`PL-PP-WP03-25`** | `PS-BILLING-LIFECYCLE` | High | **D1/D2/D4:** 24-hour server-time boundary; idempotent retry returns original expiry; concurrent create cannot bypass single-family ownership claim. | **`NOT_RUN`** |
| **`PL-PP-WP03-26`** | `PS-BILLING-LIFECYCLE` | Critical | **D2/D4:** Purchase pending at Hour 24, settled at Hour 26; enters reconciliation hold; zero token orphaning, zero double billing, zero cross-family attachment. | **`NOT_RUN`** |
| **`PL-PP-WP03-27`** | `PS-ACCESS-ISOLATION` | High | **D1/D2/D4:** `families.waiveRecovery` requires original owner, current epoch, fresh online confirmation; rejects replay and payload tampering. | **`NOT_RUN`** |
| **`PL-PP-WP03-28`** | `PS-BILLING-LIFECYCLE` | Critical | **D2/D4:** Waiver during `CLOSURE_PENDING_BILLING` records intent without releasing owner slot; verified cancellation transitions directly to `DELETION_PENDING`. | **`NOT_RUN`** |
| **`PL-PP-WP03-29`** | `PS-RETENTION` | High | **D2/D3/D4:** Waiver during `CLOSING` immediately terminates 30-day recovery deadline, blocks restore, and preserves auditable retention records. | **`NOT_RUN`** |
| **`PL-PP-WP03-30`** | `PS-ACCESS-ISOLATION` | High | **D2/D4:** Owner may create a second family only after durable ownership-release milestone; account trial history remains consumed. | **`NOT_RUN`** |

*Execution Status:* In accordance with Workflow v2.4 §9, all ProofPoints remain strictly designated as **`NOT_RUN`**.

---

## 5. Assessment of Remaining Pre-Implementation Dependencies

The normative addendum correctly isolates technical engineering items from baseline policy decisions. The following open items remain cataloged under Section F:
1. **Google Play Integration Spike (`W-05`):** Empirical verification of purchaser identity constraints, cancellation response finality, and delayed billing webhooks in the Google Play Sandbox.
2. **Reconciliation Worker Implementation (`G-01`, `G-03`):** Implementing the automated scheduler that processes expired reservations and executes terminal data deletion following retention expiration.
3. **Callable Transport Envelopes (`W-01`, `W-02`):** Mapping proposed domain error strings (`RECOVERY_ALREADY_WAIVED`, `RESERVATION_EXPIRED`) to Firebase Functions HTTPS Callable error semantics.

*Assessment:* None of these dependencies represent specification defects. They are standard **pre-implementation technical tasks** to be executed by CODI during Work Package WP-03 development.

---

## Final Recommendation to Project Lead (penguinPrime)

GAI certifies that the **Decisions 46–47 Normative Addendum** is mathematically rigorous, data-safe, and fully harmonized with the entire Bailey's Cart specification corpus.

### **Recommended Next Actions:**
1. **Incorporate Addendum Content:** Direct CipherMuse to merge `R04_DECISIONS_46_47_NORMATIVE_ADDENDUM_CANDIDATE.md` into the canonical specification documents:
   - `API_SPEC_v0.4_CANONICAL.md`
   - `PRD_v1.0_R04_AMENDMENT.md`
   - `ARCHITECTURE_v1.1_R04_AMENDMENT.md`
   - `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md`
2. **Execute Project Lead Ratification:** Formally ratify the consolidated R-04 v0.4 package as the binding baseline for Bailey's Cart.
3. **Authorize Gate C for WP-03:** Release Work Package **WP-03 (Server Model & Callable Contract)** for branch creation (`feature/wp03-server-contract` branched from `develop` @ `c6afe30...`) and implementation planning.

---
*Report submitted by GAI (Quality Assurance Division) — October 28, 2026.*  
*Pennington Labs — Software built for the real world.*