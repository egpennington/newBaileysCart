# Bailey's Cart — Architecture v1.1 R-04 Controlled Amendment (Proposed)
**Project:** Bailey's Cart / newBaileysCart  
**Author:** CipherMuse  
**Status:** CONSOLIDATED FOR PROJECT LEAD RATIFICATION REVIEW — NOT RATIFIED  
**Authority:** Project Lead approves architecture, Gate C, merges and release.  
**Evidence:** Source files mounted for review; no Git checkout/SHA verified. No implementation, provisioning, tests, or deployment authorized. All Verity ProofPoints `NOT_RUN`.  
**Workflow:** Pennington Labs Engineering Workflow v2.4.  
**Source hierarchy:** `API_SPEC_v0.2.md`; `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (filename/header status discrepancy); `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`; `ARCHITECTURE_v1.1.md`; `newBaileysCart_PRD_v1.0_GAI_Review.md`; R-04 candidates; `GAI_R04_Contract_Reconciliation_Review_Report.md`; explicit PL Decisions 33–47. Existing source conflicts are flagged, not erased.  

## A. Data and authorization model (§2, §4, §6)
Replace universal one-family-per-UID relationship with `ownedFamilyId?` plus zero-to-many membership edges `(uid,familyId,role,state)`; server-enforced max one **nonterminal owned family**. Every family has immutable `ownerUid`, isolated `entitlementId`, `familyEpoch` integer initialized 1, lifecycle state, closure and purchase reconciliation identifiers. Active-cart selection is client-side UX and cannot grant server rights. Firestore rules deny direct domain writes and prevent cross-family reads; callable backend checks current membership, owner exceptions, lifecycle, epoch and entitlement transactionally.

## B. Local persistence (§3, §5)
Keep per-UID encrypted storage isolation; additionally **logically partition every table, index, snapshot and outbox by familyId** (or physically separate DBs; final choice requires CODI design/GAI review). No unscoped family data queries. A verified leave/removal/closure invalidates only the target family's local access; purge family items, pending overlays, outbox, family-scoped secrets and snapshots with crash-safe transactional semantics. Other families remain intact. A phone offline cannot be remotely wiped; on reconnection restrict before protected content render. No automatic backup of unprotected keys/queues. On restore, only fresh-epoch operations can queue; old epoch operations are quarantined, never mutated to new epoch.

## C. Epoch, idempotency and lifecycle (§4–§8)
`familyEpoch` read from server-authorized family session; persisted when op created. Server atomically increments it on successful owner restoration. Reject mismatch `STALE_EPOCH_REJECTED` without effects. Idempotency records bind UID, opId, command, familyId, epoch and payload hash; prior results cannot leak to revoked users. External Google Play cancellation and Firestore state **cannot be atomic**: use durable outbox/saga worker, provider correlation IDs, bounded backoff, audit, safe reentrancy and escalation. `CLOSURE_PENDING_BILLING` blocks all list reads/writes; `families.restore` rejects `CLOSURE_CANCELLATION_IN_PROGRESS`. On verified billing outcome, set server UTC 30-day deadline. Recovery restores owner only, increments epoch, and leaves billing unentitled unless independently verified.

## D. Trial and onboarding (§7)
Durable UID-level trial ledger atomically claimed on eligible family creation. No trial: create `UNENTITLED_AWAITING_PAYMENT` family reservation and correlate explicit Google Play purchase to owner/family. Provider-verified purchase activates entitlement. Suggested reservation TTL 24h **unratified**; reconcile in-flight provider results before cleanup. Verify purchase token uniqueness, product/package/account identity and Play cancellation semantics empirically. Distinct app email does not guarantee distinct Play account.

## E. Account deletion (§8)
Reintroduce `account.requestDeletion` as durable orchestration across one owned family, zero-to-many joined families, account records, billing cancellation and eventual data deletion. Do **not** implement GAI's suggested single Firestore transaction across external provider calls. Define retention and data export/erasure obligations separately; reconcile older owner deletion read-only retention against new closure no-read state.

## F. Migration / rollout
Existing single-family users migrate to one owner edge plus membership edges without duplicating entitlements or resetting trials. Use versioned protocol and `canonVersion`; unsupported clients receive side-effect-free update-required errors, preserve queues, never rewrite op identities. Require GAI migration/security review and FORGE tests after Gate C. No production migration authorized.

## G. Outstanding architecture decisions
Schema indexes and physical local partition design; ownership release/terminal state; trial ledger races; secure purge and offline-device visibility; exact callable wire; billing product and purchase identity; cancellation finality; backup/retention/deletion SLA; Unicode fixture parity; Firestore Clear All scaling. **All remain open until independently reviewed and ratified.**

---

## R-04 Decisions 46–47 — Integrated normative amendments

> **Integration notice (Decisions 46–47):** The following consolidated normative section incorporates the GAI delta-PASS addendum. Where older candidate language in this document says a 24-hour reservation TTL, waiver endpoint, or ownership release is merely proposed/open, the later D46–D47 section controls the policy and lifecycle behavior. Exact provider/transport implementation details remain open. This file is not yet ratified.

## C. Architecture v1.1 R-04 amendment insert
- Use durable, transactionally guarded reservation records and payment-attempt correlation before launching checkout; preserve a billing reconciliation tombstone/audit record after reservation expiry. Cleanup worker must be idempotent, avoid token orphaning, and prevent reuse of an unresolved purchase across families.
- Model waiver as a durable lifecycle saga with owner confirmation, provider cancellation verification, nonrecoverability marker, controlled ownership-slot release, retention tracking, and operational escalation. Never model external Google Play cancellation as atomic with Firestore state.
- Firestore rules and callable authorization deny cart access in all closure states, regardless of pending waiver or delayed billing. Partition caches/outboxes by family and enforce purge/quarantine on revoked/closed access.
