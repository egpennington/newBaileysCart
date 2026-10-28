# Bailey's Cart — R-04 Ratification Recommendation after Decisions 46–47

**Status:** RECOMMENDATION ONLY — NOT A PROJECT LEAD RATIFICATION OR GATE C AUTHORIZATION

## Evidence
GAI's `GAI_R04_Contract_Reconciliation_Recheck_Report.md` returned **CONDITIONAL PASS** for the five-document v0.4 candidate package, found prior BLK-01..05 and MAJ-01..04 resolved at specification level, and marked all executable ProofPoints **NOT_RUN**. It requested a 24-hour TTL decision and ownership-lockout disposition. The Project Lead has now approved Decisions 46 and 47. GAI has **not** rechecked their exact contract text.

## Recommendation
1. Incorporate `R04_DECISIONS_46_47_NORMATIVE_ADDENDUM_CANDIDATE.md` into `API_SPEC_v0.4_CANONICAL_CANDIDATE.md`, the PRD and Architecture amendments, authorization/error matrix, and Verity handoff. Update source hierarchy and decision ledger to Decisions 33–47; retain original historical baselines.
2. Ask GAI for a **focused delta recheck** of reservation-expiry/late-payment safety, waiver irreversibility, pending cancellation, owner-slot release, provider identity constraints, and new ProofPoints.
3. Resolve the explicitly open technical contracts (particularly W-01 through W-05 and G-01/G-03) at the appropriate pre-implementation gate; do not turn a conditional specification PASS into an evidence-free billing feasibility PASS.
4. Once GAI reports on the revised integrated package, submit a separate formal **Project Lead ratification record** identifying exact filenames, versions, checksums, precedence, accepted risks, and effective scope. The Project Lead may approve or reject it.
5. **Only after separate Gate C authorization** may CODI branch or implement the specifically approved WP-03 scope. FORGE builds/tests and GAI verification remain subsequent evidence gates.

## Suggested GAI handoff
> GAI: Please conduct a focused independent R-04 delta recheck of the Decisions 46–47 normative addendum against the previously reviewed API v0.4, PRD/Architecture amendments, authorization matrix, and Verity handoff. Verify 24-hour reservation expiry with late-settling purchase reconciliation, irreversible recovery waiver, cancellation-first safety, owner-slot release, stale epoch and idempotency, and proposed ProofPoints 25–30. Identify any remaining pre-ratification blockers and issue PASS / CONDITIONAL PASS / FAIL with evidence. All executable tests remain NOT_RUN. WP-03 and Gate C remain ON HOLD.

## Governance
- **Decisions 46–47:** Approved policy.
- **Integrated v0.4 baseline:** Not yet ratified.
- **Focused GAI delta review:** Not yet performed.
- **WP-03 / Gate C:** HOLD / NOT AUTHORIZED.
