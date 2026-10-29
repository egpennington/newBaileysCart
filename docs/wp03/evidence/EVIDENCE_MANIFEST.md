# WP-03 Slice 1 Evidence Manifest: PS-BILLING-LIFECYCLE, PS-ACCESS-ISOLATION

- **Version:** 1.3 (2026-10-29). Changes from v1.2:
  - records the Phase B test commit `94d31d9`, its local evidence (D1 129/129; emulator 143/143; NC-10..NC-16) and FORGE runs #22–#26
  - records the PL-inspected run #25 totals
  - records the GAI Phase A and Phase B D4 reports and their correction addenda, in chronological order with their supersession relationships
  - records the seven Phase B test gaps as **closed within Slice 1 scope**, with provenance. T-GAP-2, 6 and 9 stay open.
  - earlier sections are retained. Where v1.3 changes a v1.2 statement, the v1.2 text is kept and marked as superseded.
  - records the Phase B local evidence archive and its SHA-256 (archived after the initial v1.3 preparation; the earlier "not yet archived" wording is replaced)

  v1.2 corrected stale branch, PR and D4 statements, recorded FORGE run #21 and GAI's 2026-10-28 final D4 determinations, and recorded the A1 v0.2 traceability result. v1.1 recorded FORGE runs #19 and #20 and the `shell: bash` repair. v1.0 recorded local evidence only.
- **Collected by:** CODI, 2026-10-28 (v1.0–v1.1); 2026-10-29 (v1.2, v1.3)
- **Branch:** `feature/wp03-s1-family-ownership`, pushed to `origin`. Remote head at the time of v1.3: `94d31d9a88ad14791e64d4945301983ba1653f92`. This v1.3 update is uncommitted until a commit is separately authorized.
- **Pull request:** #4, **Draft**, `feature/wp03-s1-family-ownership` → `develop` (https://github.com/egpennington/newBaileysCart/pull/4). Merge is not authorized. GAI's corrected Phase B record places merge on **HOLD** pending the PL's decision.
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
  - A documentation commit recording this manifest v1.3 (pending authorization)
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
  - Run #26 totals were not separately inspected by the PL.
  - Runs #21–#24 totals were not confirmed to CODI (#23/#24 are GAI-reported as PL-observed).
- **Local evidence storage:**
  - NC-10..16 and the Phase B local logs are CODI-reported. GAI did not inspect the raw logs.
  - Those logs are archived outside the repository in `WP03_S1_PHASE_B_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` (SHA-256 `5c5e0142…8843`). They are not committed and have not been inspected by GAI.
- **Emulator only:** CI and local evidence both come from emulators on a `demo-*` project. No production Firebase environment exists or was used.
- **Authentication:** the emulators do not verify ID-token (JWT) signatures or App Check tokens (W-01 D-4, D-5). **Production JWT-signature and App Check verification are not established.** D2/D3 prove logic, transactions and rule evaluation, not production authentication.
- **Contention:** Firestore emulator transaction contention is not production contention evidence.
- **Android:** D3 uses the JS modular client SDK. The Android client SDK is not exercised (W-01 D-9).
- **Production behavior:** production request limits and deployment behavior are not evidenced (W-01 D-8).

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
