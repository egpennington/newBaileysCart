# WP-00 Evidence Manifest: PS-BUILD-SUPPLY-CHAIN

- **Version:** 1.2. Adds the FORGE run 1 result, the Fix A clean-environment correction, and Fix B lint-tool dependency remediation.
- **Collected by:** CODI
- **Branch:** `feature/wp00-foundations`
- **Base:** `b6ac365a471f77e0b0dcfb488dc064c106e782c4`
- **Implementation commits:**
  - `27de6506bece09c75ffc28192056b6c397feeef3` (implementation)
  - `8c91f74` (executable bits only)
  - `0cb99e5` (report and manifest v1.0; pushed, FORGE run 1)
  - `92f83a3` Fix A: verification metadata repair
  - Fix B commit: lint-tool dependency remediation (this revision)
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

## Status matrix

Statuses follow Workflow v2.4 §9. `NOT_RUN` and `BLOCKED` are not passes. FORGE results are taken only from GitHub Actions job conclusions.

| ProofPoint | D2 local (CODI, after Fix A+B) | D2 CI (FORGE run 1, `0cb99e5`) | D4 (GAI) |
|---|---|---|---|
| PL-PP-WP00-01 Clean repeat build | PASS (identical hashes; clean-cache builds pass) | **FAIL** (verification, see correction) | NOT_RUN |
| PL-PP-WP00-02 Secret absence | PASS | **PASS** | NOT_RUN |
| PL-PP-WP00-03 CI failure gate | PASS (local negatives) | NOT_RUN (no deliberate-fixture CI run) | NOT_RUN |
| PL-PP-WP00-04 Dependency integrity / inventory | PASS (osv clean; integrity enforced) | **FAIL** (Scan lockfiles step) | NOT_RUN |
| PL-PP-WP00-05 No real Firebase | PASS | **PASS** | NOT_RUN |

D1 (unit) and D3 (device) were not applicable to these ProofPoints and were not run. Results after the remediation commits are recorded once the next FORGE run completes.

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
