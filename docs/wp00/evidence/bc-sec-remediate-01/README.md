# BC-SEC-REMEDIATE-01 evidence archive

This folder archives the engineering and review reports for BC-SEC-REMEDIATE-01 (PR #25): the retirement of all three time-boxed security exceptions before 2026-12-01T00:00:00Z.

- **Archived by:** CODI, 2026-11-19, under the PL authorization for the BC-SEC-REMEDIATE-01 documentation closeout.
- **Rule:** the archived reports are byte-identical copies of the files as delivered. **They are not edited.** Corrections and later results are recorded below and in the decision register (v1.20).

## Archived reports

| File | Author | Role | SHA-256 (as delivered and as committed) |
|---|---|---|---|
| `BC-SEC-REMEDIATE-01-PR25-CI-FAILURE.md` | CODI | Engineering report: run #99 attempt 1 failure investigation and FORGE fail-fast proposal (design only) | `6e70d1d07ef94b46211d9d2722b8fe797ecfed29b0d6882cc0e0a60c6e1e5155` |
| `BC-SEC-REMEDIATE-01-GAI-D4-REVIEW.md` | GAI | **Final D4 review: APPROVE (GO).** Document ID `GAI-D4-BC-SEC-REMEDIATE-01` | `6d61138ec40a83efa3d987b4a79a50a2bcf8213c08f0fa76d165e74d4e1df1fc` |
| `BC-SEC-REMEDIATE-01-GAI-D4-REVIEW-v1-SUPERSEDED.md` | GAI | First D4 review: APPROVE WITH CONDITIONS. **Superseded** by the final review; kept for verification history | `c03fdeea6d3262f54c8baddc0c7e40e406cb3cf0a1d5b73ecbde90b3f2d84812` |

The two GAI reports were supplied by the PL. Each was saved without modification at `reports/BC-SEC-REMEDIATE-01-GAI-D4-REVIEW.md` in the local workspace, where the final review replaced the first. The superseded file name was assigned by CODI when archiving; its content is unchanged.

## Verification history

| Step | Result | Source |
|---|---|---|
| PR #25 head `edb85e9`, base `develop` `f3c68da` | Opened by the PL | PR #25 |
| FORGE run #98, push, `edb85e9` | **success, 12/12 (FULL)** | [44604960563](https://github.com/egpennington/newBaileysCart/actions/runs/44604960563) |
| FORGE run #99, pull_request, merge ref `102cae1` (tree identical to `edb85e9`), attempt 1 | **failure.** Clean repeat build `135879958586` failed after 42 s (`Plugin [id: 'org.jetbrains.kotlin.jvm', version: '2.4.10', apply: false] was not found`, as reported by the PL; the raw log was not read by CODI). Path verification `135899797917` and FORGE gate `135899878280` failed as a consequence. The other 9 jobs succeeded. | [44614595322](https://github.com/egpennington/newBaileysCart/actions/runs/44614595322); CODI report |
| CODI investigation | Probable transient plugin-resolution failure on the runner; not a defect in the PR. No files changed. | `BC-SEC-REMEDIATE-01-PR25-CI-FAILURE.md` |
| FORGE run #99, attempt 2 (PL "Re-run failed jobs", no code change) | **success, 12/12.** Re-run jobs: Clean repeat build `135912563735`, Path verification `135914456353`, FORGE gate `135914545966`. The other 9 jobs carry their attempt 1 success. | [44614595322](https://github.com/egpennington/newBaileysCart/actions/runs/44614595322) |
| GAI D4, first review | APPROVE WITH CONDITIONS. CODI found factual errors (see below); recommended NO-GO until corrected | `BC-SEC-REMEDIATE-01-GAI-D4-REVIEW-v1-SUPERSEDED.md` |
| GAI D4, final review | **APPROVE (GO).** 0 npm audit findings, corrected run #99 findings, PR #22 conditions dropped as moot | `BC-SEC-REMEDIATE-01-GAI-D4-REVIEW.md` |
| CODI pre-merge check (2026-11-19 ~22:21Z) | PR mergeable (`clean`), head `edb85e9`, all 12 FORGE checks success; fresh full-tree `npm audit` on `edb85e9` 0 findings and gate exit 0; `check-osv-exceptions.mjs` exit 0 with 0 exceptions | CODI |
| PR #25 merge | **Merged** into `develop` by the PL, 2026-11-19T22:45:32Z. Merge commit `96396f7aff52de7089f49224484ad206752cb888` (parents `f3c68da`, `edb85e9`); tree `56d6265c…` identical to `edb85e9` | PR #25 |
| Post-merge FORGE run #100, push, `develop` `96396f7` | **success, 12/12, FULL** (attempt 1, completed 2026-11-19T23:18:50Z; Path verification `135956339677`, FORGE gate `135956410998`) | [44631595739](https://github.com/egpennington/newBaileysCart/actions/runs/44631595739) |

## Addendum A: CODI report status after attempt 2

The CODI report records fresh PR verification as **NOT RUN (PENDING)** and its final recommendation as **BLOCKED** until a re-run passed. Both conditions were then met: run #99 attempt 2 concluded success, 12/12 (above), with no change to the PR. The report's recommendation therefore moved to **READY FOR REVIEW**, as the report itself specified. The report's root cause remains a **probable, not proven** transient failure, because the raw job log was never read.

The FORGE fail-fast proposal in section 5 of the report is a design proposal only. It is **not implemented** and needs a separate PL decision.

## Addendum B: corrections to the final GAI D4 review

The final GAI review stands as GAI's decision (APPROVE (GO)). CODI records two factual inaccuracies in it. Neither changes the security conclusion.

| # | GAI statement | Repository fact |
|---|---|---|
| B-1 | §3.2: "`backend/functions/package.json` adds an explicit override for `"glob": "14.x"`" | The override is the **exact pin** `"glob": "14.0.6"` (`backend/functions/package.json` at `edb85e9`). The registered decision BC-SEC-REM-GLOB and `docs/wp03/VERSION_DECISION_RECORD.md` record 14.0.6. |
| B-2 | §5: "GAI verified the exact diff of commit `edb85e9` against `develop@f3c68da`" and lists 9 files | `git diff --name-status f3c68da edb85e9` lists **14 files**. The 5 files not listed by GAI are documentation and test data only (below). None is application source, a dependency file, a Gradle file or a workflow. |

**PR #25 complete file list (14):**

| Status | File | In GAI §5 list |
|---|---|---|
| M | `.github/workflows/forge-wp00.yml` (one step name, one comment) | yes |
| D | `backend/functions/osv-scanner.toml` | yes |
| M | `backend/functions/package-lock.json` | yes |
| M | `backend/functions/package.json` | yes |
| M | `docs/BUILD.md` | yes |
| M | `docs/decisions/DECISION_REGISTER.md` | **no** |
| M | `docs/forge/FORGE_FP01_FAST_PATH.md` | **no** |
| M | `docs/wp00/evidence/EVIDENCE_MANIFEST.md` | **no** |
| M | `docs/wp03/VERSION_DECISION_RECORD.md` | **no** |
| M | `scripts/check-npm-audit.mjs` | yes |
| M | `scripts/check-osv-exceptions.mjs` | yes |
| A | `scripts/forge/tests/fixtures/npm-audit-bc-sec-remediate-01.json` | **no** |
| M | `scripts/forge/tests/security-exceptions.test.mjs` | yes |
| M | `tests/verity/proofpoints/PL-PP-WP00-04b.yaml` | yes |

## Addendum C: errors in the superseded first GAI review (corrected in the final review)

Recorded for history; the final review corrected all of these.

| First-review statement | Repository fact |
|---|---|
| 12 moderate npm audit findings "remain", all in dev tooling | The 12 moderate findings belong to the **pre-PR** tree `f3c68da` (6 of them also in `--omit=dev`). On `edb85e9` the full tree and the production tree both report **0**. Same command and environment for both trees. |
| Conditions 1 and 2: merge PR #25 before PR #22, then rebase PR #22 | PR #22 (LP-2) was already merged into `develop` on 2026-11-18T22:49:23Z. Both conditions were moot. |
| `osv-scanner.toml` "contains zero active exception blocks" | The file is **deleted**; any scanner configuration file now fails the policy check. |
| Overrides for `glob` and `minimatch` | Only `glob` is overridden; `minimatch` 11.0.9 arrives through `glob` 14.0.6. |
