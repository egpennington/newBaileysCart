# WP-00 Version Decision Record

- **Version:** 1.0
- **Date:** 2026-10-26
- **Owner:** CODI
- **Rule:** every pinned version below was checked against an official source on 2026-10-26. Nothing is pinned from memory.

## Toolchain

| Component | Pinned | Why | Official source checked |
|---|---|---|---|
| Android Gradle Plugin | **9.4.0** | Latest stable AGP. 9.5/9.6 are previews. Requires Gradle ≥ 9.6.0, JDK ≥ 17, build-tools ≥ 36.0.0; max compileSdk 37. | developer.android.com/build/releases/gradle-plugin |
| Gradle | **9.8.2** (wrapper, `distributionSha256Sum` pinned) | Current release. Meets AGP 9.4 minimum (9.6.0). Gradle 9.8 is tested with AGP 9.0–9.5.0-alpha02 and runs on JVM 17–27. | docs.gradle.org/current/userguide/compatibility.html; services.gradle.org (SHA-256 `21bd5da2…9607` matched) |
| JDK | **Temurin 21.0.12+8**, both locally and in CI | LTS. Within the AGP (≥ 17) and Gradle (17–27) ranges. 21.0.13 was rejected because its Windows build was not yet published, which would have split local and CI JDKs. | Adoptium GitHub release; SHA-256 `9ba963ee…21d0` (Windows) matched |
| Kotlin (KGP + Compose compiler plugin) | **2.4.10** | Stable. Gradle 9.8's embedded Kotlin version and the version used in the Android Compose compiler setup docs. 2.4.21 is newer, but Gradle 9.8 is tested only through 2.4.20-RC2. AGP 9 built-in Kotlin is used for `:app`, and the Compose compiler plugin version equals the Kotlin version. | kotlinlang.org/docs/releases.html; developer.android.com/develop/ui/compose/compiler; developer.android.com/build/migrate-to-built-in-kotlin |
| Compose BOM | **2026.09.00** | Latest BOM on Google Maven (`<release>`). Compose 1.12+ requires compileSdk 37 and AGP 9. | developer.android.com/develop/ui/compose/bom/bom-mapping; Google Maven metadata |
| androidx.activity:activity-compose | **1.13.0** | Latest stable on Google Maven (1.14.0 is alpha). | Google Maven metadata |
| JUnit | **4.13.2** | Unit-test harness for JVM tests. | Maven Central |
| minSdk | **26** | P4-ADR-11, PL APPROVED 2026-10-26. | Decision register |
| compileSdk | **37** | Required by Compose 1.12 (BOM 2026.09.00). AGP 9.4 maximum. | Compose compiler docs; AGP 9.4 notes |
| targetSdk | **36** | Google Play requires API 36+ for new apps and updates from 2026-08-31. 37 was not adopted, to avoid untested behavior changes in a foundation build. | developer.android.com/google/play/requirements/target-sdk |
| Node.js | **22** (CI: latest 22.x via setup-node; local: 22.18.0) | Supported by Cloud Functions for Firebase (22, 20; 18 deprecated). Maintenance LTS until 2027-04-30. Node 20 reached EOL 2026-03-24. | firebase.google.com/docs/functions/manage-functions; github.com/nodejs/Release schedule.json |
| TypeScript | **6.0.3** | Mature 6.x line. TypeScript 7.x adoption was deferred to keep the backend skeleton conservative. | npm registry |
| @types/node | **22.20.5** | Matches the Node 22 major. | npm registry |
| gitleaks | **8.30.1** (SHA-256 pinned) | Secret scanning. | GitHub release checksums file |
| osv-scanner | **2.7.0** (SHA-256 pinned) | Vulnerability scanning of Gradle lockfiles and package-lock.json; CycloneDX SBOM output. | GitHub release SHA256SUMS |

## GitHub Actions (pinned by commit SHA)

| Action | Tag | Commit |
|---|---|---|
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-java | v6.1.0 | `b843ebf9b913146b38da2eaa7aeddf76074ae1ad` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| gradle/actions (setup-gradle, wrapper-validation) | v6.4.0 | `3f5f9adaf7d9fecd50b5935e54106014257a94e6` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

## Module graph

```
android/            Gradle root (wrapper, version catalog, verification metadata)
├── :app            Android application. Compose placeholder host; depends on :core:model
└── :core:model     Pure Kotlin/JVM. WP-00 placeholder only; domain types are WP-03 scope
backend/
├── functions/      TypeScript skeleton. No Firebase SDK, no callables (WP-03 scope)
├── firebase.json   Emulator ports only
└── .firebaserc     demo-newbaileyscart (demo-* emulator ID only)
```

This is a bounded subset of the layout proposed in the CODI Phase 4 assessment. Additional `core/*` and `feature/*` modules are added by the work packages that need them.

## Deterministic resolution

- **Gradle:**
  - `dependencyLocking { lockAllConfigurations(); lockMode = STRICT }` with one `gradle.lockfile` per project.
  - `gradle/verification-metadata.xml` holds SHA-256 checksums for every resolved artifact.
  - The platform-specific `aapt2` jar has entries for Windows (generated), Linux and macOS. The Linux and macOS jars were downloaded from Google Maven and their SHA-1 was matched to the published `.sha1`.
- **npm:** `package-lock.json`, `npm ci --ignore-scripts`, `save-exact=true`, `engine-strict=true`.
- **Reproducibility claim:** this is a reproducible *procedure*: pinned inputs, verified checksums, locked graphs. Byte-identical APKs are measured and reported, not promised.

## Deviations from the CODI Phase 4 planning proposal (non-binding input)

| Proposed | WP-00 choice | Reason |
|---|---|---|
| ktlint/detekt | Not added | Android Lint (warnings as errors, both modules) plus Kotlin `allWarningsAsErrors` cover the static gate. Avoids extra plugin supply chain in WP-00. Can be added later. |
| eslint + jest | `tsc` strict + `node:test` | No runtime code yet. Built-in runner avoids dozens of dev dependencies. |
| Emulator job (Auth/Firestore/Functions) | Not run; plan documented in `docs/BUILD.md` | WP-00 has no rules or callables to exercise. Handoff §2 permits emulators only where WP-00 checks require them. |
| Hilt | Not added | DI root is WP-01/WP-02 scope. |
