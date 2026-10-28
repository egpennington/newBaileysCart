# Bailey's Cart — R-04 Authorization & Error Matrix v0.4
**Project:** Bailey's Cart / newBaileysCart  
**Author:** CipherMuse  
**Status:** CONSOLIDATED FOR PROJECT LEAD RATIFICATION REVIEW — NOT RATIFIED  
**Authority:** Project Lead approves architecture, Gate C, merges and release.  
**Evidence:** Source files mounted for review; no Git checkout/SHA verified. No implementation, provisioning, tests, or deployment authorized. All Verity ProofPoints `NOT_RUN`.  
**Workflow:** Pennington Labs Engineering Workflow v2.4.  
**Source hierarchy:** `API_SPEC_v0.2.md`; `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (filename/header status discrepancy); `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`; `ARCHITECTURE_v1.1.md`; `newBaileysCart_PRD_v1.0_GAI_Review.md`; R-04 candidates; `GAI_R04_Contract_Reconciliation_Review_Report.md`; explicit PL Decisions 33–47. Existing source conflicts are flagged, not erased.  

**Error labels are candidate domain codes, not verified Firebase callable status mappings.** Authentication, current authorization, lifecycle, epoch, entitlement and idempotency checks must avoid protected-data leakage; exact precedence for historical opId replay OPEN.

| Operation / condition | Actor / state | Outcome or candidate code | Side effects / retry |
|---|---|---|---|
| `families.create` eligible first owner | Verified UID, no nonterminal owned family | Trial family created, 21-day server timestamps | Atomic trial claim; same opId same result |
| `families.create` trial used | Verified UID, no owned family | `UNENTITLED_AWAITING_PAYMENT`, familyId reserved | No cart access or automatic charge; safe retry |
| `families.create` already owns/reserves | UID owns nonterminal family | `OWNER_ALREADY_HAS_FAMILY` | None; does not prevent other memberships |
| `families.create` unverified | Unverified UID | `EMAIL_VERIFICATION_REQUIRED` | No family or trial claim |
| `account.getSession` | Authenticated UID | Owned family + joined families only | No foreign billing or family data |
| `invites.accept` valid | Verified invited UID, even if member elsewhere | Fresh membership | Atomic consume; no trial impact |
| `invites.accept` unverified | Unverified UID | `EMAIL_VERIFICATION_REQUIRED` | Invite remains intact |
| `invites.accept` closing family | Pending/closing/deletion family | `FAMILY_CLOSING` or `INVITE_INVALID` (mapping OPEN) | No membership |
| `invites.accept` expired/consumed | Invalid invite | `INVITE_EXPIRED` / `INVITE_CONSUMED` | No membership; no existence leak |
| `invites.create/revoke` | Current owner, ACTIVE, epoch matches | Success | Old invites never revived after restore |
| `members.leave` | Current non-owner member | Success | Remove only target family; purge on device detection |
| `members.leave` | Owner | `OWNER_CANNOT_LEAVE` | None |
| `members.leave` | Closing/pending family | `FAMILY_CLOSING` | None; membership already inaccessible |
| `members.remove` | Owner, current epoch | Revocation | Immediate server denial; local purge on detection |
| `members.remove` | Non-owner | `OWNER_REQUIRED` | None |
| `billing.verifyPurchase` | Owner, unentitled reservation, valid verified token | Activate family entitlement | Token bound once to UID/family; idempotent |
| `billing.verifyPurchase` | Non-owner | `OWNER_REQUIRED` | None; no token details |
| `billing.verifyPurchase` | Pending/closing/deletion family | `FAMILY_CLOSING` | No entitlement grant; provider outcome must still be reconciled |
| `billing.verifyPurchase` | Provider pending/invalid token | `PURCHASE_NOT_VERIFIED` | No entitlement; reconciliation as needed |
| `billing.verifyPurchase` | Token already bound elsewhere | `PURCHASE_ALREADY_BOUND` | No entitlement; audit |
| `billing.getStatus` | Current active member | Minimal access mode | Owner alone gets billing controls |
| `items.*` | Current member, ACTIVE, writable, epoch matches | Existing item semantics | Server transaction and dedup |
| `items.*` | Expired subscription | `ENTITLEMENT_READ_ONLY` | Preserve pending ops for eligible future replay |
| `items.*` | Stale epoch after restore | `STALE_EPOCH_REJECTED` | None; quarantine, no auto retarget |
| `items.*` | Revoked member | `MEMBERSHIP_REVOKED` / privacy-safe `FORBIDDEN` | None; no replay or cached success disclosure |
| Family list read | Current member, ACTIVE, expired entitlement | Read-only data | No mutations |
| Family list read | Any actor, pending/closing/deletion | `FAMILY_CLOSURE_PENDING` / `FAMILY_CLOSING` | No list data, including owner |
| `families.close` | Original owner, ACTIVE, confirmed, online | `CLOSURE_PENDING_BILLING` | Immediate access restriction; durable cancellation saga |
| `families.close` duplicate same op | Original owner | Existing pending/completed result | No duplicate provider cancellation |
| `families.close` same opId changed payload | Authenticated UID | `IDEMPOTENCY_KEY_REUSED` | None |
| `families.getClosureStatus` | Original owner, closure state | Sanitized status/deadline | No raw billing details |
| Billing cancellation uncertain | Pending state | Pending status / `BILLING_PROVIDER_UNAVAILABLE` | Durable retries; no recovery clock |
| Billing cancellation confirmed | Pending state | `CLOSING`, 30-day UTC deadline | Server-authoritative transition |
| `families.restore` | Owner, pending cancellation | `CLOSURE_CANCELLATION_IN_PROGRESS` | No state/epoch/billing change |
| `families.restore` | Owner, CLOSING before deadline | Owner-only restore | Atomic epoch increment; no member/billing/old queue revival |
| `families.restore` | Former member | `FORBIDDEN` | None |
| `families.restore` | Owner, deadline passed/deletion pending | `CLOSURE_RECOVERY_EXPIRED` | None |
| `account.requestDeletion` | Verified account owner | Durable deletion request/saga | Joins/leaves and billing reconcile; retention OPEN |
| `items.add` canonical duplicate | Current authorized member | Satisfied without second item | Dependent operations do not retarget |
| `items.edit` rename collision | Current authorized member | `DUPLICATE_NAME_EXISTS` | Both original items preserved |
| `items.edit` after delete | Current authorized member | `ITEM_NOT_FOUND` | No resurrection |
| `items.clearConfirmed` stale confirmation | Current authorized member | `CONFIRMATION_EXPIRED` or skipped versions | No deletion of new/changed items |
| Unsupported API/canon version | Any mutation | `API_VERSION_UNSUPPORTED` / `CANON_VERSION_UNSUPPORTED` | None; queue retained for upgrade |
| Offline op >=21 days or age uncertain | Client | Local `REVIEW_REQUIRED` | No automatic replay |
| Network outage | Authorized status unknown | Transport `UNAVAILABLE` | Retry identical opId/payload with jitter; not revocation |

**Outstanding:** Firebase transport codes, `OWNER_ALREADY_HAS_FAMILY` naming, invite privacy/error precedence, owner claim release, pending purchase expiry, epoch/idempotency order, closure retention, account deletion and provider verification. No executable tests run.

---

## R-04 Decisions 46–47 — Integrated normative amendments

> **Integration notice (Decisions 46–47):** The following consolidated normative section incorporates the GAI delta-PASS addendum. Where older candidate language in this document says a 24-hour reservation TTL, waiver endpoint, or ownership release is merely proposed/open, the later D46–D47 section controls the policy and lifecycle behavior. Exact provider/transport implementation details remain open. This file is not yet ratified.

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

### Additional validation dimensions
- Authentication/owner authorization, immutable operation identity, current epoch, lifecycle state, and provider verification must be evaluated transactionally without leaking cross-family information. Final ordering and Firebase callable transport mappings are open W-01/W-02.
- Waiver accepted during cancellation pending must deny restore; the externally visible code follows D44 pending-cancellation precedence until cancellation is verified.
- All ten rows above are specification expectations, **not executed tests**.
