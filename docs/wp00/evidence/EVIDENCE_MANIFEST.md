# WP-00 Evidence Manifest: PS-BUILD-SUPPLY-CHAIN

- **Version:** 1.0
- **Collected by:** CODI
- **Branch:** `feature/wp00-foundations`
- **Base:** `b6ac365a471f77e0b0dcfb488dc064c106e782c4`
- **Implementation commits:**
  - `27de6506bece09c75ffc28192056b6c397feeef3` (implementation)
  - `8c91f74` (executable bits only)
- **Local environment:** Windows 11 (amd64), Git Bash
  - Temurin 21.0.12+8
  - Gradle 9.8.2 (wrapper; embedded Kotlin 2.4.10)
  - Node v22.18.0, npm 10.9.3
  - gitleaks 8.30.1, osv-scanner 2.7.0
  - Android SDK platform `android-37.0`, build-tools 36.0.0
- **Local TLS note:** Gradle ran with `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` because local antivirus inspects TLS. This changes transport trust only. Artifact integrity is enforced by `verification-metadata.xml`.
- **Raw logs:** retained outside the repository. They contain local machine paths, and Workflow v2.4 §9 says not to commit large logs. Available to GAI on request.

All local runs happened on 2026-10-27 between 03:35Z and 03:50Z (2026-10-26 Pacific).

## Status matrix

Statuses follow Workflow v2.4 §9. `NOT_RUN` and `BLOCKED` are not passes.

| ProofPoint | D2 local (CODI) | D2 CI (FORGE) | D4 (GAI) | Overall |
|---|---|---|---|---|
| PL-PP-WP00-01 Clean repeat build | **PASS** | NOT_RUN | NOT_RUN | Incomplete: CI not run |
| PL-PP-WP00-02 Secret absence | **PASS** | NOT_RUN | NOT_RUN | Incomplete: CI not run |
| PL-PP-WP00-03 CI failure gate | **PASS** (local negatives) | NOT_RUN | NOT_RUN | Incomplete: CI negative run not done |
| PL-PP-WP00-04 Dependency integrity / inventory | **FAIL** (vulnerability scan); integrity enforcement PASS | NOT_RUN | NOT_RUN | **FAIL**, pending PL disposition (WP00-OPEN-02) |
| PL-PP-WP00-05 No real Firebase | **PASS** | NOT_RUN | NOT_RUN | Incomplete: CI not run |

D1 (unit) and D3 (device) were not applicable to these ProofPoints and were not run. FORGE CI has **never executed**: the branch has not been pushed, because pushing needs PL approval.

## PL-PP-WP00-01: Clean repeat build

Command: `./gradlew clean :app:assembleRelease :core:model:jar --no-daemon --no-build-cache --rerun-tasks`

| Run | When (UTC) | Tree | Result | `app-release-unsigned.apk` SHA-256 | `model.jar` SHA-256 |
|---|---|---|---|---|---|
| 1 | 03:36Z | pre-commit working tree | BUILD SUCCESSFUL | `aa78c065341f31583c25f03da549219e150f73e73dab617edab3e92841580587` | `cf6d0b163ede0ec153dd6e07d01d86ba5eed229bcd155b7ffeb7aed85ec00024` |
| 2 | 03:37Z | same | BUILD SUCCESSFUL | `aa78c065…0587` (identical) | `cf6d0b16…0024` (identical) |
| 3 | 03:50Z | committed HEAD `8c91f74` | BUILD SUCCESSFUL | `aa78c065…0587` (identical) | `cf6d0b16…0024` (identical) |

- **Result:** byte-identical across three clean builds on one machine.
- **Limitation:** this doesn't show cross-machine or cross-OS identity. The CI repeat-build job will record Linux hashes.
- **Also checked:** `zipalign -c -P 16 -v 4` passes for `libandroidx.graphics.path.so` in all four ABIs (16 KB zip alignment). ELF segment alignment was not inspected.

## PL-PP-WP00-02: Secret absence and redaction

| Check | Result |
|---|---|
| `gitleaks git --config .gitleaks.toml --redact` (2 commits, full history) | exit 0, no leaks found |
| `gitleaks dir` on a `git archive` export of the committed tree (matches the CI checkout) | exit 0, no leaks found |
| Negative: synthetic `ghp_`-shaped random token in a temporary untracked file | exit 1, detected and redacted. File deleted. |
| `.gitleaks.toml` | default ruleset, no allowlist |

**Observation:** `gitleaks dir` on the *local* working directory reports one `generic-api-key` hit. It's in the untracked handoff document, line 14, where a document filename matched the rule: a false positive. That file is not committed (see report, risk R-05).

## PL-PP-WP00-03: Failure-gate behavior (local)

Each fixture was temporary, the gate command was run, and the fixture was then reverted. After the run, `git status` showed no fixture files and nothing staged.

| Fixture | Gate command | Exit | Result |
|---|---|---|---|
| Failing JUnit test in `:core:model` | `./gradlew :core:model:test` | 1 | Gate failed (expected) |
| Kotlin compiler warning (deprecated call) | `./gradlew :core:model:compileKotlin` | 1 | Gate failed (expected): `warnings found and -Werror specified` |
| Hardcoded manifest label | `./gradlew :app:lintDebug` | 1 | Gate failed (expected) |
| Failing `node:test` | `npm test` | 1 | Gate failed (expected) |
| Synthetic secret | `gitleaks dir` | 1 | Gate failed (expected) |
| `google-services.json`, gitignored | `check-no-real-firebase.sh` | 1 | Gate failed (expected) |
| `google-services.json`, force-tracked | `check-no-real-firebase.sh` | 1 | Gate failed (expected) |
| Non-demo project ID in `.firebaserc` | `check-no-real-firebase.sh` | 1 | Gate failed (expected) |
| One SHA-256 in `verification-metadata.xml` zeroed | `./gradlew assembleDebug lint --refresh-dependencies` | 1 | Gate failed (expected) |
| Lockfile entry drifted (junit 4.13.2 → 4.13.1) | `./gradlew :core:model:test` | 1 | Gate failed (expected) |

**Defects found and fixed during this ProofPoint:** the first run had two unexpected passes.
1. An unused-variable fixture produced no Kotlin 2 compiler warning, so the fixture was invalid. It was replaced by a deprecated-call fixture, which fails.
2. The Firebase guard skipped gitignored `google-services.json` files. The guard was corrected to include ignored copies and then retested.

The original unexpected passes are recorded in the raw logs.

**CI negative run: NOT_RUN.** It requires pushing a disposable failing-fixture branch, which needs PL approval.

## PL-PP-WP00-04: Dependency integrity and inventory

| Check | Result |
|---|---|
| Strict lockfiles | `android/app/gradle.lockfile`, `android/core/model/gradle.lockfile`, `android/settings-gradle.lockfile` |
| Checksum verification | `android/gradle/verification-metadata.xml`: SHA-256, 309 components. Linux and macOS `aapt2` jars added and checked against the published SHA-1. |
| Tamper and drift negatives | both fail the build (see PL-PP-WP00-03) |
| `npm ci --ignore-scripts` + `npm audit --audit-level=high` | 0 vulnerabilities (3 packages) |
| `osv-scanner scan source` over all lockfiles | **exit 1: 12 known vulnerabilities in 8 package entries (4 unique packages × 2 lockfiles), 1 ecosystem (Maven)** |
| CycloneDX 1.6 SBOM (`--all-packages`) | 209 components (206 Maven + 3 npm), which matches the 206 unique locked Maven coordinates |

Vulnerability findings. All of them sit **only** in the `androidLintTool` configuration, the Android Lint tool shipped with AGP 9.4.0. None are on any app compile or runtime classpath, and none are in the APK.

| Package | Locked version | Max severity (CVSS) | Fixed in |
|---|---|---|---|
| org.bouncycastle:bcprov-jdk18on | 1.80.2 | 9.3 (Critical) | 1.85 |
| org.bouncycastle:bcpkix-jdk18on | 1.80.2 | 6.3 | 1.84 |
| org.apache.commons:commons-lang3 | 3.16.0 | 6.5 | 3.18.0 |
| org.apache.httpcomponents:httpclient | 4.5.6 | 5.3 | 4.5.13 |

No suppression or allowlist was applied. Disposition is a PL risk decision (decision register WP00-OPEN-02).

## PL-PP-WP00-05: No real Firebase connectivity

| Check | Result |
|---|---|
| `bash scripts/check-no-real-firebase.sh` on the committed tree | exit 0: `PASS: no real Firebase configuration found (demo-* only).` |
| `backend/.firebaserc` | `demo-newbaileyscart` only |
| Android build | No Firebase SDK, no google-services plugin. Manifest declares no `INTERNET` permission. |
| Negative fixtures | 3/3 fail (see PL-PP-WP00-03) |
| Emulators | Not installed or run. WP-00 has no rules or callables (plan in `docs/BUILD.md`). |

## Android and backend gate (final pre-commit run, 03:46Z)

| Command | Result |
|---|---|
| `./gradlew clean assembleDebug assembleRelease test lint` | BUILD SUCCESSFUL. Lint passed (abortOnError and warnings as errors, both modules). |
| Unit tests | `AppModuleGraphTest` 1/1 pass; `BuildContractTest` 1/1 pass |
| `npm run typecheck` / `npm test` | exit 0; 1/1 pass |
