# API v0.3 Proposed Amendments (Delta to Approved API v0.2)

**Project:** newBaileysCart  
**Date:** 2026-10-26  
**Owner:** CipherMuse | **Decision authority:** penguinPrime  
**Status:** REVISED PROPOSAL FOR FOCUSED GAI RECHECK — NOT AN APPROVED API BASELINE  
**Authority:** Phase 4 PLANNING ONLY. No coding, provisioning, repository edits/commits, merges, deployments, live tests, or changes to legacy Bailey’s Cart. All executable Verity ProofPoints **NOT_RUN**.  
**Source basis:** CODI Phase 4 Assessment (2026-10-26), PRD v1.0, Architecture v1.1, API v0.2, UX Brief v0.2, Phase 4 Planning v0.2. CODI proposals are not independent test evidence.

## 1. Scope and precedence

**This is a proposed delta, not a replacement or ratified API.** API v0.2 remains the approved baseline until PL approves changes and GAI checks consistency. The following proposals explicitly identify choices that would amend PRD or Architecture. Wire examples are conceptual; Firebase callable SDK envelopes must be verified.

## 2. Family onboarding commands (proposed)

### `families.create`

- Authenticated caller with no existing family; online-only, idempotent `opId`, validated display family name if required by final UX.
- Server transaction atomically creates family, owner membership, `/users/{uid}` projection, and trial entitlement if trial start at creation is PL-approved; enforce one-family-per-UID and eligibility policy.
- Request candidate `{apiVersion,opId,displayName?}`; response `COMMITTED data:{familyId,ownerUid,entitlement:{state,trialEndsAt?}}` with only authorized fields.
- Errors: `ALREADY_IN_FAMILY`, `VALIDATION_FAILED`, `RATE_LIMITED`, `FORBIDDEN`, and entitlement/trial-eligibility code **TBD**. Do not silently promise a new free trial on every family creation.
- **BLOCKED:** trial start trigger, email verification and anti-abuse policy need PL decisions.

### `members.leave`

- Authenticated non-owner active member; online-only, idempotent; server revokes caller's membership and updates user projection transactionally. Owner cannot use leave to bypass owner deletion/cancellation process.
- Request `{apiVersion,opId,familyId}`; response `{leftFamilyId, membershipState:"LEFT"}`.
- Server denies subsequent family reads/writes and outbox replay. Client purges family cache only upon authoritative leave success or confirmed membership state; offline sign-out alone is not a server leave.
- Errors `FORBIDDEN`, `MEMBERSHIP_REVOKED`, `ALREADY_LEFT` (**new candidate**) with idempotent treatment TBD.

### `account.getSession` (candidate read)

- Authenticated read-only bootstrap, no mutation `opId` required; returns minimal user/family membership, role, entitlement accessMode, and server timestamp. No family details for unauthorized user.
- Alternative: strictly secured `/users/{uid}` projection plus family-scoped read. **Choose one** before WP-01; do not create redundant authorities.

## 3. Item identity and dependent offline operations (proposed)

- Amend `items.add` request to `{apiVersion,opId,familyId,itemId,name,category}` where `itemId` is cryptographically random client-generated UUID, globally collision-resistant and validated by server; no client authority is inferred from ID.
- Transaction atomically rejects itemId collisions/reuse with mismatched payload, enforces name-key uniqueness, and stores original outcome against `(actorUid,opId)`; stable ID remains across edits.
- `items.edit` and `items.delete` queued after offline add use the same itemId. Strict FIFO guarantees server add terminal resolution before dependent dispatch.
- If add permanently fails (including duplicate race), dependent operations become `BLOCKED_DEPENDENCY`; show a recovery choice; **never retarget to a different member's item or silently discard**. Define whether user can explicitly re-enter intent as a fresh operation.
- This alters API v0.2's server-created-ID description and needs PL/GAI approval.

## 4. Edit conflicts: P4-D03 PL-approved semantics (supersedes this section in prior proposal)

**Binding product decision:** Preserve approved PRD v1.0 §2.3 / AC-09: last **server-accepted** ordinary edit wins. The backend must serialize accepted commits through authoritative transactions, never compare device clocks. For `items.edit` on an existing, editable item, an outdated `expectedVersion` **must not itself cause `VERSION_CONFLICT`**. `expectedVersion` may be carried as diagnostic metadata but is not a precondition for ordinary name/category edits. Server validates actor/family/role/entitlement, item existence and non-deleted state, name-key uniqueness, payload, and opId replay. An accepted edit atomically updates requested ordinary fields and increments item version. If two valid edits modify the same field, the later successfully committed server edit is authoritative. If a submitted edit contains both name and category, the accepted payload updates both; **field-level merging is not implicitly authorized**.

**Rejections that remain valid:** `ITEM_NOT_FOUND`/`ITEM_DELETED` (no resurrection), `DUPLICATE_NAME`, `FORBIDDEN`/`MEMBERSHIP_REVOKED`, `READ_ONLY`, `VALIDATION_FAILED`, or deterministic idempotency errors. No routine stale-edit conflict modal. A rejected edit does not become server-accepted. An edit racing a delete must not recreate a deleted item; transaction rechecks the item state. `items.delete`, `items.prepareClear`, and `items.clearConfirmed` retain their own version/snapshot safeguards; do not extend ordinary-edit last-wins to destructive actions.

**GAI review required:** Confirm these rules against PRD AC-09 and API v0.2, examine multi-field overwrites, duplicate-name races, delete/edit races, ambiguous transport replay, and outbox FIFO. Final wire request/response shape and `expectedVersion` optionality remain subject to controlled API approval.

## 5. Name canonicalization and Firestore IDs (proposed)

1. Reject unpaired surrogates and prohibited characters; exact policy for unassigned/default-ignorables is **TBD**.
2. Normalize display to NFC, trim/collapse an explicitly versioned Unicode `White_Space` set; reject line/paragraph separators, Cc and bidi overrides/isolation controls. Count **Unicode code points after normalization**; max 100; server authoritative.
3. Comparison key: default full Unicode case fold, then NFC; **not NFKC**. Full folding means e.g. `Straße` and `STRASSE` collide, which PL must explicitly approve. ZWJ sequences must not be casually rejected.
4. ID: `"k_" + Base64URL_no_padding(UTF8(canonicalKey))`. Include `canonVersion` on item and nameKey documents; check actual UTF-8 encoded length and Firestore 1500-byte ID ceiling, reject oversize `VALIDATION_FAILED`. Do not assume every 100-code-point input fits without proof.
5. Shared pinned Unicode tables and Kotlin/TypeScript test vectors, including Turkish I, Greek sigma, accents, whitespace, emoji, control characters and 100/101 boundaries. Pinning version is an open PL decision.

## 6. Idempotency and response semantics (proposed)

- Bind operation records to verified `(actorUid,opId)` and canonical request hash; propose `/users/{uid}/operations/{opId}` or SHA-256 encoded compound key. Private, no direct client reads. Same payload returns original terminal result; changed payload returns `IDEMPOTENCY_KEY_REUSED`.
- Domain terminal outcomes use `COMMITTED` or `REJECTED` envelopes with stable codes; authentication/transport failure may use callable transport errors. A timeout after possible commit is **ambiguous**: retry identical opId and payload, not a new mutation. Actual SDK mapping TBD.
- Minimum 30-day dedup retention **from terminal resolution**; candidate 21-day max automatic replay from creation, but special treatment required for in-flight ambiguity and aged work. Never auto-replay outside policy; quarantine and notify.

## 7. Firestore persistence, reads and Clear All (proposed)

- Android Firestore client: memory-only cache (no Firestore plaintext disk persistence); encrypted per-UID Room is intended sole durable local family store. Verify SDK version/config and data-at-rest behavior in future Verity tests.
- Direct client writes denied to all collections. Member-scoped read projections only; operations, nameKeys, invites, tokens, billing and deletion internals not directly readable.
- `items.prepareClear` binds exact `{itemId,version}` snapshot, actor, family and expiry; `items.clearConfirmed` deletes only bound matching versions. Concurrent new items survive. Chunking and partial outcome semantics must be specified within actual transaction limits; token TTL TBD. No implementation assumptions about Firestore TTL enforcement in emulators.

## 8. Explicit consistency fixes proposed

- API v0.2 §5: paid revocation immediate read-only + 30-day retention is **already approved ADR-06**; remove obsolete pending-language on approval.
- Companion reference should be Architecture v1.1, not v1.0.
- UI Undo timeout follows approved UX v0.2: `max(5000ms, AccessibilityManager.getRecommendedTimeoutMillis(...))`, not fixed five seconds. Visible action window must equal actual actionable duration.
- Trial start, email verification, encryption/key loss, default-ignorables, Unicode version, name-key prefix, and new endpoints remain decision-gated. **Conflict semantics P4-D03 are PL-approved, pending GAI document recheck and canonical API incorporation.**

## 9. Proposed contract review checklist

GAI should test the *specification* for transactional membership/entitlement checks, one-family invariant, privacy, opId replay, client ID spoofing/collision, rejected dependent operations, auth projection leakage, Unicode parity, Clear All partials, and explicit PL decision gates. All executable tests remain **NOT_RUN**.

## Document Completeness Verification

**Code: 8723434126**
