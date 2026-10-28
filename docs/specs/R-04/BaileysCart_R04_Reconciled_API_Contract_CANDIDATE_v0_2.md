# Bailey's Cart — R-04 Reconciled API Contract
**Candidate v0.2 | 2026-10-27 | CipherMuse | DOCUMENT-ONLY / NOT RATIFIED**

**Gate:** WP-03 implementation HOLD. GAI independent review NOT_RUN; FORGE tests/builds NOT_RUN; no repo commit or deployment evidenced. This file is a proposed consolidated delta, not a replacement for the complete API v0.2 baseline until PL ratification.

## 1. Source precedence and scope
- Base: `API_SPEC_v0.2.md`; later delta: `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (its internal header says proposed despite filename); `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`; R-04 draft/matrix; Architecture v1.1; Pennington Labs workflow v2.3 and available v2.4.
- **Explicit later PL decisions supersede contradictory older clauses**. Decisions 33–41 are approved in conversation, not yet committed to canonical Git history. Do not silently treat all earlier draft TBDs as ratified.
- Existing API item, invite, billing and undo operations remain candidates unless changed below. Exact Firebase callable envelope, field sizes, limits, SDK status mapping and Play cancellation behavior require verification.

## 2. Approved policy invariants — Decisions 33–41
| Decision | Normative policy for reconciliation |
|---|---|
| 33 | One verified UID may own multiple families and be member of multiple families; each has immutable distinct familyId, isolated list, membership, entitlement, subscription; one active UI cart at a time; no second email required. |
| 34 | One introductory 21-day trial per eligible verified account across its created families. First eligible `families.create` successful server commit starts it; joining another family does not consume eligibility. Deletion, renaming, membership removal and family creation cannot reset account trial history. No automatic new trial on later families. |
| 35 | v1 family owner alone is responsible for that family's subscription; non-owner payer/ownership transfer unsupported. Each family requires separate entitlement; payment tokens cannot cross families. |
| 36 | On expiration, current authorized members may read but cannot mutate; owner sees renewal controls; members see neutral read-only notice with no billing details; other families unaffected; revoked members have zero access. |
| 37 | Ownership transfer unsupported in v1. Original creator remains owner; replacement owner creates separate family/subscription; no automatic cart or entitlement transfer. |
| 38 | Owner may explicitly initiate online, authenticated, confirmed family closure, distinct from subscription cancellation. Details governed by Decisions 39–41. |
| 39 | Owner-confirmed closure immediately restricts family access and sync. Once closure is finalized, original owner has 30 days to recover. After deadline recovery is denied and deletion processing begins subject to retention obligations. No automatic billing/membership/old queue reactivation. |
| 40 | Recovery restores family and retained grocery data **for original owner only**; former non-owner memberships stay revoked; fresh invitations required; no pre-closure queue replay. |
| 41 | If provider cancellation cannot be confirmed, durable `CLOSURE_PENDING_BILLING` immediately restricts access; reconcile/retry cancellation safely; do not claim finalized closure or start 30-day clock until billing safeguards verified. Unexpected charges must surface for resolution. |

## 3. Core data model — logical requirements, not physical schema approval
- `/users/{uid}` or secured account projection: immutable UID; durable `introTrialConsumedAt`/trial claim record, ownedFamilyIds and membership references (projection only, not authorization source). Eligibility must be enforced atomically with eligible family creation; a concurrent create across devices cannot grant two trials. Never infer eligibility solely from email string or a client claim.
- `/families/{familyId}`: immutable ownerUid, server creation time, lifecycleState, closureRequestId, closureConfirmedAt?, recoverUntilAt?, entitlement reference, isolated membership and grocery records. `ownerUid` immutable for v1.
- Family-scoped subscription binding: provider purchase token uniquely associated with **one** family and its owner; do not grant cross-family access. A single UID may have several independent subscriptions.
- Family lifecycle: `ACTIVE` → `CLOSURE_PENDING_BILLING` → `CLOSING` → `DELETION_PENDING` → deletion processing. `CLOSING` → `ACTIVE` by authenticated owner recovery within deadline; recovered membership set contains only owner. Repeated close/recover calls require idempotent, safe status responses.
- Closure request and provider cancellation are **not one atomic transaction**. Persist request before external side effect; track attempt/provider correlation, reconciliation state, retry schedule and audit without exposing purchase data to members. Cancellation failure/unknown outcome must not be represented as success.
- Data retained in `CLOSING` must be inaccessible to members; recovery cannot restore previously revoked member authorization. Define secure snapshots and deletion worker separately.

## 4. API operations — proposed candidate signatures
All protected mutations require authenticated UID, supported `apiVersion`, immutable UUID/high-entropy `opId`, and server-side idempotency binding `(actorUid, opId, command, canonical payload hash)`; familyId is immutable in the operation. Client does not set owner, entitlement, timestamps or provider state. **Field names and response bodies below are candidate wire designs, not deployed SDK contracts.**

| Operation | Candidate request fields | Server authorization / success contract |
|---|---|---|
| `families.create` | `{apiVersion,opId,displayName?}` | Verified email; UID may already own/join families. Allocate unique familyId and immutable owner; atomically determine/consume trial eligibility if eligible. Subsequent family created without trial must have a permitted subscription onboarding path; **payment-before-create ordering unresolved**. Retry returns same familyId and original trial timestamps. |
| `account.getSession` | `{apiVersion}` | Authenticated, privacy-scoped projection of all currently authorized family IDs, roles, accessMode, selected family candidate and account-level trial eligibility; never leak member billing details. **Endpoint vs Firestore projection undecided**. |
| `billing.verifyPurchase` | `{apiVersion,opId,familyId,purchaseToken,productId}` | Owner only; verify provider-authoritative purchase and unique token-to-family binding; no entitlement from client callback alone. |
| `billing.getStatus` | `{apiVersion,familyId}` | Active member receives minimal accessMode; owner alone gets renewal/management action metadata. Revoked users denied before status projection. |
| `families.close` | `{apiVersion,opId,familyId,confirmationToken}` | Original owner, online and explicit confirmation; durably restrict access and create billing cancellation task. Return `CLOSURE_PENDING_BILLING` until provider reconciliation is confirmed; then server sets `closureConfirmedAt`, `recoverUntilAt=+30 days` and `CLOSING`. Confirmation-token UX/TTL TBD. |
| `families.getClosureStatus` | `{apiVersion,familyId}` | Original owner only; return pending/cancel-confirmed/recoverable/deletion status and safe remediation instructions; no sensitive provider details. |
| `families.restore` | `{apiVersion,opId,familyId}` | Original owner, online, only `CLOSING` before server-authoritative `recoverUntilAt`; atomically restore family for owner only, invalidate old invites and pre-closure replay epochs; entitlement independently checked; no billing reactivation. |
| `invites.create` | `{apiVersion,opId,familyId}` | Owner only, family `ACTIVE`, verified authorization and applicable entitlement policy; new invitation after recovery, no old invite reuse. |
| `invites.accept` | `{apiVersion,opId,code}` | Verified email; intended-account binding and atomic invitation consumption; membership in other families permitted; replay cannot reauthorize a later-removed member. |
| `members.remove` | `{apiVersion,opId,familyId,memberUid}` | Owner only, cannot remove owner; revocation overrides all entitlement states and queued operations. |
| `members.leave` | `{apiVersion,opId,familyId}` | Non-owner active member only; leaving one family does not affect other memberships. |
| `items.*` | `{apiVersion,opId,familyId,...}` | Current membership + family ACTIVE + writable entitlement for mutations; no cross-family op redirect; no stale edit resurrection. |

**Owner recovery access exception:** during `CLOSING` or `CLOSURE_PENDING_BILLING`, family data reads/mutations remain denied to everyone including owner; only narrowly scoped owner closure-status and eligible restore operations are allowed. In `DELETION_PENDING`, recovery is denied.

## 5. Cross-cutting existing API reconciliation
- `families.create` and `invites.accept`: REMOVE old “caller has no existing family” / “one-family-per-UID” preconditions. Preserve family capacity (if still approved), verified email and invitation identity constraints.
- `items.add`: client UUID v4 itemId, server atomic claim; canonical duplicate add satisfied without second item. A dependent edit/delete may not silently target another item when add collided; stop or quarantine dependents until explicit reconciliation.
- `items.edit`: last server-accepted transaction wins ordinary edit fields; `expectedVersion` alone cannot reject. Rename collision with *another* active item rejected. Delete/clear guards still enforce their versions/snapshots.
- Name uniqueness: server authoritative, `k_` + unpadded Base64URL(UTF-8 canonicalKey), canonVersion; Cafe/Café equivalent while meaningful international combining marks preserved. Unicode table/version/fixtures **OPEN**.
- Offline: per-account/family isolated durable queue, one in-flight ordered op, <21 days eligible auto replay, >=21 days or unreliable age quarantine, dedup >=30 days from terminal plus safety margin, identical retry on ambiguous result. Closure epoch invalidates pre-closure replay regardless of age.
- Firestore domain writes denied from client; secure memory-only Firestore cache and app-owned durable encrypted local snapshot/queue. Confirm SDK implementation and secure erase design.
- Clear List: online fresh confirmation, snapshot/version guards, concurrent additions preserved; exact chunk/TTL and partial behavior **OPEN**.

## 6. Authorization evaluation and disclosure safety
1. Verify caller identity and supported protocol without leaking family existence.
2. For family operations, enforce current membership/role and lifecycle, except narrow original-owner closure/recovery status APIs.
3. Revocation overrides paid, trial, grace, and read-only entitlements. No protected result leakage from old idempotency records after revocation.
4. Check entitlement for active-family mutations; expired family retains authorized read-only access, not writes.
5. Enforce transactional uniqueness, invite consumption, item guards, and opId replay; ambiguous transport is not proof of revocation.
6. All family IDs, purchase tokens, local storage partitions and offline op IDs stay bound to original family and account.

## 7. Error and status taxonomy (candidate; SDK mapping not yet verified)
`UNAUTHENTICATED`, `EMAIL_VERIFICATION_REQUIRED`, `FORBIDDEN`/`MEMBERSHIP_REVOKED` (privacy-safe selection TBD), `API_VERSION_UNSUPPORTED`, `CANON_VERSION_UNSUPPORTED`, `ENTITLEMENT_READ_ONLY`, `OWNER_REQUIRED`, `FAMILY_CLOSURE_PENDING`, `FAMILY_CLOSING`, `FAMILY_DELETION_PENDING`, `CLOSURE_BILLING_UNCONFIRMED`, `CLOSURE_RECOVERY_EXPIRED`, `INVITE_INVALID`, `DUPLICATE_NAME_EXISTS`, `ITEM_NOT_FOUND`, `IDEMPOTENCY_KEY_REUSED`, `BILLING_PROVIDER_UNAVAILABLE`, `REVIEW_REQUIRED` (local), `UNAVAILABLE` (transport). Exact transport/domain mapping is an implementation blocker. Billing outage is retryable, not a reason to lift closure restrictions.

## 8. Explicit unresolved blockers — do not invent defaults
| ID | Open contract detail | Proposed owner / gate |
|---|---|---|
| B01 | How to create additional family before its paid purchase exists; Play subscription/product binding and account ownership rules; subscription transfer prohibited | CipherMuse + PL billing policy, GAI review |
| B02 | Play cancellation API and verification semantics; pending-cancellation SLA, duplicate-safe reconciliation, escalation/charge remediation | CODI technical spike + GAI independent review, PL scope |
| B03 | Exact closure data retention/deletion SLA, backup retention, compliance record separation, deletion failure remediation | PL privacy decision + CODI design + GAI |
| B04 | Recovery while cancellation is still pending: deny restore until finalized, or permit safe cancellation of closure request? **Not decided** | PL policy |
| B05 | 30-day boundary UTC timestamp arithmetic, status visibility and failure behavior after deadline | CipherMuse schema + GAI |
| B06 | Atomic trial ledger schema, eligibility criteria and multi-account abuse protections | PL/privacy + GAI |
| B07 | Unicode normative algorithm/version and fixture parity; exact NameKey migration | CipherMuse/CODI proposal + GAI |
| B08 | `account.getSession` projection versus Firestore reads; rules and bootstrap isolation | CipherMuse + GAI |
| B09 | Exact callable envelope, errors, limits, confirmation tokens, invite policy and clear concurrency | CODI contract spike + GAI |
| B10 | Secure local purge on revocation/closure and offline device limitations | CODI security design + GAI |
| B11 | Source/header ratification discrepancies, Git baseline SHA, and workflow v2.4 applicability | PL + repo verification |

## 9. Gate and handoff
- **CipherMuse → GAI:** review candidate contract and companion matrix, issue severity-ranked findings and Verity coverage critique. Do not mark PASS from document existence.
- **GAI → CipherMuse/PL:** resolve blocking contract ambiguities and report evidence. **PL** separately ratifies final canonical API and authorizes scoped WP-03 Gate C.
- **CODI:** no implementation until Gate C. After authorization certify repo/branch/SHA and implement within scope; author executable ProofPoints.
- **FORGE:** configured checks and recorded artifacts only after authorized implementation. **GAI:** independent challenge. **PL:** merge/release/production decisions.

**Document completeness:** candidate draft; open blockers intentionally visible. **Verity: NOT_RUN.**
