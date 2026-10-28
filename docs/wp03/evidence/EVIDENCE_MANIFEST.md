# WP-03 Slice 1 Evidence Manifest: PS-BILLING-LIFECYCLE, PS-ACCESS-ISOLATION

- **Version:** 1.0 (local evidence only; no FORGE run yet)
- **Collected by:** CODI, 2026-10-28
- **Branch:** `feature/wp03-s1-family-ownership` (local; not pushed)
- **Base:** `develop` @ `f96e5376804facc2e01bcad7100e4574f05de3c3`
- **Implementation commits:**
  - `ac3a54e9b4575dd5d1cc13e69d39c0eaf775c5dd` dependencies, emulator config, deny-all rules
  - `75bf4b1222cc0820de4793266d5333bbd4a2459c` contract, validation, pure domain (Tasks 2–3)
  - `d7beae883c98b2aa739990571bd9c75f86a24c51` `families.create`, `account.getSession`, adapter, tests (Tasks 4–7)
  - `e4e9e1cfbbbce0638e1823f98cc5288d4e137858` FORGE emulator job (Task 8)
  - A documentation commit recording this manifest, the Verity YAMLs and the version record
- **Local environment:** Windows 11 (amd64), Git Bash
  - Node v22.18.0, npm 10.9.3
  - Firestore emulator on OpenJDK 25.0.3 (Android Studio JBR). CI pins Temurin 21.0.12+8.
  - firebase-tools 15.34.1; `cloud-firestore-emulator-v1.22.0.jar`
  - osv-scanner 2.7.0 (Windows build; SHA-256 `9964ed64…6438` from the release SHA256SUMS, whose Linux entry equals FORGE's pin)
  - gitleaks 8.30.1 (Windows build; SHA-256 `d29144de…c4e`, same release checksums file)
- **Raw logs:** retained outside the commits, in the untracked archive `docs/specs/R-04/WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.tar.gz` (SHA-256 `9162ac5e39f30daa2fe6bf31ca15ff12a29e80b08383673d494ce8aadf9a1833`; per-file sums in `WP03_S1_LOCAL_TEST_EVIDENCE_v1.0.SHA256SUMS.txt`, 37 files). The logs contain local machine paths.
- **FORGE:** **NOT_RUN.** The branch has not been pushed; a push needs PL authorization.

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

## ProofPoint status

Status reflects local execution only. **No ProofPoint is PASS** until FORGE CI evidence exists and GAI completes D4.

| ProofPoint | Slice coverage | D1 | D2 | D3 | D4 | FORGE | Status |
|---|---|---|---|---|---|---|---|
| PL-PP-WP03-15 | Full (trial claim) | local pass | local pass (50 × 5 stress) | n/a | NOT_RUN | NOT_RUN | **NOT_RUN (local evidence ready)** |
| PL-PP-WP03-25 | Full (timestamps, retry, concurrency); checkout expiry out of scope | local pass | local pass | local pass | NOT_RUN | NOT_RUN | **NOT_RUN (local evidence ready)** |
| PL-PP-WP03-14 | **Partial** (rules + session isolation) | n/a | local pass | n/a | NOT_RUN | NOT_RUN | **PARTIAL; NOT_RUN** |
| PL-PP-WP03-30 | **Partial** (negative half only) | local pass | local pass | local pass | NOT_RUN | NOT_RUN | **PARTIAL; NOT_RUN** |
| PL-PP-WP03-01..13, 16–24, 26–29 | Not in Slice 1 | — | — | — | — | — | NOT_RUN |

## Known limitations of this evidence
- The emulators do not verify ID-token or App Check signatures (W-01 D-5). D2/D3 prove logic, transactions and rule evaluation, not production authentication.
- Firestore emulator transaction contention is not production contention evidence.
- D3 uses the JS modular client SDK. The Android client SDK is not exercised (W-01 D-9).
- Production request limits, App Check and deployment behavior are not evidenced (W-01 D-4, D-8).
