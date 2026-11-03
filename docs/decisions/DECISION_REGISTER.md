# newBaileysCart Decision Register

- **Register version:** 1.11. Records the PL **acceptance** of WP03-S2-SEC-DISP (2026-11-03; expires 2026-12-01T00:00:00Z), the release of WP03-S2-HOLD for the authorized merge, the merge of PR #6 into `develop` (merge commit `dddb7ca`) and post-merge FORGE run #39. v1.10 recorded WP03-S2-SEC-DISP as proposed (pending final PL authorization; not then active in remote CI). v1.9 recorded the PL acceptance of T-GAP-6, the canonical ProofPoint ID PL-PP-WP03-31, the GAI D4 review of Slice 2 (report v1.1) and the PR #6 hold. v1.8 recorded the WP-03 Slice 2 hardening authorization and the HB-1/HB-3 fail-closed output decisions. v1.7 recorded the administrative closure of WP-03 Slice 1, and that Gate C for WP-03 Slice 2 remained CLOSED. v1.6 recorded Gate C for WP-03 Slice 1 and decisions PL-1..PL-10. v1.5 recorded R-04 ratification: the R-04 v0.4 four-document specification baseline. v1.4 resolved WP00-OPEN-03; v1.3 added WP00-MAINT-01; v1.2 added WP00-REPRO-01; v1.1 resolved WP00-OPEN-02.
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

### WP-03 Slice 2 hardening (register v1.8)

The WP03-S2-GATE entry above (v1.7) is retained as the historical record. These entries record decisions only; the A1 v0.2 contract is unchanged.

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| WP03-S2-GATE-C | **Gate C OPEN for WP-03 Slice 2 hardening only:** HB-1, HB-2, HB-3 and test gaps T-GAP-2, T-GAP-6, T-GAP-9 in existing backend functions. Excludes new family-record writers, billing, Android UI, shopping lists, provisioning and deployment. No merge without separate PL approval. | PL | 2026-10-31 | CipherMuse → CODI "WP-03 Slice 2 Sprint" handoff |
| WP03-S2-HB1-OUT | **HB-1 output:** an OWNER entry whose stored `lifecycleState` is missing or not a recognized value fails the whole `account.getSession` call with sanitized `INTERNAL` (backlog v1.1 option (b)). A server-side integrity event is logged with identifiers only. No A1 contract change. Resolves the open decision in ratification record v1.1 §4. | PL | 2026-10-31 | PL answer to CODI during the Slice 2 sprint; `CODI_WP03_S2_Hardening_Sprint_Report_v1.0.md` §1 (local, untracked) |
| WP03-S2-HB3-OUT | **HB-3 output:** inconsistent stored records (more than one OWNER membership; `ownedFamilyId` and OWNER membership not consistent; lifecycle timestamps not exclusive or not consistent with `lifecycleState`) fail the whole call with sanitized `INTERNAL`, with an identifiers-only integrity event. No A1 contract change. | PL | 2026-10-31 | As WP03-S2-HB1-OUT |
| WP03-S2-HB3-RESID | **HB-3 residual case:** a family whose `ownerUid` is the caller, reached through a non-OWNER membership that `ownedFamilyId` does not name, also fails the call with sanitized `INTERNAL` and never yields `READ_WRITE`. Legitimate MEMBER access is unchanged. | PL | 2026-10-31 | CipherMuse → CODI "WP-03 Slice 2 — Final Hardening & Dependency Fix" handoff §1 |
| WP03-S2-HB2 | **HB-2:** a stored `displayName` failing PL-5 is omitted and logged (backlog v1.1; no decision was open, recorded for completeness). | — | 2026-10-31 | `WP03_S1_HARDENING_BACKLOG_v1.1.md` |

The "Still open" line of v1.8 (T-GAP-6 acceptance; GAI D4 review of the Slice 2 hardening) is resolved by the v1.9 entries below.

### WP-03 Slice 2 closeout (register v1.9)

These entries record decisions only; the A1 v0.2 contract is unchanged.

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| WP03-S2-TGAP6 | **T-GAP-6 accepted:** Firestore's documented read-only transaction snapshot guarantee is **accepted as an approved platform dependency** for `account.getSession`. Code-side evidence: one transaction with `{ readOnly: true }`, all reads inside it, no writes (D1 `test/unit/session.test.ts`; NC-26 caught). **Production verification remains a separate future cloud gate**; this acceptance is not production evidence. | PL | 2026-11-01 | CipherMuse → CODI "WP-03 Slice 2 — Approved Closeout" §2; GAI D4 v1.1 §3 |
| WP03-S2-PP31 | **Canonical ProofPoint ID `PL-PP-WP03-31`** assigned to the Slice 2 session-integrity ProofPoint (formerly `PROPOSED-WP03-S2-GETSESSION-INTEGRITY`). The file is now `tests/verity/proofpoints/PL-PP-WP03-31.yaml` in suite `PS-ACCESS-ISOLATION`. The assignment is a PL decision, so CODI did not invent the ID. | PL | 2026-11-01 | Closeout handoff §1; GAI D4 v1.1 §4.2 (finding GAI-WP03-S2-LOW-01) |
| WP03-S2-GAI | GAI Independent D4 Verification of WP-03 Slice 2, **report v1.1**, governed by **Pennington Labs Engineering Workflow v2.3** per PL direction. It supersedes v1.0, which cited Workflow v2.4 and preceded the PL decisions above. Verdict: **CONDITIONAL GO**: the code and hardening are verified, and the PR #6 merge is on HOLD. Target `da662c0`; FORGE runs #33 (`41214464755`) and #34 (`41214862064`). | GAI (review); PL (governing baseline) | 2026-11-01 | `GAI_WP03_S2_Independent_D4_Verification_v1.1.md` (local, untracked; SHA-256 `338ab150…48e4`) |
| WP03-S2-HOLD | **PR #6 remains ON HOLD.** The required `FORGE gate` check is red only on `osv-scanner` (GHSA-3g3m-2fjr-6pw4 `glob`, GHSA-g3hv-75wg-m249 `minimatch`; pre-existing, not introduced by Slice 2). **No merge, deployment, scanner exception or forced dependency override is authorized.** The hold continues until compatible upstream releases exist (finding GAI-WP03-S2-BLK-01). | PL | 2026-11-01 | Closeout handoff; GAI D4 v1.1 §6.4 |

**Still open:** the PR #6 merge, blocked by the upstream advisories above and needing separate PL approval. T-GAP-6 production verification is a future cloud gate.

### WP-03 Slice 2 security disposition (register v1.10) — PROPOSED; **ACCEPTED in v1.11** (see below)

**v1.11 status note:** the v1.10 text below is retained as the historical record of the proposal. WP03-S2-SEC-DISP was **ACCEPTED** by the PL on 2026-11-03 (entry WP03-S2-SEC-ACCEPT in the v1.11 section below). The statements "not finally approved", "not active in remote CI" and "PR #6 remains ON HOLD" were true on 2026-11-02 and are superseded.

This entry records a **proposed** risk exception, **not a vulnerability fix**. It is **not finally approved** and is **not active in remote CI**. The PL authorized local implementation and testing only (CipherMuse → CODI "Operation Gatekeeper — Controlled Local Implementation", 2026-11-02). WP03-S2-HOLD remains in force: **PR #6 remains ON HOLD**, and no merge or deployment is authorized.

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| WP03-S2-SEC-DISP | **Proposed time-boxed disposition** of exactly two advisories in `backend/functions/package-lock.json`: **GHSA-3g3m-2fjr-6pw4** (`glob` 10.5.0) and **GHSA-g3hv-75wg-m249** (`minimatch` 3.1.5, 5.1.9, 6.2.3, 9.0.9), both MODERATE. **Mechanism:** `backend/functions/osv-scanner.toml` (two `[[IgnoredVulns]]` entries, `ignoreUntil = 2026-12-01T00:00:00Z`), enforced by `scripts/check-osv-exceptions.mjs`. That policy step runs in FORGE immediately before the unchanged scan, fails closed, and allows only these two IDs, a UTC expiry no later than 2026-12-01T00:00:00Z, a reason citing WP03-S2, and no other scanner configuration file or flag anywhere (PL-PP-WP00-04b). Scanner coverage, the pinned binary, the lockfile list and the SBOM are unchanged. **Production evidence:** the vulnerable code is present in the deployed dependency set but showed no reachability (CODI Prove Zero: 0 loads in a production-like harness while the declaring parents `google-gax@5.0.8`/`gaxios@7.1.3` were active; static analysis found no importer). **Limits:** the cloud build was not verified (devDependency omission, serving framework), and production-only code paths were analysed statically only. **Development/CI exposure is NOT zero:** `firebase-tools` loads `glob` and `minimatch` in every emulator and CLI run; GAI rates it LOW–MODERATE, bounded by repository access control. **Scope:** the suppression is advisory-wide for that lockfile. It covers production and tooling copies alike, and it also hides **any future occurrence of the same two IDs** introduced before expiry. **Expiry and revalidation:** the exception lapses automatically at 2026-12-01T00:00:00Z, when the policy step and the scanner both fail. Renewal requires a new PL decision with re-run reachability evidence. Remove it early once upstream ships fixes (`@google-cloud/firestore` admitting `firestore-api` ≥ 0.4; `firebase-tools` on `glob` ≥ 14.0.2 / `minimatch` ≥ 11.0.1). Revalidate on any change to `firebase-admin`, `firebase-functions`, `@google-cloud/firestore` or `firebase-tools`. **Relationship to WP03-S2-HOLD:** if finally authorized, this would supersede only that entry's "no scanner exception" clause, for these two IDs until expiry. The rest of WP03-S2-HOLD stands (no forced dependency override, merge or deployment). **Owner:** Project Lead. | PL (pending final authorization on 2026-11-02; **ACCEPTED 2026-11-03**, see WP03-S2-SEC-ACCEPT); GAI D4 CONDITIONAL GO | 2026-11-02 (proposed); 2026-11-03 (accepted) | `GAI_WP03_S2_Operation_Gatekeeper_D4_Verification_Report.md` (local, untracked; SHA-256 `ce2acda0…09b2`); `CODI_WP03_S2_Operation_Gatekeeper_Pilot_Report_v1.0.md` (`d5260b09…9043`); `CODI_WP03_S2_Prove_Zero_Runtime_Reachability_Report_v1.0.md` (`1be303a0…1a91`); `CODI_WP03_S2_Gatekeeper_Local_Implementation_Report_v1.0.md` |

**Pending before activation:** final PL authorization; a Linux FORGE run verifying the policy step, the scan and the gate (PL-PP-WP00-04b D3); GAI review (D4); and registering PL-PP-WP00-04b in suite PS-BUILD-SUPPLY-CHAIN, which needs a tracked-file change that has not been authorized.

*(v1.11: every item in the paragraph above is resolved. Final PL authorization: WP03-S2-SEC-ACCEPT. Linux FORGE: runs #37, #38 and #39. GAI D4: pre-push GO and post-push final GO. Suite registration: committed in `0524a58`.)*

### WP-03 Slice 2 acceptance and merge (register v1.11)

These entries record decisions and verified results only. The A1 v0.2 contract, application logic, dependencies, the security exception files and the FORGE policy are unchanged by this register version.

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| WP03-S2-SEC-ACCEPT | **WP03-S2-SEC-DISP ACCEPTED** as written in v1.10 above: a time-boxed exception for exactly **GHSA-3g3m-2fjr-6pw4** (`glob`) and **GHSA-g3hv-75wg-m249** (`minimatch`) in `backend/functions/package-lock.json`. **Expiry: 2026-12-01T00:00:00Z**, after which the policy step and the scanner fail closed. **This is temporary risk acceptance, NOT a vulnerability fix.** The vulnerable packages remain in the lockfile, and **development/CI exposure remains nonzero** (`firebase-tools` loads `glob` and `minimatch` in every emulator and CLI run). The agreed compensating governance controls are independent GAI review and explicit PL merge authorization. All v1.10 scope, revalidation and early-removal conditions continue to apply. | PL **APPROVED** | 2026-11-03 | CipherMuse → CODI "WP03 Slice 2 — Authorized Merge Execution" §1; GAI recommendation `GO` in `GAI_WP03_S2_Gatekeeper_PostPush_Final_D4_Report.md` (local, untracked; SHA-256 `b07b181c…f9a3`) |
| WP03-S2-HOLD-REL | **WP03-S2-HOLD released for the authorized merge of PR #6 only.** The "no scanner exception" clause is superseded for the two IDs above until expiry (as anticipated in v1.10). Its other prohibitions still stand: no forced dependency override and no deployment. | PL | 2026-11-03 | As WP03-S2-SEC-ACCEPT |
| WP03-S2-MERGE | **PR #6 merged into `develop`** by the PL using a merge commit (2026-11-03T14:54:33Z). Merge commit **`dddb7caf743934324b969726fcac84ac8bdde884`**; parents `509cfeaf5a5b8884e19a63cd824d3b3f559ecf13` (prior `develop`) and `0524a58de58535a220d304472619af21cf5b302a` (GAI-reviewed PR head). The merged tree is identical to `0524a58`. All eight CODI preflight checks passed. `main` was not touched, and the feature branch is preserved. | PL | 2026-11-03 | `CODI_WP03_S2_Merge_Preflight_Report_v1.0.md`; `CODI_WP03_S2_Merge_PostMerge_FORGE_Report_v1.0.md` (local, untracked) |
| WP03-S2-FORGE39 | **Post-merge FORGE run #39** (`41658358920`, push on `develop` at `dddb7ca`) concluded **success, 9/9 jobs**. The steps "Verify security exception policy", "Scan lockfiles", "CycloneDX SBOM", the emulator tests and `FORGE gate` all succeeded. No production deployment occurred, and the GitHub Deployments API lists none. | — (verified result) | 2026-11-03 | https://github.com/egpennington/newBaileysCart/actions/runs/41658358920; `docs/wp03/evidence/EVIDENCE_MANIFEST.md` v1.5 |

**Still open:**
- **PL formal closure of WP-03 Slice 2.** This register version does not declare Slice 2 closed.
- **Revalidation or removal of WP03-S2-SEC-DISP before 2026-12-01T00:00:00Z.**
- T-GAP-6 production verification (future cloud gate).
- **Gate C for WP-03 Slice 3 remains CLOSED.**

## Open decisions raised by WP-00 (not decided)

| ID | Question | Raised by | Notes |
|---|---|---|---|
| WP00-OPEN-01 | Permanent Play `applicationId` | CODI | WP-00 uses the nonproduction placeholder `com.penningtonlabs.baileyscart.wp00placeholder`. An applicationId cannot change after Play publication. |
| WP00-OPEN-02 | Disposition of vulnerabilities in Android Lint tool dependencies (`androidLintTool` configuration, bundled by AGP 9.4.0) | CODI | **RESOLVED 2026-10-26.** The PL authorized Fix B: patched versions for the lint tool configuration only. No suppression or exception was applied. See the version decision record. |
| WP00-FIX-A | Repair verification metadata after FORGE run 40447910773 clean-cache failure | PL AUTHORIZED 2026-10-26 | Additions only. Each new checksum validated against publisher SHA-1. |
| WP00-REPRO-01 | Reproducibility policy (GAI-WP00-MAJ-01): the `:core:model` JAR must be byte-identical across two independent clean CI builds (hard gate). APK hash comparison is informational for WP-00. | PL APPROVED 2026-10-26 | Source: `CODI_WP00_HARD_GATE_NEGATIVE_CI_AUTHORIZATION_v1.0.md` (code `9361742805`). Implemented in the `repeat-build` job of `forge-wp00.yml`. |
| WP00-MAINT-01 | Fix C: override `com.google.guava:guava` from `33.4.0-jre` to `33.7.2-jre` on the Android Lint tool classpath (`androidLintTool` configuration only), for **GHSA-xxph-c9ww-hj94 / CVE-2026-102554** (HIGH; uncontrolled memory allocation in deserialization; fixed in 33.7.2). | PL AUTHORIZED 2026-10-27 | Found by the osv-scanner gate in FORGE run 40559437781; the advisory was published 2026-10-27, after the last green run. Build-time Lint tooling only; the shipped APK and application runtime dependencies are unaffected. No suppression or exception was applied. Implemented in `android/build.gradle.kts` next to the Fix B overrides. **Maintenance obligation:** on every Android Gradle Plugin or Lint upgrade, check the Guava version that AGP bundles. Remove this override once AGP ships 33.7.2-jre or later; never let it pin Guava below the bundled version. |
| WP00-OPEN-03 | Branch target: Workflow v2.4 §10 creates `feature/*` from `develop`, but `develop` does not exist; handoff specifies `main` at the baseline | CODI | **RESOLVED 2026-10-27.** On PL authorization, CODI created `develop` from verified `main` (`b6ac365a471f77e0b0dcfb488dc064c106e782c4`). The PL then created ruleset "Pennington Labs - Protected Branches" (id 25981594) on `main` and `develop`. It requires a PR, the `FORGE gate` GitHub Actions check with branches up to date, and resolved conversations; it uses the merge-commit method only and blocks force pushes and deletions. WP-00 merged into `develop` via PR #1 (merge commit `c6afe30acbd9b53016314ca6662420dde2b4e72b`, PL-merged 2026-10-27T19:55:31Z). The PR run 40571030265 and the post-merge `develop` push run 40573451935 passed all 8 jobs. `main` remains at `b6ac365`. New work branches from `develop`. Not yet verified: ruleset bypass actors, and required-check blocking of a red PR. |
