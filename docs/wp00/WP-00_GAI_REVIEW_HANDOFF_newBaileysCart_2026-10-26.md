# Engineering Handoff: WP-00 → GAI Independent Verification

**Project:** newBaileysCart
**Sprint / issue:** WP-00 Android foundations and FORGE build contract
**From / To:** CODI → GAI (D4 independent challenge). Then CipherMuse assessment and penguinPrime decision.
**Workflow:** Pennington Labs Engineering Workflow v2.4, Production Engineering
**Date:** 2026-10-26

**Status:** implementation complete and pending GAI verification. **Not accepted, not merge-approved.** Neither a GAI PASS nor a green CI run authorizes a merge; the PL decides.

## Repository, branch and commits

| Item | Value |
|---|---|
| Repository | `https://github.com/egpennington/newBaileysCart.git` |
| Branch | `feature/wp00-foundations` (no PR; not merged) |
| Base | `main` @ `b6ac365a471f77e0b0dcfb488dc064c106e782c4` (certified baseline) |
| Code and dependency review target | `64c4d1c0ff5954e2fe8a273778fd41aa72fa2dd1`, the last commit that changes code, dependencies or gates. FORGE run #2 passed on it. |
| Branch head | the documentation-only commit that adds this handoff (it touches only `docs/wp00/`) |

Commit history, oldest first:

| Commit | Content |
|---|---|
| `27de650` | WP-00 implementation |
| `8c91f74` | Executable bits for Linux CI |
| `0cb99e5` | Implementation report + manifest v1.0 (FORGE run #1: failed) |
| `92f83a3` | Fix A: verification metadata completed for clean caches (PL-authorized) |
| `64c4d1c` | Fix B: patched Lint-tool dependencies (PL-authorized) (FORGE run #2: success) |
| docs commit | Manifest v1.3 + this handoff (no code changes) |

## Objective

Independently verify that WP-00 meets handoff v1.0 §4 acceptance criteria 1–7. Challenge the gates, the evidence and the honesty of the status reporting. Don't rely on CODI's assertions.

## Review package (all on the branch)

| Document | Path |
|---|---|
| Implementation report (with remediation addendum) | `docs/wp00/WP-00_IMPLEMENTATION_REPORT_newBaileysCart_2026-10-26.md` |
| Verity evidence manifest v1.3 | `docs/wp00/evidence/EVIDENCE_MANIFEST.md` |
| Version decision record | `docs/wp00/VERSION_DECISION_RECORD.md` |
| Decision register v1.1 | `docs/decisions/DECISION_REGISTER.md` |
| Build, check and emulator plan | `docs/BUILD.md` |
| ProofPoint contracts / suite | `tests/verity/proofpoints/PL-PP-WP00-0{1..5}.yaml`, `tests/verity/suites/PS-BUILD-SUPPLY-CHAIN.yaml` |
| FORGE workflow | `.github/workflows/forge-wp00.yml` |
| Ratified API copy (context only; not WP-00 scope) | `docs/specs/` |
| FORGE run #1 (failure) | https://github.com/egpennington/newBaileysCart/actions/runs/40447910773 |
| FORGE run #2 (success) | https://github.com/egpennington/newBaileysCart/actions/runs/40455233810 |

## Current evidence status (CODI-reported; not GAI-verified)

| ProofPoint | Local | CI run #2 | GAI |
|---|---|---|---|
| 01 Clean repeat build | PASS | PASS (builds); hash identity not retrieved | NOT_RUN |
| 02 Secrets | PASS | PASS | NOT_RUN |
| 03 CI failure gate | PASS (local) | **NOT_RUN** | NOT_RUN |
| 04 Dependency integrity | PASS | PASS (scan); SBOM not inspected | NOT_RUN |
| 05 No real Firebase | PASS | PASS | NOT_RUN |

## Review instructions

### 1. Baseline and scope (AC-1)
- `git merge-base origin/main origin/feature/wp00-foundations` must equal `b6ac365…`.
- `git diff --stat b6ac365..origin/feature/wp00-foundations`: confirm only WP-00 paths changed. That means `android/`, `backend/`, `scripts/`, `tests/verity/`, `.github/workflows/forge-wp00.yml`, `docs/`, repo hygiene files and the README Getting started section.
- `git diff --stat 64c4d1c..origin/feature/wp00-foundations`: confirm the final commit touches only `docs/wp00/`.
- Confirm there is no auth, Firestore rules, callables, Room/SQLCipher, entitlement or product UI work (WP-01/02/03 scope), and no change to the legacy repository.

### 2. Reproduce on an independent machine (AC-2, AC-5)
Follow `docs/BUILD.md` with Temurin 21.0.12+8 and an **empty** `GRADLE_USER_HOME`:
```sh
cd android
./gradlew clean assembleDebug assembleRelease test lint
./gradlew clean :app:assembleRelease :core:model:jar --no-build-cache --rerun-tasks   # run twice
sha256sum app/build/outputs/apk/release/*.apk core/model/build/libs/*.jar
```
- Compare with CODI's local hashes: APK `aa78c065341f31583c25f03da549219e150f73e73dab617edab3e92841580587`, `model.jar` `cf6d0b163ede0ec153dd6e07d01d86ba5eed229bcd155b7ffeb7aed85ec00024`.
- Differences across machines are allowed if explained. Byte-identical output is not promised.
- Backend: `cd backend/functions && npm ci --ignore-scripts && npm run typecheck && npm test && npm audit --audit-level=high`.

### 3. Retrieve the CI evidence CODI could not read (signed-in GitHub access required)
- Run #2 → job "Clean repeat build" → Summary: record both hashes and whether they match each other and the local values.
- Run #2 → artifact `sbom`: confirm it is CycloneDX 1.6 with about 209 components (206 Maven + 3 npm).
- Run #2 → job logs: confirm the osv-scanner step ran against all three lockfiles, and that gitleaks scanned the full history.
- Run #1 → Android job log: confirm the failure matches CODI's reproduced cause (dependency verification failure on the `classpath` configuration).

### 4. Challenge the gates (AC-3, AC-4)
- **Repeat-build job:** it reports hash differences without failing. Assess whether that's acceptable for WP-00.
- **`forge-gate`:** check its aggregation logic, including skipped or cancelled jobs.
- **gitleaks:** default ruleset only, no allowlist. Look for secret types it would miss.
- **`scripts/check-no-real-firebase.sh`:** it excludes itself. Probe for bypasses: file naming, encodings, configs outside `.firebaserc`.
- **Dependency verification:**
  - Do the lockfiles cover the plugin classpath (`settings-gradle.lockfile`)?
  - Are the 47 checksum entries added in Fix A/B (5 + 42) all justified? Each was validated against publisher SHA-1.
  - Could checksum-only verification without signatures be bypassed?
- **Fix B:** confirm that only the `androidLintTool` configuration changed, that app classpaths are unchanged, and that the APK hash is the same before and after. Assess whether the forced versions could stop lint from catching issues. CODI ran negative tests in both modules.
- **Workflow permissions:** `contents: read`, actions pinned by SHA, no secrets used.
- Confirm no credentials, signing material, real Firebase config, `.env` files or private machine paths in committed files or CI artifacts.

### 5. Evidence honesty (AC-6, AC-7)
- No ProofPoint may show PASS for an unexecuted depth. PL-PP-WP00-03 CI must remain NOT_RUN.
- Check that each local claim has a command, environment, timestamp and result. Raw local logs are available from CODI on request; they contain machine paths, so they are not committed.
- Note the documented CODI errors and corrections:
  - AC-5 was claimed before any clean-cache build was tested (corrected by Fix A).
  - Two invalid or weak negative fixtures were found and fixed during PL-PP-WP00-03.

## Outstanding items (not resolved by WP-00)

| ID | Item | Owner |
|---|---|---|
| WP00-OPEN-01 | Permanent Play `applicationId`. A placeholder `com.penningtonlabs.baileyscart.wp00placeholder` is in use, and the applicationId cannot change after Play publication. | PL |
| WP00-OPEN-03 | Develop-branch policy. Workflow v2.4 §10 expects `feature/*` from `develop`; `develop` does not exist. Decide before any WP-00 PR. | PL |
| PP-03 CI | Deliberate-failure CI run on a disposable branch. Not authorized yet. | PL to authorize; CODI to run |
| CI evidence | Repeat-build hashes, SBOM contents and job logs not retrieved by CODI | GAI or PL (signed in) |
| R-05 | Handoff v1.0 not committed: it contains a private machine path, and line 14 is a gitleaks false positive | PL |
| R-04 (API) | Canonical API incorporation of API v0.3 Rev 1 and the P4-D10/D11 addendum (register R-04) | CipherMuse / PL |
| Lint overrides | Patched Lint-tool versions are pinned (bouncycastle 1.85, commons-lang3 3.18.0, httpclient 4.5.13). Newer releases exist. Revisit at the next AGP upgrade. | CODI at next upgrade |
| Branch protection | Make `FORGE gate` a required check on `main`/`develop` | PL (repo settings) |
| Deferred tooling | ktlint/detekt, eslint, Gradle-native SBOM, emulator job (WP-03) | Future WPs |

## Constraints and non-goals

- No merges, PRs, deployments, provisioning or production signing.
- No WP-01/02/03 or SQLCipher spike work.
- No vulnerability exceptions or gate weakening.

## Requested GAI output

`REVIEW_REPORT.md` containing:
- PASS / CONDITIONAL PASS / FAIL against AC-1 to AC-7
- prioritized findings using the Workflow v2.4 §8 severities
- independent reproduction results
- the retrieved CI evidence
- a recommendation to the PL

## Next action and owner

GAI performs the D4 verification. CipherMuse assesses residual risk. penguinPrime decides on acceptance, merge path and the next work package.
