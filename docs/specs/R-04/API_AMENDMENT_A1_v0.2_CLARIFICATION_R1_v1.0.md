# Bailey's Cart — API Amendment A1 v0.2, Clarification R-1: Replay Precedence v1.0

**Status:** PL-APPROVED clarification. **Interpretive documentation only.**
**Date:** 2026-10-29 · **Prepared by:** CODI · **Approved by:** Project Lead (penguinPrime), decision R-1
**Clarifies:** API Amendment A1 v0.2, `docs/specs/R-04/API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.2.md` (SHA-256 `616bd0eb75b191aa6dc9b7157bf07557ad9067c6025870d2b874a794b3e30572`), §A1.6 "Idempotent replay"
**Recorded in:** `API_AMENDMENT_A1_v0.2_RATIFICATION_RECORD_v1.1.md`
**Scope:** WP-03 Slice 1 (`families.create`), as A1 v0.2 is scoped.

## 1. Clarification (PL-approved wording, verbatim)

> Idempotency replay is available only after the caller satisfies the current authentication and verified-email requirements. A previously successful operation does not bypass those checks.

## 2. What this clarification is, and is not

- **What it is.** It governs how §A1.6 is read. §A1.6 describes what a replay returns but does not repeat the evaluation order. This clarification confirms that §A1.6 is subject to the evaluation precedence already stated in §A1.2.
- **No API or runtime change.** This document does **not** change API behavior, runtime authentication, idempotency behavior, error codes, retryability, response fields or envelopes. It adds no requirement beyond what A1 v0.2 §A1.2 and §A1.4 already state.
- **A1 v0.2 is not edited.** It stays byte-identical to its ratified SHA-256. This clarification is a separate referencing document.
- **No conflict.** Where §A1.6 was silent, this clarification controls its interpretation. It does not conflict with any ratified text.

## 3. Basis in A1 v0.2

- **§A1.2, "Evaluation precedence (Slice 1)":**
  1. authentication
  2. request validation
  3. verified email (create only)
  4. inside one Firestore transaction: idempotency replay or reuse, then the owner limit, then the trial or reservation decision
  - Replay is step 4, so steps 1–3 always run first, whether or not the `opId` previously committed.
  - Request validation (step 2) also precedes replay. The PL wording names authentication and verified email; validation precedence is already explicit in §A1.2 and is unchanged.
- **§A1.2:** "Rejections are not recorded as idempotent outcomes. Only committed results are replayed (§A1.6)."
- **§A1.3:** defines "authenticated" (non-empty trimmed string `uid`) and "verified email" (`email_verified === true` exactly), as evaluated on the **current** request's token.
- **§A1.4, `EMAIL_VERIFICATION_REQUIRED` row:** `retryable: false`. After user action and a token refresh, the same `opId` MAY be resubmitted, because rejections are not recorded.

## 4. Illustrative cases (non-normative)

| # | Situation | Outcome under A1 v0.2 + R-1 |
|---|---|---|
| 1 | An `opId` committed earlier is resubmitted **without authentication** | `UNAUTHENTICATED`. No replay. |
| 2 | An `opId` committed earlier while verified is resubmitted after the caller's token has `email_verified` not `true` | `EMAIL_VERIFICATION_REQUIRED`. No replay. |
| 3 | First attempt rejected with `EMAIL_VERIFICATION_REQUIRED`; the caller verifies, refreshes the token and resubmits the same `opId` and payload | Evaluated as a new attempt (nothing was recorded). It commits if the remaining rules allow, and later identical resubmissions replay that commit. |

## 5. Implementation correspondence (source inspection; no change made)

This was read from `feature/wp03-s1-family-ownership` @ `8d2bfa0`. Paths are relative to `backend/functions/`.

| Step | Location |
|---|---|
| Authentication | `src/callable/adapter.ts`: `runCallable` calls `authenticate()` before the handler |
| Validation | `src/commands/familiesCreate.ts:55`, via `parseCreateFamilyRequest` |
| Verified email | `src/commands/familiesCreate.ts:56` |
| Replay | inside the transaction, `src/commands/familiesCreate.ts:66-71` |

## 6. Verification status

| Case | Test gap | Status |
|---|---|---|
| Case 3 | T-GAP-4 | **Not yet closed.** Planned, Phase B; not implemented. |
| Case 2 | T-GAP-10 | **Not yet closed.** Planned, Phase B (PL decision D-2); not implemented. |
| Case 1 | — | Authentication before the handler is covered by existing tests (`test/unit/adapter.test.ts`, `test/e2e/callables.test.ts`). No test resubmits a *committed* `opId` unauthenticated. |

No ProofPoint status changes because of this document.
