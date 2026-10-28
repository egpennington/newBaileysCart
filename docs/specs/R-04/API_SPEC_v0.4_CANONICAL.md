# Bailey's Cart — Unified API v0.4 Canonical Candidate
**Project:** Bailey's Cart / newBaileysCart  
**Author:** CipherMuse  
**Status:** CONSOLIDATED FOR PROJECT LEAD RATIFICATION REVIEW — NOT RATIFIED  
**Authority:** Project Lead approves architecture, Gate C, merges and release.  
**Evidence:** Source files mounted for review; no Git checkout/SHA verified. No implementation, provisioning, tests, or deployment authorized. All Verity ProofPoints `NOT_RUN`.  
**Workflow:** Pennington Labs Engineering Workflow v2.4.  
**Source hierarchy:** `API_SPEC_v0.2.md`; `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (filename/header status discrepancy); `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`; `ARCHITECTURE_v1.1.md`; `newBaileysCart_PRD_v1.0_GAI_Review.md`; R-04 candidates; `GAI_R04_Contract_Reconciliation_Review_Report.md`; explicit PL Decisions 33–47. Existing source conflicts are flagged, not erased.  

## 1. Ratification and precedence
This is a **consolidation candidate**, not an approved replacement for ratified API v0.2/v0.3. PL Decision 42 **supersedes Decision 33 only on multi-family ownership**: one verified UID may own **at most one nonterminal family**, while joining multiple other families by invitation. Decisions 34–41 and 43–45 remain applicable. Older `ALREADY_IN_FAMILY` checks on *membership* must be removed; an owner-limit check replaces them for `families.create`. P4-D10/D11 require verified email for family creation/invite acceptance and server-commit start of eligible 21-day trial. This candidate does not authorize changes to governing PRD/Architecture until ratified.

## 2. Core invariants
1. `ownerUid` immutable for v1; one owner per family; UID owns at most one family in `UNENTITLED_AWAITING_PAYMENT`, `ACTIVE`, `CLOSURE_PENDING_BILLING`, or `CLOSING`; `DELETION_PENDING` ownership release timing is **OPEN G-01** (do not permit duplicate creation before definitive release). Family membership is many-to-many; active UI cart selection is not an authorization credential.
2. Each family has isolated groceries, name keys, membership, offline queue and entitlement. Only owner pays; subscription purchase token uniquely bound to `(ownerUid,familyId)` after provider verification. Separate Bailey's Cart emails do not prove distinct Play purchaser identity.
3. Durable account-level trial history: at most one eligible 21-day trial per verified UID, consumed atomically at successful eligible `families.create` server commit; joining families does not consume; closing/deleting family never resets. A previously consumed trial creates unentitled family reservation (Decision 45). Account proliferation abuse remains OPEN.
4. Current membership required for family reads/writes. Revocation overrides trial, grace, payment and cached/offline state. Expired entitlement allows current members read-only access; owner alone sees renewal controls.
5. Family lifecycle: `UNENTITLED_AWAITING_PAYMENT` -> `ACTIVE` after verified purchase; `ACTIVE` -> `CLOSURE_PENDING_BILLING` immediately restricts all list access; provider-confirmed cancellation -> `CLOSING` and 30-day recovery deadline; `CLOSING` -> `ACTIVE` by original-owner restore; deadline -> `DELETION_PENDING`. No automatic membership, billing or old-operation reactivation.
6. Server-authoritative `familyEpoch` initialized to 1, incremented **atomically with successful restore**; all family mutation envelopes carry captured epoch. Stale epoch rejected without side effects. A persisted operation's original epoch is immutable and bound to idempotency identity.

## 3. Transport envelope — candidate, SDK mapping unverified
Authenticated HTTPS Firebase callable commands; deny direct client Firestore domain writes. Caller UID comes from verified Auth context, not body. App Check enforcement and exact Firebase transport mapping need environment verification. Candidate request:
```json
{"apiVersion":"v0.4","opId":"<UUIDv4>","familyId":"<immutable family ID>","familyEpoch":1,"payload":{}}
```
`familyId` and `familyEpoch` omitted only on account-level calls and `families.create`; `invites.accept` uses invite code and server-resolved family, with server-bound invite generation/epoch validation. Read requests need no `opId`. Candidate successful response:
```json
{"apiVersion":"v0.4","opId":"<same opId>","status":"COMMITTED","serverTime":"<UTC RFC3339>","data":{}}
```
Candidate domain error response:
```json
{"apiVersion":"v0.4","opId":"<same opId>","status":"REJECTED","error":{"code":"STALE_EPOCH_REJECTED","retryable":false,"details":{}}}
```
**OPEN W-01:** exact wire version string, callable SDK error envelope, transport codes, request limits, App Check behavior, and confirmation-token constraints must be verified before coding. Never claim these JSON examples are deployed.

## 4. Command register
| Command | Inputs (in addition to common envelope) | Authorization / atomic effect |
|---|---|---|
| `account.getSession` | `{apiVersion}` | Authenticated callable **candidate chosen for recheck**; return `ownedFamilyId?`, joined family summaries with roles/access modes, account trial eligibility (owner only), selected family suggestion; no cross-family billing details. Selection remains client UI state, not server permission. |
| `families.create` | `{displayName?}` | Verified email; reject if owns nonterminal family or reservation. Atomically claim trial ledger if eligible, allocate owner/family and start 21-day trial at commit. Otherwise reserve `familyId` as `UNENTITLED_AWAITING_PAYMENT` with no list access; owner-only payment onboarding. Idempotent retry returns same ID. |
| `billing.verifyPurchase` | `{familyId,familyEpoch,purchaseToken,productId}` | Original owner only; provider-authoritative purchase status, product/package/owner/family binding, acknowledgment and replay handling. Only verified eligible purchase activates reserved family. Pending purchase never grants writes. |
| `billing.getStatus` | `{familyId}` | Current member minimal `accessMode`; owner receives management/renewal metadata. In closure, original owner uses narrow `families.getClosureStatus`. |
| `families.close` | `{familyId,familyEpoch,confirmationToken}` | Online original owner only; durable closure request, immediately restrict reads/writes and queue replay, schedule external cancellation. Retry same opId does not duplicate provider effect. |
| `families.getClosureStatus` | `{familyId}` | Original owner only during pending/closing/deletion; sanitized state, retry/escalation, server deadline. |
| `families.restore` | `{familyId,familyEpoch}` | Original owner, online; **reject** in `CLOSURE_PENDING_BILLING` with `CLOSURE_CANCELLATION_IN_PROGRESS`, no side effects. Only `CLOSING` and strictly before server deadline: restore owner-only access, invalidate prior invites, atomically advance epoch, no automatic billing. |
| `invites.create` / `invites.revoke` | `{familyId,familyEpoch,...}` | Owner only; invite token single-use, short-lived and hashed; close/pending states reject; no old invite revival. |
| `invites.accept` | `{code,opId}` | Verified email; invite resolves intended family and epoch; atomic consume and membership creation, capacity max six **subject to baseline confirmation**; may join multiple families, including while owning one. Accept/revoke first committed transaction wins. |
| `members.remove` | `{familyId,familyEpoch,memberUid}` | Owner only; immediate server-side revocation, no owner removal. Local purge on next device contact. |
| `members.leave` | `{familyId,familyEpoch}` | Current non-owner member only; owner gets `OWNER_CANNOT_LEAVE`; only target family membership affected. |
| `items.add` | `{familyId,familyEpoch,itemId,name,category}` | UUID v4 client itemId; atomic item claim and family-wide canonical NameKey uniqueness; duplicate canonical add is satisfied without duplicate item, but dependents cannot retarget. |
| `items.edit` | `{familyId,familyEpoch,itemId,patch}` | Last server-accepted edit wins for ordinary fields, no stale expectedVersion rejection; name collision with different active item rejected; deleted item never resurrected. |
| `items.delete` / `items.undoDelete` | `{familyId,familyEpoch,itemId/deleteOpId,...}` | Tombstone/undo and nameKey guards per earlier API; redundant delete satisfied, conflicting undo rejected. Preserve five-second local Undo UX. |
| `items.prepareClear` / `items.clearConfirmed` | `{familyId,familyEpoch,confirmationToken?}` | Online fresh confirmation; guard bound IDs/versions; never delete newly added items; partial conflict reporting. Transaction limits and max items OPEN. |
| `account.requestDeletion` | `{apiVersion,opId,confirmationToken}` | Authenticated, revalidated sensitive action; durable **account-level saga**, not atomic cross-provider transaction. Close all owned families (v1 at most one), leave all joined families, revoke sessions/access, reconcile billing, and process personal-data deletion with retention obligations. Failure/retry and 30-day legacy retention reconciliation OPEN G-02. |

## 5. State, epoch and replay validation
Server must enforce authentication, role/membership (or narrowly scoped original-owner recovery exception), lifecycle, epoch and entitlement in the same transactional authorization boundary as mutation. Idempotency records bind `(actorUid,opId,command,canonical request including familyId and familyEpoch)`; replay with changed payload is `IDEMPOTENCY_KEY_REUSED`. **Never return protected historical success data to revoked actors**. If same opId was already committed before closure, return only a privacy-safe replay disposition, not data; exact replay ordering is OPEN W-02. On restore, prior epoch is invalid; client quarantines old queued ops and never rewrites their epoch/opId. Local clock cannot authorize replay. Normal <21-day eligible ops may replay if membership, entitlement, lifecycle and epoch still match; >=21 days or uncertain age require review. Dedup >=30 days after terminal outcome plus safety margin; bounded jitter backoff on outages; no duplicate effects after ambiguous network outcomes.

## 6. Name, item and clear semantics retained
Server canonicalizes names; display names preserve user spelling; max 100 Unicode code points after whitespace normalization; reject unsafe control/invisible formatting; accent-insensitive Latin equivalence (Cafe/Café) while preserving meaningful combining marks in Korean/Japanese and other scripts. `nameKeyId = "k_" + Base64URL_no_padding(UTF8(canonicalKey))`; `canonVersion` explicit. **OPEN W-03:** normative Unicode algorithm, library/version, byte limits and Kotlin/JS fixtures; do not implement from these examples alone. `items.clearConfirmed` must honor server-bound snapshot and transaction write limits; **OPEN W-04:** scalable atomicity/size cap, TTL and response partial semantics. GAI's suggested 300-item cap is a proposal, not approved product policy.

## 7. Billing onboarding and closure
**Decision 45:** Unentitled reservation before owner-authorized purchase. **Candidate** TTL 24h server-time, subject to GAI/PL approval; expiry must not orphan an in-flight/settled Play purchase. Purchase correlation should be recorded durably before checkout and reconciled by provider purchase token/verified state. No entitlement based on callback alone; no automatic charge from a family creation. Verify Google Play subscription identity and whether one purchaser can bind a product to more than one Bailey's Cart account before Gate C.

**Decisions 39,41,44:** `CLOSURE_PENDING_BILLING` immediately denies all list access. Billing cancellation is an external saga: durable intent, idempotent provider correlation, retries and escalation. While unresolved, `families.restore` returns `CLOSURE_CANCELLATION_IN_PROGRESS` without mutation. On verified cancellation, `closureConfirmedAt` and `recoverUntilAt = closureConfirmedAt + 30*86400 seconds` set server-side; restore allowed strictly before deadline. After deadline recovery denied, deletion processing begins; retention of backups, billing and security records OPEN G-03. Provider cancellation semantics (immediate vs end-of-period, verified finality) OPEN W-05. Never promise no charges without provider evidence.

## 8. Error taxonomy (domain candidates; no SDK mapping certified)
`UNAUTHENTICATED`, `APP_CHECK_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, `OWNER_ALREADY_HAS_FAMILY` (proposed replacement for create-only `ALREADY_IN_FAMILY`), `OWNER_REQUIRED`, `OWNER_CANNOT_LEAVE`, `FORBIDDEN`, `MEMBERSHIP_REVOKED`, `FAMILY_FULL`, `INVITE_INVALID`, `INVITE_EXPIRED`, `INVITE_CONSUMED`, `UNENTITLED_AWAITING_PAYMENT`, `PURCHASE_NOT_VERIFIED`, `PURCHASE_ALREADY_BOUND`, `ENTITLEMENT_READ_ONLY`, `FAMILY_CLOSURE_PENDING`, `FAMILY_CLOSING`, `FAMILY_DELETION_PENDING`, `CLOSURE_CANCELLATION_IN_PROGRESS`, `CLOSURE_RECOVERY_EXPIRED`, `STALE_EPOCH_REJECTED`, `API_VERSION_UNSUPPORTED`, `CANON_VERSION_UNSUPPORTED`, `DUPLICATE_NAME_EXISTS`, `ITEM_NOT_FOUND`, `UNDO_NOT_ELIGIBLE`, `IDEMPOTENCY_KEY_REUSED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_EXPIRED`, `OFFLINE_NOT_ALLOWED`, `BILLING_PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `VALIDATION_FAILED`, `REVIEW_REQUIRED` (local). Privacy-safe error precedence requires review.

## 9. Open gate items (do not imply resolved)
- **W-01** exact Firebase callable wire, SDK mappings, limits, App Check.
- **W-02** idempotency/revocation/epoch precedence and historical safe replay response.
- **W-03** Unicode normative implementation and vectors.
- **W-04** Clear All transaction limits, cap/atomicity, token TTL.
- **W-05** Google Play product/purchaser binding, purchase state, cancellation/verification, retry/escalation and refund remediation; independent evidence required.
- **G-01** ownership claim release after closure/deletion; abandoned reservation cleanup and retries; proposed 24h TTL unratified.
- **G-02** account deletion saga and relation to earlier 30-day read-only retention baseline.
- **G-03** closure deletion SLAs, backups and billing/security retention.
- **G-04** secure per-family local partition, purge of caches/outbox/keys on revocation, offline-device limitations.
- **G-05** trial ledger atomic schema, abuse/eligibility and migration from legacy accounts.
- **G-06** confirm canonical PRD/Architecture filenames, source headers, approved Git SHA and workflow v2.4.

## 10. Gate
Candidate only; GAI must recheck against source baseline, PL must ratify, CODI remains on hold, FORGE tests not run, Gate C CLOSED.

---

## R-04 Decisions 46–47 — Integrated normative amendments

> **Integration notice (Decisions 46–47):** The following consolidated normative section incorporates the GAI delta-PASS addendum. Where older candidate language in this document says a 24-hour reservation TTL, waiver endpoint, or ownership release is merely proposed/open, the later D46–D47 section controls the policy and lifecycle behavior. Exact provider/transport implementation details remain open. This file is not yet ratified.

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

### Integration clarifications and precedence
- For an expired reservation, `RESERVATION_RECONCILIATION_PENDING` is a **state**; `PURCHASE_RECONCILIATION_PENDING` is a **candidate domain error**. Do not conflate them.
- `families.waiveRecovery` is owner-only, online-only, idempotent by immutable `(actorUid, opId, request)`; confirmation tokens must be fresh, family-bound and single-use as defined by security design.
- Pending-cancellation restore returns `CLOSURE_CANCELLATION_IN_PROGRESS` even if waiver intent was accepted; after verified cancellation and committed waiver, return `RECOVERY_ALREADY_WAIVED`.
- `DELETION_PENDING` alone does not prove ownership release or physical erasure. Release requires a separate durable milestone with verified billing liability resolution.
- Existing API v0.4 candidate sections 1–10 remain applicable unless explicitly superseded here.
