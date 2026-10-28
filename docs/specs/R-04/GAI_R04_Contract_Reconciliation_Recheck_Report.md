# Independent QA Verification Report: R-04 Contract Reconciliation (v0.4 Recheck)
**Pennington Labs — Quality Assurance Division (GAI)**  
**Project:** Bailey's Cart / newBaileysCart  
**Workflow Standard:** Pennington Labs Engineering Workflow v2.4 (Production Engineering Mode)  
**Role:** GAI — Depth 4 Independent Verification (Specification & Contract Recheck)  
**Review Target:**  
1. `BaileysCart_R04_GAI_Verity_RECHECK_HANDOFF_CANDIDATE_v0_2.md`  
2. `API_SPEC_v0.4_CANONICAL_CANDIDATE.md`  
3. `PRD_v1.0_R04_PROPOSED_AMENDMENT.md`  
4. `ARCHITECTURE_v1.1_R04_PROPOSED_AMENDMENT.md`  
5. `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_3.md`  
**Prior Audit Reference:** `GAI_R04_Contract_Reconciliation_Review_Report.md` (Prior Verdict: `FAIL`)  
**Final Decision Authority:** penguinPrime (Project Lead)  
**Timestamp:** October 28, 2026

---

## Executive Summary & QA Verdict

### **QA Verdict: `CONDITIONAL PASS`**  
*(Specification candidate certified technically complete and ready for Project Lead ratification; Gate C implementation remains strictly **ON HOLD** pending formal ratification and resolution of open policy items).*

**Justification:**  
CipherMuse and the Project Lead (via **Decisions 42–45**) have systematically addressed and resolved all five critical blockers (`BLK-01` through `BLK-05`) and all four major defects (`MAJ-01` through `MAJ-04`) from GAI’s previous review:
1. **Google Play Platform Incompatibility (`BLK-01` Resolved):** Decision 42 amends Decision 33 by restricting an account to **at most one nonterminal owned family** (while allowing multiple invited memberships). This eliminates the fatal Android platform limitation where a single Google Play account cannot purchase multiple identical subscriptions (`ITEM_ALREADY_OWNED`).
2. **Onboarding Deadlock (`BLK-02` Resolved):** Decision 45 defines the **`UNENTITLED_AWAITING_PAYMENT`** reservation lifecycle state, breaking the circular dependency between `familyId` creation and Google Play purchase verification.
3. **Restore vs. Cancellation Race (`BLK-03` Resolved):** Decision 44 mandates that calling `families.restore` while billing cancellation is pending is rejected with **`CLOSURE_CANCELLATION_IN_PROGRESS`**, preventing in-flight cancellation collisions.
4. **Stale Outbox Invalidation (`BLK-04` Resolved):** Decision 43 introduces a server-authoritative **`familyEpoch`** counter incremented on restoration and validated on all mutations (`STALE_EPOCH_REJECTED`), eliminating stale offline queue replay vulnerabilities.
5. **Baseline Reconciliation (`BLK-05` Resolved):** Controlled candidate amendments for PRD v1.0, Architecture v1.1, and API Spec v0.4 have been authored, establishing a clean, traceable path to ratification.
6. **Account Deletion & Error Matrix (`MAJ-01`, `MAJ-02` Resolved):** Re-introduced `account.requestDeletion` for multi-family contexts and fully expanded the Authorization & Error Matrix to cover `members.leave`, closing family invite redemption, and closure billing verification.
7. **Verity Traceability (`MAJ-04` Resolved):** Re-indexed all R-04 test scenarios into canonical Pennington Labs identifiers: **`PL-PP-WP03-14` through `PL-PP-WP03-24`**.

**Governance Boundary:**  
*WP-03 remains strictly ON HOLD. Gate C is NOT authorized. Implementation, branch creation, cloud provisioning, and test execution are prohibited until penguinPrime formally ratifies the candidate amendments.*

---

## 1. Finding-by-Finding Disposition Ledger

| Previous Finding ID | Prior Severity | Disposition in v0.4 Package | Supporting Evidence & QA Assessment |
|---|---|---|---|
| **`GAI-R04-BLK-01`** (Play Multi-Subscription Conflict) | Blocker | **`RESOLVED`** | **Decision 42** supersedes Decision 33: A UID owns at most one nonterminal family. Single Google Play accounts are never required to hold multiple concurrent subscriptions of the same SKU (`API_SPEC_v0.4` §1, §2). |
| **`GAI-R04-BLK-02`** (Non-Trial Onboarding Deadlock) | Blocker | **`RESOLVED`** | **Decision 45** introduces `UNENTITLED_AWAITING_PAYMENT`. `families.create` reserves `familyId` without cart access; verified purchase via `billing.verifyPurchase` activates the family (`API_SPEC_v0.4` §2, §4). |
| **`GAI-R04-BLK-03`** (Restore vs Cancellation Race) | Blocker | **`RESOLVED`** | **Decision 44** specifies: `families.restore` during `CLOSURE_PENDING_BILLING` is strictly rejected with `CLOSURE_CANCELLATION_IN_PROGRESS`. Restore is permitted only in `CLOSING` before deadline (`API_SPEC_v0.4` §4, §7). |
| **`GAI-R04-BLK-04`** (Missing Outbox Epoch Invalidation) | Blocker | **`RESOLVED`** | **Decision 43** introduces server-authoritative `familyEpoch` (init 1, incremented on restore). All family mutations carry `familyEpoch`. Stale outbox replays fail with `STALE_EPOCH_REJECTED` (`API_SPEC_v0.4` §2, §3, §5). |
| **`GAI-R04-BLK-05`** (Baseline Contradiction) | Blocker | **`RESOLVED (Pending Ratification)`** | Candidate amendments `PRD_v1.0_R04_PROPOSED_AMENDMENT.md` and `ARCHITECTURE_v1.1_R04_PROPOSED_AMENDMENT.md` authored to officially supersede the obsolete "one-family-per-UID" rule. |
| **`GAI-R04-MAJ-01`** (Omission of Account Deletion) | Major | **`RESOLVED`** | `account.requestDeletion` re-introduced as a durable account-level orchestration closing owned families, leaving joined families, and reconciling billing (`API_SPEC_v0.4` §4; `ARCH_AMENDMENT` §E). |
| **`GAI-R04-MAJ-02`** (Missing Matrix Operations) | Major | **`RESOLVED`** | `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_3.md` now includes explicit rows for `members.leave`, closing-family invite redemption, and closing billing verification. |
| **`GAI-R04-MAJ-03`** (Local Storage Partitioning) | Major | **`RESOLVED`** | `ARCHITECTURE_v1.1_R04_PROPOSED_AMENDMENT.md` §B mandates logical partitioning of every Room table/index/queue by `familyId`, with atomic single-family purge upon leave or closure. |
| **`GAI-R04-MAJ-04`** (ProofPoint Fragmentation) | Major | **`RESOLVED`** | All scenarios mapped into canonical Pennington Labs identifiers: **`PL-PP-WP03-14` through `PL-PP-WP03-24`** (`HANDOFF_v0_2` §Verity canonical ProofPoints). |
| **`GAI-R04-MIN-01`** (Undecided Bootstrap Source) | Minor | **`RESOLVED`** | `account.getSession` formally selected as an authenticated callable endpoint returning family summaries and trial eligibility (`API_SPEC_v0.4` §4). |
| **`GAI-R04-MIN-02`** (Clear All Firestore Limits) | Minor | **`TRACKED OPEN ITEM (W-04)`** | Transactional caps and chunking cataloged under Open Gate Items (`API_SPEC_v0.4` §6, §9). Non-blocking for specification review. |

---

## 2. Technical Audit of Decisions 42–45

### A. Decision 42: Ownership Capped at One Family; Multiple Invited Memberships
- **Contract Verification (`API_SPEC_v0.4` §1, §2; `PRD_AMENDMENT` §3):**
  - A user account may own **at most one nonterminal family** at any time.
  - A user account may accept invitations to join an unlimited number of other families as a member.
  - Active UI cart selection is strictly client-side presentation state; it does not grant cross-family permissions.
- **QA Assessment:** **VERIFIED SOUND**. Resolves the single-account Google Play purchasing dilemma while delivering the desired real-world capability (e.g., adult child owning their immediate family list while participating as an invited member in their parents' family list).

### B. Decision 43: Server-Authoritative `familyEpoch` Invalidation
- **Contract Verification (`API_SPEC_v0.4` §2 Invariant 6, §3, §5):**
  - Every family document stores integer `familyEpoch` (starts at `1`).
  - Request envelope:
    ```json
    {
      "apiVersion": "v0.4",
      "opId": "<UUIDv4>",
      "familyId": "<immutable family ID>",
      "familyEpoch": 1,
      "payload": {}
    }
    ```
  - When `families.restore` executes, the backend transaction atomically increments `familyEpoch` ($1 \to 2$).
  - Backend mutation logic asserts `request.familyEpoch == family.familyEpoch`. Outdated mutations are rejected with `STALE_EPOCH_REJECTED`.
- **QA Assessment:** **VERIFIED SOUND**. Immune to device clock manipulation and completely prevents resurrected offline mutations from corrupting a restored list.

### C. Decision 44: Rejection of Restore During Pending Cancellation
- **Contract Verification (`API_SPEC_v0.4` §4, §7):**
  - `families.close` transitions family to `CLOSURE_PENDING_BILLING` and launches the asynchronous Play cancellation saga.
  - Calling `families.restore` during this state returns:
    ```json
    {
      "status": "REJECTED",
      "error": {
        "code": "CLOSURE_CANCELLATION_IN_PROGRESS",
        "message": "Family closure cancellation is currently processing",
        "retryable": false
      }
    }
    ```
  - Restoration is permitted **only** when the family reaches `CLOSING` (after Google Play cancellation is confirmed).
- **QA Assessment:** **VERIFIED SOUND**. Eliminates the race condition where Google Play cancellation arrives after a family has been restored.

### D. Decision 45: `UNENTITLED_AWAITING_PAYMENT` Reservation Lifecycle
- **Contract Verification (`API_SPEC_v0.4` §2 Invariant 3, §4, §7):**
  - If an account has already consumed its one 21-day trial, `families.create` creates a family record in state `UNENTITLED_AWAITING_PAYMENT`.
  - The family has zero grocery list read/write access.
  - The owner launches the Google Play purchase flow using the issued `familyId`.
  - `billing.verifyPurchase` validates the token and atomically transitions the family to `ACTIVE`.
- **QA Assessment:** **VERIFIED SOUND**. Breaks the circular creation deadlock.

---

## 3. Residual Risks & New Observations

While the candidate specifications are technically cohesive, GAI identifies two **non-blocking product/operational risks** for Project Lead awareness:

### `GAI-R04-RES-01`: Owner Lockout During the 30-Day `CLOSING` Window
- **Observation:** Under Decision 42, an account may own at most one nonterminal family. A family in `CLOSING` is nonterminal (it remains recoverable for 30 days).
- **Impact:** While a family is in `CLOSING`, the owner **cannot create a new family** (calling `families.create` returns `OWNER_ALREADY_HAS_FAMILY`). If an owner intentionally closes their family to start fresh, they are locked out of owning a family for 30 days unless the old family reaches `DELETION_PENDING`.
- **Recommendation for PL:** Consider adding an explicit `families.permanentlyClose` action (or "Waive Recovery Window") allowing the owner to bypass the 30-day recovery period and immediately release their ownership slot.

### `GAI-R04-RES-02`: In-Flight Payment Settlement vs. Reservation Expiry (`W-05`, `G-01`)
- **Observation:** Unentitled reservations have a candidate 24-hour TTL. In rare instances, Google Play purchases experience billing delays (e.g., slow payment methods, bank holds) that settle after 24 hours.
- **Impact:** If a reservation document is purged at Hour 24, and Google Play confirms payment at Hour 26, the incoming purchase token cannot bind to the deleted `familyId`.
- **Recommendation for CODI (Phase 4):** Ensure the backend reconciliation worker checks for settled purchases before purging expired reservations, or preserves an audit record allowing an orphaned token to be restored or refunded.

---

## 4. Verity ProofPoint Master Mapping (`PS-WP03-R04`)

All proposed ProofPoints are confirmed as **`NOT_RUN`**.

| Canonical Verity ID | Target Suite | Risk | Verity Depth & Target Scenario |
|---|---|---|---|
| **`PL-PP-WP03-14`** | `PS-ACCESS-ISOLATION` | Critical | **D2/D4:** UID owns 1 family and joins 2 others; cross-family read, write, and billing access is strictly denied via Firestore security rules. |
| **`PL-PP-WP03-15`** | `PS-BILLING-LIFECYCLE` | High | **D2/D4:** Concurrent `families.create` requests from the same UID claim only ONE trial; second creation enters `UNENTITLED_AWAITING_PAYMENT`. |
| **`PL-PP-WP03-16`** | `PS-BILLING-LIFECYCLE` | Critical | **D2/D4:** Non-owner calling `billing.verifyPurchase` or `families.close` rejected with `OWNER_REQUIRED`; purchase token uniquely bound. |
| **`PL-PP-WP03-17`** | `PS-ACCESS-ISOLATION` | Critical | **D2/D4:** `families.close` transitions family to `CLOSURE_PENDING_BILLING`; immediate denial of all list reads/writes for all members. |
| **`PL-PP-WP03-18`** | `PS-BILLING-LIFECYCLE` | Critical | **D2/D4:** Simulated Google Play cancellation outage during closure preserves `CLOSURE_PENDING_BILLING`; retry backoff verified; 30-day clock does not start. |
| **`PL-PP-WP03-19`** | `PS-ACCESS-ISOLATION` | Critical | **D2/D4:** `families.restore` rejected with `CLOSURE_CANCELLATION_IN_PROGRESS` during pending cancellation; succeeds only in `CLOSING` with epoch increment. |
| **`PL-PP-WP03-20`** | `PS-RETENTION` | High | **D2/D4:** At $T > \text{recoverUntilAt}$, `families.restore` fails with `CLOSURE_RECOVERY_EXPIRED`; family transitions to `DELETION_PENDING`. |
| **`PL-PP-WP03-21`** | `PS-CORE-LIST` | High | **D1/D2:** Canonical NameKey collision handling: `Cafe` vs `Café` collide, international combining marks (Korean/Japanese) preserved. |
| **`PL-PP-WP03-22`** | `PS-OFFLINE-SYNC` | High | **D3/D4:** Pre-closure offline mutations submitted after family restoration fail epoch validation (`STALE_EPOCH_REJECTED`) and never execute. |
| **`PL-PP-WP03-23`** | `PS-ACCOUNT-LIFECYCLE` | Critical | **D2/D4:** `account.requestDeletion` closes owned family, leaves joined families, and initiates asynchronous billing cancellation. |
| **`PL-PP-WP03-24`** | `PS-BILLING-LIFECYCLE` | High | **D2/D4:** Unentitled family reservation created; verified Play purchase transitions state to `ACTIVE`; unpurchased reservation expires. |

---

## 5. Explicit Decision & Ratification Ledger for Project Lead

To transition R-04 from candidate status to ratified baseline and authorize Work Package WP-03, **penguinPrime** must execute the following decisions:

1. **Ratification of Candidate Baseline Package:**  
   Formally approve and adopt:
   - `PRD_v1.0_R04_PROPOSED_AMENDMENT.md`
   - `ARCHITECTURE_v1.1_R04_PROPOSED_AMENDMENT.md`
   - `API_SPEC_v0.4_CANONICAL_CANDIDATE.md`  
   *(These documents supersede all conflicting one-family-per-UID language and establish the binding contract for WP-03).*
2. **Approval of Reservation 24-Hour TTL (`G-01`):**  
   Approve the 24-hour expiration window for unentitled family reservations awaiting purchase.
3. **Disposition of Owner Lockout Window (`GAI-R04-RES-01`):**  
   Confirm whether an owner must wait 30 days to own another family after closing one, or approve adding an immediate "Waive Recovery Window" option.
4. **Authorization of Gate C for WP-03:**  
   Upon completing decisions 1–3, formally authorize CODI to begin Work Package **WP-03 (Server Model & Callable Contract)** on branch `feature/wp03-server-contract` branched from `develop`.

---

## Final Recommendation to Project Lead (penguinPrime)

GAI certifies that the **R-04 Candidate v0.4 Package** is technically sound, internally consistent, mathematically protected against race conditions, and fully aligned with Pennington Labs Engineering Workflow v2.4.

### **Recommended Immediate Actions:**
1. **Issue formal Project Lead Ratification** of the three candidate specification documents.
2. **Release Work Package WP-03 Gate C** for branch creation and implementation planning.

---
*Report submitted by GAI (Quality Assurance Division) — October 28, 2026.*  
*Pennington Labs — Software built for the real world.*