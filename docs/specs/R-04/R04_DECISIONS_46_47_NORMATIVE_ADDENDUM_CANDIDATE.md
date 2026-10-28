# Bailey's Cart — R-04 Decisions 46–47 Normative Addendum (Candidate)

**Date:** 2026-10-27 (decision record; GAI report supplied is dated 2026-10-28)  
**Authority:** Project Lead approval of policy only  
**Status:** PROPOSED CONTRACT TEXT — NOT YET RATIFIED OR GAI-RECHECKED  
**Scope:** Proposed deltas to API v0.4, PRD v1.0 R-04 amendment, Architecture v1.1 R-04 amendment, Authorization/Error Matrix v0.3, and Verity handoff v0.2.  
**Governance:** WP-03 HOLD; Gate C CLOSED. No code, tests, merge, or deployment authorized.

## Decision record
- **R-04 D46 (approved):** `UNENTITLED_AWAITING_PAYMENT` reservation expires 24 hours after server-authoritative reservation creation, with durable, safe late-payment reconciliation.
- **R-04 D47 (approved):** Original owner may explicitly and irreversibly waive the default 30-day recovery window, subject to safe cancellation/billing reconciliation and deletion/retention safeguards.

## A. Exact proposed API v0.4 deltas

### A1. Reservation timestamps and ownership
- `reservationCreatedAt`: server-generated immutable timestamp at successful `families.create` commit.
- `reservationExpiresAt = reservationCreatedAt + 24 hours` using server time. Idempotent replays return the original timestamps and family ID; retries MUST NOT extend the TTL.
- An unexpired reservation counts as the UID's one owned family. Expiry MUST prevent new checkout attempts and unverified activation, but MUST NOT destroy evidence of an in-flight purchase or unilaterally release ownership while settlement is unresolved.
- `billing.verifyPurchase` MUST independently verify purchase state and enforce a unique server-side binding of purchase token to `(ownerUid, familyId, productId)` and purchaser constraints supported by provider evidence. Duplicate callbacks/retries are idempotent.
- At or after expiry, an unsettled or unknown purchase enters a **reconciliation hold** (candidate internal designation `RESERVATION_RECONCILIATION_PENDING`), not an automatic deletion. A verified late payment MUST be reconciled to the original reservation or remediated via a documented refund/support path; MUST NOT silently attach to a different family or grant entitlement without authorization. Whether late settlement can activate the original reservation is **technical design pending**, not presumed.
- Only a provider-confirmed no-purchase/no-liability result (or completed remediation) permits final reservation cleanup and release of ownership. Durable billing audit records survive cleanup subject to approved retention rules.
- **Proposed domain errors** (not ratified wire codes): `RESERVATION_EXPIRED`, `PURCHASE_RECONCILIATION_PENDING`. Provider mapping, final expiry cleanup timing, and remediation SLA remain open W-05/G-01.

### A2. Irreversible recovery waiver
- Add candidate authenticated callable **`families.waiveRecovery`** with `{apiVersion, opId, familyId, familyEpoch, confirmationToken}`. Original owner only, online, recent-auth/strong confirmation per security design. This is a **new candidate endpoint name**, not an already approved deployed API.
- UI MUST explicitly disclose: loss of the right to restore this family, loss of previous member access, inability to recover grocery data after deletion, and that payment cancellation and legally required retention are separate processes. Require a fresh, family-bound, short-lived confirmation; no preselected confirmation or offline queue.
- **If `CLOSURE_PENDING_BILLING`:** record a durable owner waiver intent only after confirmation, without releasing ownership or advancing to deletion until billing cancellation is verified. Return a privacy-safe pending disposition. `families.restore` continues to reject `CLOSURE_CANCELLATION_IN_PROGRESS` while cancellation is unresolved. If waiver has been accepted, subsequent restoration is prohibited even after reconciliation.
- **If `CLOSING` and cancellation verified:** atomically mark recovery irrevocably waived and transition to `DELETION_PENDING` (or equivalent terminal nonrecoverable state). All reads/writes remain denied; no membership, billing, or offline operations revive. No 30-day recovery deadline applies once waived.
- Waiver MUST NOT claim immediate physical erasure, cancellation of already incurred charges, or deletion of mandatory audit/retention records. Retention and deletion proceed via a durable auditable saga.
- **Ownership slot release:** only after a server-committed, durable, nonrecoverable ownership-release milestone AND billing liabilities are reconciled. Exact milestone and invariant for `DELETION_PENDING` require G-01/G-03 resolution; **do not** equate state name alone with release.
- Repeated identical `opId` is idempotent; changed request with same `opId` rejects. Replayed pre-waiver operations must be denied without side effects. Waiver does not reset trial history.
- **Proposed domain errors:** `RECOVERY_ALREADY_WAIVED`, `CLOSURE_NOT_ELIGIBLE_FOR_WAIVER`, `BILLING_RECONCILIATION_PENDING`. Final error names/precedence are subject to API wire review.

### A3. Lifecycle and safety invariants
- Default path remains `CLOSURE_PENDING_BILLING` -> provider-verified `CLOSING` -> 30-day recovery window -> `DELETION_PENDING`.
- Waiver path is `CLOSURE_PENDING_BILLING` (durable waiver intent, no ownership release) -> provider-verified cancellation -> irrevocable `DELETION_PENDING`, OR `CLOSING` -> confirmed waiver -> `DELETION_PENDING`.
- Every family mutation includes captured `familyEpoch`; no epoch rewriting. A waiver is lifecycle-sensitive and must validate epoch and owner identity transactionally. `familyEpoch` advances on **restore** only, per D43; waiver does not imply restoration or epoch increment.
- The server must distinguish `waiverRequestedAt`, `waiverCommittedAt`, `billingCancellationVerifiedAt`, `ownershipReleasedAt`, and `deletionCompletedAt` where applicable. Do not infer one event from another.

## B. PRD v1.0 R-04 amendment insert
- Owners without trial eligibility can reserve one family for 24 hours before explicitly authorizing payment. Expired unpaid reservations do not become usable carts. Payment pending at expiry is safely reconciled, with clear status/support; no lost or duplicate charges by design.
- Family closure defaults to 30 days of recovery after verified cancellation. Owner may choose a separate, explicitly confirmed irreversible waiver of recovery; this does not bypass payment reconciliation or retention obligations.
- UI must distinguish **reservation expired**, **purchase reconciliation pending**, **closure cancellation pending**, **recovery available**, **recovery waived**, and **deletion processing** without promising immediate erasure.

## C. Architecture v1.1 R-04 amendment insert
- Use durable, transactionally guarded reservation records and payment-attempt correlation before launching checkout; preserve a billing reconciliation tombstone/audit record after reservation expiry. Cleanup worker must be idempotent, avoid token orphaning, and prevent reuse of an unresolved purchase across families.
- Model waiver as a durable lifecycle saga with owner confirmation, provider cancellation verification, nonrecoverability marker, controlled ownership-slot release, retention tracking, and operational escalation. Never model external Google Play cancellation as atomic with Firestore state.
- Firestore rules and callable authorization deny cart access in all closure states, regardless of pending waiver or delayed billing. Partition caches/outboxes by family and enforce purge/quarantine on revoked/closed access.

## D. Authorization/error matrix v0.3 additions
| Operation/scenario | Actor | State | Expected disposition | Side effects |
|---|---|---|---|---|
| `families.create` idempotent retry | Verified owner | Unexpired reservation | Same `familyId` and original expiry | No extension or duplicate |
| Start checkout | Owner | Expired reservation | `RESERVATION_EXPIRED` (candidate) | No new purchase attempt |
| Purchase settles after expiry | Original owner | Reconciliation hold | Pending reconciliation / provider-authoritative resolution | No orphaned token or cross-family activation |
| `families.waiveRecovery` | Non-owner | Any | `OWNER_REQUIRED` | None |
| `families.waiveRecovery` | Owner | `ACTIVE` | `CLOSURE_NOT_ELIGIBLE_FOR_WAIVER` (candidate) | None |
| `families.waiveRecovery` | Owner | `CLOSURE_PENDING_BILLING` | Durable waiver intent; pending cancellation | No early ownership release or recovery |
| `families.waiveRecovery` | Owner | `CLOSING` | Irreversible nonrecoverable transition | No cart or billing reactivation |
| `families.restore` | Owner | Waiver accepted | `RECOVERY_ALREADY_WAIVED` (candidate), except pending-cancellation precedence remains `CLOSURE_CANCELLATION_IN_PROGRESS` | None |
| `families.waiveRecovery` | Owner | Stale epoch | `STALE_EPOCH_REJECTED` | None |
| New `families.create` after waiver | Same UID | Billing unresolved or ownership not released | `OWNER_ALREADY_HAS_FAMILY` | None |

## E. Verity additions (IDs provisional until master registry checked)
- **`PL-PP-WP03-25`** — D1/D2/D4: 24-hour server-time boundary, idempotent retry retains expiry, concurrent create cannot bypass owner claim.
- **`PL-PP-WP03-26`** — D2/D4: purchase pending at hour 24, settled at hour 26; no token orphan, double charge, cross-family binding or unverified entitlement.
- **`PL-PP-WP03-27`** — D1/D2/D4: waiver requires original owner, current epoch, online fresh confirmation, and rejects replay or tampering.
- **`PL-PP-WP03-28`** — D2/D4: waiver during pending cancellation does not release owner slot; verified cancellation leads to irrevocable nonrecoverable state.
- **`PL-PP-WP03-29`** — D2/D3/D4: waiver in CLOSING blocks restore and old outbox, respects local purge, and preserves billing/retention records.
- **`PL-PP-WP03-30`** — D2/D4: owner may create another family only after durable ownership-release milestone; trial remains consumed.
- All ProofPoints **NOT_RUN**. D3 device/E2E where relevant after authorized client integration. GAI must validate registry collisions and four-deep coverage.

## F. Explicit unresolved technical dependencies
1. Google Play purchaser identity and product subscription constraints, verified cancellation semantics, pending-purchase and refund flows (W-05).
2. Reservation reconciliation/cleanup timing, durable payment correlation, ownership-release milestone and deletion retention SLA (G-01/G-03).
3. Exact Firebase callable wire/errors and confirmation-token implementation (W-01/W-02).
4. Prior GAI conditional pass **does not cover this addendum**; request a focused GAI delta recheck before ratification.

**Document completeness:** Candidate delta specified; no evidence of repository integration or execution. **Gate C remains CLOSED.**
