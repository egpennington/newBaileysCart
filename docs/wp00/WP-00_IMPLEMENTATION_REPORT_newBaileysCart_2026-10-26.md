# WP-00 Implementation Report: Android Foundations and FORGE Build Contract

**Project:** newBaileysCart | **Workflow:** Pennington Labs Engineering Workflow v2.4 | **Mode:** Production Engineering
**From / To:** CODI → GAI (independent verification) → CipherMuse → penguinPrime
**Date:** 2026-10-26 | **Handoff:** CODI WP-00 Implementation Handoff v1.0 (completeness code `6391824705`)

## Summary

The WP-00 foundation is implemented and committed on `feature/wp00-foundations`. It contains:

- a pinned Android build with two modules
- a TypeScript backend skeleton
- strict dependency locking and checksum verification
- lint and warnings-as-errors gates
- secret and Firebase guards
- a FORGE GitHub Actions workflow
- the five Verity ProofPoint contracts

Local evidence:
- **PASS (local):** PL-PP-WP00-01, -02, -03 and -05.
- **FAIL:** PL-PP-WP00-04. osv-scanner reports 12 known vulnerabilities in the Android Lint tool's own dependencies, bundled by AGP 9.4.0. They are not in the app. This needs a PL risk decision.

**FORGE CI has not run.** The branch is local only, because pushing needs PL approval. No CI result is claimed.

Nothing was merged, deployed or provisioned. No WP-03/WP-01/WP-02 or SQLCipher work was done, and the legacy repository was not touched.

## (a) Branch and commits

| Item | Value |
|---|---|
| Repository | `https://github.com/egpennington/newBaileysCart.git` |
| Branch | `feature/wp00-foundations` (local only, not pushed) |
| Base | `main` @ `b6ac365a471f77e0b0dcfb488dc064c106e782c4` (certified; `origin/main` unchanged at start of work) |
| Commits | `27de650` implementation; `8c91f74` executable bits for Linux CI; this report and evidence manifest in the following commit |
| Legacy repo | Not touched |

## (b) Changed-file manifest (`b6ac365..8c91f74`, 49 files)

| Area | Files |
|---|---|
| Repo hygiene | `.gitignore`, `.gitattributes`, `.gitleaks.toml`, `README.md` (Getting started section only) |
| Android build | `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`, `android/gradle/verification-metadata.xml`, `android/gradle/wrapper/*`, `android/gradlew(.bat)`, `android/*gradle.lockfile` (3) |
| `:app` | `build.gradle.kts`, `AndroidManifest.xml`, `MainActivity.kt` (placeholder), `res/values/strings.xml`, `res/xml/{data_extraction_rules,backup_rules}.xml`, `res/drawable/ic_launcher_placeholder.xml`, `AppModuleGraphTest.kt` |
| `:core:model` | `build.gradle.kts`, `BuildContract.kt` (placeholder), `BuildContractTest.kt` |
| Backend | `backend/.firebaserc` (demo only), `backend/firebase.json` (emulator ports), `backend/functions/{package.json,package-lock.json,tsconfig.json,.npmrc,.nvmrc,src/index.ts,test/index.test.ts}` |
| FORGE | `.github/workflows/forge-wp00.yml`, `scripts/check-no-real-firebase.sh` |
| Verity | `tests/verity/proofpoints/PL-PP-WP00-0{1..5}.yaml`, `tests/verity/suites/PS-BUILD-SUPPLY-CHAIN.yaml` |
| Docs | `docs/BUILD.md`, `docs/decisions/DECISION_REGISTER.md`, `docs/wp00/VERSION_DECISION_RECORD.md`, `docs/specs/README.md`, `docs/specs/API_SPEC_v0.3_REV1_RATIFIED_COPY.md` (byte-identical copy) |

These files are not committed, following the PL documentation policy:
- the handoff document (see R-05)
- the checkout certification report
- the escalation reports and the temporary follow-up note

They remain local.

## (c) Module graph and version decisions

See `docs/wp00/VERSION_DECISION_RECORD.md`. In short:

- **Toolchain:** AGP 9.4.0, Gradle 9.8.2, Kotlin 2.4.10, Compose BOM 2026.09.00, JDK Temurin 21.0.12+8.
- **SDK levels:** minSdk 26 (P4-ADR-11), compileSdk 37, targetSdk 36.
- **Backend:** Node 22, TypeScript 6.0.3.
- **Modules:** `:app` → `:core:model`, plus `backend/functions`.

Each version was checked against an official source on 2026-10-26.

## (d) Local build and test instructions

See `docs/BUILD.md`.

## (e) FORGE workflow and CI results

- Workflow file: `.github/workflows/forge-wp00.yml`.
- Jobs: wrapper validation, Android build/lint/test, repeat build, backend, osv-scanner + SBOM, gitleaks, Firebase guard, and the aggregate `forge-gate`.
- Actions are pinned by commit SHA, and downloaded scanners are pinned by SHA-256. Permissions are `contents: read`, and no secrets are used.
- **Observed CI results: none. NOT_RUN.**
- **Expected CI result once pushed:** the `dependency-audit` job, and therefore `forge-gate`, will **fail** because of the osv findings. That outcome is correct until the PL decides WP00-OPEN-02.

## (f) Dependency and secret evidence

See `docs/wp00/evidence/EVIDENCE_MANIFEST.md`.

- Strict lockfiles and SHA-256 verification are enforced: tamper and drift both fail the build.
- npm audit: 0 vulnerabilities.
- CycloneDX SBOM: 209 components.
- gitleaks: clean on full history and on the committed tree.
- Firebase guard: clean.

## (g) Verity ProofPoint status

| ProofPoint | Local D2 | CI D2 | GAI D4 |
|---|---|---|---|
| PL-PP-WP00-01 Repeat build | PASS (3 byte-identical builds, incl. at HEAD) | NOT_RUN | NOT_RUN |
| PL-PP-WP00-02 Secrets | PASS | NOT_RUN | NOT_RUN |
| PL-PP-WP00-03 Failure gate | PASS (10/10 negatives, after fixing 2 fixture/guard defects) | NOT_RUN | NOT_RUN |
| PL-PP-WP00-04 Dependency integrity | **FAIL** (vulnerability scan); integrity enforcement PASS | NOT_RUN | NOT_RUN |
| PL-PP-WP00-05 No real Firebase | PASS | NOT_RUN | NOT_RUN |

## (h) Risks and unresolved decisions

| ID | Severity (proposed) | Item | Proposed handling |
|---|---|---|---|
| R-01 | High (build tooling, not shipped) | osv: bcprov 1.80.2 (2 Critical/High), bcpkix, commons-lang3, httpclient in `androidLintTool` only (WP00-OPEN-02) | PL options: (1) accept with scoped, expiring osv-scanner ignores for `androidLintTool` only; (2) force newer versions for the lint tool configuration and retest lint; (3) wait for an AGP release that updates them. CODI recommends (2) if it passes the lint gate, otherwise (1) with a 30-day expiry. Nothing applied yet. |
| R-02 | Medium | FORGE CI never executed; Linux behavior unverified (SDK install, aapt2 Linux checksum, executable bits) | Approve a push of `feature/wp00-foundations` (no PR, no merge) so FORGE runs, then run the CI negative check for PL-PP-WP00-03 on a disposable branch. |
| R-03 | Medium | Permanent `applicationId` undecided (WP00-OPEN-01); placeholder in use | PL decision before any Play publication. |
| R-04 | Low | Workflow v2.4 §10 expects `feature/*` from `develop`; `develop` does not exist (WP00-OPEN-03) | PL decides whether to create `develop` from `b6ac365` before the WP-00 PR. Branch content is identical either way. |
| R-05 | Low | The handoff document contains a private machine path (§1) and trips a gitleaks false positive (line 14). PL policy says both "commit the handoff" and "no private machine paths". | Not committed. PL to choose: commit as-is with a scoped gitleaks allowlist, or commit a PL-approved redacted copy. |
| R-06 | Low | Repeat-build identity proven on one Windows machine only | The CI repeat-build job adds the Linux record. Cross-OS identity is not claimed. |
| R-07 | Low | Planned-but-deferred tools: ktlint/detekt, eslint, Gradle-native CycloneDX, emulator job | Recorded in the version decision record. Emulator job belongs to WP-03. |
| R-08 | Info | Node 22 is Maintenance LTS until 2027-04-30. Firebase docs list 22 as the newest supported runtime. | Revisit when Firebase supports Node 24. |
| R-09 | Info | README "Current phase" text is outdated (says Phase 2) | Left for CipherMuse; only Getting started was changed. |

## (i) GAI review request

Please run an independent D4 review of `feature/wp00-foundations` at the commit that contains this report, against handoff v1.0 §4 acceptance criteria 1–7:

1. Confirm the branch is based on `b6ac365` and contains only WP-00 changes.
2. Reproduce the build, repeat-build hashes and the negative checks from `docs/BUILD.md` and the evidence manifest on an independent machine.
3. Challenge the gates for bypasses: gitleaks default ruleset coverage, the guard self-exclusion, lockfile coverage of plugin classpaths (`settings-gradle.lockfile`), and the `forge-gate` aggregation logic.
4. Assess R-01 severity and options, plus the honesty of the status matrix (no unexecuted PASS).
5. Confirm no secrets, signing material, real Firebase config or private paths are in committed files.

GAI PASS and green CI do not authorize a merge. The PL retains the merge and next-WP decisions.

## (j) Report file name

`docs/wp00/WP-00_IMPLEMENTATION_REPORT_newBaileysCart_2026-10-26.md` (this file)

## Decisions requested from the PL

1. **Push approval:** push `feature/wp00-foundations` to origin so FORGE runs. No PR and no merge.
2. **R-01:** disposition of the Lint tool vulnerabilities.
3. **R-05:** how to commit the handoff.
4. **WP00-OPEN-01 and -03:** applicationId, and whether to create `develop`.
