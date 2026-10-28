# Bailey's Cart — R-04 Contract Reconciliation
**Draft v0.1 | CipherMuse | 2026-10-27**

**Status:** PL decisions captured; reconciliation IN PROGRESS; not ratified; implementation HOLD. This is a planning artifact, not evidence of repository changes, GAI verification, tests, or deployment.

## 1. Purpose and authority
Reconcile WP-03 approved product decisions into an implementable Android Kotlin/Compose + Firebase API and synchronization contract. This draft is based on the decision history in the conversation and the supplied Pennington Labs Engineering Workflow v2.3 file. The project conversation also references a v2.4 workflow; its full text has not been independently inspected in this work session. GitHub remains canonical once the approved artifact is committed.

Project Lead (PL) approves product decisions, architecture, merges, and release. CipherMuse specifies; CODI implements and authors executable Verity ProofPoints; GAI independently challenges and verifies; FORGE executes configured checks/builds/deployment subject to authorization.

## 2. Approved invariants (normative candidates)
### A. Authorization and entitlement
- Family resources are scoped by immutable familyId; accountId + familyId isolate durable device data and pending queues.
- Server checks current membership for every protected read and mutation. Membership revocation overrides trial, grace, active subscription, and read-only entitlements. No server read/write after revocation; no replay of revoked member's pending operations, including after rejoin.
- On confirmed revocation the app stops sync, hides family data, and securely clears that family's local snapshot and queued operations without affecting other families or the account. Offline devices cannot detect a remote revocation until connectivity/authoritative status is restored; protected-cache exposure policy requires explicit design.
- Revoked user retains independent account and may create/join another family. New family requires separate subscription or eligibility-based trial. No automatic family data or billing transfer.
- Inactive subscription preserves server list for authorized members but makes it read-only; pending operations are retained, and eligible operations may resume on renewal with original identity, subject to age and membership checks.
- Family creator/owner may remove members and invite replacements while retaining family ownership, subscription, and list. Removal does not require ownership transfer.
- Revoked-member UX: neutral 'Family access ended' screen; actions 'Start My Own Family' and 'Join Another Family'; no personal explanation, automatic charge, or frozen app. Distinguish authoritative revocation from transient Firebase failure.

### B. Item identity, names, and edits
- Client generates UUID v4 itemId; server atomically claims IDs and enforces family-wide uniqueness of canonical NameKey for active items.
- Canonical NameKey doc ID: 'k_' + unpadded Base64URL of UTF-8 canonical comparison key; include canonVersion. Server computes authoritative key, never trusts client-supplied key.
- Preserve display spelling; normalize whitespace; max 100 Unicode code points; reject unsafe control/invisible formatting; accent-insensitive comparisons for Latin examples Cafe/Café and Jalapeno/Jalapeño, while preserving meaningful marks in international scripts (e.g. 몰, 김치). Water and Bottled Water remain distinct; no fuzzy matching.
- Duplicate add of same canonical name is quietly satisfied; collision on rename of a different active item is rejected with user explanation. Same-item capitalization/accent edits allowed.
- Ordinary edits use last successful server transaction wins, without expectedVersion rejection; authorization, uniqueness, and delete/clear guards still apply.
- Stale edits never resurrect deleted items; redundant deletes are satisfied; fresh adds can recreate previously deleted names. Clear List requires online confirmation, operates on current server active list, and respects guards. Offline clear requires fresh reconnection confirmation, never automatic replay.
- Canonicalization changes require versioned compatibility and collision-aware migration. Incompatible contract versions are rejected without side effects.

### C. Offline durability and replay
- Firestore memory-only cache; app-owned durable offline snapshot and mutation queue.
- Show offline/stale and pending indicators. Do not claim server success until confirmed; local success only after durable local commit. Storage failure must not create phantom successes.
- Never-submitted offline add + dependent edit may safely coalesce; do not silently retarget dependent operations.
- Pending operations younger than 21 days auto-replay if otherwise eligible; 21+ days quarantine for review, not deletion. Unreliable operation age also quarantines. Client clock is not authoritative; use local and elapsed-time evidence; clock changes never reset age. Server time governs server transaction ordering and retention.
- Dedup outcome records retained at least 30 days after terminal resolution plus safety margin; retry uncertain outcome with exact same immutable operation ID and payload, not a new operation. Do not blindly replay beyond dedup safety.
- Permanent failures block only failed operation and true dependents; independent operations proceed. Retryable failures remain pending. Allow review/dismiss/correction by new operations without silent loss.
- Temporary Firebase outages preserve durable queue, retry with bounded exponential backoff and jitter, avoid hammering service, and show accurate pending status; do not bypass authorization on recovery.
- Sign-out stops sync, hides data, warns of unsynced changes, preserves protected local state for re-login. Explicit account removal securely erases its local state. Exclude protected data/keys from auto backup until secure restore design exists. Uninstall does not guarantee recovery of unsynced device-only changes.
- Multi-device queues use globally unique operation IDs; one account can have multiple devices. Updates/migrations preserve queue, immutable identities/payloads; quarantine incompatible or uncertain operations.

### D. Invitation and family creation
- Verified email required before families.create and invites.accept; EMAIL_VERIFICATION_REQUIRED leaves invitation intact.
- 21-day trial starts at families.create transaction commit; eligibility for a newly created family must be specified separately from membership revocation.
- Invitation acceptance atomically validates and consumes invitation; same intended account's repeated acceptance is idempotently satisfied; different account cannot reuse consumed invitation; invalid, expired, or revoked invitations grant no access.
- Acceptance versus revocation: first successful server transaction wins on the same invitation state. If acceptance wins, subsequent invitation revocation does not remove membership; separate Remove Member required.

### E. API compatibility
- Every mutation declares contract version. Server accepts supported versions, rejects unsupported versions without partial effects, and returns actionable update-required error. Preserve pending immutable operations. FORGE/GAI verify compatibility and upgrades.

## 3. Contract reconciliation worklist (OPEN)
| ID | Open item | Why it matters | Proposed disposition |
|---|---|---|---|
| R04-01 | Precise membership-read/cache policy for offline phones before revocation is detectable | Cannot promise instantaneous remote erasure | Security design + GAI challenge; PL decision if user-visible tradeoff |
| R04-02 | Exact wire schema, version fields, response codes, and atomic Firestore transaction boundaries | CODI cannot implement interoperably from prose alone | Reconcile against ratified API v0.3 Rev 1 and addenda |
| R04-03 | Cross-platform Unicode canonicalization test vectors and runtime Unicode version | Kotlin/JS drift could violate uniqueness or damage international names | Normative fixture corpus + GAI independent verification |
| R04-04 | Dedup safety margin and precise age calculation across reboot/clock change | Uncertain retries and 21-day threshold | Define server/client algorithm and conservative quarantine |
| R04-05 | Owner/member permissions, invitation target identity, and invitation expiry semantics | Authorization and race conditions | Validate existing API and document preconditions |
| R04-06 | Trial eligibility for removed member creating own family | Avoid granting or denying unapproved free trials | PL policy decision if unspecified in existing specs |
| R04-07 | Secure local erase and protected cache encryption/key lifecycle | Security claim requires implementable storage design | CODI design, GAI security review |
| R04-08 | Error taxonomy: revoked vs inactive entitlement vs outage vs unsupported version vs duplicate rename | Correct UI and retries depend on errors | Normative error/status matrix |
| R04-09 | Migration/rollout sequencing for canonicalization versions and existing NameKeys | Avoid collisions and partial migration | Explicit migration plan and rollback |
| R04-10 | Confirm full v2.4 workflow and canonical source revisions | Prevent handoff against stale documents | Fetch authoritative repo versions before ratification |

## 4. Verity ProofSuite proposal — WP03-R04
All ProofPoints below are **NOT_RUN**; they are proposed scenarios, not verified results.

| ProofPoint | Risk | Scenario | Required evidence |
|---|---|---|---|
| PP-R04-001 | Critical | Removed Dad reconnects; all Mom family server reads/writes denied, pending replay rejected, neutral UX | Rules/API integration + E2E + GAI adversarial review |
| PP-R04-002 | High | Firebase outage while Dad reconnects does not falsely claim revocation | Fault-injection integration + E2E |
| PP-R04-003 | High | Dad creates independent family; Mom list/subscription cannot leak or transfer | Integration + E2E |
| PP-R04-004 | High | Duplicate add and conflicting rename enforce canonical NameKey uniqueness atomically | Concurrent integration + Unicode fixtures |
| PP-R04-005 | High | Korean and other international names preserve meaningful marks; Latin accent equivalence works | Cross-platform unit fixtures + GAI challenge |
| PP-R04-006 | High | Same invitation accepted twice, and acceptance races revocation | Concurrent transaction integration |
| PP-R04-007 | High | Ambiguous mutation response retried with same immutable identity, no duplicate side effect | Network fault-injection integration |
| PP-R04-008 | High | Clock jump, reboot, uncertain age: quarantine rather than unsafe replay | Unit + device E2E |
| PP-R04-009 | High | Subscription expiry and renewal retain list/queue while respecting revocation | Integration + E2E |
| PP-R04-010 | High | Unsupported API/canon version rejected atomically; queue survives app update | Upgrade E2E + GAI challenge |
| PP-R04-011 | High | Local durable-write failure never reports success or corrupts prior queue | Fault-injection device test |
| PP-R04-012 | High | Family/account switching never exposes or redirects other family operations | Integration + E2E + GAI security review |

Four-deep verification: (1) unit; (2) integration; (3) E2E; (4) independent GAI challenge. Capture command/run link, commit SHA, environment, outcome, and evidence; no PASS without execution.

## 5. Engineering handoff gates
**Current:** R-04 DRAFT; no Gate C approval; WP-03 CODI implementation HOLD.
1. CipherMuse compares all approved decisions against canonical architecture, API v0.3 Rev 1, addenda, and feature spec; resolves contradictions or escalates to PL.
2. GAI independently reviews reconciled contract and ProofSuite coverage; records findings and status.
3. PL explicitly authorizes scoped Gate C implementation, if satisfied.
4. CODI implements on approved branch; FORGE executes configured checks; GAI independently verifies evidence.
5. PL separately approves merges and production releases.

## 6. Traceability notes
Approved decisions in current conversation include WP-03 D25 clock integrity, D26 Firebase outage, D27 API compatibility, D28 canonicalization version, D29 invitation acceptance, D30 acceptance/revocation race, D31 owner may remove member and keep family, and D32 neutral access-ended CTA. Earlier approved decisions are summarized in the conversation context and must be checked against source specs before ratification.

**Not verified in this session:** repository baseline SHA; contents of ratified API files; actual GAI reports; CI status; deployed code; exact v2.4 workflow text.
