# Independent QA Review Report: R-04 Contract Reconciliation
**Pennington Labs — Quality Assurance Division (GAI)**  
**Project:** Bailey's Cart / newBaileysCart  
**Workflow Standard:** Pennington Labs Engineering Workflow v2.4 (Production Engineering Mode)  
**Role:** GAI — Depth 4 Independent Verification (Specification & Contract Review)  
**Review Target:**  
1. `BaileysCart_R04_GAI_Verity_Review_Handoff_CANDIDATE_v0_1.md`  
2. `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md`  
3. `BaileysCart_R04_Reconciliation_Draft_v0_1.md`  
4. `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_2.md`  
**Governing Baseline References:** `API_SPEC_v0.3_REV1_RATIFIED_COPY.md`, `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`, `ARCHITECTURE_v1.1.md`, `PRD_v1.0.md`  
**Final Decision Authority:** penguinPrime (Project Lead)  
**Timestamp:** October 28, 2026

---

## Executive Summary & Specification Readiness Verdict

### **QA Verdict: `FAIL (Specification Readiness — Hold Gate C)`**

**Justification:**  
While the R-04 candidate artifacts make substantial progress capturing Project Lead Decisions 33–41 (multi-family support, account-level trial ledger, owner billing responsibility, and family closure/recovery), the package contains **five critical specification blockers** that make implementation impossible without introducing runtime billing failures, circular onboarding deadlocks, and offline data corruption.

Most critically:
1. **Google Play Platform Incompatibility:** Decision 33 permits one user account to own multiple families with separate subscriptions. However, native Google Play Billing binds purchases to the device’s underlying Google Play account and strictly prohibits purchasing multiple active subscriptions of the exact same base plan/SKU (`ITEM_ALREADY_OWNED`). The candidate contracts provide no solution for how a single Google Play account purchases separate subscriptions for Family A and Family B.
2. **Non-Trial Family Creation Deadlock (`B01`):** Decision 34 limits users to one 21-day trial across all families. When an owner creates an additional family, `families.create` cannot grant a trial. The candidate contract marks the payment-before-create sequence as unresolved, creating a circular dependency: purchasing in Google Play requires a `familyId`, but `families.create` cannot produce an active family without payment.
3. **Undefined Race on Restore During Pending Cancellation (`B04`):** The contract leaves the behavior of calling `families.restore` while Google Play cancellation is in-flight completely undefined, creating a race condition where a restored family's subscription could be canceled post-recovery.
4. **Missing Server Epoch Mechanism for Outbox Replays:** Decisions 39 and 40 dictate that pre-closure outbox mutations must never replay after family restoration. Because client clocks are explicitly untrusted, and the mutation wire contracts carry no server epoch identifier, the server has no technical mechanism to differentiate pre-closure offline mutations from post-restoration mutations.
5. **Direct Baseline Contradiction:** Approved `PRD_v1.0.md`, `ARCHITECTURE_v1.1.md`, and `API_SPEC_v0.3_REV1` explicitly mandate **one family per UID** and define `ALREADY_IN_FAMILY` errors. The candidate R-04 documents introduce multi-family support as an unratified delta without formally amending the governing PRD and Architecture baselines.

**Authority Restriction:**  
*Work Package WP-03 remains strictly ON HOLD. Gate C is NOT authorized. No coding, branch creation, provisioning, test execution, or merges are authorized.*

---

## 1. Severity-Ranked Findings

### Category A: BLOCKERS (Must be resolved before Gate C authorization)

#### `GAI-R04-BLK-01`: Google Play Store Single-Account Multi-Subscription Incompatibility
- **Affected Documents:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §2 (Decisions 33, 35), §3; `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_2.md`
- **Conflict / Platform Defect:**  
  Decision 33 permits a single authenticated user UID to own multiple families, and Decision 35 mandates that each family requires a separate, independent subscription.  
  However, on Android, all digital billing flows must route through the Google Play Store account active on the device. By default, Google Play subscriptions **do not permit a single Google Play account to purchase multiple active concurrent subscriptions of the identical base plan**. Attempting to purchase the same subscription product again returns `BillingResponseCode.ITEM_ALREADY_OWNED`.
- **System Impact:**  
  An owner attempting to subscribe for their second family on the same phone will be blocked by the Google Play Billing Library.
- **Actionable Correction:**  
  CODI and CipherMuse must evaluate and specify the Google Play billing architecture:
  1. *Option 1:* Pre-define multiple discrete base plans/offers in Play Console (e.g., `family-sub-slot-1`, `family-sub-slot-2`, etc.).
  2. *Option 2:* Restrict multi-family *ownership* in v1 (permitting multi-family *membership* only, where each family must be owned/funded by a distinct Google account).
  3. *Option 3:* Validate whether Google Play Multi-Quantity subscriptions can be applied.  
  Gate C cannot proceed without an empirically verified Google Play billing contract.

---

#### `GAI-R04-BLK-02`: Onboarding Deadlock for Non-Trial Subsequent Families (`B01`)
- **Affected Documents:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §2 (Decision 34), §4 (`families.create`), §8 (B01)
- **Conflict / Architectural Deadlock:**  
  Decision 34 dictates that an account receives only one 21-day promotional trial across all its created families. When a user who has already consumed their trial calls `families.create` for a second family, the contract states:
  > *“Subsequent family created without trial must have a permitted subscription onboarding path; payment-before-create ordering unresolved.”*
  This is a circular deadlock:
  - The client cannot purchase a Google Play subscription for a family without a `familyId` (since purchase tokens are bound immutably to a `familyId` under Decision 35).
  - The server cannot commit `families.create` in an `ACTIVE` state without a verified purchase.
  - If created as `READ_ONLY`, members cannot use the cart.
- **Actionable Correction:**  
  Specify an explicit transitional lifecycle state:
  `families.create` creates the second family in state **`UNENTITLED_AWAITING_PAYMENT`** with a 24-hour TTL. It issues an unentitled `familyId`. The client launches the Play purchase flow using this ID, calls `billing.verifyPurchase`, and upon verified receipt, the backend atomically transitions the family from `UNENTITLED_AWAITING_PAYMENT` to `ACTIVE`. If unpaid after 24 hours, the family record is purged.

---

#### `GAI-R04-BLK-03`: Undefined Race Condition on Restore During Pending Cancellation (`B04`)
- **Affected Documents:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §4 (`families.restore`), §8 (B04); `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_2.md`
- **Conflict / Concurrency Race:**  
  When an owner calls `families.close`, the family enters `CLOSURE_PENDING_BILLING` while an asynchronous task attempts Google Play Developer API cancellation. If the owner calls `families.restore` while cancellation is still in-flight:
  The contract and error matrix explicitly state: **`UNRESOLVED B04. No assumed behavior; block final implementation.`**
  - If `families.restore` succeeds while cancellation is in-flight, Google Play may cancel the subscription *after* the family is restored, leaving an active family without recurring billing.
  - If `families.restore` is rejected without clear guidance, a transient Play API outage traps the user in `CLOSURE_PENDING_BILLING`.
- **Actionable Correction:**  
  Formally define the contract: `families.restore` called while in `CLOSURE_PENDING_BILLING` is rejected with `CLOSURE_CANCELLATION_IN_PROGRESS`. The UI informs the owner that closure processing is completing. Once the cancellation worker reaches a terminal state (`CLOSING` or `FAILED_RETRY_EXHAUSTED`), recovery becomes available.

---

#### `GAI-R04-BLK-04`: Missing Server Epoch Counter to Invalidate Stale Pre-Closure Outbox Replays
- **Affected Documents:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §2 (Decisions 39, 40), §4, §5; `BaileysCart_R04_GAI_Verity_Review_Handoff_CANDIDATE_v0_1.md` (PP-R04-040, PP-R04-043)
- **Conflict / Data Corruption Defect:**  
  Decisions 39 and 40 mandate that restoring a closed family restores data for the original owner only, and **no pre-closure queue replay is permitted**.  
  However, the candidate request fields for item mutations in §4 (`items.*`) carry only `{apiVersion, opId, familyId, ...}`. There is **no epoch, generation token, or lifecycle counter** in the mutation payload.
  - Because client device clocks are explicitly untrusted (§5: *"Client clock is not authoritative"*), the backend cannot evaluate `operation.clientCreatedAt < family.closedAt`.
  - If an offline device reconnects after family restoration, its outbox will replay pre-closure mutations against the restored list. The server has no technical mechanism to identify that these mutations were generated prior to closure.
- **Actionable Correction:**  
  Add an authoritative integer **`familyEpoch`** to `/families/{familyId}` (initialized at `1`).
  - When `families.restore` executes, the backend atomically increments `familyEpoch` ($1 \to 2$).
  - All local outbox mutations must capture the active `familyEpoch` when queued locally.
  - Every backend mutation transaction must assert:
    $$\text{request.familyEpoch} == \text{family.familyEpoch}$$
    Any mutation submitted with a stale epoch is rejected with `STALE_EPOCH_REJECTED`.

---

#### `GAI-R04-BLK-05`: Direct Baseline Contradiction (One-Family-Per-UID vs. Multi-Family Support)
- **Affected Documents:** `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` §2; `ARCHITECTURE_v1.1.md` §2, §6; `PRD_v1.0.md` §3; `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §1, §5
- **Conflict / Governance Breakdown:**  
  - Approved `PRD_v1.0.md` §3 and `ARCHITECTURE_v1.1.md` §2 strictly mandate: *"Each account belongs to one family at a time... no multi-family membership."*
  - Ratified `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` §2 enforces: `families.create` and `invites.accept` reject with `ALREADY_IN_FAMILY`.
  - Candidate R-04 introduces Decision 33 ("One verified UID may own multiple families and be member of multiple families") as an unratified delta that inverts the foundational data model of the entire project.
  - Furthermore, `BaileysCart_R04_Reconciliation_Draft_v0_1.md` §1 still cites "Pennington Labs Engineering Workflow v2.3" instead of approved Workflow v2.4.
- **Actionable Correction:**  
  penguinPrime must execute a controlled, formal amendment to `PRD_v1.0.md` and `ARCHITECTURE_v1.1.md` officially replacing the one-family constraint with the Decision 33 multi-family model before any API spec implementing it can be ratified.

---

### Category B: MAJOR FINDINGS (Material Functional & Architectural Gaps)

#### `GAI-R04-MAJ-01`: Omission of Account Deletion in Multi-Family Context
- **Affected Documents:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §4; `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` §6
- **Gap Analysis:**  
  In ratified API v0.3 Rev 1 §6, `account.requestDeletion` provided a verified flow for owner account deletion (freezing family writes, preserving 30-day read-only retention for members, and triggering asynchronous Play cancellation).  
  In R-04 Candidate v0.2, `families.close` was added for closing a single family, but **`account.requestDeletion` was completely omitted from the API operations table**.  
  If a user owns two families and is a member of a third, what happens when they delete their Google/Firebase user account? Does the backend cascade `families.close` across all owned families and trigger `members.leave` on joined families? Leaving this unspecified violates Google Play Account Deletion policy requirements.
- **Actionable Correction:**  
  Re-incorporate `account.requestDeletion` into the API contract and specify that it transactionally invokes `families.close` across all owned families and `members.leave` across all joined families.

---

#### `GAI-R04-MAJ-02`: Missing Operations in Authorization & Error Matrix
- **Affected Documents:** `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_2.md`
- **Gap Analysis:**  
  The candidate matrix omits several critical operations and lifecycle boundary conditions:
  1. **`members.leave`:** There is no row in the matrix for `members.leave`. It fails to specify the error returned if an owner attempts to leave their own family without closing it (must return `OWNER_CANNOT_LEAVE`), or if a member attempts to leave during `CLOSING`.
  2. **`invites.accept` on Closing Families:** Missing from the matrix. Attempting to redeem an invite for a family in `CLOSURE_PENDING_BILLING`, `CLOSING`, or `DELETION_PENDING` must be explicitly mapped to `FAMILY_CLOSING` or `INVITE_INVALID`.
  3. **`billing.verifyPurchase` on Closing Families:** Missing from the matrix. Attempting to verify a purchase on a family in `CLOSING` must be rejected.
- **Actionable Correction:**  
  Update `BaileysCart_R04_Authorization_Error_Matrix` to add explicit rows for `members.leave`, `invites.accept` against closing families, and `billing.verifyPurchase` during closure states.

---

#### `GAI-R04-MAJ-03`: Unspecified Multi-Family Local Storage & Purge Architecture
- **Affected Documents:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §3, §5; `ARCHITECTURE_v1.1.md` §3
- **Architectural Risk:**  
  Architecture v1.1 §3 mandated a separate encrypted SQLite/Room database file per UID (`app_cache_{digest(uid)}.db`). Under Decision 33, a single UID can participate in multiple families.  
  If all families for that UID reside in the same Room database:
  - How does a confirmed `members.remove`, `members.leave`, or `families.close` purge *only* that family's cached items and outbox mutations without wiping or corrupting the user's other families?
  - Does Room partition by `(uid, familyId)` across distinct tables, or use separate SQLite files per family (`app_cache_{uid}_{familyId}.db`)?
- **Actionable Correction:**  
  Formally define in Architecture and the API contract that local Room storage is partitioned per family, and mandate an atomic `DELETE FROM items WHERE family_id = :familyId` purge transaction that executes immediately upon authoritative leave, removal, or closure confirmation.

---

#### `GAI-R04-MAJ-04`: Verity ProofPoint Namespace Fragmentation
- **Affected Documents:** `BaileysCart_R04_GAI_Verity_Review_Handoff_CANDIDATE_v0_1.md` §Proposed Verity ProofSuite; `FEATURE_SPEC_WP00_WP03_PLANNING_v0.3.md` §3; `BaileysCart_R04_Reconciliation_Draft_v0_1.md` §4
- **Traceability Defect:**  
  In Phase 4 Planning v0.3, the canonical Verity ProofPoints for WP-03 were indexed as `PL-PP-WP03-01` through `PL-PP-WP03-13`.  
  In `BaileysCart_R04_Reconciliation_Draft_v0_1.md`, ProofPoints were labeled `PP-R04-001` through `PP-R04-012`.  
  In `BaileysCart_R04_GAI_Verity_Review_Handoff_CANDIDATE_v0_1.md`, ProofPoints jump to `PP-R04-033` through `PP-R04-043` under an isolated suite `PS-WP03-R04-CLOSURE-ISOLATION`.  
  This creates three incompatible numbering conventions that fragment test traceability.
- **Actionable Correction:**  
  Map all R-04 test scenarios into the canonical Pennington Labs format: `PL-PP-WP03-14` through `PL-PP-WP03-24` (see Section 3).

---

### Category C: MINOR FINDINGS (Ambiguities & Hygiene)

#### `GAI-R04-MIN-01`: Undecided Bootstrap Authority (`account.getSession` vs. Firestore Reads — `B08`)
- **Reference:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §4, §8 (B08)
- **Observation:** Section 4 lists `account.getSession` but states: *"Endpoint vs Firestore projection undecided."* Leaving the bootstrap source unresolved impedes WP-01 client planning.
- **Recommendation:** Adopt `account.getSession` as an authenticated callable endpoint. It cleanly provides multi-family IDs, roles, and trial eligibility in one round trip without exposing wide Firestore security read rules on `/users`.

#### `GAI-R04-MIN-02`: Firestore Transaction Limits on Clear All
- **Reference:** `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md` §5
- **Observation:** Section 5 marks Clear All chunking and transaction limits as OPEN. Firestore hard-caps atomic transactions at 500 document writes.
- **Recommendation:** Enforce a maximum shopping list size of 300 active items per family in v1. This guarantees that `items.clearConfirmed` always executes within a single, atomic, 500-write Firestore transaction.

---

## 2. Updated Disposition of Blockers B01–B11

GAI audited the 11 candidate blockers listed in Section 8 of `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md`:

| ID | Description | GAI Assessment | Status |
|---|---|---|---|
| **B01** | Multi-family Play purchase binding & non-trial creation | **CRITICAL BLOCKER.** Platform limit (`ITEM_ALREADY_OWNED`) and creation deadlock. | **Gate C Blocker** |
| **B02** | Play cancellation API & verification semantics | **CRITICAL BLOCKER.** Drives the `CLOSURE_PENDING_BILLING` state machine. | **Gate C Blocker** |
| **B03** | Exact closure data retention/deletion SLA | **ARCHITECTURAL REQUIREMENT.** Bounded by the 30-day recovery deadline. | Post-Gate C / WP-03 Task |
| **B04** | Restore while cancellation is pending | **CRITICAL BLOCKER.** Undefined race condition; must reject with specific code. | **Gate C Blocker** |
| **B05** | 30-day boundary UTC arithmetic | **RESOLVED.** Strict elapsed timestamp: $\text{closureConfirmedAt} + 30 \times 86{,}400\text{ s}$. | Resolved in spec |
| **B06** | Atomic trial ledger schema & abuse protections | **CRITICAL BLOCKER.** Required to implement atomic trial consumption in `families.create`. | **Gate C Blocker** |
| **B07** | Unicode normative algorithm & test vectors | **CRITICAL BLOCKER.** Required to implement `nameKeys` reservation transactions. | **Gate C Blocker** |
| **B08** | `account.getSession` vs. Firestore reads | **CRITICAL BLOCKER.** Mandatory for client onboarding and session bootstrap. | **Gate C Blocker** |
| **B09** | Exact callable wire envelope & error codes | **CRITICAL BLOCKER.** Engineering cannot author callables from prose descriptions. | **Gate C Blocker** |
| **B10** | Secure local purge & offline limitations | **WP-02 CONCERN.** Governs client-side Room database and outbox purge. | WP-02 Blocker (Not WP-03) |
| **B11** | Baseline ratification & Git SHA | **GOVERNANCE BLOCKER.** Canonical baseline and workflow v2.4 must be certified. | **Gate C Blocker** |

---

## 3. Verity ProofSuite Reconciliation

GAI maps all proposed R-04 scenarios into canonical Pennington Labs identifiers within the master Verity registry:

| Canonical Verity ID | Handoff Alias | Target Suite | Risk | Verity Depth & Scenario |
|---|---|---|---|---|
| **`PL-PP-WP03-14`** | `PP-R04-033` | `PS-ACCESS-ISOLATION` | Critical | **D2/D4:** One UID owns two families; cross-family read, write, and billing access is strictly denied via Firestore security rules. |
| **`PL-PP-WP03-15`** | `PP-R04-034` | `PS-BILLING-LIFECYCLE` | High | **D2/D4:** Concurrent `families.create` requests from the same UID claim only ONE trial; second creation enters unentitled/paid onboarding. |
| **`PL-PP-WP03-16`** | `PP-R04-035` | `PS-BILLING-LIFECYCLE` | Critical | **D2/D4:** Non-owner member calling `billing.verifyPurchase` or `families.close` is rejected with `OWNER_REQUIRED`; purchase token bound to 1 family. |
| **`PL-PP-WP03-17`** | `PP-R04-038` | `PS-ACCESS-ISOLATION` | Critical | **D2/D4:** `families.close` transitions family to `CLOSURE_PENDING_BILLING`; immediate rejection of all list reads and item mutations for all members. |
| **`PL-PP-WP03-18`** | `PP-R04-039` | `PS-BILLING-LIFECYCLE` | Critical | **D2/D4:** Simulated Google Play cancellation outage during closure preserves `CLOSURE_PENDING_BILLING`; retry backoff verified; 30-day clock does NOT start. |
| **`PL-PP-WP03-19`** | `PP-R04-040` | `PS-ACCESS-ISOLATION` | Critical | **D2/D4:** `families.restore` before deadline restores family for original owner only; former member tokens and pre-closure outbox mutations rejected with `STALE_EPOCH_REJECTED`. |
| **`PL-PP-WP03-20`** | `PP-R04-041` | `PS-RETENTION` | High | **D2/D4:** At $T > \text{recoverUntilAt}$, `families.restore` fails with `CLOSURE_RECOVERY_EXPIRED`; family transitions to `DELETION_PENDING`. |
| **`PL-PP-WP03-21`** | `PP-R04-042` | `PS-CORE-LIST` | High | **D1/D2:** Canonical NameKey collision handling: `Cafe` vs `Café` collide, international combining marks (Korean/Japanese) preserved. |
| **`PL-PP-WP03-22`** | `PP-R04-043` | `PS-OFFLINE-SYNC` | High | **D3/D4:** Pre-closure offline mutations submitted after family restoration fail epoch validation and never execute. |

*Execution Status:* In accordance with Workflow v2.4 §9, all ProofPoints remain strictly designated as **`NOT_RUN`**.

---

## 4. Explicit Decisions Required from Project Lead (penguinPrime)

1. **Ratification of Multi-Family Architecture (Decision 33):**  
   Formally approve amending `PRD_v1.0.md` and `ARCHITECTURE_v1.1.md` to retire the "one family per UID" constraint and adopt multi-family ownership and membership.
2. **Resolution of Single-Account Multi-Subscription Feasibility (`GAI-R04-BLK-01`):**  
   Authorize a technical spike or define product policy for how a single Google Play account purchases separate subscriptions for Family 1 and Family 2 without encountering Google Play `ITEM_ALREADY_OWNED` errors.
3. **Approval of Non-Trial Family Creation State (`GAI-R04-BLK-02`):**  
   Approve the `UNENTITLED_AWAITING_PAYMENT` lifecycle state for subsequent families created after the trial has been consumed.
4. **Resolution of Restore during Pending Cancellation (`GAI-R04-BLK-03`):**  
   Approve rejecting `families.restore` with `CLOSURE_CANCELLATION_IN_PROGRESS` while Google Play cancellation is in-flight.
5. **Approval of Server-Side `familyEpoch` Counter (`GAI-R04-BLK-04`):**  
   Approve adding an incrementing `familyEpoch` to `/families/{familyId}` and requiring it on all outbox mutation requests to authoritatively reject stale pre-closure offline replays.

---

## 5. Recommended Remediation Order

```text
Step 1: Project Lead Decisions
  └─ penguinPrime resolves Decisions 1–5 above.

Step 2: Controlled PRD & Architecture Amendments
  └─ CipherMuse updates PRD v1.0 and Architecture v1.1 from "one-family" to "multi-family",
     incorporating familyEpoch and the non-trial creation lifecycle.

Step 3: Unified Canonical API Specification
  └─ CipherMuse consolidates API v0.3 Rev 1, the P4-D10/11 addendum, and the R-04 delta into
     a single, non-contradictory API_SPEC_v0.4_CANONICAL.md.

Step 4: GAI Verification of Unified Specification
  └─ GAI reviews the unified API v0.4 contract and issues a re-check verdict.

Step 5: Scoped Gate C Authorization
  └─ penguinPrime reviews GAI's report and formally authorizes Gate C for WP-03 development.
```

---

*Report submitted by GAI (Quality Assurance Division) — October 28, 2026.*  
*Pennington Labs — Software built for the real world.*