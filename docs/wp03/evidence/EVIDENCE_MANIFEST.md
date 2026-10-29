# WP-03 Slice 1 Evidence Manifest: PS-BILLING-LIFECYCLE, PS-ACCESS-ISOLATION

- **Version:** 1.2 (2026-10-29). Changes from v1.1:
  - corrects stale branch, PR and D4 statements
  - records FORGE run #21 and GAI's final D4 determinations, attributed to GAI and not re-asserted by CODI
  - records the A1 v0.2 contract traceability result and the open test gaps

  v1.1 recorded FORGE runs #19 (positive, with test totals verified by the PL) and #20 (gate-integrity negative control), and the `shell: bash` repair. v1.0 recorded local evidence only.
- **Collected by:** CODI, 2026-10-28 (v1.0–v1.1); 2026-10-29 (v1.2)
- **Branch:** `feature/wp03-s1-family-ownership`, pushed to `origin`. Remote head at the time of v1.2: `8d2bfa0`. The v1.2 documentation commits are local until a push is separately authorized.
- **Pull request:** #4, **Draft**, `feature/wp03-s1-family-ownership` → `develop` (https://github.com/egpennington/newBaileysCart/pull/4). Merge is not authorized.
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
  - A documentation commit recording this manifest v1.2 and the Verity YAML corrections
- **Local environment:** Windows 11 (amd64), Git Bash
  - Node v22.18.0, npm 10.9.3
  - Firestore emulator on OpenJDK 25.0.3 (Android Studio JBR). CI pins Temurin 21.0.12+8.
  - firebase-tools 15.34.1; `cloud-firestore-emulator-v1.22.0.jar`
  - osv-scanner 2.7.0 (Windows build; SHA-256 `9964ed64…6438` from the release SHA256SUMS, whose Linux entry equals FORGE's pin)
  - gitleaks 8.30.1 (Windows build; SHA-256 `d29144de…c4e`, same release checksums file)
- **Raw logs:** retained outside the commits, in the untracked archive `docs/specs/R-04/WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` (SHA-256 `9162ac5e39f30daa2fe6bf31ca15ff12a29e80b08383673d494ce8aadf9a1833`; per-file sums in `WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.SHA256SUMS.txt`, 37 files). The logs contain local machine paths.
- **FORGE:** run #19 passed on `aa8db5b`, with 137/137 emulator tests passing. Run #20, the gate-integrity negative control, failed as intended. Run #21 passed on `8d2bfa0`, 9/9 jobs. Run #18 (`fa5b329`) is superseded. Details are in "FORGE CI evidence" below.

## Test runs

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

## GAI D4 determinations (recorded as GAI's; not re-asserted by CODI)

| Item | Value |
|---|---|
| Source | `docs/specs/R-04/GAI_WP03_Slice1_Final_D4_Verification_Report.md` (not committed; SHA-256 `b5cf38771d916837730c4087889a82704b75813d12de0901c0327afbea7e3673`) |
| Reviewed | `feature/wp03-s1-family-ownership` @ `8d2bfa0`; FORGE runs #19, #20 and #21 |
| Verdict | **GO to open a pull request to `develop`.** GAI states that this does **not** authorize merge, deployment or provisioning. |
| Findings | MED-01: ratify API Amendment A1 before merge. CODI addressed it with the PL ratification of A1 v0.2, committed in `e0f885d`, but **GAI has not re-reviewed it**. LOW-01: delete the disposable branch `feature/wp03-s1-gate-negative` (pending PL authorization). LOW-02: prune `backend/w01-probe/` (preserved by PL instruction). |
| Contract basis | GAI audited **A1 v0.1**. GAI has **not** reviewed the v0.1 → v0.2 delta (C-1..C-3, §A1.8), clarification R-1, or the F-3/HB-3 decisions. |

## A1 v0.2 contract traceability (CODI, not GAI)

- **Source:** `docs/specs/R-04/CODI_WP03_S1_A1_CONTRACT_TRACEABILITY_REPORT_v1.0.md` (not committed), reviewing `8d2bfa0`.
- **Result:** 73 rows: 52 MATCH, **0 MISMATCH**, 12 NOT VERIFIED (10 test gaps plus F-1/F-2), 9 DEFERRED.
- **Flags:** R-1 was resolved as a documentation clarification (no behavior change). F-3 was accepted for the Slice 1 sole-writer scope only, with HB-3 mandatory before any additional writer.

## ProofPoint status

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

## Open test gaps (NOT closed)

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

## Known limitations of this evidence
- GAI D4 covers `8d2bfa0` against A1 **v0.1** only. The A1 v0.2 delta, clarification R-1 and the F-3/HB-3 decisions await GAI review.
- F-1, F-2 and F-3 (malformed or inconsistent stored family records) are accepted limitations only while `families.create` is the sole writer. HB-1..HB-3 hardening is not implemented.
- CI and local evidence both come from emulators on a `demo-*` project. No production Firebase environment exists or was used.
- The emulators do not verify ID-token or App Check signatures (W-01 D-5). D2/D3 prove logic, transactions and rule evaluation, not production authentication.
- Firestore emulator transaction contention is not production contention evidence.
- D3 uses the JS modular client SDK. The Android client SDK is not exercised (W-01 D-9).
- Production request limits, App Check and deployment behavior are not evidenced (W-01 D-4, D-8).
