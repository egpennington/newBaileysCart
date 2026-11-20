# WP-03 Slice 1 Version Decision Record

- **Scope:** dependencies added to `backend/functions` for WP-03 Slice 1. Toolchain pins in `docs/wp00/VERSION_DECISION_RECORD.md` are unchanged: Node 22, TypeScript 6.0.3, `@types/node` 22.20.5, Temurin 21.0.12+8 in CI, osv-scanner 2.7.0, gitleaks 8.30.1, and the pinned GitHub Actions.
- **Recorded by:** CODI, 2026-10-28, under the PL Slice 1 implementation authorization (PL-3; Node 22 retained).
- **Rule applied:** latest stable release published at least 7 days earlier, compatible with Node 22, exact-pinned (`save-exact`), installed with `--ignore-scripts`.

## Runtime dependencies

| Package | Pinned | Released | Why | Audit |
|---|---|---|---|---|
| `firebase-functions` | **7.4.0** | 2026-09-15 | v2 `onCall` callables. The version W-01 was probed against. | npm audit 0; osv 0 |
| `firebase-admin` | **14.5.0** | 2026-09-23 | Firestore transactions and Auth from the server. Requires Node ≥ 22. Within `firebase-functions`' peer range (`^11 … ^14`). | npm audit 0; osv 0 |

## Test-only dependencies (`devDependencies`)

| Package | Pinned | Released | Why |
|---|---|---|---|
| `firebase-tools` | **15.34.1** | 2026-10-21 | Auth, Firestore and Functions emulators (`emulators:exec`). Downloads `cloud-firestore-emulator-v1.22.0.jar` at runtime and verifies its checksum. Needs Java ≥ 21. |
| `@firebase/app` | **0.16.2** | 2026-09-09 | Modular official client SDK for D3, at the versions bundled in `firebase` 12.19.0 (W-01 probe client). Node ≥ 20. |
| `@firebase/auth` | **1.13.6** | 2026-09-09 | As above. |
| `@firebase/functions` | **0.14.0** | 2026-08-19 | As above. |
| `ajv` | **8.20.0** | 2026-04-24 | JSON Schema 2020-12 validator (`ajv/dist/2020.js`) for T-GAP-1: validates live `account.getSession` responses against the ratified API Amendment A1 v0.2 §A1.5 schema. PL decision D-1 (2026-10-29). Already in the lockfile at this exact version as a dev dependency of `firebase-tools`, so the resolved tree is unchanged; only the root `devDependencies` entry is new. Installed with `--ignore-scripts`; `npm audit` 0. |

**Rejected:**
- The monolithic `firebase` 12.19.0. Its `@firebase/firestore` brings `@grpc/grpc-js ≤ 1.13.5`, with 4 high findings (W-01 D-11).
- `firebase` 13.x and `@firebase/app` 0.16.4 / `@firebase/auth` 1.13.8. They require Node ≥ 24.12 (W-01 D-10).
- `@firebase/rules-unit-testing`. It needs `firebase` as a peer. Rules are tested against the emulator REST API instead.

## Overrides (dev tree only)

Adding `firebase-tools` introduced 1 high and 5 medium osv findings (npm audit: 6 moderate), which would fail FORGE's osv gate. Each affected package has exactly **one copy** in the lockfile, and that copy sits inside `firebase-tools`' tree, so a top-level override affects nothing else. A nested override (`"firebase-tools": {…}`) was tried first and rejected, because it produced a lockfile `npm ci` refuses ("lock file's @opentelemetry/core@2.12.0 does not satisfy @opentelemetry/core@1.30.1").

| Package | From | To | Dependent and declared range | Advisories cleared | Compatibility evidence |
|---|---|---|---|---|---|
| `uuid` | 9.0.1 | **11.1.1** | `gaxios` 6.7.1 `^9.0.1` (major bump) | GHSA-w5hq-g745-h8pq | `gaxios` calls only `uuid.v4` through `require("uuid")`. `uuid` 11 keeps the CommonJS `v4` export. |
| `@opentelemetry/core` | 1.30.1 | **2.12.0** | `@google-cloud/pubsub` 5.3.1 `^1.30.1` (major bump) | GHSA-8988-4f7v-96qf | `pubsub` uses only `new core.W3CTraceContextPropagator()`, which 2.x still exports. `firebase-tools` loads `pubsub` only in `lib/emulator/pubsubEmulator.js`. The Pub/Sub emulator is not run. |
| `re2` | 1.24.1 | **1.27.0** | `superstatic` 10.0.0 optional `^1.17.7` (in range) | GHSA-6hxr-mr5r-9836, GHSA-8hcv-x26h-mcgp, GHSA-ff84-5f28-78qj, GHSA-j4r3-hg7j-8chg | Within the declared range. Native addon; not built under `--ignore-scripts`. Used only by the Hosting emulator, which is not run. |

**Regression evidence:**
- `npm ci --ignore-scripts` succeeds.
- The full emulator suite (Auth, Firestore, Functions) passes with the overrides in place.
- `npm audit`: 0 vulnerabilities (all, and `--omit=dev`).
- osv-scanner 2.7.0 on `backend/functions/package-lock.json`: "No issues found".

**Not covered by the evidence:** `firebase-tools` features Slice 1 does not use, such as the Pub/Sub and Hosting emulators and deploy.

**Maintenance:** remove each override once `firebase-tools` ships with patched versions. Re-check the overrides on every `firebase-tools` upgrade.

## BC-SEC-REMEDIATE-01 (2026-11-19): `glob` override and `@google-cloud/firestore` refresh

Recorded by CODI under the PL authorization "BC-SEC-REMEDIATE-01". The PL approved superseding the WP03-S2-HOLD "no forced dependency override" clause **for `glob` only**, conditional on demonstrated compatibility.

| Change | From | To | Kind | Advisories cleared | Compatibility evidence |
|---|---|---|---|---|---|
| `@google-cloud/firestore` (optional dependency of `firebase-admin` 14.5.0, range `^9.1.0`) | 9.4.0 | **9.4.1** | Lockfile only (`npm update @google-cloud/firestore --package-lock-only`); `package.json` unchanged | Removes the production path `@google-cloud/firestore-api` 0.2.0 → `google-gax` 5.0.8 / `gaxios` 7.1.3 → `rimraf` 5 → `glob` 10.5.0 → `minimatch` 9.0.9 | `firestore-api` 0.2.0 → 0.7.1 now shares the existing root `google-gax` 6.13.0. No other production package version changed (the rest of the diff only moves packages from production to development). Unit and emulator suites pass. |
| `glob` (npm override, every dependent) | 10.5.0 | **14.0.6** | `overrides` in `backend/functions/package.json`; `glob` 14 brings `minimatch` 11.0.9 and `path-scurry` 3.0.0 | GHSA-3g3m-2fjr-6pw4 (`glob`), GHSA-g3hv-75wg-m249 (`minimatch` 9.0.9) | The CommonJS and ESM exports are identical (`sync`, `glob`, `globSync`, `Glob`, `hasMagic`, `escape`, …). Engines: Node `18 \|\| 20 \|\| >=22`. Dependents and their call style: `rimraf` 5.0.10 (`globSync`), `archiver-utils` 5.0.2 (`glob.sync`), `exegesis` 4.3.0 (`glob.sync`), `firebase-tools` 15.34.1. A differential test running the same 20 cases on glob 10.5.0 (baseline install) and glob 14.0.6 gave identical output. The cases cover globstar, dot, braces, extglobs, escaped brackets, spaces, `archiver-utils` `file.expand` and `firebase-tools` `listFiles`. Unit tests pass 356/356; the emulator suite passes 356/356. |

**Release age:** `glob` 14.0.6 was published 2026-11-12T12:02Z (7 days). Its transitive dependencies are newer: `minimatch` 11.0.9 (2026-11-16, 3 days), `brace-expansion` 5.0.13 (2026-11-11) and `@isaacs/nonrecursive-glob-match` 1.1.0 (2026-11-05, a new package). All come from the packages' established maintainers. This falls short of the Slice 1 "at least 7 days" rule for transitive packages, and is disclosed for PL and GAI review.

**Merged:** PR #25 into `develop` at `96396f7` (2026-11-19). The override is the exact pin `"glob": "14.0.6"`. GAI's final D4 review describes it as `14.x`; register entry BC-SEC-REM-D4-CORR records the correction.

**Not changed:** `firebase-tools` stays at 15.34.1. The latest release (15.37.0) still declares `glob ^10.5.0`, so upgrading it would not help. **Maintenance:** remove the `glob` override once `firebase-tools`, `exegesis`, `archiver-utils` and `rimraf` (through `google-gax` 5) accept a patched `glob`. Re-check it on every `firebase-tools` upgrade.

## Local-only toolchain note
Locally, the Firestore emulator ran on Android Studio's bundled JBR (OpenJDK 25.0.3), because no standalone JDK is installed. CI uses Temurin 21.0.12+8.
