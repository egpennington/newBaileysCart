# newBaileysCart Decision Register

- **Register version:** 1.7. Records the administrative closure of WP-03 Slice 1, and that Gate C for WP-03 Slice 2 remains CLOSED. v1.6 recorded Gate C for WP-03 Slice 1 and decisions PL-1..PL-10. v1.5 recorded R-04 ratification: the R-04 v0.4 four-document specification baseline. v1.4 resolved WP00-OPEN-03; v1.3 added WP00-MAINT-01; v1.2 added WP00-REPRO-01; v1.1 resolved WP00-OPEN-02.
- **Created:** 2026-10-26 by CODI, recording Project Lead (penguinPrime) decisions
- **Rule:** entries record decisions and their sources. They do not change the API contract. Canonical API incorporation is a separate, controlled CipherMuse change that must be recorded here when it happens.

## Ratifications

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| R-01 | Phase 4 planning reconciliation certified **PASS** | GAI (document review, not executed tests) | 2026-10-26 | GAI Phase 4 Focused Reconciliation Recheck Report |
| R-02 | `API_SPEC_v0.3_PROPOSED_AMENDMENTS_REV1.md` (completeness code `8723434126`) **ratified as API v0.3 Rev 1** | PL, following GAI R-01 PASS | 2026-10-26 | CODI WP-00 Implementation Handoff v1.0 §1; PL clarification to CODI, 2026-10-26 |
| R-03 | `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md` received a separate **GAI PASS**; PL policy decisions approved | GAI; PL | 2026-10-26 | Handoff v1.0 §1; PL clarification, 2026-10-26 |
| R-04 | Incorporation of R-02 and R-03 into a canonical API document. **RATIFIED** as the R-04 v0.4 four-document specification baseline: `API_SPEC_v0.4_CANONICAL.md`, `PRD_v1.0_R04_AMENDMENT.md`, `ARCHITECTURE_v1.1_R04_AMENDMENT.md`, `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md` (in `docs/specs/R-04/`; SHA-256 manifest in the ratification record). Covers Decisions 33–47; D42 supersedes D33 on multi-family ownership only. Specification ratification only. | CipherMuse (owner); PL ratified, following GAI integration PASS on the prior unified package. The matrix H1 correction was accepted by the PL and not separately rechecked by GAI. | Not independently timestamped (see note below) | `docs/specs/R-04/R04_PROJECT_LEAD_RATIFICATION_RECORD_APPROVED.md`; `docs/specs/R-04/GAI_R04_v0.4_Unified_Ratification_Verification_Report.md`; Handoff v1.0 §1 |

The document headers of R-02 still read "REVISED PROPOSAL … NOT AN APPROVED API BASELINE". Those headers predate ratification. Per PL direction (2026-10-26), the handoff and later PL decisions supersede older headers **only for the specific decisions amended**.

The four ratified R-04 v0.4 documents still carry pre-ratification status headers (for example "NOT RATIFIED" and "consolidation candidate"). Those headers predate ratification. The files are kept byte-identical to the ratified SHA-256 manifest, so they are not edited. The approved ratification record is the record of their status. Historical R-04 candidates, the superseded signature-review record and `README_REVIEW_FIRST.md` are preserved unmodified as evidence. R-04 is specification ratification only. It does not authorize Gate C, WP-03 implementation, implementation branches, merges, builds, provisioning, test execution, deployment or release. Gate C remains CLOSED and WP-03 remains ON HOLD. These retained dependencies remain open, as do the other open gate items listed in the ratification record:
- W-01/W-02: Firebase callable transport and SDK evidence
- W-05: Google Play identity and billing evidence
- G-01/G-03: reconciliation workers, ownership release and deletion retention
- Verity ProofPoints PL-PP-WP03-01..30, which are NOT_RUN

The ratification record has no independently verified approval timestamp, so the register records none.

## Product and architecture decisions

| ID | Decision | Status | Date | Source |
|---|---|---|---|---|
| P4-D01 | Canonical repository `https://github.com/egpennington/newBaileysCart.git`; baseline `b6ac365a471f77e0b0dcfb488dc064c106e782c4` | PL VERIFIED; CODI checkout certified PASS | 2026-10-26 | Addendum v0.4 §3; WP-00 checkout certification |
| P4-D03 | Ordinary edits: last server-accepted commit wins (Option B); destructive commands keep version/snapshot guards | PL APPROVED | 2026-10-26 | Addendum v0.4 §3; API v0.3 Rev 1 §4 |
| P4-D10 | Trial starts on first successful family creation | PL APPROVED (future integration contract; not WP-00 scope) | 2026-10-26 | Handoff v1.0 §1; R-03 |
| P4-D11 | Verified email required for family creation and invite acceptance | PL APPROVED (future integration contract; not WP-00 scope) | 2026-10-26 | Handoff v1.0 §1; R-03 |
| **P4-ADR-11** | **Android platform floor: minSdk = 26** | **PL APPROVED** | 2026-10-26 | PL clarification to CODI, 2026-10-26. Opened as P4-ADR-11 because ADR-07 is already used for branding rights (Addendum v0.4 §4.8). |
| P4-CI-01 | **GitHub Actions** is the CI provider for FORGE WP-00 build and check workflows | **PL APPROVED** | 2026-10-26 | PL clarification to CODI, 2026-10-26 |
| P4-WP00-SCOPE | WP-00 only, on `feature/wp00-foundations` from the certified baseline. No WP-03/WP-01/WP-02, SQLCipher spike, provisioning, merge or deploy. | PL AUTHORIZED | 2026-10-26 | Handoff v1.0 §2; PL WP-00 implementation authorization |

## WP-03 Slice 1 (Family Ownership Core)

Gate C is open for **WP-03 Slice 1 only**, on `feature/wp03-s1-family-ownership` from `develop` @ `f96e5376804facc2e01bcad7100e4574f05de3c3`. Source: PL "Gate C Authorization & CODI Implementation Handoff" and "WP-03 Slice 1 Implementation Authorization" (2026-10-28), following GAI `GAI_WP03_Slice1_Plan_Verification_Report.md` (CONDITIONAL GO) and `GAI_WP03_S1_Task1_W01_Verification_Report.md` (Task 1 PASS). Plan: `docs/workflow/CODI_WP03_SLICE1_IMPLEMENTATION_PLAN_v1.0.md`. The plan and both GAI reports are local untracked records, not committed. Push, PR, merge and deployment still need separate PL authorization.

| ID | Decision | Status |
|---|---|---|
| PL-1 | W-01 handled as Slice 1 Task 1 (emulator evidence), with a review stop before further work | PL APPROVED; Task 1 PASS (GAI); checkpoint released |
| PL-2 | An expired reservation keeps the owner claim (fail closed); no cleanup until G-01/W-05 define release | PL APPROVED |
| PL-3 | Local and CI Firebase emulators (`demo-*` only) and the Firebase dependencies; Node 22 retained | PL APPROVED |
| PL-4 | Emulator job added to `forge-wp00.yml`, feeding the single `FORGE gate` check | PL APPROVED |
| PL-5 | `displayName`: optional; trimmed; max **50** code points; rejects control, line-break and invisible-format characters and empty values; no canonicalization | PL APPROVED as modified by GAI |
| PL-6 | Trial eligibility = no `trialLedger/{uid}`; anti-abuse (G-05) deferred | PL APPROVED (accepted risk) |
| PL-7 | Provisional names `OWNER_ALREADY_HAS_FAMILY` and `apiVersion` "v0.4" | PL APPROVED |
| PL-8 | Idempotency retention: commit + 30 days + 7-day margin (37 days); TTL policy not configured | PL APPROVED |
| PL-9 | `account.getSession` returns only the caller's own trial eligibility | PL APPROVED |
| PL-10 | R-04 v0.4 sufficient for Slice 1 | PL APPROVED |
| W01-D2 | Domain rejections are native `HttpsError` with the full v0.4 envelope in `details` (Option A), using GAI's mapping table | GAI mandated; PL directed |

### WP-03 Slice 1 closure (register v1.7)

**Slice 1 is closed.** PR #4 was merged into `develop` and Slice 1 was administratively closed on 2026-10-29. The Gate C paragraph above (v1.6) is retained as the historical record of the Slice 1 authorization.

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| WP03-S1-CLOSE | **WP-03 Slice 1 (Family Ownership Core) formally closed administratively.** PR #4 was merged into `develop` at merge commit `bb69c01f76048010d7d22db6ef457e221e89075b` (parents `f96e537…`, `ca742f4…`). Post-merge FORGE run #29 (`40964381385`) concluded success, 9/9 jobs. | PL **GO** | 2026-10-29 | PL "WP-03 Slice 1 Administrative Closure Record" handoff; evidence in `docs/wp03/evidence/EVIDENCE_MANIFEST.md` v1.4 |
| WP03-S1-GAI | GAI's final D4 recommendation, "GO — Recommend Formal Administrative Closure of WP-03 Slice 1", **accepted** | PL | 2026-10-29 | `GAI_WP03_S1_VRIG1_Challenge_and_Closure_Correction_Addendum.md` (local, untracked; SHA-256 `baee3340…f5a7`) |
| WP03-S1-VRIG1 | The VRIG-1 (Verity Report Integrity Gate) source-retrieval pilot **passed**: GAI reported the correct marker from the PL's controlled challenge document. This was a **pilot, not ratified workflow policy**. Retrieval shows source access only; it is **not** proof of runtime correctness. | PL | 2026-10-29 | `VRIG1_WP03_S1_Controlled_Challenge_v1.0.md` (local, untracked) |
| WP03-S2-GATE | **Gate C for WP-03 Slice 2 remains CLOSED.** Slice 1 closure authorizes no Slice 2 work, provisioning or deployment. | PL | 2026-10-29 | PL closure handoff |

**Carried forward from Slice 1 (unchanged):**
- **Accepted limitations:** F-1, F-2 and F-3 apply only while `families.create` is the sole family-record writer.
- **Hardening:** HB-1, HB-2 and HB-3 are mandatory before any additional family-record writer is merged (ratification record v1.1 §4).
- **Open gaps:** T-GAP-2, T-GAP-6 and T-GAP-9 remain open.
- **Administrative follow-ups:** the nine items from the CODI post-merge closure report §5(3)(a–i) are recorded as nonblocking in manifest v1.4.
- **Untouched:** `main`, the preserved branches (`feature/wp03-s1-family-ownership`, `feature/wp03-s1-gate-negative`), production infrastructure and deployments.

## Open decisions raised by WP-00 (not decided)

| ID | Question | Raised by | Notes |
|---|---|---|---|
| WP00-OPEN-01 | Permanent Play `applicationId` | CODI | WP-00 uses the nonproduction placeholder `com.penningtonlabs.baileyscart.wp00placeholder`. An applicationId cannot change after Play publication. |
| WP00-OPEN-02 | Disposition of vulnerabilities in Android Lint tool dependencies (`androidLintTool` configuration, bundled by AGP 9.4.0) | CODI | **RESOLVED 2026-10-26.** The PL authorized Fix B: patched versions for the lint tool configuration only. No suppression or exception was applied. See the version decision record. |
| WP00-FIX-A | Repair verification metadata after FORGE run 40447910773 clean-cache failure | PL AUTHORIZED 2026-10-26 | Additions only. Each new checksum validated against publisher SHA-1. |
| WP00-REPRO-01 | Reproducibility policy (GAI-WP00-MAJ-01): the `:core:model` JAR must be byte-identical across two independent clean CI builds (hard gate). APK hash comparison is informational for WP-00. | PL APPROVED 2026-10-26 | Source: `CODI_WP00_HARD_GATE_NEGATIVE_CI_AUTHORIZATION_v1.0.md` (code `9361742805`). Implemented in the `repeat-build` job of `forge-wp00.yml`. |
| WP00-MAINT-01 | Fix C: override `com.google.guava:guava` from `33.4.0-jre` to `33.7.2-jre` on the Android Lint tool classpath (`androidLintTool` configuration only), for **GHSA-xxph-c9ww-hj94 / CVE-2026-102554** (HIGH; uncontrolled memory allocation in deserialization; fixed in 33.7.2). | PL AUTHORIZED 2026-10-27 | Found by the osv-scanner gate in FORGE run 40559437781; the advisory was published 2026-10-27, after the last green run. Build-time Lint tooling only; the shipped APK and application runtime dependencies are unaffected. No suppression or exception was applied. Implemented in `android/build.gradle.kts` next to the Fix B overrides. **Maintenance obligation:** on every Android Gradle Plugin or Lint upgrade, check the Guava version that AGP bundles. Remove this override once AGP ships 33.7.2-jre or later; never let it pin Guava below the bundled version. |
| WP00-OPEN-03 | Branch target: Workflow v2.4 §10 creates `feature/*` from `develop`, but `develop` does not exist; handoff specifies `main` at the baseline | CODI | **RESOLVED 2026-10-27.** On PL authorization, CODI created `develop` from verified `main` (`b6ac365a471f77e0b0dcfb488dc064c106e782c4`). The PL then created ruleset "Pennington Labs - Protected Branches" (id 25981594) on `main` and `develop`. It requires a PR, the `FORGE gate` GitHub Actions check with branches up to date, and resolved conversations; it uses the merge-commit method only and blocks force pushes and deletions. WP-00 merged into `develop` via PR #1 (merge commit `c6afe30acbd9b53016314ca6662420dde2b4e72b`, PL-merged 2026-10-27T19:55:31Z). The PR run 40571030265 and the post-merge `develop` push run 40573451935 passed all 8 jobs. `main` remains at `b6ac365`. New work branches from `develop`. Not yet verified: ruleset bypass actors, and required-check blocking of a red PR. |
