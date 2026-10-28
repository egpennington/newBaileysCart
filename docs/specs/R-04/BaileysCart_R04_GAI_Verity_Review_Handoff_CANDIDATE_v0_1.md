# GAI Independent Review Assignment — R-04
**CipherMuse → GAI | 2026-10-27 | DOCUMENT REVIEW ONLY**

## Objective
Independently challenge R-04 candidate contract v0.2 and authorization/error matrix v0.2 against the supplied API v0.2, Rev1 delta, P4-D10/11 addendum, Architecture v1.1, existing R-04 drafts and explicit PL decisions 33–41. Distinguish source-backed approvals from candidate technical design. No coding or implementation authorization.

## Inputs
- `BaileysCart_R04_Reconciled_API_Contract_CANDIDATE_v0_2.md`
- `BaileysCart_R04_Authorization_Error_Matrix_CANDIDATE_v0_2.md`
- `API_SPEC_v0.2.md`, `API_SPEC_v0.3_REV1_RATIFIED_COPY.md`, `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md`
- `ARCHITECTURE_v1.1.md`, `BaileysCart_R04_Reconciliation_Draft_v0_1.md`, `WP03_R04_CONTRACT_RECONCILIATION_DRAFT_v0.1.md`
- Pennington Labs workflow v2.3/v2.4 (confirm governing revision and Git commit)

## Independent challenge priorities
1. Multi-family vs legacy one-family-per-UID: account projection, ownership, invites, billing isolation and Firestore authorization.
2. Trial ledger concurrency: two simultaneous family creations, retries, membership-only joins, deletion/recreation and email change.
3. Owner-only billing: token reuse across families, canceled but still entitled, cancellation provider outage, double cancel, charges after closure request, no false closure completion.
4. Closure authorization: all member reads/writes blocked immediately; original-owner-only status/recovery exception; recover before/at/after 30-day deadline; no automatic billing, memberships, invites or queued ops.
5. Durable billing workflow: crash between Firestore update and provider call; timeout after provider success; provider event reordering; reconciliation audit and remediation.
6. Unicode/NameKey collisions and duplicate add dependent operations; stale edit/delete/clear and outbox ordering.
7. SDK error envelopes, read-only entitlements, privacy-safe errors, offline cache purge, backup exclusions and remote offline device limitations.
8. Explicit review of unresolved B01–B11, including whether any is a Gate C blocker versus later-WP concern.

## Proposed Verity ProofSuite `PS-WP03-R04-CLOSURE-ISOLATION`
All ProofPoints **NOT_RUN**. CODI authors executable tests after Gate C; FORGE records CI evidence; GAI independently challenges tests and results.

| ID | Risk | Scenario | D1 Unit | D2 Integration/emulator | D3 E2E | D4 GAI independent challenge |
|---|---|---|---|---|---|---|
| PP-R04-033 | Critical | One UID owns two families; cross-family reads/writes/purchases denied | family binding | Auth/Rules/Functions | switch family | adversarial ID substitution |
| PP-R04-034 | High | Concurrent family creates consume only one account trial; retries stable | eligibility transition | concurrent transactions | signup/retry | clock/account history challenge |
| PP-R04-035 | Critical | Non-owner cannot verify/cancel owner's purchase; token bound to one family | role guards | provider stub + rules | billing UX | spoofed payer/token |
| PP-R04-036 | High | Expired family read-only, owner-only renewal, revoked member denied | access matrix | entitlement/rules | banners | info disclosure |
| PP-R04-037 | High | No owner transfer; owner leaves prohibited, member leaves only own family | role state | callable denial | member flows | ownerUid tampering |
| PP-R04-038 | Critical | Closure request blocks all list access immediately | lifecycle guards | transactional auth | close flow | in-flight writes and listener race |
| PP-R04-039 | Critical | Billing outage preserves pending; no premature recovery clock; retries no duplicate effects | state transitions | provider fault injection | pending UX | crash/reorder replay |
| PP-R04-040 | Critical | Recovery before deadline owner-only; former members and queues never reactivate | epoch guards | Auth/Rules/Functions | restore/invite | replay and invitation attack |
| PP-R04-041 | High | Deadline expires; no restore; deletion processing and retention separation | UTC boundary | scheduler emulation | deadline UX | clock skew and stale reads |
| PP-R04-042 | High | Duplicate canonical add vs dependent edit; international names | canonical fixtures | concurrency | offline sync | cross-platform parity |
| PP-R04-043 | High | Old op after closure and recovery never replays, even <21 days | queue epoch | emulator reconnect | device offline | replay attack |

## ProofPoint evidence contract
For each run: commit SHA, branch, environment, command, fixtures, expected/actual result, artifact link, status `NOT_RUN|BLOCKED|PASS|FAIL`, responsible owner and independent reviewer. No PASS without actual execution. Four-deep coverage is a plan, not completed evidence.

## Requested GAI output
- Severity-ranked findings with exact document section and conflict source.
- Verdict on completeness/consistency: PASS, CONDITIONAL PASS or FAIL **for the specification only**, not executable verification.
- Updated B01–B11 blocker disposition and concrete correction requests.
- Verity coverage gaps and adversarial cases.
- Recommendation to PL on readiness for canonical ratification and **separate** scoped WP-03 Gate C; GAI cannot authorize either.

**Repository/branch/base commit:** not verified in this work session. PL/CODI must identify exact Bailey's Cart Git baseline before a repo-native handoff. **No code changes, CI runs, or deployments performed.**
