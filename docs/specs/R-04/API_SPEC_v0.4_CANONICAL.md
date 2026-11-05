# Bailey's Cart — Unified API v0.4 Canonical Candidate
**Project:** Bailey's Cart / newBaileysCart  
**Author:** CipherMuse  
**Status:** CONSOLIDATED FOR PROJECT LEAD RATIFICATION REVIEW — NOT RATIFIED  
**Authority:** Project Lead approves architecture, Gate C, merges and release.  
**Evidence:** Source files mounted for review; no Git checkout/SHA verified. No implementation, provisioning, tests, or deployment authorized. All Verity ProofPoints `NOT_RUN`.  
**Workflow:** Pennington Labs Engineering Workflow v2.4.  
**Source hierarchy:** `API_SPEC_v0.2.md`; `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (filename/header status discrepancy); `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`; `ARCHITECTURE_v1.1.md`; `newBaileysCart_PRD_v1.0_GAI_Review.md`; R-04 candidates; `GAI_R04_Contract_Reconciliation_Review_Report.md`; explicit PL Decisions 33–47. Existing source conflicts are flagged, not erased.  

> **Controlled amendment A2-D1D4 (Project Lead approved D-1–D-4, 2026-11-05).** This file was ratified as part of the R-04 v0.4 baseline with SHA-256 `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d` (`R04_PROJECT_LEAD_RATIFICATION_RECORD_APPROVED.md`). Those ratified bytes are preserved unchanged at `develop@bdcbd9783c4a7d5859637fed542ecb6ef445cb7d` (git blob `7687d91ec3cd0608249ee7b5fb5c0bda796880c1`). The header lines above predate ratification and are kept as they were. The only changes made by A2-D1D4 are the passages marked **[A2-D1]**, **[A2-D3]** and **[A2-D4]** in §4, §5 and §8, and the section "A2 controlled amendment D-1–D-4" at the end of this file. The amendment is recorded in `docs/decisions/DECISION_REGISTER.md` v1.13 (WP03-A2-D1D4). Sources: `WP03_A2_Controlled_Contract_Delta_D1-D4_v0.1.md` (CipherMuse) and `GAI_WP03_S3B_Readiness_and_A2_Delta_Review_Report.md` (GAI, marker `WP03-A2-D1D4-S3B-CONFORMANCE-01`). The companion D-2 correction is in `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md`.

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
| `families.prepareLifecycleConfirmation` **[A2-D4] PLANNED, not implemented** (callable export `familiesPrepareLifecycleConfirmation`) | `{apiVersion,opId,familyId,action}`; `action` is `CLOSE` or `WAIVE_RECOVERY`; no `familyEpoch` in the request | Authenticated, verified, current immutable family owner only. Issues a single-use confirmation token for `families.close` or `families.waiveRecovery`, bound to owner, family, action and current server epoch, with a 15-minute TTL. Only the SHA-256 digest is stored. The token supersedes earlier unconsumed tokens for the family. No family, billing or lifecycle mutation. The full contract is in "A2 controlled amendment D-1–D-4", §A2-D4. |
| `account.requestDeletion` | `{apiVersion,opId,confirmationToken}` | Authenticated, revalidated sensitive action; durable **account-level saga**, not atomic cross-provider transaction. Close all owned families (v1 at most one), leave all joined families, revoke sessions/access, reconcile billing, and process personal-data deletion with retention obligations. Failure/retry and 30-day legacy retention reconciliation OPEN G-02. |

## 5. State, epoch and replay validation
Server must enforce authentication, role/membership (or narrowly scoped original-owner recovery exception), lifecycle, epoch and entitlement in the same transactional authorization boundary as mutation. Idempotency records bind `(actorUid,opId,command,canonical request including familyId and familyEpoch)`; replay with changed payload is `IDEMPOTENCY_KEY_REUSED`. **Never return protected historical success data to revoked actors**. If same opId was already committed before closure, return only a privacy-safe replay disposition, not data; exact replay ordering is OPEN W-02. On restore, prior epoch is invalid; client quarantines old queued ops and never rewrites their epoch/opId. Local clock cannot authorize replay. Normal <21-day eligible ops may replay if membership, entitlement, lifecycle and epoch still match; >=21 days or uncertain age require review. Dedup >=30 days after terminal outcome plus safety margin; bounded jitter backoff on outages; no duplicate effects after ambiguous network outcomes.

**[A2-D1] Committed replay versus later epoch advancement (PL D-1, 2026-11-05).** When a request is identical (same actor, `opId`, command and canonical request, including its original `familyId` and `familyEpoch`) to one that has already committed, the server may return the original cached result. It does so only after it has re-verified, in the current transaction, the caller's authentication, verified email and current authorization. For owner-only lifecycle commands, that means the caller is the current immutable owner of the family. A `familyEpoch` advanced after the original commit (for example by a later successful restore) does not invalidate that committed replay. The replay performs no further mutation. It does not advance the epoch, consume a confirmation token, rerun the lifecycle transition, call the billing provider, or extend or reset any deadline. A caller who fails the current authorization check receives that check's rejection and no cached data, so the rule above about never returning protected historical success data to revoked actors still governs. Any request that is not an exact replay of a committed operation is a new mutation, and a new mutation whose `familyEpoch` is not the current server epoch rejects with `STALE_EPOCH_REJECTED` without side effects. A changed request with the same `opId` remains `IDEMPOTENCY_KEY_REUSED`. This resolves W-02 only for exact committed replay. The other W-02 ordering questions remain open.

## 6. Name, item and clear semantics retained
Server canonicalizes names; display names preserve user spelling; max 100 Unicode code points after whitespace normalization; reject unsafe control/invisible formatting; accent-insensitive Latin equivalence (Cafe/Café) while preserving meaningful combining marks in Korean/Japanese and other scripts. `nameKeyId = "k_" + Base64URL_no_padding(UTF8(canonicalKey))`; `canonVersion` explicit. **OPEN W-03:** normative Unicode algorithm, library/version, byte limits and Kotlin/JS fixtures; do not implement from these examples alone. `items.clearConfirmed` must honor server-bound snapshot and transaction write limits; **OPEN W-04:** scalable atomicity/size cap, TTL and response partial semantics. GAI's suggested 300-item cap is a proposal, not approved product policy.

## 7. Billing onboarding and closure
**Decision 45:** Unentitled reservation before owner-authorized purchase. **Candidate** TTL 24h server-time, subject to GAI/PL approval; expiry must not orphan an in-flight/settled Play purchase. Purchase correlation should be recorded durably before checkout and reconciled by provider purchase token/verified state. No entitlement based on callback alone; no automatic charge from a family creation. Verify Google Play subscription identity and whether one purchaser can bind a product to more than one Bailey's Cart account before Gate C.

**Decisions 39,41,44:** `CLOSURE_PENDING_BILLING` immediately denies all list access. Billing cancellation is an external saga: durable intent, idempotent provider correlation, retries and escalation. While unresolved, `families.restore` returns `CLOSURE_CANCELLATION_IN_PROGRESS` without mutation. On verified cancellation, `closureConfirmedAt` and `recoverUntilAt = closureConfirmedAt + 30*86400 seconds` set server-side; restore allowed strictly before deadline. After deadline recovery denied, deletion processing begins; retention of backups, billing and security records OPEN G-03. Provider cancellation semantics (immediate vs end-of-period, verified finality) OPEN W-05. Never promise no charges without provider evidence.

## 8. Error taxonomy (domain candidates; no SDK mapping certified)
`UNAUTHENTICATED`, `APP_CHECK_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, `OWNER_ALREADY_HAS_FAMILY` (proposed replacement for create-only `ALREADY_IN_FAMILY`), `OWNER_REQUIRED`, `OWNER_CANNOT_LEAVE`, `FORBIDDEN`, `MEMBERSHIP_REVOKED`, `FAMILY_FULL`, `INVITE_INVALID`, `INVITE_EXPIRED`, `INVITE_CONSUMED`, `UNENTITLED_AWAITING_PAYMENT`, `PURCHASE_NOT_VERIFIED`, `PURCHASE_ALREADY_BOUND`, `ENTITLEMENT_READ_ONLY`, `FAMILY_CLOSURE_PENDING`, `FAMILY_CLOSING`, `FAMILY_DELETION_PENDING`, `CLOSURE_CANCELLATION_IN_PROGRESS`, `CLOSURE_RECOVERY_EXPIRED`, `FAMILY_NOT_CLOSED` **[A2-D3]**, `STALE_EPOCH_REJECTED`, `API_VERSION_UNSUPPORTED`, `CANON_VERSION_UNSUPPORTED`, `DUPLICATE_NAME_EXISTS`, `ITEM_NOT_FOUND`, `UNDO_NOT_ELIGIBLE`, `IDEMPOTENCY_KEY_REUSED`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_EXPIRED`, `OFFLINE_NOT_ALLOWED`, `BILLING_PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `VALIDATION_FAILED`, `REVIEW_REQUIRED` (local). Privacy-safe error precedence requires review.

**[A2-D3] `FAMILY_NOT_CLOSED` (PL D-3, 2026-11-05).** `families.restore` returns this code when the original owner attempts to restore a family that has not entered closure, meaning it is in `ACTIVE` or `UNENTITLED_AWAITING_PAYMENT` and has no closure case. The callable mapping is `failed-precondition` (HTTP 400), with `retryable: false`. The rejection causes no state change: no lifecycle transition, epoch advancement, billing call, token consumption or idempotency commit. It is not a fallback for unknown lifecycle states. Closure states keep their specific codes under the existing precedence (`CLOSURE_CANCELLATION_IN_PROGRESS`, `CLOSURE_RECOVERY_EXPIRED`, `RECOVERY_ALREADY_WAIVED`). A non-owner receives `OWNER_REQUIRED` (D-2) before this code is evaluated. An exact replay of an already-committed restore (D-1) returns its original result before this code is evaluated, even though the restored family is now `ACTIVE`.

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

---

## A2 controlled amendment D-1–D-4

> **Amendment notice (A2-D1D4).** The Project Lead approved D-1 through D-4 on 2026-11-05. This section incorporates them as a controlled documentation change. It authorizes no code, provisioning or deployment, and it does not open Gate C for Substage 3B. The decisions are recorded in `docs/decisions/DECISION_REGISTER.md` v1.13 (WP03-A2-D1D4). Sections 1–10 and the D46–D47 section above remain in force except where the marked passages below refine them.

| ID | Decision | Where incorporated | Implementation status at `develop@bdcbd97` |
|---|---|---|---|
| D-1 | An exact committed replay returns the original result after current authorization is re-verified. A later epoch advancement does not invalidate it. New stale-epoch mutations reject with `STALE_EPOCH_REJECTED`. | §5 **[A2-D1]** | Implemented in Substage 3A (owner-only lifecycle commands) |
| D-2 | Every authenticated, verified non-owner, including a former member, receives `OWNER_REQUIRED` (`permission-denied`, HTTP 403) from the owner-only lifecycle commands `families.close`, `families.getClosureStatus`, `families.restore` and `families.waiveRecovery`. | `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md`, row "`families.restore` / Former member", and its A2 section | Implemented in Substage 3A |
| D-3 | `FAMILY_NOT_CLOSED` (`failed-precondition`, HTTP 400, `retryable: false`, no state change) for restore of a family that has not entered closure. | §8 **[A2-D3]** | Implemented in Substage 3A |
| D-4 | Client confirmation-token preparation callable. | §4 **[A2-D4]** and §A2-D4 below | **PLANNED, not implemented.** No client-accessible issuance endpoint exists. Substage 3A has only the internal, test-only issuer `issueConfirmationToken`. |

### A2-D4. `families.prepareLifecycleConfirmation` — PLANNED

**Status: PLANNED.** This is a contract for a future callable, not a description of deployed behavior. Implementation needs separate Gate C authorization. Its Verity ProofPoint is `PL-PP-WP03-32` (suite `PS-ACCESS-ISOLATION`, status `NOT_RUN`).

**Names.** The logical command is `families.prepareLifecycleConfirmation`. Under the A1 naming rule, the Firebase callable export is `familiesPrepareLifecycleConfirmation`.

**Request.** The request has flat fields, as for the other Slice 3 callables. The caller UID comes only from verified Auth context.
```json
{"apiVersion":"v0.4","opId":"<UUIDv4>","familyId":"<familyId>","action":"CLOSE"}
```
`action` is exactly `CLOSE` (for `families.close`) or `WAIVE_RECOVERY` (for `families.waiveRecovery`). Any other value, or any unknown or missing field, is rejected as `VALIDATION_FAILED`. The request carries no `familyEpoch`. The token is bound to the server epoch read when the token is issued.

**Success data**, in the A1 native callable success envelope:
```json
{"confirmationToken":"<opaque base64url>","expiresAt":"<UTC RFC3339>","action":"CLOSE","familyId":"<familyId>","familyEpoch":1}
```
The plaintext `confirmationToken` appears only in the response to the successful issuing call. It is never part of a replay, an error or `details`.

**Authorization.** The caller must be authenticated, have a verified email, and be the current immutable owner of the existing family. A non-owner, including a current or former member, receives `OWNER_REQUIRED` (D-2), and no token is issued. The family must be in a state where the requested action could currently be accepted: `ACTIVE` for `CLOSE`, and a state in which `families.waiveRecovery` is eligible for `WAIVE_RECOVERY`. Otherwise the request rejects with the code that the target command would return, and no token is issued. Issuing a token is not proof of final confirmation. `families.close` and `families.waiveRecovery` still re-evaluate authorization, epoch, lifecycle state, confirmation and financial safeguards in their own commit transactions.

**Token.**
- The token is generated server-side by a cryptographically secure random source, with at least 32 random bytes (base64url). It is bound to `(ownerUid, familyId, action, familyEpoch)`.
- The TTL is exactly 15 minutes: `expiresAt = issuedAt + 900 seconds`, using server time. A token is invalid at `now >= expiresAt`.
- The server stores only the SHA-256 digest with its binding and timestamps. The plaintext token is never stored on the server and never appears in logs, analytics, audit records, push messages, URLs, error details or crash reports.

**Single use and consumption.** The protected operation checks the token's binding, expiry, supersession and non-consumption, and consumes the token, atomically in the same transaction that commits the lifecycle change. A token that is consumed, expired, superseded, or bound to another owner, family, action or epoch never authorizes an action. The protected operation then rejects with `CONFIRMATION_REQUIRED`, or `CONFIRMATION_EXPIRED` for an expired token, without mutation. An exact committed replay of the protected operation (D-1) consumes nothing further.

**Supersession.** Each successful preparation invalidates every earlier unconsumed token for the same family, for either action, in the same transaction that records the new digest. At most one unconsumed token per family can be valid at a time. When preparations race, the last one to commit holds the only valid token. If a preparation and a consumption race, they serialize: if the consumption commits first, the action is committed and a later preparation re-evaluates eligibility against the new state; if the preparation commits first, the older token is superseded and the consumption rejects with `CONFIRMATION_REQUIRED` without mutation.

**Same-`opId` retry (fail-closed).** The server keeps only a digest, so it cannot reproduce the plaintext of a token it has already issued. The contract therefore does not pretend that a replay can return it.
- An identical retry (same actor, `opId` and canonical request) of a preparation that has already committed returns no token. It rejects with `CONFIRMATION_REQUIRED` (`failed-precondition`, `retryable: false`, empty `details`). In the same transaction, it invalidates the token issued under that `opId` if that token is still unconsumed. It issues no new token.
- To obtain a usable token, the client must call again with a new `opId`. That call is a new preparation and supersedes any outstanding token.
- A changed request with the same `opId` rejects with `IDEMPOTENCY_KEY_REUSED` and changes nothing.
- A response lost in transit therefore never leaves a recoverable plaintext token and never yields a second valid token for the same `opId`.

**Client (Android) requirements.**
- The client holds `confirmationToken` in volatile memory only. It never writes the token to Room/SQLite, SharedPreferences, DataStore, files, logs, analytics, crash reports or the offline queue.
- The client discards the token after use, on expiry, on sign-out and when the process ends.
- Preparation and the protected action are online-only.
- The client must show its own explicit confirmation screen for the irreversible action. Issuing a token must not make the destructive action one-click or invisible.

**No side effects.** A preparation call, successful or not, never changes family, membership, billing, lifecycle or epoch state. A successful call writes only the token digest record, the supersession marks and the idempotency record. A rejected call writes nothing, except that an identical retry of a committed preparation invalidates that preparation's token as described above.

**Still open (not decided by D-4):** issuance rate limits and their error behavior, recent-authentication requirements, App Check enforcement, and the exact storage layout for supersession. These are GAI/PL review points for the implementation Gate C.
