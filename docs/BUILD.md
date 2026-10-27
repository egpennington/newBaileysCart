# Building newBaileysCart (WP-00 foundations)

These steps reproduce the WP-00 build on a clean machine. A clean-cache build was verified locally on 2026-10-27, after the Fix A repair. Pinned versions and their sources are in `docs/wp00/VERSION_DECISION_RECORD.md`.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| JDK | Temurin 21.0.12+8 | Set `JAVA_HOME`. Gradle runs on 17–27, but use the pinned JDK to match CI. |
| Android SDK | `platforms;android-37.0`, `build-tools;36.0.0` | Set `ANDROID_HOME`, or create an untracked `android/local.properties`. |
| Node.js | 22.x | `backend/functions/.nvmrc` |
| gitleaks | 8.30.1 | Optional locally; required in CI |
| osv-scanner | 2.7.0 | Optional locally; required in CI |

Gradle is not installed separately. Always use the wrapper (`android/gradlew`). It downloads Gradle 9.8.2 and verifies its SHA-256.

## Android

```sh
cd android
./gradlew assembleDebug assembleRelease test lint
```

- The release APK is **unsigned** (`app/build/outputs/apk/release/app-release-unsigned.apk`). No signing material exists in WP-00.
- Lockfiles are strict and checksums are verified on every resolution. A lock or checksum mismatch, or an artifact with no recorded checksum, fails the build. This is intentional and must be reviewed.

### Changing dependencies: regenerate from an empty Gradle cache

Always regenerate locks and verification metadata from an **empty** `GRADLE_USER_HOME`. A warm cache hides parent POM and BOM files that a clean machine downloads. Gradle never records those files, and clean builds then fail verification. That is exactly what broke FORGE run 40447910773 (see the evidence manifest).

```sh
cd android
export GRADLE_USER_HOME="$(mktemp -d)"   # empty cache, deleted afterwards
./gradlew assembleDebug assembleRelease test lint :app:dependencies :core:model:dependencies \
  --write-locks --write-verification-metadata sha256
```

Then:
1. Check that the diff of `verification-metadata.xml` only *adds* entries. No existing checksum may change.
2. Validate new checksums against publisher metadata (for example, Maven Central `.sha1`).
3. Prove the result with a full build from a *second* empty cache: `./gradlew clean assembleDebug assembleRelease test lint`.

The Linux and macOS `aapt2` entries were added by hand. A regeneration on Windows keeps existing entries, so they remain.

### Repeat-build check (PL-PP-WP00-01)

```sh
cd android
./gradlew clean :app:assembleRelease :core:model:jar --no-build-cache --rerun-tasks
sha256sum app/build/outputs/apk/release/*.apk core/model/build/libs/*.jar
```

Run this twice and compare hashes. Identical hashes show the procedure is deterministic on that machine. They don't guarantee identical binaries across machines.

## Backend skeleton

```sh
cd backend/functions
npm ci --ignore-scripts
npm run typecheck
npm test
npm audit --audit-level=high
```

## Supply-chain and secret checks

Run these from the repository root:

```sh
gitleaks git --config .gitleaks.toml --redact .
osv-scanner scan source -L android/app/gradle.lockfile -L android/core/model/gradle.lockfile -L backend/functions/package-lock.json
bash scripts/check-no-real-firebase.sh
```

`gitleaks dir` also scans untracked and ignored files, such as build outputs and local notes. CI scans only the checked-out tracked files.

## CI (FORGE, GitHub Actions)

`.github/workflows/forge-wp00.yml` runs on:

- pushes to `feature/**`, `fix/**`, `develop` and `main`
- pull requests targeting `main` or `develop`
- manual dispatch (`workflow_dispatch`)

Runs on `main` and `develop` are never cancelled or superseded by later runs, because each gets its own concurrency group. Runs for `feature/**` and `fix/**` branches and for pull requests cancel an in-progress run for the same ref.

The jobs are:

1. Wrapper validation
2. Android compile, lint and unit tests
3. Clean repeat build: two independent clean builds. The `core:model` JAR must be byte-identical or the job fails (hard gate). The APK comparison only warns (informational for WP-00). Hashes go to notice annotations, the job summary and the `repeat-build-evidence` artifact.
4. Backend typecheck, tests and npm audit
5. osv-scanner plus CycloneDX SBOM
6. gitleaks (full history and working tree)
7. Firebase guard
8. `forge-gate`, which fails unless every upstream job succeeded

Make `FORGE gate` the required status check in branch protection. That is a PL action in repository settings.

Platform limitations:
- CI runs on Linux (`ubuntu-24.04`).
- Local evidence for WP-00 was collected on Windows 11 with Git Bash.
- The repeat-build job compares two builds on the same runner, not across operating systems.

## Firebase emulators (demo-only plan)

- `backend/firebase.json` defines Auth, Firestore and Functions emulator ports.
- `backend/.firebaserc` names only `demo-newbaileyscart`. A `demo-*` project ID makes the Firebase emulators run offline-only, and they never contact real resources.
- WP-00 does **not** install `firebase-tools` or run emulators, because there are no rules or callables to exercise yet. WP-03 will add the emulator job.
- Emulator results never prove production behavior (for example TTL enforcement, contention or quotas).
- `scripts/check-no-real-firebase.sh` fails if it finds any of these:
  - a `google-services.json`, `GoogleService-Info.plist` or service-account file (tracked, untracked or ignored)
  - a non-`demo-*` project ID in a `.firebaserc`
  - a Google API key, OAuth client ID, `firebaseio.com`/`firebaseapp.com` host, or the google-services Gradle plugin in tracked or untracked files

## Known local-environment issue

TLS-inspecting antivirus software can make Gradle fail with `Plugin ... was not found` while dependency downloads work in a browser or curl. The JDK doesn't trust the antivirus root certificate. On Windows, a local-only workaround is to set an environment variable rather than committing anything:

```sh
export JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStoreType=Windows-ROOT"
```

Dependency integrity is still enforced by `verification-metadata.xml` checksums, whatever the transport.
