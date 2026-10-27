# WP-00 Evidence Manifest: PS-BUILD-SUPPLY-CHAIN

- **Version:** 1.4. Adds the JAR reproducibility hard gate, its positive control, and the PL-PP-WP00-03 negative CI runs. v1.3 recorded FORGE run 2; v1.2 added Fix A/Fix B; v1.1 added FORGE run 1 and the Fix A correction.
- **Collected by:** CODI
- **Branch:** `feature/wp00-foundations`
- **Base:** `b6ac365a471f77e0b0dcfb488dc064c106e782c4`
- **Implementation commits:**
  - `27de6506bece09c75ffc28192056b6c397feeef3` (implementation)
  - `8c91f74` (executable bits only)
  - `0cb99e5` (report and manifest v1.0; pushed, FORGE run 1)
  - `92f83a3939c2749260a4684b5d4cbedd68a81968` Fix A: verification metadata repair
  - `64c4d1c0ff5954e2fe8a273778fd41aa72fa2dd1` Fix B: lint-tool dependency remediation (FORGE run 2)
  - `50c1a64` manifest v1.3 + GAI handoff (docs only)
  - `39fa9a74bdcfb6f4217312619c607db64b45c723` JAR reproducibility hard gate (positive control run 40461844217)
  - Documentation-only commit recording this revision (v1.4)
- **Local environment:** Windows 11 (amd64), Git Bash
  - Temurin 21.0.12+8
  - Gradle 9.8.2 (wrapper; embedded Kotlin 2.4.10)
  - Node v22.18.0, npm 10.9.3
  - gitleaks 8.30.1, osv-scanner 2.7.0
  - Android SDK platform `android-37.0`, build-tools 36.0.0
- **Local TLS note:** Gradle ran with `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` because local antivirus inspects TLS. This changes transport trust only. Artifact integrity is enforced by `verification-metadata.xml`.
- **Raw logs:** retained outside the repository. They contain local machine paths, and Workflow v2.4 §9 says not to commit large logs. Available to GAI on request.

The v1.0 local runs happened on 2026-10-27 between 03:35Z and 03:50Z (2026-10-26 Pacific). Fix A runs happened between 04:41Z and 05:02Z.

## Correction: clean-environment build (Fix A)

**Original defect:**
- v1.0 evidence was collected only against a warm local Gradle cache. No build from an empty cache was run, so handoff acceptance criterion 5 ("reproducible on a clean environment") was claimed without being demonstrated.
- FORGE run 1 (https://github.com/egpennington/newBaileysCart/actions/runs/40447910773, commit `0cb99e5`) failed in both Android jobs during Gradle configuration.
- A fresh clone of `0cb99e5` with an empty `GRADLE_USER_HOME` reproduced the failure locally:

```
> Dependency verification failed for configuration 'classpath'
  4 artifacts failed verification:
    - guava-parent-33.4.0-jre.pom
    - junit-bom-5.10.2.module
    - junit-bom-5.11.0-M2.module
    - kotlinx-coroutines-bom-1.8.0.pom
```

The CI job logs themselves were not readable (they need a signed-in account). The reproduction is local evidence.

**Repair:**
- `verification-metadata.xml` was regenerated from an empty cache. It now has **5 added artifact entries** and no existing checksum changed or removed.
- Every new SHA-256 entry comes from a file whose SHA-1 matches the `.sha1` published on Maven Central.

| Added artifact | SHA-256 | Maven Central SHA-1 |
|---|---|---|
| `com.google.guava:guava-parent:33.4.0-jre` `.pom` | `3a499ed34a0d9ee0f1bcc39230021a1cd4e2f7dd0426ab6844f585465d41dcd7` | match |
| `org.apache.groovy:groovy-bom:4.0.29` `.pom` | `c24277dec93f146bcda25f5ae4391d6527e384e2132efa32184c1e852b42bca9` | match |
| `org.jetbrains.kotlinx:kotlinx-coroutines-bom:1.8.0` `.pom` | `1239e9dbe1397cd5971342956b2511bc3ace7b641842e4372a088dcfa8b9ad55` | match |
| `org.junit:junit-bom:5.10.2` `.module` | `de23b114b3e4119a8fe6eb17bed5a3852816698bace67071579d6d927ebb080a` | match |
| `org.junit:junit-bom:5.11.0-M2` `.module` | `86477abcf490d6ca059aa9973cb108d22a506f49d1a5569bb32cc6cbf43c2cce` | match |

| Repair run (local) | Cache | Result |
|---|---|---|
| Regenerate: `--write-verification-metadata sha256 assembleDebug assembleRelease test lint :app:dependencies :core:model:dependencies` | empty | BUILD SUCCESSFUL in 8m 42s |
| Verify: `clean assembleDebug assembleRelease test lint` | second empty cache | BUILD SUCCESSFUL in 5m 35s (108 tasks executed, 0 verification failures) |

The scratch-clone trial also added `junit-bom-5.13.3.pom`. The authoritative clean regeneration did not need it, and the second empty-cache build proves it isn't required.

## Fix B: Android Lint tool dependency remediation

- **Change:** `android/build.gradle.kts` forces patched versions for the `androidLintTool` configuration only:
  - bcprov/bcpkix/bcutil-jdk18on 1.80.2 → 1.85
  - commons-lang3 3.16.0 → 3.18.0
  - httpclient 4.5.6 → 4.5.13
- **No suppression:** no exclusions, ignores or gate changes.

| Check (local, 2026-10-27 05:09Z–05:25Z) | Result |
|---|---|
| Regenerate locks and metadata from an empty cache (`clean … --write-locks --write-verification-metadata sha256`) | BUILD SUCCESSFUL. Two earlier attempts failed on local network/TLS drops to `dl.google.com` and services.gradle.org; their partial outputs were discarded. |
| Lockfile diff | Only the 5 `=androidLintTool` lines above changed, in `app` and `core/model`. `settings-gradle.lockfile` unchanged. |
| Verification metadata diff | 42 artifacts added, 0 removed or changed. **42/42** match the publisher's `.sha1` (Google Maven or Maven Central), and their SHA-256 matches the recorded entry. Additions: the 10 patched jars/POMs, 3 parent POMs (apache-35, commons-parent-85, httpcomponents-client-4.5.13), and 29 metadata files (22 AndroidX `.module`/`.pom`, 4 kotlinx-coroutines, 3 junit-bom). The second empty-cache build after Fix A did not need those 29. This cold resolution fetched and recorded them, and why it differs between runs was not determined. Extra validated entries add no trust beyond those exact checksums. |
| Full build from a second empty cache: `clean assembleDebug assembleRelease test lint` | BUILD SUCCESSFUL (108 tasks executed) |
| Release APK SHA-256 after Fix B | `aa78c065…0587`, **identical** to before Fix B, so the app runtime is unchanged |
| `osv-scanner scan source` (all 3 lockfiles: 201 + 100 Maven, 3 npm packages) | exit 0: **No issues found** |
| `./gradlew lint --rerun-tasks` | exit 0; 11 lint tasks executed with the patched tool classpath |
| Lint negative: hardcoded manifest label in `:app` | exit 1: `[UnusedResources]` error detected |
| Lint negative: `String.format` without locale in `:core:model` | exit 1: `[DefaultLocale]` error detected |
| Lint after reverting both fixtures | exit 0 |

## FORGE (GitHub Actions) results

These come from GitHub Actions job conclusions read through the public GitHub REST API. They are **not** CODI local results, and **GAI has not verified them**.

| Run | Commit | Event | Started (UTC) | Conclusion | URL |
|---|---|---|---|---|---|
| #1 | `0cb99e5` | push | 2026-10-27T04:06Z | **failure** | https://github.com/egpennington/newBaileysCart/actions/runs/40447910773 |
| **#2** | **`64c4d1c`** | push | 2026-10-27T05:25:27Z | **success** | https://github.com/egpennington/newBaileysCart/actions/runs/40455233810 |

### Run #2 job results (`64c4d1c`)

| Job | Job ID | Conclusion | Duration |
|---|---|---|---|
| Gradle wrapper integrity | 122026895456 | success | 7 s |
| Android compile, lint, unit tests | 122026939408 | success | 169 s |
| Clean repeat build (PL-PP-WP00-01) | 122026939345 | success | 185 s |
| Backend typecheck, tests, npm audit | 122026895405 | success | 15 s |
| Dependency vulnerability scan and SBOM (PL-PP-WP00-04) | 122026895639 | success | 6 s |
| Secret scan (PL-PP-WP00-02) | 122026895201 | success | 6 s |
| No real Firebase configuration (PL-PP-WP00-05) | 122026895506 | success | 5 s |
| FORGE gate (aggregate) | 122027875549 | success | 2 s |

### Run #2 artifacts (retention until 2026-11-10)

| Artifact | ID | Size (zip) | Digest |
|---|---|---|---|
| `android-reports` (lint and unit-test reports) | 12712306369 | 22,888 B | `sha256:a0096994d68f75f75bec39152b61d2588d0632c04dda9871efc63bcfc39cc17a` |
| `sbom` (CycloneDX 1.6, `--all-packages`) | 12712028867 | 4,418 B | `sha256:b0b272e585232fd199435c9e63b0791b960bcc531bfb66b9255aac39ec7a78e1` |

### Incomplete CI evidence (not retrieved)

CODI has no signed-in GitHub access. Job logs, job summaries and artifact downloads all need a signed-in account; the API returns 403 and exposes no check-run summary. So:

- **CI repeat-build hashes: NOT RETRIEVED.** They are written to the job summary of job 122026939345 (run #2 → "Clean repeat build" → Summary). That job builds twice and reports whether the hashes match, but **does not fail on a mismatch**. A green job therefore proves both clean builds succeeded, not that their outputs were identical. The local hashes are `aa78c065…0587` (APK) and `cf6d0b16…0024` (`model.jar`). Whether CI hashes match each other, or match the local ones, is unverified.
- **CI SBOM contents: NOT INSPECTED.** Locally, the same command produces 209 components.
- **CI job logs: NOT READ.** The run #1 root cause was established by local reproduction (see correction above).

A signed-in reviewer (GAI or the PL) can retrieve all three from the run #2 page.

## JAR reproducibility hard gate and negative CI proof (v1.4)

- **Authorization:** `CODI_WP00_HARD_GATE_NEGATIVE_CI_AUTHORIZATION_v1.0.md` (code `9361742805`)
- **Decision:** register entry WP00-REPRO-01
- **Hard-gate commit:** `39fa9a74bdcfb6f4217312619c607db64b45c723`

**Gate behavior (`repeat-build` job):**
1. Step "Two independent clean builds" runs `./gradlew clean` and fails if any `model.jar` or release APK survives the clean. It then builds `:app:assembleRelease :core:model:jar` (`--no-build-cache --rerun-tasks`) and copies that run's `model.jar` and APK to `run1/` or `run2/`. It does this twice.
2. Step "Compare hashes" compares the SHA-256 of the two `model.jar` copies, and exits 1 on mismatch with an `::error::` annotation (**hard gate**). It compares the two APK copies too, but a mismatch only raises `::warning::` (**informational for WP-00**).
3. Both hash pairs are published as `::notice::` annotations, in the job summary, and in the `repeat-build-evidence` artifact (`hashes.txt`, `build-provenance.txt`, both JARs and APKs). The artifact upload uses `if: always()`, so the evidence survives a failure.
4. A failed `repeat-build` propagates to `forge-gate`, which fails on any non-`success` upstream result.

The annotations are readable through the public GitHub API, so CODI could read the CI hashes directly for this evidence. The job logs and summaries still need a signed-in account.

### Run-by-run evidence

| Run | Branch / commit | Fixture (diff vs `39fa9a7`) | Expected | Actual (GitHub API) | `forge-gate` | Result |
|---|---|---|---|---|---|---|
| **Positive control** [40461844217](https://github.com/egpennington/newBaileysCart/actions/runs/40461844217) | `feature/wp00-foundations` @ `39fa9a7` | none | all 8 jobs succeed; JAR hashes equal | all 8 success. JAR `cf6d0b16…0024` ×2; APK `aa78c065…0587` ×2 (notice annotations) | success | **PASS** |
| **Variant A** [40462443414](https://github.com/egpennington/newBaileysCart/actions/runs/40462443414) | `feature/wp00-pp03-gate-negative` @ `658a5fa5f1e8fe94a49bca44c5281f0bee0cfd08` | +`Wp00Pp03NegativeTest.kt` (deliberate `assertEquals` failure) | `android` fails at "Build, lint, unit tests"; `forge-gate` fails | `android` **failure** at step 7 "Build, lint, unit tests"; other 6 jobs success; repeat-build JAR hashes equal | **failure** | **PASS** (negative) |
| **Variant B** [40462880987](https://github.com/egpennington/newBaileysCart/actions/runs/40462880987) | same branch @ `3595e26854928f4ee87b0be09a7e5b779858d1e5` | `verification-metadata.xml`: `junit-4.13.2.jar` SHA-256 replaced with an invalid value | Gradle dependency verification fails in `android`; `forge-gate` fails | `android` **failure** at step 7; `repeat-build` success (junit is not on its classpaths, as predicted); other jobs success | **failure** | **PASS** (negative) |
| **Variant C** [40463371956](https://github.com/egpennington/newBaileysCart/actions/runs/40463371956) | same branch @ `581e2baf99b97adb53d389b8ca1fcfc5823d19fa` | `core/model/build.gradle.kts`: per-build nanosecond stamp added to `model.jar` (build script only; no production source) | `repeat-build` fails at "Compare hashes" on differing JAR hashes; `forge-gate` fails | build step success (independence check passed). `repeat-build` **failure at step 7 "Compare hashes"**, `::error:: core:model JAR not byte-identical` run1 `7b925fc7f97503e5815ac98440f955e3f1a9d4cb9ea87634f8633ebadb108cc2` / run2 `c4c8170cf3db00b828042ae87b1bd5b547f47a5a17e6bfa7ff6bf40180499871`. APK warning only. All other jobs success; evidence artifact uploaded. | **failure** | **PASS** (negative) |

Each variant's commit tree is `39fa9a7` plus that variant's fixture alone. Each later variant removed the previous fixture, so no failure could mask another. Runs were pushed one at a time, each after the previous run had finished.

**Attribution limits:**
- For variants A and B, CI attribution is at **step level** ("Build, lint, unit tests" failed). The log text that would show the assertion or verification message was not read; it needs a signed-in account.
- The intended causes are supported by local reproduction of the identical fixtures on `39fa9a7`:
  - A: `Wp00Pp03NegativeTest > deliberateFailureForForgeGateProof FAILED … ComparisonFailure`, 2 tests, 1 failed.
  - B: `Dependency verification failed … junit-4.13.2.jar (junit:junit:4.13.2)`.
- They are also consistent with the `android-reports` artifact sizes: A 14,409 B (tests ran, lint skipped); B 725 B (failed during resolution); baseline about 22.9 KB.
- **Variant C's cause is shown directly in the CI annotations.**

**Not tested:** a *skipped* upstream job. The planned wrapper-tamper variant was replaced by the non-executable checksum fixture, per the authorization §4B preference. The skipped path in `forge-gate` is covered by its code (`!= success`) and by GAI's code audit, but not by a CI run.

### Local checks (CODI, 2026-10-27, before pushing)

| Check | Result |
|---|---|
| Hard-gate step scripts extracted from the workflow and run locally with two real clean builds | positive: exit 0, JAR `cf6d0b16…0024` ×2 |
| Same compare script on an altered `model.jar` copy | exit 1 with `::error::` |
| Variant C fixture with the step scripts | build exit 0, compare exit 1 (different JAR hashes); other gates (`assembleDebug test lint`) exit 0 |
| Workflow YAML parse (js-yaml 4.1.0) | 8 jobs; repeat-build has 7 steps; upload `if: always()` |

### Cross-OS observation

The positive-control CI hashes on Linux (`ubuntu-24.04`) are **identical** to CODI's local Windows hashes: JAR `cf6d0b16…0024`, APK `aa78c065…0587`. That makes the WP-00 build byte-reproducible across those two environments, which is observed, not promised.

### Disposable branch cleanup

1. Before deletion: all 3 run records, the job results, annotations and artifact IDs were captured, and a verified `git bundle` plus patches of `39fa9a7..581e2ba` were saved by CODI outside the repository.
2. `feature/wp00-pp03-gate-negative` was deleted locally and on `origin` at **2026-10-27T06:56:04Z**.
3. After deletion:
   - `feature/wp00-foundations` = `39fa9a7` and `main` = `b6ac365`, both unchanged; no other branches exist.
   - All 3 negative runs, and their 3 artifacts each, are still retrievable.
   - Commit `581e2ba` still resolves through the GitHub API.
   - The canonical tree contains none of the fixtures.

## Status matrix

Statuses follow Workflow v2.4 §9. `NOT_RUN` and `BLOCKED` are not passes. The CI columns reflect GitHub Actions results only. **GAI has not reviewed the hard gate or the negative runs.**

| ProofPoint | D2 local (CODI) | D2 CI (FORGE) | D4 (GAI) |
|---|---|---|---|
| PL-PP-WP00-01 Clean repeat build | PASS (identical hashes; clean-cache builds; hard-gate scripts pass on match, fail on mismatch) | **PASS**: positive control 40461844217, JAR hard gate passed on equal hashes. Gate effectiveness shown by variant C (40463371956). | NOT_RUN for the hard gate (GAI's earlier CONDITIONAL PASS predates it) |
| PL-PP-WP00-02 Secret absence | PASS | PASS (runs #2, #3, positive control) | GAI-reported PASS (code and CI inspection, per GAI reconciliation report; not a bare-metal reproduction) |
| PL-PP-WP00-03 CI failure gate | PASS (10 local negative fixtures) | **PASS**: variants A, B and C each failed their intended gate, and `forge-gate` failed each time (A/B attributed at step level; C by annotation). Skipped-job path not exercised in CI. | NOT_RUN |
| PL-PP-WP00-04 Dependency integrity / inventory | PASS | PASS (scan job succeeded). Verification gate effectiveness shown by variant B. SBOM contents not inspected by CODI. | GAI-reported PASS (inspection) |
| PL-PP-WP00-05 No real Firebase | PASS | PASS | GAI-reported PASS (inspection) |

D1 (unit) and D3 (device) were not applicable to these ProofPoints and were not run.

## PL-PP-WP00-01: Clean repeat build

Command: `./gradlew clean :app:assembleRelease :core:model:jar --no-daemon --no-build-cache --rerun-tasks`

| Run | When (UTC) | Tree | Result | `app-release-unsigned.apk` SHA-256 | `model.jar` SHA-256 |
|---|---|---|---|---|---|
| 1 | 03:36Z | pre-commit working tree | BUILD SUCCESSFUL | `aa78c065341f31583c25f03da549219e150f73e73dab617edab3e92841580587` | `cf6d0b163ede0ec153dd6e07d01d86ba5eed229bcd155b7ffeb7aed85ec00024` |
| 2 | 03:37Z | same | BUILD SUCCESSFUL | `aa78c065…0587` (identical) | `cf6d0b16…0024` (identical) |
| 3 | 03:50Z | committed HEAD `8c91f74` | BUILD SUCCESSFUL | `aa78c065…0587` (identical) | `cf6d0b16…0024` (identical) |

- **Result:** byte-identical across three clean builds on one machine.
- **Limitation:** these three local runs alone don't show cross-machine identity. Since the hard gate (`39fa9a7`), CI hashes are published as annotations: the Linux CI hashes equal the local Windows hashes (see the cross-OS observation). A post-Fix-B local rebuild also produced the same APK hash.
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

**CI negative runs: executed 2026-10-27 on a disposable branch (variants A, B, C). See "JAR reproducibility hard gate and negative CI proof" above.

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

No suppression or allowlist was applied. **Superseded:** this table is the v1.0 state. The findings were remediated by Fix B (`64c4d1c`): local osv-scanner reports no issues, and the FORGE run #2 scan job succeeded.

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
