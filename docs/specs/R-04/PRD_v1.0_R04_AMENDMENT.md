# Bailey's Cart — PRD v1.0 R-04 Controlled Amendment (Proposed)
**Project:** Bailey's Cart / newBaileysCart  
**Author:** CipherMuse  
**Status:** CONSOLIDATED FOR PROJECT LEAD RATIFICATION REVIEW — NOT RATIFIED  
**Authority:** Project Lead approves architecture, Gate C, merges and release.  
**Evidence:** Source files mounted for review; no Git checkout/SHA verified. No implementation, provisioning, tests, or deployment authorized. All Verity ProofPoints `NOT_RUN`.  
**Workflow:** Pennington Labs Engineering Workflow v2.4.  
**Source hierarchy:** `API_SPEC_v0.2.md`; `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (filename/header status discrepancy); `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`; `ARCHITECTURE_v1.1.md`; `newBaileysCart_PRD_v1.0_GAI_Review.md`; R-04 candidates; `GAI_R04_Contract_Reconciliation_Review_Report.md`; explicit PL Decisions 33–47. Existing source conflicts are flagged, not erased.  

## Amendment scope
Source: `newBaileysCart_PRD_v1.0_GAI_Review.md` §3, §4, §5, §7. **Do not overwrite baseline**. Supersede only conflicting one-family membership and ownership language after PL ratification.

### §3 Accounts, ownership, invitations — replacement candidate
- A verified UID may own **one** family at a time (including reserved and recoverable closure states), may belong to multiple additional families through explicit invitations, and selects one active cart at a time. Ownership and membership are independent. No owner transfer in v1.
- One owner is responsible for each family's subscription. An invited member may not pay for that family in v1. Another owner account is needed for another owned family; a different app email does not by itself prove different Google Play purchaser identity.
- Verified email required for `families.create` and `invites.accept`; an unverified invite remains unconsumed. Invitation acceptance is single-use and race-safe. Revocation supersedes entitlement; removed member's Bailey's Cart account survives and may still own/join other families.
- A current owner may leave other families as member but may not leave their owned family without separately approved closure.

### §4 Offline-first — additional acceptance criteria
- Queue, local snapshot, selected family, encryption and purge are isolated per `(uid,familyId)`; no cross-family replay or display.
- All family mutations capture immutable server `familyEpoch`; restoration increments epoch; stale operations never replay or retarget. Sign-out protects pending queue without exposing it; revocation blocks access when detected. Remote offline device cannot be erased until it reconnects.

### §5 Subscription/data lifecycle — replacement candidate
- One eligible 21-day introductory trial per verified UID, consumed at successful eligible family-creation commit. Joining other families does not consume it; family deletion/closure does not reset it. Trial eligibility is account-scoped, entitlement family-scoped.
- If no trial is available, create an unentitled reserved family before explicitly authorized purchase; only verified purchase grants cart use. Reservation expiry and purchase reconciliation must prevent orphaned charges.
- Expiration preserves family list for authorized members in read-only mode; only owner gets renewal controls, members get neutral notice, no payment details.
- Owner may explicitly close family separately from subscription cancellation; access stops immediately; billing cancellation reconciliation may be pending. Upon verified billing resolution, 30-day recoverable closure begins. Restore original owner and retained grocery data only, requiring fresh invitations; no automatic subscription or queued-op restart. After deadline deletion processing begins subject to approved retention.
- Account deletion across owned and joined families requires a durable workflow; do not assume it equals closing one family or immediate deletion of provider billing records.

### §7 Acceptance criteria additions
- One owner account cannot create a second owned family while first is nonterminal; may accept invitations to other families.
- Two family carts remain isolated under membership, billing, storage, and offline replay.
- Verified purchase and cancellation outcome cannot be fabricated by client.
- Closure and recovery enforce membership, deadline, billing-pending and epoch invariants.
- Privacy-preserving family-specific purge, including lost access on revocation.

## Explicit unresolved product decisions
Ownership claim release timing, precise deletion/backup retention, 24-hour reservation TTL, abandoned purchase remediation, account-deletion retention conflicts, max list size, and account-level trial anti-abuse. **GAI review required; no automatic acceptance of proposed defaults.**

---

## R-04 Decisions 46–47 — Integrated normative amendments

> **Integration notice (Decisions 46–47):** The following consolidated normative section incorporates the GAI delta-PASS addendum. Where older candidate language in this document says a 24-hour reservation TTL, waiver endpoint, or ownership release is merely proposed/open, the later D46–D47 section controls the policy and lifecycle behavior. Exact provider/transport implementation details remain open. This file is not yet ratified.

## B. PRD v1.0 R-04 amendment insert
- Owners without trial eligibility can reserve one family for 24 hours before explicitly authorizing payment. Expired unpaid reservations do not become usable carts. Payment pending at expiry is safely reconciled, with clear status/support; no lost or duplicate charges by design.
- Family closure defaults to 30 days of recovery after verified cancellation. Owner may choose a separate, explicitly confirmed irreversible waiver of recovery; this does not bypass payment reconciliation or retention obligations.
- UI must distinguish **reservation expired**, **purchase reconciliation pending**, **closure cancellation pending**, **recovery available**, **recovery waived**, and **deletion processing** without promising immediate erasure.
