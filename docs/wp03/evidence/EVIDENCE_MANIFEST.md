# WP-03 Evidence Manifest (Slices 1–2, Slice 3 Substage 3A): PS-BILLING-LIFECYCLE, PS-ACCESS-ISOLATION, PS-BUILD-SUPPLY-CHAIN, PS-RETENTION, PS-OFFLINE-SYNC

- **Version:** 1.7 (2026-11-05). Changes from v1.6:
  - adds the section "WP-03 Slice 3B Stage B1: local billing engine (v1.7)" before "History". It covers PR #11 (reviewed head `148415d`; merge commit `ad1b700`), local D1/D2 evidence, NC-33..NC-39, FORGE runs #49–#51, the GAI D4 record with CODI-inspected corrections, ProofPoint status and carry-forward obligations. Every earlier section is unchanged, including the title, which predates Slice 3B.

  v1.6 (2026-11-05) changes from v1.5:
  - adds the section "WP-03 Slice 3 Substage 3A: family lifecycle (v1.6)" before "History". It covers PR #8 (reviewed head `23d751a`; merge commit `7ca19f3`), local D1/D2/D3 evidence, NC-28..NC-32, FORGE runs #42–#44, the GAI D4 record with CODI-inspected corrections, ProofPoint status and remaining obligations.
  - retitles the manifest to include Slice 3 Substage 3A and the two new suites. Every Slice 1 and Slice 2 section is unchanged.

  v1.5 (2026-11-03) changes from v1.4:
  - adds the section "WP-03 Slice 2: ownership hardening and security disposition (v1.5)" before "History". It covers the Slice 2 implementation, local tests, GAI verification, FORGE runs #32–#39, the merge of PR #6 (merge commit `dddb7ca`), post-merge run #39, the accepted time-boxed security disposition and dependency-expiry tracking.
  - retitles the manifest to cover Slices 1–2. Every Slice 1 section is unchanged.

  v1.4 (2026-10-29) changes from v1.3:
  - records the merge of PR #4 into `develop` (merge commit `bb69c01`), post-merge FORGE run #29, and the PL's formal administrative closure of WP-03 Slice 1 ("Post-merge and closure" below)
  - records the nine nonblocking administrative follow-ups, the VRIG-1 pilot result and GAI's accepted closure recommendation
  - the v1.3 header lines for branch and PR state are kept and marked superseded

  v1.3 (2026-10-29) changes from v1.2:
  - records the Phase B test commit `94d31d9`, its local evidence (D1 129/129; emulator 143/143; NC-10..NC-16) and FORGE runs #22–#26
  - records the PL-inspected run #25 totals
  - records the GAI Phase A and Phase B D4 reports and their correction addenda, in chronological order with their supersession relationships
  - records the seven Phase B test gaps as **closed within Slice 1 scope**, with provenance. T-GAP-2, 6 and 9 stay open.
  - earlier sections are retained. Where v1.3 changes a v1.2 statement, the v1.2 text is kept and marked as superseded.
  - records the Phase B local evidence archive and its SHA-256 (archived after the initial v1.3 preparation; the earlier "not yet archived" wording is replaced)

  v1.2 corrected stale branch, PR and D4 statements, recorded FORGE run #21 and GAI's 2026-10-28 final D4 determinations, and recorded the A1 v0.2 traceability result. v1.1 recorded FORGE runs #19 and #20 and the `shell: bash` repair. v1.0 recorded local evidence only.
- **Collected by:** CODI, 2026-10-28 (v1.0–v1.1); 2026-10-29 (v1.2, v1.3, v1.4); 2026-11-03 (v1.5); 2026-11-05 (v1.6)
- **Branch (v1.4):** merged into `develop` at `bb69c01f76048010d7d22db6ef457e221e89075b`. The feature branch `feature/wp03-s1-family-ownership` (`ca742f4…`) is preserved. This v1.4 update is uncommitted until a commit is separately authorized.
- **Pull request (v1.4):** #4 **MERGED** into `develop` at 2026-10-29T22:14:55Z (https://github.com/egpennington/newBaileysCart/pull/4).
- *Superseded v1.3 header lines (kept as history):*
  - "Branch: `feature/wp03-s1-family-ownership`, pushed to `origin`. Remote head at the time of v1.3: `94d31d9…`."
  - "Pull request: #4, Draft … Merge is not authorized. GAI's corrected Phase B record places merge on HOLD pending the PL's decision."
- **Base:** `develop` @ `f96e5376804facc2e01bcad7100e4574f05de3c3`
- **Implementation commits:**
  - `ac3a54e9b4575dd5d1cc13e69d39c0eaf775c5dd` dependencies, emulator config, deny-all rules
  - `75bf4b1222cc0820de4793266d5333bbd4a2459c` contract, validation, pure domain (Tasks 2–3)
  - `d7beae883c98b2aa739990571bd9c75f86a24c51` `families.create`, `account.getSession`, adapter, tests (Tasks 4–7)
  - `e4e9e1cfbbbce0638e1823f98cc5288d4e137858` FORGE emulator job (Task 8)
  - `fa5b329bbf124ccbd9a5f8506d3b457b8312ac1f` documentation: this manifest v1.0, the Verity YAMLs and the version record
  - `aa8db5b60fec141e74fe12138539d7af1cb5829c` CI repair: `shell: bash` on the emulator test step (PL-authorized gate-integrity remediation)
  - `8d2bfa041641b559b8bfd3b07ad4acfd2744d92e` documentation: this manifest v1.1
  - `e0f885d4abcd8187d6b2f62e1fba5835363cd25d` documentation: API Amendment A1 v0.2 (ratified, SHA-256 `616bd0eb…0572`), ratification record v1.1, clarification R-1, hardening backlog v1.1
  - `b12f0ea9965cbed41b2dbc96bce8d7e72a3588c6` documentation: this manifest v1.2 and the Verity YAML corrections
  - `94d31d9a88ad14791e64d4945301983ba1653f92` Phase B tests (test-only): T-GAP-1, 3, 4, 5, 7, 8, 10; `ajv` 8.20.0 exact devDependency; version record. 9 files; no production source change.
  - `ca742f49a213af65673ada2784c89ce2711b22c8` documentation: this manifest v1.3 and the Verity gap-closure records
  - `bb69c01f76048010d7d22db6ef457e221e89075b` **merge commit** of PR #4 into `develop` (parents `f96e537…`, `ca742f4…`)
  - A documentation commit recording this manifest v1.4 on `develop` (pending authorization)
- **Local environment:** Windows 11 (amd64), Git Bash
  - Node v22.18.0, npm 10.9.3
  - Firestore emulator on OpenJDK 25.0.3 (Android Studio JBR). CI pins Temurin 21.0.12+8.
  - firebase-tools 15.34.1; `cloud-firestore-emulator-v1.22.0.jar`
  - osv-scanner 2.7.0 (Windows build; SHA-256 `9964ed64…6438` from the release SHA256SUMS, whose Linux entry equals FORGE's pin)
  - gitleaks 8.30.1 (Windows build; SHA-256 `d29144de…c4e`, same release checksums file)
- **Raw logs:** retained outside the commits, in the untracked archive `docs/specs/R-04/WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` (SHA-256 `9162ac5e39f30daa2fe6bf31ca15ff12a29e80b08383673d494ce8aadf9a1833`; per-file sums in `WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.SHA256SUMS.txt`, 37 files). The logs contain local machine paths.
- **Phase B raw logs (archived 2026-10-29):**
  - **Archive:** `WP03_S1_PHASE_B_LOCAL_TEST_EVIDENCE_v1.0.tar.gz`, SHA-256 `5c5e0142a30d902230d7d064f5c1c808ad3023e6a506a177f878fffa075a8843`
  - **Checksum manifest:** `WP03_S1_PHASE_B_LOCAL_TEST_EVIDENCE_v1.0_SHA256SUMS.txt`. It lists the archive hash and the SHA-256 of every archived file.
  - **Storage:** the existing local evidence store **outside the Git repository**, not committed. The archive contains local machine paths.
  - **Contents:** 36 files, including:
    - every NC-10..NC-16 test log, mutation diff, build and post-restore build output
    - the harness `nc.py` and its `summary.txt` (per-control pre/post SHA-256 and restoration)
    - the full Phase B emulator log `emulator-run1.log`
    - the NC batch and emulator task outputs
    - the pre-install lockfile backup and the osv-scanner release checksums
  - **Integrity:** CODI reports successful extraction and a SHA-256 match for all 36 files against the originals and the checksum manifest (`docs/specs/R-04/CODI_WP03_S1_PHASE_B_EVIDENCE_ARCHIVAL_REPORT_v1.0.md`, not committed).
  - **Not archived:** D1, typecheck, npm and osv raw outputs were never saved as files and were not regenerated.
  - **Verification boundary:** GAI has **not** independently inspected these raw Phase B negative-control logs. Archiving preserves the evidence; it does not independently prove the results.
  - **Retention:** preserve the archive and checksum manifest. No cleanup is authorized.
  - **Separate from v1.0:** these logs are **not** in the v1.0 archive above.
- **FORGE:**
  - Run #19 passed on `aa8db5b`, with 137/137 emulator tests passing.
  - Run #20, the gate-integrity negative control, failed as intended.
  - Runs #21 (`8d2bfa0`), #22 (`8d2bfa0`), #23 and #24 (`b12f0ea`) passed, 9/9 jobs each.
  - Runs #25 and #26 passed on the Phase B commit `94d31d9`, 9/9 jobs each. Run #25's totals were PL-inspected: D1 129/129, emulator 143/143.
  - Run #29 (`40964381385`, `push` to `develop`, merge commit `bb69c01`) passed, 9/9 jobs. Its emulator totals come from PL screenshots; its D1 totals are NOT VERIFIED.
  - Run #18 (`fa5b329`) is superseded.
  - Details are in "FORGE CI evidence" below.

## Test runs (Slice 1 implementation, v1.0)

| Run | Commit / tree | Command | Result |
|---|---|---|---|
| D1 unit | HEAD `e4e9e1c`, after a clean `npm ci --ignore-scripts` | `npm test` | **95/95 pass**, 0 fail |
| D2 + rules + D3, run 1 | Working tree identical in content to `d7beae8` (pre-commit) | `npm run test:emulator` | **137/137 pass**, 0 fail, 592 s |
| D2 + rules + D3, run 2 | HEAD `e4e9e1c` (`backend/` and `.github/` verified equal to HEAD), clean `npm ci` | `npm run test:emulator` | **137/137 pass**, 0 fail, 615 s |
| Typecheck | HEAD | `npm run typecheck` | exit 0 |
| npm audit | HEAD lockfile | `npm audit --audit-level=high`; `npm audit --omit=dev` | 0 vulnerabilities (both) |
| osv-scanner | HEAD lockfile + both Gradle lockfiles | FORGE's exact `scan source -L …` | "No issues found" |
| SBOM | same | CycloneDX 1.6 | 844 components |
| gitleaks | `f96e537..HEAD` (4 commits) and full history | `gitleaks git --config .gitleaks.toml --redact` | no leaks found |
| Firebase guard | working tree | `scripts/check-no-real-firebase.sh` | PASS (demo-* only) |

The 137 emulator tests (counted from the run 2 log) break down as:
- **30 D2:** `families.create` 21, including three 50-iteration × 5-parallel stress tests and 6 rollback steps; `account.getSession` 9.
- **97 rules:** 3 callers × 32 access attempts, plus 1 integrity check.
- **10 D3.**

## Negative controls (critical invariants)

Each control changed committed code, ran the targeted tests, and restored the file with `git checkout`. A control is **caught** when the targeted tests fail. All files were verified restored afterwards.

| ID | Invariant broken | Tests run | Result |
|---|---|---|---|
| NC-1r | Owner limit removed from `decideCreate` | D1 | **Caught** (2 not ok) |
| NC-1br | Same | D2 `families.create`, 5 iterations | **Caught** (6 not ok: owner limit, expired-reservation hold, 2 stress tests) |
| NC-2 | Create reads taken outside the transaction (`db.getAll`) | D2, 10 iterations | **Caught** (all 3 stress tests fail: duplicate families/claims) |
| NC-3 | Idempotency payload-hash comparison removed | D2 | **Caught** (both `IDEMPOTENCY_KEY_REUSED` tests) |
| NC-4 | Rules changed to `allow read, write: if true` | rules | **Caught** (101 not ok) |
| NC-5r | Adapter accepts any non-null auth (no uid check) | D1 + D3 | **Caught** (7 not ok, including the garbage-bearer wire test) |
| NC-6 | Reverse membership index written outside the transaction | D2 rollback | **Caught** (rollback after the reverse-index step leaves an orphan edge) |
| NC-7r2 | `getSession` trusts the reverse index without the family's member edge | D2 session | **Caught** (stale-edge test) |
| NC-8 | Unpaid reservation granted `READ_WRITE` | D1 + D2 session | **Caught** (6 not ok) |
| NC-9r | `displayName` limit raised from 50 to 100 | D1 | **Caught** (4 not ok) |

**Harness defects (recorded, not counted as results):** the first attempts at NC-1, NC-1b, NC-5, NC-7 and NC-9 did not reach their tests. The causes were a missing working directory in the subshell (NC-1, NC-9), a pattern that missed CRLF line endings after `git checkout` (NC-1b), mutations that failed TypeScript compilation (NC-5, NC-7), and a regex escaping error in a generated script (NC-7r). Each was corrected and rerun as the `r`-suffixed control above. All runs and diffs are in the archive.

## Phase B local test runs (CODI-reported; tree content identical to `94d31d9`)

Source: `docs/specs/R-04/CODI_WP03_S1_PHASE_B_TEST_IMPLEMENTATION_REPORT_v1.0.md` (not committed).

**Environment:**
- Same as above, after a clean `npm ci --ignore-scripts`
- osv-scanner 2.7.0 Windows build `9964ed64…6438`, re-fetched and checksum-verified
- gitleaks not run locally; FORGE ran it

| Run | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| D1 unit | `npm test` | **129/129 pass**, 12 suites, 0 fail (+34: T-GAP-3 ×10, T-GAP-1 D1 ×24). Re-run after the negative controls: 129/129. |
| D2 + rules + D3 | `npm run test:emulator` (stress at 50 iterations) | **143/143 pass**, 13 suites, 0 fail, 601 s (+6 tests, +1 suite) |
| npm audit | `--audit-level=high`; `--omit=dev` | 0 vulnerabilities (both) |
| osv-scanner | FORGE's exact `scan source -L …` | "No issues found" |
| Firebase guard | `scripts/check-no-real-firebase.sh` | PASS |

The six new emulator tests:
- D2 `account.getSession`: T-GAP-5, T-GAP-7
- D2 `families.create`: T-GAP-4, T-GAP-10
- D3: T-GAP-4, T-GAP-5

T-GAP-1 (live D2/D3) and T-GAP-8 are assertions added to existing tests.

## Negative controls NC-10..NC-16 (Phase B; CODI-reported)

**Method:**
1. Back up the target file as raw bytes.
2. Apply one exact-match mutation to production source.
3. Build and run the targeted tests (emulator controls at `WP03_STRESS_ITERATIONS=2`).
4. Restore the backup **byte-for-byte**, not via `git checkout`, which rewrites EOLs on this machine.
5. Verify the SHA-256 is unchanged and `git diff` is clean.

There were no harness defects. Mutations were never staged or committed.

| ID | Gap | Mutation (file) | Tests run | Result (intended assertion) |
|---|---|---|---|---|
| NC-10 | T-GAP-1 | Owner-only fields emitted on MEMBER entries: `...(isOwner ? …` → `...(true ? …` (`src/commands/accountGetSession.ts`) | D2 session | **Caught.** 4 fail, all "account.getSession data violates A1 v0.2 §A1.5" |
| NC-11 | T-GAP-3 | `typeof apiVersion !== "string"` check removed (`src/contract/validate.ts`) | D1 | **Caught.** Exactly the 10 T-GAP-3 tests |
| NC-12 | T-GAP-4 | Idempotency record written on the `EMAIL_VERIFICATION_REQUIRED` path (`src/commands/familiesCreate.ts`) | D2 create + D3 | **Caught.** 4 fail. D2 T-GAP-4 failed at "the rejection was not recorded" (an `idempotency/…` document appeared). D3 T-GAP-4, the existing unverified-create test and T-GAP-10 also failed. |
| NC-13 | T-GAP-5 | `getSession` throws `EMAIL_VERIFICATION_REQUIRED` for unverified callers (`src/commands/accountGetSession.ts`) | D2 session + D3 | **Caught.** Exactly T-GAP-5 D2 and D3 |
| NC-14 | T-GAP-7 | `.sort()` → `.sort((a, b) => a.localeCompare(b))` (`src/commands/accountGetSession.ts`) | D2 session | **Caught.** T-GAP-7 only ("joinedFamilies not strictly ascending: m-… before Z-…") |
| NC-15 | T-GAP-8 | Stored idempotency `command` set to `"familiesCreate"` at the write site (`src/commands/familiesCreate.ts`) | D2 create | **Caught.** T-GAP-8 assertions (`expected 'families.create'`, `actual 'familiesCreate'`). Replay-dependent tests also failed. |
| NC-16 | T-GAP-10 | Verified-email check moved after the idempotency replay (`src/commands/familiesCreate.ts`) | D2 create | **Caught.** T-GAP-10 only ("expected DomainError EMAIL_VERIFICATION_REQUIRED, but the call succeeded") |

**Restoration (re-verified at the Phase B commit and push):**
- `accountGetSession.ts` `28947e1c…`, `validate.ts` `9f1c5874…`, `familiesCreate.ts` `4f355e88…` are unchanged from their pre-mutation values.
- `backend/functions/src/` is unchanged between `b12f0ea` and `94d31d9`.

**Provenance:**
- These results are **CODI-reported**. GAI reconciled the descriptions (Negative Control Reconciliation Addendum) but did **not** inspect the raw local logs.
- The raw logs are preserved in `WP03_S1_PHASE_B_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` (SHA-256 `5c5e0142…8843`; see "Phase B raw logs" above). They are **not** in `WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.tar.gz`.

## FORGE CI evidence

### Gate-integrity repair (`aa8db5b`)
- **The defect.** The `backend-emulator` test step runs `npm run test:emulator 2>&1 | tee "$RUNNER_TEMP/emulator-tests.log"`. With no `shell:` set, GitHub Actions runs a step as `bash -e {0}`, without `pipefail`.
  - The pipeline therefore took `tee`'s exit status (0).
  - A failing test run could leave the step, the job and `FORGE gate` green.
  - This was found in run #18 (`fa5b329`), whose emulator result is therefore **inconclusive** and **superseded**.
- **The repair.** One line: `shell: bash` on that step. GitHub then runs it as `bash --noprofile --norc -eo pipefail {0}`, so the test process's nonzero exit fails the step while `tee` still captures the log. No test, assertion, application code or other job changed.
- **Local demonstration** with the same pipe shape and a command exiting 1: the pipeline exits 0 under `bash -e` and 1 under `-eo pipefail`.

### Run #19: positive control on the repaired branch
| Field | Value |
|---|---|
| Run | 40768261653 (#19), event `push`, branch `feature/wp03-s1-family-ownership` |
| URL | https://github.com/egpennington/newBaileysCart/actions/runs/40768261653 |
| Commit | `aa8db5b60fec141e74fe12138539d7af1cb5829c` |
| Conclusion | **SUCCESS**. All 9 jobs succeeded: wrapper integrity, Android compile/lint/unit, clean repeat build (JAR `cf6d0b16…0024` ×2 hard gate; APK `aa78c065…0587` ×2), backend typecheck/tests/audit, **backend emulator tests** (job 123098200010; test step 530 s under `pipefail`), dependency scan and SBOM, secret scan, Firebase guard, **FORGE gate** (job 123102930559) |
| Emulator totals | `# tests 137`, `# suites 12`, `# pass 137`, `# fail 0`, `# cancelled 0`, `# skipped 0`. **Inspected in the job log by the Project Lead**; CODI's access cannot read CI logs. They match the local run on the same code. |
| Artifact | `emulator-test-evidence` 12851836616, `sha256:77730e549247c03aede9af88edca18ebdc1889e0b5c5a5f379ba7f1b7f7ac961` (expires 2026-11-11) |

### Run #20: FORGE gate-integrity negative control
This control tests **the CI gate**, not application behavior. It is distinct from the application-level negative controls NC-1..NC-9 above, which mutate application code.

| Field | Value |
|---|---|
| Run | 40768495604 (#20), event `push`, disposable branch **`feature/wp03-s1-gate-negative`** (never to be merged; kept pending PL cleanup) |
| URL | https://github.com/egpennington/newBaileysCart/actions/runs/40768495604 |
| Commit | `8d681993631dcad9468a2eb60f6031742809b19b` = `aa8db5b` plus one file, `backend/functions/test/emulator/zz-forge-gate-negative-control.test.ts`, holding a single `assert.fail` test |
| Conclusion | **FAILURE, as intended** |
| `backend-emulator` (job 123099015310) | **failure.** The test step failed after 523 s (full suite ran); annotation "Process completed with exit code 1". Log still uploaded (artifact 12850889272, `sha256:4002e974e885e27c7e38dd8af0a8beabc328b8b21c153d6ed179938b41e14315`). PL-inspected log: `not ok 9 - FORGE-GATE-NEGATIVE-CONTROL: deliberate failure`, `AssertionError`. |
| `FORGE gate` (job 123103644218) | **failure.** PL-inspected log: upstream results included one failure, `FORGE gate FAILED`, process exited with code 1. |
| Other 7 jobs | success. The negative control did not weaken or bypass any other gate. |

**Conclusion:** run #20 shows that an emulator test failure now fails `backend-emulator` and `FORGE gate`. A green `backend-emulator` therefore means the emulator suite had no failing tests, which makes run #19 valid CI evidence.

### Run #21: positive run on the manifest v1.1 commit
| Field | Value |
|---|---|
| Run | 40772247717 (#21), event `push`, branch `feature/wp03-s1-family-ownership` |
| URL | https://github.com/egpennington/newBaileysCart/actions/runs/40772247717 |
| Commit | `8d2bfa041641b559b8bfd3b07ad4acfd2744d92e` (documentation only; `backend/` unchanged since `d7beae8`) |
| Conclusion | **SUCCESS**, all 9 jobs: backend typecheck/tests/audit (123112235933), **backend emulator tests** (123112236231), Firebase guard (123112236261), secret scan (123112236322), wrapper integrity (123112236416), dependency scan and SBOM (123112236480), clean repeat build (123112306103), Android compile/lint/unit (123112306213), **FORGE gate** (123116618406) |
| Emulator totals | **Not inspected.** CODI cannot read CI logs, and no PL inspection of run #21's totals is recorded. Under `pipefail` (run #20), a green `backend-emulator` means zero failing emulator tests. |

### Runs #22–#24 (documentation commits; no backend change)
| Run | Event | Commit | Conclusion | Totals |
|---|---|---|---|---|
| #22 [40789802242](https://github.com/egpennington/newBaileysCart/actions/runs/40789802242) | `pull_request` (PR #4 opened) | `8d2bfa0` | **SUCCESS** | Not inspected (not recorded in v1.2) |
| #23 [40886310216](https://github.com/egpennington/newBaileysCart/actions/runs/40886310216) | `push` | `b12f0ea` | **SUCCESS**, 9/9 jobs; emulator job 123490848603; FORGE gate 123495963720 | Not confirmed to CODI. GAI's Phase A delta report states the PL observed 137 tests, 12 suites, 0 failures; recorded here as **GAI-reported**. |
| #24 [40886319990](https://github.com/egpennington/newBaileysCart/actions/runs/40886319990) | `pull_request` | `b12f0ea` | **SUCCESS**, 9/9 jobs; emulator job 123490882303; FORGE gate 123496051059 | As #23 |

### Runs #25 and #26: Phase B test commit `94d31d9`
| Field | Run #25 | Run #26 |
|---|---|---|
| Run / URL | 40899889216, https://github.com/egpennington/newBaileysCart/actions/runs/40899889216 | 40899897542, https://github.com/egpennington/newBaileysCart/actions/runs/40899897542 |
| Event | `push` | `pull_request` (PR #4) |
| Commit | `94d31d9a88ad14791e64d4945301983ba1653f92` | same |
| Conclusion | **SUCCESS**, 9/9 jobs | **SUCCESS**, 9/9 jobs |
| Backend typecheck, tests, npm audit | success (123538959132) | success (123538987274) |
| Backend emulator tests | success (123538959938, 547 s, under `pipefail`) | success (123538987857, 543 s) |
| Dependency scan/SBOM; secret scan; Firebase guard; wrapper integrity | success (123538959886; 123538959773; 123538959940; 123538960006) | success (123538988301; 123538988146; 123538987880; 123538988148) |
| Clean repeat build; Android | success (123539061995; 123539062046) | success (123539066433; 123539066519) |
| FORGE gate | **success** (123544531904) | **success** (123544506497) |
| **D1 totals** | **PL-inspected:** 129 tests, 12 suites, 129 pass, 0 fail, 0 skipped | **Not separately inspected by the PL** |
| **Emulator totals** | **PL-inspected:** 143 tests, 13 suites, 143 pass, 0 fail, 0 skipped, exit code 0 | **Not separately inspected by the PL** |
| `emulator-test-evidence` | 12910190494, `sha256:d1e50f7d6751445febc5bfacd4d77041ce3a4bf0f330a9f9fe08c72b040ac4dc` | 12909931521, `sha256:4c79f4cce9e9766dbc669922e329911872d15d1b594e790de86aa203b8181a7a` |
| `repeat-build-evidence` | 12908633096, `sha256:451a546595efca1ed9680db1353d473a57886ae0ad4f4e8e964dbf8df57d950a` | 12908757068, `sha256:3e62a231ba7e5cd899ff7bbd7f30ed8e0db0977149121db2fbd14daaa66eb4f9` |

**Provenance:**
- Run and job conclusions, job IDs and artifact digests: CODI-inspected through the public GitHub API.
- Totals: PL-inspected (run #25 only).
- GAI's reports also state that the repeat-build hashes (`cf6d0b16…0024` JAR, `aa78c065…0587` APK) were identical in runs #23–#26. CODI did not see the job logs and records this as **GAI-reported**.

### Run #29: post-merge on `develop` (merge commit `bb69c01`)
| Field | Value | Class |
|---|---|---|
| Run / URL | 40964381385 (#29), attempt 1, https://github.com/egpennington/newBaileysCart/actions/runs/40964381385. The only run for this SHA. | CODI-inspected (public API) |
| Event / branch / commit | `push` / `develop` / `bb69c01f76048010d7d22db6ef457e221e89075b` | CODI-inspected |
| Conclusion | **SUCCESS**, 9/9 jobs. Every step succeeded; none skipped or cancelled. Jobs: backend typecheck/tests/audit (123765004676), **backend emulator tests** (123765004771, 550 s, under `pipefail`), dependency scan/SBOM (123765004524), secret scan (123765004913), Firebase guard (123765004749), wrapper integrity (123765004742), clean repeat build (123765071481), Android (123765071567), **FORGE gate** (123769132836) | CODI-inspected |
| Repeat-build hard gate | Check-run annotations: core:model JAR `cf6d0b163ede0ec153dd6e07d01d86ba5eed229bcd155b7ffeb7aed85ec00024` ×2; APK (informational) `aa78c065341f31583c25f03da549219e150f73e73dab617edab3e92841580587` ×2 | CODI-inspected |
| Emulator totals | 143 passed, 13 suites, 0 failed, 0 skipped, 0 cancelled | **PL screenshots**. Not inspected by CODI or GAI (logs return HTTP 403 without authentication). |
| D1 totals | **NOT VERIFIED.** Job success only. | — |
| Artifacts | `emulator-test-evidence` 12938176224 (`sha256:4ee2f363…71d8`), `repeat-build-evidence` 12936259857 (`sha256:df14e13a…25f0`), `android-reports` 12937941154 (`sha256:9bdd9d0a…2c23`), `sbom` 12937416780 (`sha256:0906b649…9f6e`). Not expired; retention until 2026-11-12. | CODI-inspected (metadata only) |

Runs #27 (`40957738978`, `push`) and #28 (`40957745466`, `pull_request`) on `ca742f4` also passed 9/9. Their totals were not inspected.

## Post-merge and closure (v1.4)

| Item | Value | Class / source |
|---|---|---|
| PR #4 | **MERGED**, 2026-10-29T22:14:55Z, by `egpennington` | CODI-inspected (PR API) |
| Merge commit | `bb69c01f76048010d7d22db6ef457e221e89075b`. Standard two-parent merge: first parent `f96e5376804facc2e01bcad7100e4574f05de3c3` (prior `develop`), second parent `ca742f49a213af65673ada2784c89ce2711b22c8` (feature HEAD). Its tree equals the tree of `ca742f4`. | CODI-inspected (`git cat-file`, `git rev-parse <sha>^{tree}`) |
| `develop` HEAD | `bb69c01f76048010d7d22db6ef457e221e89075b` | CODI-inspected (`git ls-remote`) |
| Post-merge CI | Run #29 SUCCESS, 9/9 (above) | CODI-inspected; totals per PL screenshots |
| Contracts at `bb69c01` | A1 v0.2 `616bd0eb…0572`; the four canonical R-04 documents unchanged (`03718a0d…`, `5e71e0b8…`, `636161e4…`, `1890c589…`) | CODI-inspected (committed blobs) |
| GAI final recommendation | "GO — Recommend Formal Administrative Closure of WP-03 Slice 1". `GAI_WP03_S1_VRIG1_Challenge_and_Closure_Correction_Addendum.md` (local, untracked; SHA-256 `baee3340c48545168cf3b06b726d8442bac119882ae294bf394539511d8ef5a7`). It supersedes `GAI_WP03_S1_PostMerge_Closure_Audit_Report.md` (`a9007ff8…75ca`) and its correction addendum (`0d897abb…7525`). **Accepted by the PL.** | GAI statement; PL decision |
| VRIG-1 pilot | **Passed.** GAI reported the marker from §B of `VRIG1_WP03_S1_Controlled_Challenge_v1.0.md` (local, untracked; SHA-256 `c4b80faf…03f1`). CODI confirmed GAI's reported value matches the source; the value is not reproduced here. VRIG-1 = Verity Report Integrity Gate, a **pilot, not ratified policy**. Source retrieval establishes source access only; it is **not** proof of runtime correctness. | PL decision; CODI-inspected match |
| **Closure** | **WP-03 Slice 1 formally closed administratively** (PL GO, 2026-10-29). Decision register v1.7, WP03-S1-CLOSE. | PL decision |
| Slice 2 | **Gate C for WP-03 Slice 2 remains CLOSED.** No Slice 2 work, provisioning or deployment is authorized. | PL decision |
| Untouched | `main` (`b6ac365…`), `feature/wp03-s1-family-ownership` (`ca742f4…`), `feature/wp03-s1-gate-negative` (`8d68199…`), production infrastructure; no deployment | CODI-inspected refs; PL decision |

**GAI statements in the final addendum that are not adopted:**
- **HB descriptions:** its HB-1/HB-2 descriptions ("membership transactional bounds", "dangling edge handling") differ from the ratified backlog. `WP03_S1_HARDENING_BACKLOG_v1.1.md` defines HB-1 as malformed `lifecycleState`, HB-2 as malformed `displayName` and HB-3 as cross-entry invariants. The backlog controls.
- **Item (b):** it defers the README fix to Slice 2 kickoff. The PL directed the stale milestone status to be corrected in this closure record.
- **Item (c):** it cites a "project policy" excluding reports from git. No such policy is recorded; committing them remains a PL decision.
- **Item (h):** it states the artifact digests are preserved in committed manifests. Run #29's digests are first recorded here, in v1.4.

### Administrative follow-ups (CODI post-merge closure report §5(3); all nonblocking)

| # | Item | Status in v1.4 |
|---|---|---|
| (a) | Manifest described PR #4 as Draft and did not record the merge or run #29 | **Proposed resolution in this v1.4 change** (uncommitted). It stays outstanding until committed. |
| (b) | `docs/specs/README.md` said "Gate C remains CLOSED and WP-03 remains ON HOLD" | **Proposed resolution in the accompanying README change** (uncommitted). It stays outstanding until committed. |
| (c) | CODI/GAI reports, including cited sources, are untracked | **Outstanding.** Committing them is a PL decision. |
| (d) | T-GAP-6 platform-guarantee acceptance not formally recorded | **Outstanding** (T-GAP-6 OPEN) |
| (e) | Totals for runs #21, #22, #26, #27 and #28 not inspected; #23/#24 GAI-reported only. (Run #29 D1 is also NOT VERIFIED.) | **Outstanding** |
| (f) | GAI has not inspected the Phase B raw NC logs | **Outstanding** |
| (g) | No durable second copy of the Phase B archive recorded | **Outstanding** |
| (h) | CI artifacts expire 2026-11-12 | **Outstanding.** Download before expiry if retention is wanted. |
| (i) | Ratification record v1.1: "introduced" (conditions list) vs "merged" (§4) | **Outstanding.** The operative rule is "before any additional family-record writer is merged"; the record is unedited. |

## GAI D4 record: chronology and supersession

All are untracked GAI files in `docs/specs/R-04/`, recorded as GAI's statements. Hashes were taken 2026-10-29.

| # | Document | Reviewed | Key determination | Supersession / status |
|---|---|---|---|---|
| G-1 | `GAI_WP03_Slice1_Final_D4_Verification_Report.md` (`b5cf3877…3673`) | `8d2bfa0`; runs #19–#21; A1 **v0.1** | GO to open a PR. PP-15/-25 PASS (Slice 1 scope); PP-14/-30 PARTIAL. MED-01: ratify A1. | Detailed below (v1.2 record). MED-01 later closed by G-2. |
| G-2 | `GAI_WP03_S1_PhaseA_Delta_Verification_Report.md` (`94547966…fcee`) | `b12f0ea`; runs #23, #24; A1 v0.2, R-1, F-3/HB-3 | Phase B **GO**. PR #4 **HOLD**. MED-01 resolved. MED-02: merge blocked pending Phase B. | Its §6.B gap descriptions are superseded by G-3. Its statement that HB-3 deferral has "zero production risk" is GAI's own and is not adopted here. |
| G-3 | `GAI_WP03_S1_PhaseA_D4_Correction_Addendum.md` (`ae0e5b51…cf52`) | `b12f0ea` | Corrects the T-GAP-1/3/4/5/7/8/10 objectives to plan §4. Phase B GO reaffirmed. | **Its T-GAP-2/6/9 descriptions are incorrect** (PL determination) and are **not adopted**. The correct definitions are under "Test gap status". |
| G-4 | `GAI_WP03_S1_PhaseB_Final_D4_Verification_Report.md` (`a6919024…e069`) | `94d31d9`; runs #25, #26 | Seven gaps CLOSED. Merge "certified ready". | **§§1, 2, 4, 7, 8 superseded by G-5.** Its invented file names (`schema.test.ts`, `replayPrecedence.test.ts`), the claimed manifest v1.3 in `94d31d9`, "100% complete", "mathematically fail-closed" and its deletion recommendations are **retracted by G-5 and G-6**. |
| G-5 | `GAI_WP03_S1_PhaseB_D4_Correction_Addendum.md` (`33989777…0b81`) | `94d31d9` | Corrected 9-file inventory. Seven gaps closed. T-GAP-10 D2 only. T-GAP-1 is not HB evidence. Merge **HOLD** pending the PL. Preserve the probe branch and directory. | Its NC ledger (§4) is **superseded by G-6**. Its claim that the NC-10..16 logs are in `WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` is incorrect (see the NC section above). |
| G-6 | `GAI_WP03_S1_PhaseB_Negative_Control_Reconciliation_Addendum.md` (`0a6ecd20…6769`) | `94d31d9` | **Binding** NC-10..16 ledger and evidence taxonomy: NC-10..16 and restoration are CODI-reported; CI totals are PL-inspected; archive-inspection claims retracted. Gap closure **PASS reaffirmed**. Merge **ON HOLD** pending PL authorization. | Current GAI position, read together with G-5 §§2, 3, 5, 6. |

**Residual inaccuracies in G-5/G-6, noted by CODI and not adopted:**
- G-6 says NC-12's retry threw `IDEMPOTENCY_KEY_REUSED`. The D2 test actually failed first at its "rejection was not recorded" assertion.
- G-6 says NC-13 failed with `failed-precondition`. That is the D3 code; the D2 handler threw `EMAIL_VERIFICATION_REQUIRED`.
- G-3 and G-6 cite A1 §A1.8 for `apiVersion` validation (it is §A1.2) and §A1.4 for logical command naming (it is §A1.1).
- G-5 and G-6 describe the selection rule as "lowest `familyId`". A1 §A1.5 specifies the first **usable** entry in `familyId` order.
- G-3, G-5 and G-6 tie HB-1..HB-3 to "opening Gate C for Slice 2". Ratification record v1.1 §4 requires them before any additional family-record writer is **merged**. The ratified wording controls.

## GAI D4 determinations (v1.2 record of G-1; recorded as GAI's; not re-asserted by CODI)

| Item | Value |
|---|---|
| Source | `docs/specs/R-04/GAI_WP03_Slice1_Final_D4_Verification_Report.md` (not committed; SHA-256 `b5cf38771d916837730c4087889a82704b75813d12de0901c0327afbea7e3673`) |
| Reviewed | `feature/wp03-s1-family-ownership` @ `8d2bfa0`; FORGE runs #19, #20 and #21 |
| Verdict | **GO to open a pull request to `develop`.** GAI states that this does **not** authorize merge, deployment or provisioning. |
| Findings | MED-01: ratify API Amendment A1 before merge. CODI addressed it with the PL ratification of A1 v0.2, committed in `e0f885d`, but **GAI has not re-reviewed it**. *(Superseded in v1.3: G-2 re-reviewed it and closed MED-01.)* LOW-01: delete the disposable branch `feature/wp03-s1-gate-negative` (pending PL authorization). LOW-02: prune `backend/w01-probe/` (preserved by PL instruction). *(v1.3: G-5 and G-6 now say to preserve both.)* |
| Contract basis | GAI audited **A1 v0.1**. GAI has **not** reviewed the v0.1 → v0.2 delta (C-1..C-3, §A1.8), clarification R-1, or the F-3/HB-3 decisions. *(Superseded in v1.3: G-2 reviewed them at `b12f0ea`.)* |

## A1 v0.2 contract traceability (CODI, not GAI)

- **Source:** `docs/specs/R-04/CODI_WP03_S1_A1_CONTRACT_TRACEABILITY_REPORT_v1.0.md` (not committed), reviewing `8d2bfa0`.
- **Result:** 73 rows: 52 MATCH, **0 MISMATCH**, 12 NOT VERIFIED (10 test gaps plus F-1/F-2), 9 DEFERRED.
- **Flags:** R-1 was resolved as a documentation clarification (no behavior change). F-3 was accepted for the Slice 1 sole-writer scope only, with HB-3 mandatory before any additional writer.

## ProofPoint status (current, v1.3)

**Status basis:**
- FORGE success alone is not a PASS.
- Statuses are GAI's corrected Phase B D4 determinations at `94d31d9` (G-5 §6, reaffirmed by G-6), consistent with G-1 and G-2.
- PL-inspected run #25 totals.
- CODI-reported local evidence and negative controls.
- **All statuses are qualified to Slice 1 scope.** They do not represent later-slice requirements, production deployment, or malformed-storage behavior.

| ProofPoint | Slice coverage | D1 | D2 | D3 | D4 (GAI) | FORGE | Status |
|---|---|---|---|---|---|---|---|
| PL-PP-WP03-15 | Full (trial claim) | local + CI pass | local + CI pass (50 × 5 stress) | n/a | PASS (Slice 1 scope): G-1, reaffirmed G-5/G-6 | #19 (137/137, PL-inspected); #25 (129 + 143, PL-inspected); #21–#24, #26 green | **PASS (Slice 1 scope)** |
| PL-PP-WP03-25 | Full (timestamps, retry, concurrency); checkout expiry out of scope | local + CI pass | local + CI pass, incl. T-GAP-4, -8, -10 | local + CI pass, incl. T-GAP-4 | PASS (Slice 1 scope): G-1, reaffirmed G-5/G-6 | as above | **PASS (Slice 1 scope)**. T-GAP-10 is D2 only. |
| PL-PP-WP03-14 | **Partial** (rules + session isolation) | T-GAP-1 drift guard and invalid samples | local + CI pass, incl. T-GAP-1, -5, -7 | T-GAP-1, -5 (wire) | PARTIAL (Slice 1 scope): G-1, reaffirmed G-5/G-6 | as above | **PARTIAL (Slice 1 scope)**. Item and billing paths belong to later slices. |
| PL-PP-WP03-30 | **Partial** (negative half only) | local + CI pass | local + CI pass | local + CI pass | PARTIAL (Slice 1 scope): G-1, reaffirmed G-5/G-6 | as above | **PARTIAL (Slice 1 scope)** |
| PL-PP-WP03-01..13, 16–24, 26–29 | Not in Slice 1 | — | — | — | — | — | NOT_RUN |

Negative controls by ProofPoint:
- **-15:** NC-1r, NC-1br, NC-2
- **-25:** NC-2, NC-3, NC-12, NC-15, NC-16
- **-14:** NC-4, NC-7r2, NC-8, NC-10, NC-13, NC-14
- **-30:** NC-1br

T-GAP-3 has no ProofPoint assigned. It is recorded against A1 traceability row 2.17b only.

## Test gap status (current, v1.3)

Definitions follow `docs/specs/R-04/CODI_WP03_S1_A1_CONTRACT_TRACEABILITY_REPORT_v1.0.md` and execution plan `docs/specs/R-04/CODI_WP03_S1_R1_HB3_TEST_GAP_EXECUTION_PLAN_v1.0.md` §4 (both not committed). The G-3 descriptions of T-GAP-2/6/9 are not used.

**Closure evidence for the seven closed gaps:**
- tests in `94d31d9`
- CODI-reported local runs and NC-10..16
- FORGE run #25 with PL-inspected totals; run #26 green, totals not separately inspected
- GAI D4 (G-4 as corrected by G-5 and G-6)

| ID | Gap (original definition) | Tests (`backend/functions/`) | Depths | Negative control | Status |
|---|---|---|---|---|---|
| T-GAP-1 | Live `account.getSession` responses validated against the A1 §A1.5 JSON Schema and applicable prose invariants | `test/support/a1Schema.ts`, `test/unit/a1Schema.test.ts`, `test/emulator/accountGetSession.test.ts` (every success), `test/e2e/callables.test.ts` | D1, D2, D3 | NC-10 | **CLOSED (Slice 1 scope).** Consistent, Slice 1-written data only; **not** HB-1/HB-2/HB-3 evidence. |
| T-GAP-3 | Non-string `apiVersion` rejected (`VALIDATION_FAILED`) | `test/unit/validate.test.ts` | D1 | NC-11 | **CLOSED (Slice 1 scope)** |
| T-GAP-4 | Unverified `families.create` rejected; verify; same `opId` commits, then replays (R-1 case 3) | `test/emulator/familiesCreate.test.ts`, `test/e2e/callables.test.ts` | D2, D3 | NC-12 | **CLOSED (Slice 1 scope)** |
| T-GAP-5 | `account.getSession` succeeds for an unverified-email caller | `test/emulator/accountGetSession.test.ts`, `test/e2e/callables.test.ts` | D2, D3 | NC-13 | **CLOSED (Slice 1 scope)** |
| T-GAP-7 | `joinedFamilies` in UTF-16 code-unit order; selection rule (first usable entry) | `test/emulator/accountGetSession.test.ts` | D2 | NC-14 | **CLOSED (Slice 1 scope)** |
| T-GAP-8 | Stored idempotency `command` is `"families.create"` | `test/emulator/familiesCreate.test.ts` | D2 | NC-15 | **CLOSED (Slice 1 scope)** |
| T-GAP-10 | Loss of email verification prevents replay of a committed `opId` (R-1 case 2) | `test/emulator/familiesCreate.test.ts` | **D2 only** (handler level; no dedicated D3 callable-wire test) | NC-16 | **CLOSED (Slice 1 scope, D2 evidence)** |
| T-GAP-2 | Transaction contention exhausted after 10 attempts → `INTERNAL` | — | — | — | **OPEN.** Untested. |
| T-GAP-6 | `account.getSession` read-only consistent snapshot | — | — | — | **OPEN.** Unasserted. Platform guarantee; acceptance not recorded. |
| T-GAP-9 | Server-side logging of `INTERNAL` exception details | — | — | — | **OPEN.** Unasserted. |

R-1 case 1 (an unauthenticated resubmission of a committed `opId`) has no dedicated test. It relies on the existing adapter authentication tests.

## Known limitations of this evidence (current, v1.3)
- **Scope:** Slice 1 only. These records do not claim WP-03, or the application, is complete, production-deployed or universally fail-closed.
- **Accepted limitations:** F-1, F-2 and F-3 (malformed or inconsistent stored family records) are accepted only while `families.create` is the sole writer.
- **Hardening:** HB-1, HB-2 and HB-3 are **not implemented**. Per ratification record v1.1 §4, they are mandatory, with D1/D2 tests, negative controls and green FORGE, before any additional family-record writer is merged.
- **Open gaps:** T-GAP-2, T-GAP-6 and T-GAP-9 remain open.
- **T-GAP-10:** D2 handler-level evidence only.
- **Run totals:**
  - Run #29 (post-merge): emulator totals are PL screenshot observations only; D1 totals are NOT VERIFIED.
  - Runs #26, #27 and #28 totals were not inspected.
  - Runs #21–#24 totals were not confirmed to CODI (#23/#24 are GAI-reported as PL-observed).
- **Local evidence storage:**
  - NC-10..16 and the Phase B local logs are CODI-reported. GAI did not inspect the raw logs.
  - Those logs are archived outside the repository in `WP03_S1_PHASE_B_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` (SHA-256 `5c5e0142…8843`). They are not committed and have not been inspected by GAI.
- **Emulator only:** CI and local evidence both come from emulators on a `demo-*` project. No production Firebase environment exists or was used.
- **Authentication:** the emulators do not verify ID-token (JWT) signatures or App Check tokens (W-01 D-4, D-5). **Production JWT-signature and App Check verification are not established.** D2/D3 prove logic, transactions and rule evaluation, not production authentication.
- **Contention:** Firestore emulator transaction contention is not production contention evidence.
- **Android:** D3 uses the JS modular client SDK. The Android client SDK is not exercised (W-01 D-9).
- **Production behavior:** production request limits and deployment behavior are not evidenced (W-01 D-8).

## WP-03 Slice 2: ownership hardening and security disposition (v1.5)

This section records Slice 2 only. The Slice 1 sections above are unchanged. **Class** follows the Slice 1 convention:
- *CODI-inspected*: read by CODI from git or the public GitHub REST API.
- *CODI-reported*: a local run by CODI, not independently rerun.
- *GAI-reported*: GAI's own statement.

### Scope and authority

- **Gate C:** opened 2026-10-31 for Slice 2 hardening only: HB-1, HB-2, HB-3 and test gaps T-GAP-2, 6 and 9 (register v1.8, WP03-S2-GATE-C).
- **Excluded:** new family-record writers, billing, Android UI, provisioning and deployment.
- **Branch:** `feature/wp03-s2-ownership-hardening`, base `develop` @ `509cfeaf5a5b8884e19a63cd824d3b3f559ecf13`.
- **PR:** #6, https://github.com/egpennington/newBaileysCart/pull/6.

### Commits (PR #6)

| Commit | Content |
|---|---|
| `d10c5da` | `getSession` read-path hardening HB-1/HB-2/HB-3 and test gaps T-GAP-2/6/9 |
| `8f1f90e` | HB-3 residual case: fail closed when `ownerUid` equals the caller through a non-OWNER membership (NC-27) |
| `da662c0` | Decision register v1.8 |
| `cca1125` | Decision register v1.9: T-GAP-6 acceptance, `PL-PP-WP03-31`, PR #6 hold |
| `0524a58de58535a220d304472619af21cf5b302a` | Time-boxed security exception policy governance: `scripts/check-osv-exceptions.mjs`, the workflow policy step, `backend/functions/osv-scanner.toml`, register v1.10, `PL-PP-WP00-04b` and its suite registration |
| `dddb7caf743934324b969726fcac84ac8bdde884` | **Merge commit** of PR #6 into `develop` (parents `509cfea…`, `0524a58…`). Its tree is identical to `0524a58`. |

### Local test evidence (CODI-reported; Windows, Node 22.18.0, Firestore emulator on Android Studio JBR)

| Run | Code | Result |
|---|---|---|
| Baseline D1 / emulator | `509cfea` | 129/129; 143/143 |
| Hardening sprint D1 / emulator | `d10c5da` content | 196/196; 165/165 |
| Residual fix D1 / emulator | `8f1f90e` content | **198/198; 168/168**. NC-27 caught (2/198 D1, 2/35 D2) |
| Gatekeeper validator harness | `0524a58` content (pre-commit working tree) | 78/78. D1 198/198 and emulator 168/168 repeated |
| `npm audit --audit-level=high` | final | exit 0 (14 moderate; dependency set unchanged) |

- **Negative controls:** NC-17..NC-26 (hardening sprint report) and NC-27 (final hardening report). The next free ID is NC-28.
- **Raw logs:** kept outside the repository, in `baileysCartApp_evidence\`, and not committed:
  - `WP03_S2_HARDENING_EVIDENCE_v1.0`
  - `WP03_S2_PROVE_ZERO_EVIDENCE_v1.0`
  - `WP03_S2_GATEKEEPER_PILOT_EVIDENCE_v1.0`
  - `WP03_S2_GATEKEEPER_IMPLEMENTATION_EVIDENCE_v1.0`
  - `WP03_S2_GATEKEEPER_VERITY_COMPLETION_EVIDENCE_v1.0`
  - `WP03_S2_GATEKEEPER_PUSH_FORGE_EVIDENCE_v1.0`
  - `WP03_S2_ADMIN_CLOSEOUT_EVIDENCE_v1.0`

### FORGE CI evidence (CODI-inspected, public API)

| Run | ID | Event / commit | Conclusion |
|---|---|---|---|
| #32 | `41211852993` | push / `d10c5da` | failure: "Scan lockfiles" only (GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249, published 2026-10-30; pre-existing on `develop`) |
| #33, #34 | `41214464755`, `41214862064` | push, PR / `da662c0` | failure: same single cause; every other job succeeded |
| #35, #36 | `41349303248`, `41349308613` | push, PR / `cca1125` | failure: same single cause |
| #37 | `41554043789` | push / `0524a58` | **success, 9/9** |
| #38 | `41554049906` | pull_request / `0524a58` | **success, 9/9** |
| **#39** | **`41658358920`** | **push / `develop` @ `dddb7ca`** | **success, 9/9**, attempt 1, 2026-11-03T14:54:36Z–15:03:57Z |

**Run #39 detail** (https://github.com/egpennington/newBaileysCart/actions/runs/41658358920):

| Job | Job ID | Conclusion |
|---|---|---|
| Secret scan | 125994656170 | success |
| No real Firebase configuration | 125994655581 | success |
| Gradle wrapper integrity | 125994655562 | success |
| Dependency scan and SBOM | 125994655651 | success |
| Backend typecheck/tests/audit | 125994655694 | success |
| Backend emulator tests | 125994655286 | success |
| Android compile/lint/unit | 125994747420 | success |
| Clean repeat build | 125994747258 | success |
| **FORGE gate** | 126000121795 | success |

- **Dependency job steps (all success):** "Install osv-scanner (checksum pinned)", **"Verify security exception policy"**, **"Scan lockfiles"**, **"CycloneDX SBOM"** and the artifact upload.
- **Emulator job:** step "Emulator tests (D2 Firestore + rules, D3 callables; 50-iteration concurrency stress)" succeeded.
- **Commit check-runs on `dddb7ca`:** 9, with `FORGE gate` success.
- **Artifacts** (expire 2026-11-17):
  - `sbom` 13240996753 (`sha256:f54b0189…4e79`)
  - `emulator-test-evidence` 13240784437 (`sha256:032101e4…70e5`)
  - `android-reports` 13241520376 (`sha256:8cc31550…5eda`)
  - `repeat-build-evidence` 13239778923 (`sha256:be39a6a2…8b3a`)
- **Not inspected:** job logs (HTTP 403) and artifact downloads (HTTP 401) need authentication. Run #39 test totals, scanner text and SBOM contents are **NOT VERIFIED from CI**; only step conclusions are.
- **Deployments:** the GitHub Deployments API lists 0, and the workflow has no deploy job.

### Security-exception evidence (`PL-PP-WP00-04b`)

**Run #37 policy and scan log text** — GAI-reported, from a PL-supplied screenshot (`GAI_WP03_S2_Gatekeeper_PostPush_Final_D4_Report.md`, SHA-256 `b07b181c…f9a3`):
- Policy: "PASS exception …" for both IDs, 28 days left.
- Scan: "Loaded filter from: …/backend/functions/osv-scanner.toml", **"Filtered 5 vulnerabilities from output"**, "No issues found".
- Coverage: 3 lockfiles, 938 packages.

**Runs #38 and #39 policy and scan steps** — CODI-inspected: success. Step conclusions only; the log text was not readable.

**Local repeat on the merged tree `dddb7ca`** — CODI-reported, 2026-11-03. Method: `git archive` of `dddb7ca`, Windows osv-scanner 2.7.0 (SHA-256 `9964ed64…6438`, matching the release SUMS). Evidence: `WP03_S2_ADMIN_CLOSEOUT_EVIDENCE_v1.0` (SHA256SUMS.txt `c0eb0b68…8a40`).

| Check | Result |
|---|---|
| Policy script | exit 0; both exceptions PASS, expiring 2026-12-01T00:00:00Z |
| Scan | exit 0; 200 + 99 + 639 packages; "Filtered 5 vulnerabilities from output"; "No issues found" |
| Scan with `osv-scanner.toml` removed | exit 1; exactly 5 findings: `glob` 10.5.0 (GHSA-3g3m-2fjr-6pw4) and `minimatch` 3.1.5, 5.1.9, 6.2.3, 9.0.9 (GHSA-g3hv-75wg-m249) |
| CycloneDX 1.6 SBOM | 844 components |

This is a local reproduction of the CI commands on identical content, using the Windows build of the same release. It is **not** the CI output itself.

### GAI verification record (GAI-reported; local, untracked reports)

| Report | Target | Verdict |
|---|---|---|
| `GAI_WP03_S2_Independent_D4_Verification_v1.1.md` (`338ab150…48e4`) | `da662c0`; runs #33/#34 | CONDITIONAL GO (code verified; merge on HOLD) |
| `GAI_WP03_S2_Operation_Gatekeeper_D4_Verification_Report.md` (`ce2acda0…09b2`) | Gatekeeper design | CONDITIONAL GO (implement on branch only) |
| `GAI_WP03_S2_Gatekeeper_PrePush_D4_Verification_Report.md` (`8498028d…ee9d`) | six files before `0524a58` | GO (commit and push only) |
| `GAI_WP03_S2_Gatekeeper_PostPush_Final_D4_Report.md` (`b07b181c…f9a3`) | `0524a58`; runs #37/#38 | GO (adopt WP03-S2-SEC-DISP; merge PR #6 via merge commit) |

GAI reviewed CODI evidence and CI telemetry. GAI did not independently rerun the tests.

### ProofPoint status (Slice 2; GAI-assigned, not upgraded by CODI)

| ProofPoint | GAI post-push final | Notes |
|---|---|---|
| `PL-PP-WP03-31` | PASS | D1 198, D2 168, D3 HB-1 over the wire. The YAML `status` still points to the sprint report. |
| `PL-PP-WP00-04b` | PASS | D3 positive path in CI (#37–#39); negative paths proven locally only. **Time-boxed to 2026-12-01T00:00:00Z.** |
| `PL-PP-WP03-14` | PARTIAL (Slice 2 scope) | — |
| `PL-PP-WP03-30` | PARTIAL (Slice 2 scope) | — |

### Post-merge and closure state (v1.5)

| Item | Value | Class / source |
|---|---|---|
| PR #6 | **MERGED** 2026-11-03T14:54:33Z by `egpennington`, merge commit method (the ruleset allows only `merge`) | CODI-inspected |
| `develop` HEAD | `dddb7caf743934324b969726fcac84ac8bdde884` | CODI-inspected |
| Security disposition | WP03-S2-SEC-DISP **ACCEPTED** (PL, 2026-11-03). **Temporary risk acceptance, not a fix.** Expires **2026-12-01T00:00:00Z** | Register v1.11 WP03-S2-SEC-ACCEPT |
| WP03-S2-HOLD | Released for the authorized merge only | Register v1.11 WP03-S2-HOLD-REL |
| Closure | **Not declared.** Formal closure of Slice 2 is reserved to the PL. | PL decision pending |
| Slice 3 | **Gate C for WP-03 Slice 3 remains CLOSED.** | PL decision |
| Untouched | `main`, `feature/wp03-s2-ownership-hardening` (preserved at `0524a58`), production infrastructure; no deployment | CODI-inspected |

### Remaining risk and tracking (Slice 2)

- **Dependency expiry:** the exception lapses at **2026-12-01T00:00:00Z**. After that, the policy step and the scanner fail and every FORGE run goes red, including on `develop`. Before then, the exception needs either removal or a renewal (a new PL decision with re-run reachability evidence).
- **Early-removal triggers:**
  - `@google-cloud/firestore` admitting `firestore-api` ≥ 0.4;
  - `firebase-tools` on `glob` ≥ 14.0.2 and `minimatch` ≥ 11.0.1.
- **Revalidation triggers:** any change to `firebase-admin`, `firebase-functions`, `@google-cloud/firestore` or `firebase-tools`.
- **Residual exposure:**
  - Production reachability was shown to be zero only in a production-like harness. The cloud build is not verified.
  - **Development/CI exposure is nonzero:** `firebase-tools` loads `glob` and `minimatch`.
  - The suppression is advisory-wide for the lockfile.
- **Evidence gaps:**
  - Run #38/#39 log text and artifacts are not inspected (authentication required).
  - The run #39 artifacts expire 2026-11-17.
  - T-GAP-6 production verification is a future cloud gate.
- **Emulator limits:** the Slice 1 emulator limitations ("Known limitations" above) apply equally to Slice 2.

## WP-03 Slice 3 Substage 3A: family lifecycle (v1.6)

This section records Substage 3A only. Every Slice 1 and Slice 2 section above is unchanged. **Class** follows the same convention as before: *CODI-inspected*, *CODI-reported*, *GAI-reported*.

**Substage 3A PASS is not production coverage.** Several ProofPoints remain PARTIAL. Their deferred parts are listed in the ProofPoint table and under "Remaining obligations" below.

### Scope and authority

| Item | Value |
|---|---|
| Gate C | Opened for **Substage 3A only**, after the PL ratified S3-D01..S3-D09 (marker `S3-3A-GATE-C-GO`; register v1.12, WP03-S3A-GATE-C) |
| Specification | `WP03_S3_Family_Lifecycle_Work_Package_v0.2.md` and `WP03_S3_Verity_Candidate_Contracts_v0.2.yaml`, from packet `WP03_S3_3A_CODI_Implementation_Packet_v1.0.zip` (SHA-256 `67e00890…05bad0`; local, untracked) |
| Included | Domain lifecycle engine; the `familiesClose`, `familiesGetClosureStatus`, `familiesRestore` and `familiesWaiveRecovery` callables; the deterministic fake billing provider (emulator only); emulator-only workers; Verity suites and ProofPoints |
| Excluded | Substage 3B (Gate C **CLOSED**); real Google Play; RTDN/Pub/Sub; credentials; cloud provisioning; deployment |
| Branch | `feature/wp03-s3-family-lifecycle`, base `develop` @ `114f03af0f6756db1c092872a85a8121ac8be840` |
| PR | #8, https://github.com/egpennington/newBaileysCart/pull/8 |

### Commits (PR #8)

| Commit | Content |
|---|---|
| `ff6124c5f2c2966ca8fa03dd69c1e6c063cdeaf2` | Pure lifecycle engine, confirmation rule, reservation decisions, error codes, request schemas, closure states on OWNER session entries, D1 tests |
| `2486b447b82d943d152232083531c429f7694bae` | The four callables, W-02 pipeline, persistence and release milestone, billing adapter and fake provider, workers, D1/D2/D3 tests, rules test |
| `23d751a0c8be019e31bd0682ba78472663dc4ca7` | Verity: `PS-RETENTION`, `PS-OFFLINE-SYNC`, 11 new ProofPoints, `PL-PP-WP03-30` extended in place. **GAI-reviewed PR head.** |
| `7ca19f365d9779e31c538efc4126a7acdcc4b298` | **Merge commit** of PR #8 into `develop` (parents `114f03a…`, `23d751a…`). Its tree `b10088f5…ae41` is identical to `23d751a`, and `git diff 23d751a 7ca19f3` is empty. |

The PR changes 45 files (+4015 / −29). There is no dependency, workflow, `firestore.rules` or security-exception change.

### Local test evidence (CODI-reported; Windows, Node 22.18.0, Firestore emulator on Android Studio JBR)

| Run | Code | Result |
|---|---|---|
| Typecheck | `23d751a` content | exit 0 |
| **D1** `npm test` | `23d751a` content | **314/314** (213 pre-existing, 101 new) |
| **D2/D3** `npm run test:emulator`, run 1 | pre-commit tree, before the D3 lifecycle file was added | 289/289, exit 0 |
| **D2/D3** run 2 | `23d751a` (clean tree) | **292/292**, exit 0, 2026-11-05T01:28:45Z–01:53:38Z. Includes 50-iteration × 5-way stress and the official-SDK D3 lifecycle file. |
| Verity cross-reference check | `23d751a` | PASS: 22 ProofPoints + 5 suites |
| `npm audit --audit-level=high` | `23d751a` | exit 0 (12 moderate; dependency set unchanged) |

**D3 scope.** D3 was a **local** official-SDK run against the Functions emulator only. Android, physical-device, Play-sandbox and cloud D3 are **DEFERRED**.

### Negative controls NC-28..NC-32 (CODI-reported; D1)

Method: a one-line source mutation, then `npm test`, then a revert with `git checkout`. After the reverts, D1 was 314/314 again.

| NC | Mutation | Result | Caught by (`backend/functions/test/unit/`) |
|---|---|---|---|
| NC-28 | `src/domain/lifecycle.ts` `combineLiability`: the guard `provider === "NONE" && local === "NONE"` became `local === "NONE"` (a missing local token alone proves zero liability) | 2 failed / 314 | `lifecycle.test.ts`: "provider UNRESOLVED + local NONE -> UNRESOLVED"; "a missing local token alone … never proves zero liability without the provider" |
| NC-29 | `assertRestorable`: `nowMillis >= recoverUntilAtMillis` became `>` (inclusive deadline) | 1 failed | `lifecycle.test.ts`: "deadline boundary: 1 ms before succeeds; at and after is CLOSURE_RECOVERY_EXPIRED" |
| NC-30 | `decideRelease`: the owner/family/claim guard was replaced by `if (false)` | 5 failed | `lifecycle.test.ts`: the five CLAIM_MISMATCH cases (claim names another family / already cleared / malformed; owner differs; case for another family) |
| NC-31 | `assertRestorable`: the `CLOSURE_PENDING_BILLING` → `CLOSURE_CANCELLATION_IN_PROGRESS` line was deleted | 1 failed | `lifecycle.test.ts`: "pending cancellation -> CLOSURE_CANCELLATION_IN_PROGRESS, even after a waiver" |
| NC-32 | `src/domain/confirmation.ts` `checkConfirmation`: the consumed-token (single-use) check was deleted | 1 failed | `lifecycleSupport.test.ts`: "unknown or already consumed (single use) -> CONFIRMATION_REQUIRED" |

- **Logs:** `negative-controls/NC-28.log` … `NC-32.log`.
- **Gap:** the mutation text was not saved as diff files; it is recorded from the executed command.
- **Next free ID:** NC-33.
- **D2 controls:** the D2 suites also contain destructive controls: state snapshots before and after every rejection, and races (close × 5, restore × 5, waiver vs restore, release vs 2 × create).
- **GAI's NC descriptions are wrong.** Both GAI reports (`GAI_WP03_S3A_PreMerge_D4_Verification_Report.md` §7 and `GAI_WP03_S3A_PR8_Final_D4_Evidence_Reconciliation.md` §2) describe NC-28..NC-32 as different mutations caught by D2 test files that do not exist. GAI's reconciliation report itself states that CODI's record is authoritative. This table is that record.

**Raw evidence:** `baileysCartApp_evidence\WP03_S3_3A_IMPLEMENTATION_EVIDENCE_v1.0\` (26 files; `SHA256SUMS.txt`). It is outside the repository and not committed, and it contains local machine paths.

### FORGE CI evidence (CODI-inspected, public API)

| Run | ID | Event / commit | Conclusion |
|---|---|---|---|
| #42 | `41951738984` | push / `23d751a` | **success, 9/9** |
| #43 | `41955805403` | pull_request (PR #8) / `23d751a` | **success, 9/9** |
| **#44** | **`41959938544`** | **push / `develop` @ `7ca19f3`** | **success, 9/9**, attempt 1, 2026-11-05T03:10:42Z–03:32:13Z |

**Run #44 detail** (https://github.com/egpennington/newBaileysCart/actions/runs/41959938544):

| Job | Job ID | Conclusion |
|---|---|---|
| Secret scan | 127023650960 | success |
| No real Firebase configuration | 127023650951 | success |
| Gradle wrapper integrity | 127023650958 | success |
| Dependency scan and SBOM | 127023650987 | success |
| Backend typecheck/tests/audit | 127023650632 | success |
| Backend emulator tests | 127023650947 | success |
| Android compile/lint/unit | 127023690916 | success |
| Clean repeat build | 127023690887 | success |
| **FORGE gate** | 127030909864 | success |

- **Dependency job steps (all success):** "Verify security exception policy", "Scan lockfiles", "CycloneDX SBOM".
- **Emulator step:** "Emulator tests (D2 Firestore + rules, D3 callables; 50-iteration concurrency stress)" succeeded.
- **Commit check-runs on `7ca19f3`:** 9, with `FORGE gate` success.
- **Artifacts** (expire 2026-11-19):
  - `sbom` 13384334261 (`sha256:bd65d25e…2971`)
  - `emulator-test-evidence` 13385119987 (`sha256:4f11a07f…2304`)
  - `android-reports` 13385221640 (`sha256:c9b38ae9…5b5c`)
  - `repeat-build-evidence` 13384493983 (`sha256:fe7fd7f4…2bf7`)
- **Not inspected:** job logs and artifact contents need authentication. CI test totals and scanner text are **NOT VERIFIED from CI**; only step conclusions are.
- **Deployments:** the GitHub Deployments API lists 0. `main` remains at `b6ac365a471f77e0b0dcfb488dc064c106e782c4`.

### GAI verification record (GAI-reported; local, untracked reports)

| Report | Target | Verdict |
|---|---|---|
| `GAI_WP03_S3A_PreMerge_D4_Verification_Report.md` (SHA-256 `0a93873d…09bb`) | `23d751a`; run #42 | CONDITIONAL GO |
| `GAI_WP03_S3A_PR8_Final_D4_Evidence_Reconciliation.md` (`ce2084c5…cb16`) | `23d751a` | **GO** (merge PR #8) |

GAI reviewed CODI evidence and CI telemetry; it did not rerun tests. **CODI-inspected discrepancies in GAI's text** are recorded here, not adopted:

| GAI statement | Repository fact |
|---|---|
| NC-28..NC-32 mutations and D2 test files | See the NC table above |
| Token code at `src/auth/confirmationToken.ts`, `validateConfirmationToken`, `test/support/confirmationToken.ts` | None of these exist. The real paths are listed under Slice 3A code references below. |
| Tokens are "signed" / "cryptographic authenticity" | Tokens are random 32-byte values looked up by SHA-256; they are not signed |
| `CONFIRMATION_*` map to `invalid-argument` | They map to `failed-precondition` |
| `PURCHASE_RECONCILIATION_PENDING` maps to `unavailable` | That code is not implemented |
| Zero-liability excerpt (`family.purchaseToken`, `entitlementState`) | Not the code. Zero liability is `combineLiability`: the provider says NONE **and** the local record says NONE |
| Post-merge run "#43" | #43 was the PR run; the post-merge `develop` run is #44 |
| Finding ID `GAI-S3-MED-01` (pre-merge report) | Reuses the ID of the design-review finding `GAI-S3-MED-01` (suite creation). Needs a distinct ID. |

None of these affects the merged code. They are evidence-accuracy corrections.

### Slice 3A code references (tracked, at `23d751a` / `7ca19f3`)

All paths are under `backend/functions/src/`.
- **Confirmation-token generation:** `persistence/lifecycleStore.ts` `issueConfirmationToken`, `confirmationTokenHash`; TTL in `domain/confirmation.ts` `CONFIRMATION_TOKEN_TTL_MS`.
- **Validation:** `contract/validate.ts` `checkConfirmationToken` (format); `domain/confirmation.ts` `checkConfirmation` (binding, single use, expiry); `persistence/lifecycleStore.ts` `confirmationRecordFrom`; `commands/lifecycleCommon.ts` `requireConfirmation`.
- **Consumption:** `commands/lifecycleCommon.ts` `consumeConfirmation`, called in `commands/familiesClose.ts` and `commands/familiesWaiveRecovery.ts`.
- **Release milestone:** `persistence/lifecycleStore.ts` `writeReleaseMilestone`; `commands/familiesWaiveRecovery.ts` `releaseOrBlock`; `domain/lifecycle.ts` `decideRelease`.

### ProofPoint status (Substage 3A)

| ProofPoint | Suite | Substage 3A result | Deferred (not claimed) |
|---|---|---|---|
| `PL-PP-WP03-16` | PS-BILLING-LIFECYCLE | PARTIAL: close half (D1/D2/D3 local) | `billing.verifyPurchase` and purchase-token binding |
| `PL-PP-WP03-17` | PS-ACCESS-ISOLATION | PARTIAL: session access NONE, rules (D1/D2/D3 local) | Item/list listeners and queued writes (no item endpoints) |
| `PL-PP-WP03-18` | PS-BILLING-LIFECYCLE | 3A domain saga with the fake provider (D1/D2) | Real Play cancellation finality (W-05, 3B); no client surface for D3 |
| `PL-PP-WP03-19` | PS-ACCESS-ISOLATION | 3A scope (D1/D2/D3 local) | Android/cloud D3 |
| `PL-PP-WP03-20` | PS-RETENTION | PARTIAL: transition, boundary, guards (D1/D2) | G-03 purge, legal hold, backup; scheduling |
| `PL-PP-WP03-22` | PS-OFFLINE-SYNC | PARTIAL: lifecycle mutations only (D2/D3 local) | Item commands, Android offline queue, account switch |
| `PL-PP-WP03-24` | PS-BILLING-LIFECYCLE | PARTIAL: disposition only (D1/D2) | Activation (`billing.verifyPurchase`), real Play (3B) |
| `PL-PP-WP03-26` | PS-BILLING-LIFECYCLE | PARTIAL: hold, binding, claim retention (D1/D2) | Checkout endpoint; real Play late settlement (3B) |
| `PL-PP-WP03-27` | PS-ACCESS-ISOLATION | 3A scope (D1/D2/D3 local) | Client token issuance; Android D3 |
| `PL-PP-WP03-28` | PS-BILLING-LIFECYCLE | 3A domain saga with the fake provider (D1/D2/D3 local) | Real Play finality (W-05, 3B) |
| `PL-PP-WP03-29` | PS-RETENTION | PARTIAL (D1/D2/D3 local) | G-03 purge and legal hold |
| `PL-PP-WP03-30` | PS-ACCESS-ISOLATION | PARTIAL: release milestone added (D1/D2/D3 local); Slice 1 record preserved | Reservation release path (not ratified); G-03 |

- **D4:** GAI GO (final reconciliation). The GAI pre-merge report labels these ProofPoints "PASS (Substage 3A)". The GAI final reconciliation preserves them as "PARTIAL (Substage 3A Scope)". This manifest follows the YAML `slice_coverage` and the final reconciliation.
- **Not upgraded:** CODI does not upgrade any ProofPoint to production PASS.

### Post-merge and closure state (v1.6)

| Item | Value | Class / source |
|---|---|---|
| PR #8 | **MERGED** 2026-11-05T03:10:39Z by `egpennington` (merge commit method); merged head `23d751a` | CODI-inspected |
| `develop` HEAD | `7ca19f365d9779e31c538efc4126a7acdcc4b298` | CODI-inspected |
| `main` | unchanged at `b6ac365` | CODI-inspected |
| Feature branch | preserved at `23d751a` | CODI-inspected |
| Deployment | none | CODI-inspected |
| Closure | **Not declared.** Formal closure of Substage 3A is reserved to the PL. | PL decision pending |
| Substage 3B | **Gate C CLOSED** | PL |

### Remaining obligations (Substage 3A carry-forward)

- **Confirmation-token issuance for clients.** No client endpoint exists, and R-04 defines none. A contract is needed before any client can close a family or waive recovery.
- **Live Google Play / billing (W-05) and all of Substage 3B.** Sandbox and production evidence; RTDN/Pub/Sub; credentials; `billing.verifyPurchase`; reservation activation.
- **Reservation owner-slot release.** No ratified path exists; expired reservations keep the claim.
- **G-03.** Retention, purge, legal hold, backup and privacy policy; worker scheduling and dead-letter notification.
- **Deferred verification.** Android/client D3, physical device, cloud and production token verification (W-01 D-5: the emulator does not verify signatures).
- **Implementation interpretations.** These need a disposition: `CODI_WP03_S3A_Administrative_Closeout_Report_v1.0.md` §2 (local, untracked); register v1.12 WP03-S3A-INTERP.
- **Security exception.** WP03-S2-SEC-DISP expires **2026-12-01T00:00:00Z**. After that every FORGE run fails, so it needs renewal (with a new PL decision) or remediation first.
- **Evidence expiry.** Run #44 artifacts expire 2026-11-19.

## WP-03 Slice 3B Stage B1: local billing engine (v1.7)

This section records Stage B1 only. Every earlier section is unchanged. **Class** follows the same convention: *CODI-inspected*, *CODI-reported*, *GAI-reported*.

**Stage B1 PASS is fake-provider domain evidence, not production coverage.** No live Google Play, sandbox, Pub/Sub, cloud or Android evidence exists. ProofPoints -33..-36 are PARTIAL.

### Scope and authority

| Item | Value |
|---|---|
| Gate C | Opened for **Stage B1 only** (marker `WP03-S3B-B1-GATE-C-GO`; register v1.14, WP03-S3B-B1-GATE-C), after the PL ratified PL-3B-01, PL-3B-02 and the D-4 same-`opId` retry policy |
| Specification | `CODI_WP03_S3B_B1_Implementation_Handoff_v1.0.md` (SHA-256 `6a658676…8539`; local, untracked), governed by the merged R-04 v0.4 + A2-D1D4 contracts |
| Included | Play-semantics provider boundary (`subscriptionsv2` get/cancel model), deterministic fake Play API, fail-closed provider selection, RTDN parsing and processing domain, internal purchase-token binding, resilience and redaction, D1/D2 tests, Verity ProofPoints -33..-36 |
| Excluded | Stages B2 and B3 (Gate C **CLOSED**); live Google Play or sandbox calls; credentials; Pub/Sub, RTDN receiver and OIDC; cloud provisioning; deployment; public `billing.verifyPurchase`; client token-issuance callable; activation and paid entitlement; acknowledgement, refunds and charges; Android |
| Branch | `feature/wp03-s3b-billing-engine`, base `develop` @ `0c23eb142bdc041db044280e2de5a3e4c6a18cbe` |
| PR | #11, https://github.com/egpennington/newBaileysCart/pull/11 |

### Commits (PR #11)

| Commit | Content |
|---|---|
| `8d28099` | Play-semantics provider boundary (`billing/play.ts`, `playApi.ts`, `playProvider.ts`), fake Play API, synthetic config, demo-only provider selection, `billingHoldReason`, bounded jitter |
| `43ffd92` | RTDN parser (`billing/rtdn.ts`), binding decisions and storage, `workers/billingWorkers.ts` (`processRtdnDelivery`, `recordVerifiedPurchase`), server-only paths |
| `148415d8beb357a42b3ab5ff4f1e56a6d0c1153c` | D1/D2 tests and Verity ProofPoints -33..-36. **GAI-reviewed PR head.** |
| `ad1b700b059bc6c89f326d8f8d8001593095a9f2` | **Merge commit** of PR #11 into `develop` (parents `0c23eb1…`, `148415d…`). Its tree `d0ae85f2…` is identical to `148415d`. |

The PR changes 23 files (+2507 / −11) in 3 commits (GitHub PR metadata). There is no dependency, lockfile, workflow, `firestore.rules`, Android or security-exception change.

### Local test evidence (CODI-reported; Windows, Node 22, emulators on JBR 21.0.11)

| Run | Code | Result |
|---|---|---|
| Typecheck | `148415d` content | 0 errors |
| **D1** `npm test` | `148415d` content | **340/340**, exit 0 (314 pre-existing, 26 new in `test/unit/billingB1.test.ts`) |
| **D2/D3** `npm run test:emulator` | `148415d` content | **316/316**, 30 suites, exit 0, 1,724 s (292 pre-existing D2/D3, 24 new D2 in `test/emulator/billingEngine.test.ts`) |
| D3 for B1 | — | **DEFERRED.** B1 adds no callable, so no SDK round trip exists. The pre-existing D3 suites passed as regression. |
| Verity cross-reference check | `148415d` | PASS: 27 ProofPoints + 5 suites |
| `check-no-real-firebase.sh`, `check-osv-exceptions.mjs` | `148415d` | PASS; PASS (2 exceptions, expire 2026-12-01, not renewed) |
| `npm audit --audit-level=high` | `148415d` | exit 0 (12 moderate; dependency set unchanged) |

One D1 run made while the emulator job was rebuilding `lib/` showed 3 failures. A clean rerun did not reproduce them. That run is not counted, and the clean result is the one recorded above.

### Negative controls NC-33..NC-39 (CODI-reported)

Method: `run_ncs.py` applies one source mutation, runs the named test file, and restores the source with a SHA-256 check.

| NC | Mutation | Depth | Caught by |
|---|---|---|---|
| NC-33 | `selectProvider.ts`: the `demo-` project check neutralized (fake selectable outside a demo project) | D1 | "only the Functions emulator with a demo- project selects the fake" |
| NC-34 | `playProvider.ts`: the cancel acknowledgement treated as finality (refresh ignored) | D1 | 3 tests: ack is not finality; refresh failure; payment hold |
| NC-35 | `billingWorkers.ts`: the RTDN COMPLETED-duplicate check removed | D2 | 2 tests: duplicate/reordered; concurrent duplicates |
| NC-36 | `billingWorkers.ts`: RTDN applies VERIFIED without the provider inspection | D2 | "the payload is never trusted …" |
| NC-37 | `billingWorkers.ts`: raw token persisted in the RTDN delivery record | D2 | redaction test |
| NC-38 | `play.ts`: installment classified as ordinary auto-renewing | D1 | 2 tests: assessment; unsupported plans held |
| NC-39 | `play.ts`: obfuscated account mismatch ignored | D1 | 2 tests: assessment; mismatches held |

- **Result:** 7 of 7 caught.
- **First attempt discarded:** the first NC-33/NC-34 mutations failed to compile (unused-variable errors, rc 2, no test ran). They were discarded and rerun with type-valid mutations.
- **Next free ID:** NC-40.

**Raw evidence:** `baileysCartApp_evidence\WP03_S3B_B1_IMPLEMENTATION_EVIDENCE_v1.0\` (9 files plus `SHA256SUMS.txt`, SHA-256 `99efbca7…b8ee`): D1 log, full emulator log, B1-only D2 log, NC record and script, Verity output, policy-check outputs. It is outside the repository and not committed, and it contains local machine paths.

### FORGE CI evidence (CODI-inspected, authenticated read-only API)

| Run | ID | Event / commit | Conclusion |
|---|---|---|---|
| #49 | `42123952533` | push / `feature/wp03-s3b-billing-engine` @ `148415d` | **success, 9/9**, attempt 1, 22:43:57Z–23:06:31Z |
| #50 | `42124037124` | pull_request (PR #11) / `148415d` | **success, 9/9**, attempt 1, 22:44:32Z–23:05:55Z |
| **#51** | **`42129345471`** | **push / `develop` @ `ad1b700`** | **success, 9/9**, attempt 1, 2026-11-05T23:26:59Z–23:49:28Z |

**Run #51 detail** (https://github.com/egpennington/newBaileysCart/actions/runs/42129345471):

| Job | Job ID | Conclusion |
|---|---|---|
| No real Firebase configuration | 127601685958 | success |
| Gradle wrapper integrity | 127601686089 | success |
| Dependency scan and SBOM | 127601686222 | success |
| Backend typecheck/tests/audit | 127601686271 | success |
| Backend emulator tests | 127601686299 | success |
| Secret scan | 127601686521 | success |
| Clean repeat build | 127601762155 | success |
| Android compile/lint/unit | 127601762428 | success |
| **FORGE gate** | 127611489198 | success |

- **Step conclusions (all three runs):** "Verify security exception policy", "Scan lockfiles", "CycloneDX SBOM", "Scan full git history", "Scan working tree" and the emulator-tests step all succeeded.
- **Commit check-runs on `ad1b700`:** 9, with `FORGE gate` success.
- **Run #51 artifacts** (expire 2026-11-19):
  - `emulator-test-evidence` 13463757040 (`sha256:ab20bd9b…`)
  - `sbom` 13463300568 (`sha256:086b323e…`)
  - `repeat-build-evidence` 13462827036 (`sha256:ba0d0c01…`)
  - `android-reports` 13462397427 (`sha256:f9271cc5…`)
- **Not inspected:** job logs and artifact contents. **CI test totals, scanner findings and repeat-build hashes are NOT VERIFIED from CI.** Only job and step conclusions are verified. The D1/D2 counts above are local CODI runs.
- **Deployments:** the GitHub Deployments API lists 0. `main` remains at `b6ac365a471f77e0b0dcfb488dc064c106e782c4`.

### GAI verification record (GAI-reported; local, untracked report)

| Report | Target | Verdict |
|---|---|---|
| `GAI_WP03_S3B_B1_Implementation_D4_Verification_Report.md` (SHA-256 `e45cdd17…32aa`) | PR #11 @ `148415d`; runs #49, #50 | **GO** (technical recommendation to merge); 0 blockers; 2 low tracking items (`GAI-S3B-LOW-01` client obfuscation-prefix specification; `GAI-S3B-LOW-02` SEC-DISP expiry) |

**Review limitations:** GAI reviewed CODI's evidence, the source and CI telemetry (including a PL screenshot of runs #49/#50). It did not rerun tests or negative controls, and it reviewed the code before the merge. Run #51 postdates the report.

**CODI-inspected discrepancies in GAI's text**, recorded here and not adopted:

| GAI statement | Repository fact |
|---|---|
| `selectBillingProvider()` excerpt reads `process.env` and returns `createFakePlayProvider()` / `disabledPlayProvider` | `selectBillingProvider(env)` takes the environment as a parameter and returns `FakeBillingProvider` or `unavailableBillingProvider`. The Play adapter is not selected at runtime in B1. |
| `createLivePlayApi()` throws `"Live Google Play API is disabled in Stage B1"` | It throws `LiveProviderDisabledError` ("live billing provider is disabled in Stage B1") |
| Emulator run "608s duration" | 1,724 s locally |
| The cancel/refresh sequence is in `billingWorkers.ts`; the classifier is `assessSubscriptionSnapshot` returning `UNSUPPORTED_PLAN_TYPE` | The sequence is in `billing/playProvider.ts` `requestCancellation`. The classifier is `play.ts` `assessSubscription` (plan kind). `UNSUPPORTED_PLAN_TYPE` is a `billingHoldReason` set by the adapter. |
| Package checked against `com.penningtonlabs.baileyscart` | The configured synthetic package is `com.penningtonlabs.baileyscart.wp00placeholder` (WP00-OPEN-01) |
| Duplicate binding fails with `PURCHASE_ALREADY_BOUND`; identifiers are defined in `binding.ts` | The rejection is `ALREADY_BOUND_ELSEWHERE` (a concurrent `create()` makes the transaction retry and re-decide). The identifiers are defined in `play.ts`. |
| The late-settlement binding is written as `PENDING` | The binding status is `HELD_LATE_SETTLEMENT`; the local billing record is `PENDING` |
| `:core:model:jar` hash `cf6d0b16…0024`; osv-scanner "0 issues" | Not verified by CODI (artifact contents and logs not inspected) |
| ProofPoint -33 risk "High" | The YAML says `risk: critical` (-35 is `high`) |

None of these affects the merged code. They are evidence-accuracy corrections.

### ProofPoint status (Stage B1)

| ProofPoint | Suite | Stage B1 result | Deferred (not claimed) |
|---|---|---|---|
| `PL-PP-WP03-33` | PS-BILLING-LIFECYCLE | PARTIAL: isolation, disabled adapter, static no-network guard, redaction (D1/D2 local) | Deployed-runtime behavior; B2 credential handling |
| `PL-PP-WP03-34` | PS-BILLING-LIFECYCLE | PARTIAL: verified-finality saga over the fake Play API (D1/D2 local) | Real Play finality (W-05, B2); installment/prepaid policy |
| `PL-PP-WP03-35` | PS-BILLING-LIFECYCLE | PARTIAL: synthetic RTDN parsing and processing (D1/D2 local) | Receiver, Pub/Sub, OIDC, real RTDN fields (B2) |
| `PL-PP-WP03-36` | PS-BILLING-LIFECYCLE | PARTIAL: internal binding and late-settlement hold (D1/D2 local) | Public `billing.verifyPurchase`, activation, acknowledgement (B2 / ratification) |
| `PL-PP-WP03-32` | PS-ACCESS-ISOLATION | **NOT_RUN** (unchanged) | Client token-issuance endpoint not implemented |

D3 for -33..-36 is **DEFERRED**, because there is no callable surface. D4 is GAI GO. CODI does not upgrade any ProofPoint to production PASS.

### Post-merge and closure state (v1.7)

| Item | Value | Class / source |
|---|---|---|
| PR #11 | **MERGED** 2026-11-05T23:26:56Z by `egpennington` (merge commit method); merged head `148415d` | CODI-inspected |
| `develop` HEAD | `ad1b700b059bc6c89f326d8f8d8001593095a9f2` | CODI-inspected |
| `main` | unchanged at `b6ac365` | CODI-inspected |
| Feature branch | preserved at `148415d` | CODI-inspected |
| Deployment / cloud / live Play | none | CODI-inspected (Deployments API; no provider code path) |
| Closure | **Not declared.** Formal closure of Stage B1 is reserved to the PL. | PL decision pending |
| Stages B2, B3 | **Gate C CLOSED** | PL |

### Remaining obligations (Stage B1 carry-forward)

- **Stage B2:**
  - live Play sandbox (`subscriptionsv2` get/cancel), credentials and service account
  - Cloud Pub/Sub topic and subscription, RTDN push receiver, OIDC verification
  - purchase acknowledgement
  - real-Play confirmation of the finality definition and RTDN fields
- **Unsupported plan policy.** Installment, prepaid and unknown plans are held in `MANUAL_REVIEW` (`UNSUPPORTED_PLAN_TYPE`). A PL decision is needed before B2.
- **Android obfuscated identifier contract** (`GAI-S3B-LOW-01`): `sha256("bc-owner:"+uid)` and `sha256("bc-family:"+familyId)` must be specified for the client (WP-01/WP-02).
- **Client-facing confirmation-token issuance** (`familiesPrepareLifecycleConfirmation`, PLANNED; `PL-PP-WP03-32` NOT_RUN). The D-4 same-`opId` retry policy is ratified as a contract rule.
- **Reservation release, billing activation and paid entitlement.** These need the ratified `billing.verifyPurchase` and a paid access model. G-03 retention, purge and legal hold. Worker scheduling and dead-letter handling.
- **Voided-purchase / refund notifications.** These are recorded with no effect; handling is unspecified (W-05 / PL).
- **Security exception** (`GAI-S3B-LOW-02`): WP03-S2-SEC-DISP expires **2026-12-01T00:00:00Z**. It needs renewal (with a new PL decision) or remediation first, or every FORGE run fails.
- **Evidence expiry.** Run #49–#51 artifacts expire 2026-11-19.

## History: superseded v1.2 sections (retained unchanged)

### ProofPoint status as recorded in v1.2 (superseded by the table above)

FORGE success is not a PASS. The D4 column records **GAI's** final D4 determination at `8d2bfa0`. CODI does not upgrade any status. Two qualifications apply:
- GAI's contract basis was A1 v0.1.
- The open test gaps below are not closed.

Any later commit that changes tests or code needs new FORGE and GAI D4 evidence.

| ProofPoint | Slice coverage | D1 | D2 | D3 | D4 (GAI final, at `8d2bfa0`) | FORGE | Status |
|---|---|---|---|---|---|---|---|
| PL-PP-WP03-15 | Full (trial claim) | local + CI pass | local + CI pass (50 × 5 stress) | n/a | **GAI: PASS (Slice 1 scope)** | #19 pass (137/137, PL-inspected); #21 pass | **Slice 1 scope only, per GAI D4.** Not an overall PASS. |
| PL-PP-WP03-25 | Full (timestamps, retry, concurrency); checkout expiry out of scope | local + CI pass | local + CI pass | local + CI pass | **GAI: PASS (Slice 1 scope)** | #19 pass; #21 pass | **Slice 1 scope only, per GAI D4.** Open gaps T-GAP-4, -8 and -10 are not closed. |
| PL-PP-WP03-14 | **Partial** (rules + session isolation) | n/a | local + CI pass | n/a | **GAI: PARTIAL (Slice 1 scope)** | #19 pass; #21 pass | **PARTIAL.** Open gaps T-GAP-1, -5 and -7 are not closed. |
| PL-PP-WP03-30 | **Partial** (negative half only) | local + CI pass | local + CI pass | local + CI pass | **GAI: PARTIAL (Slice 1 scope)** | #19 pass; #21 pass | **PARTIAL** |
| PL-PP-WP03-01..13, 16–24, 26–29 | Not in Slice 1 | — | — | — | — | — | NOT_RUN |

### Test gaps as recorded in v1.2 (superseded by "Test gap status" above)

These come from the A1 traceability report and the execution plan `docs/specs/R-04/CODI_WP03_S1_R1_HB3_TEST_GAP_EXECUTION_PLAN_v1.0.md`. **No test for any of them has been implemented.**

| ID | Gap | Plan | Verity | Status |
|---|---|---|---|---|
| T-GAP-1 | Live `account.getSession` responses not validated against the A1 §A1.5 schema | Phase B (D1/D2/D3) | PL-PP-WP03-14 | **Not yet closed** |
| T-GAP-3 | Non-string `apiVersion` rejection untested | Phase B (D1) | none assigned (GAI to decide) | **Not yet closed** |
| T-GAP-4 | Verify, then resubmit the same `opId` (R-1 case 3) | Phase B (D2/D3) | PL-PP-WP03-25 | **Not yet closed** |
| T-GAP-5 | Unverified `account.getSession` caller | Phase B (D2/D3) | PL-PP-WP03-14 | **Not yet closed** |
| T-GAP-7 | Deterministic `joinedFamilies` order | Phase B (D2) | PL-PP-WP03-14 | **Not yet closed** |
| T-GAP-8 | Stored idempotency `command` value | Phase B (D2) | PL-PP-WP03-25 | **Not yet closed** |
| T-GAP-10 | Replay after loss of verification (R-1 case 2) | Phase B (D2), PL decision D-2 | PL-PP-WP03-25 | **Not yet closed** |
| T-GAP-2 | Contention exhaustion → `INTERNAL` | Deferred (optional) | — | Not closed |
| T-GAP-6 | Read-only snapshot not asserted | Proposed acceptance as a platform guarantee; not yet accepted | — | Not closed |
| T-GAP-9 | `INTERNAL` server-side logging not asserted | Deferred (optional) | — | Not closed |

### Known limitations as recorded in v1.2 (superseded by the list above)
- GAI D4 covers `8d2bfa0` against A1 **v0.1** only. The A1 v0.2 delta, clarification R-1 and the F-3/HB-3 decisions await GAI review.
- F-1, F-2 and F-3 (malformed or inconsistent stored family records) are accepted limitations only while `families.create` is the sole writer. HB-1..HB-3 hardening is not implemented.
- CI and local evidence both come from emulators on a `demo-*` project. No production Firebase environment exists or was used.
- The emulators do not verify ID-token or App Check signatures (W-01 D-5). D2/D3 prove logic, transactions and rule evaluation, not production authentication.
- Firestore emulator transaction contention is not production contention evidence.
- D3 uses the JS modular client SDK. The Android client SDK is not exercised (W-01 D-9).
- Production request limits, App Check and deployment behavior are not evidenced (W-01 D-4, D-8).
