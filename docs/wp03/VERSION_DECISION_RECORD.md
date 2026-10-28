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

## Local-only toolchain note
Locally, the Firestore emulator ran on Android Studio's bundled JBR (OpenJDK 25.0.3), because no standalone JDK is installed. CI uses Temurin 21.0.12+8.
