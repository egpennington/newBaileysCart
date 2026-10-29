# W-01 Firebase Callable Wire Evidence v1.0 (Local Emulator)

**Project:** newBaileysCart · **Work package:** WP-03 Slice 1, Task 1 · **Workflow:** Pennington Labs v2.4
**Author:** CODI · **Captured:** 2026-10-28 (run 1 at 19:13:18Z; reproduced in run 2) · **For review by:** GAI, CipherMuse
**Branch:** `feature/wp03-s1-family-ownership` · **Base:** `f96e5376804facc2e01bcad7100e4574f05de3c3` (uncommitted working tree)
**Status:** EVIDENCE FOR REVIEW. **W-01 is NOT verified.** These are observations of the local Firebase emulators only. They are not production evidence.

## 1. What this evidence is and is not

| It is | It is not |
|---|---|
| The observed wire behavior of `onCall` (firebase-functions 7.4.0) in the **local Functions and Auth emulators** (firebase-tools 15.34.1), project `demo-newbaileyscart` | Evidence of production Cloud Functions behavior: token verification, App Check, size limits, error pages |
| The behavior of the official **JS web client SDK** (`firebase` 12.19.0) and raw HTTP, side by side | Evidence for the **Android** client SDK (`FirebaseFunctionsException`), which is Bailey's Cart's real production client |
| A basis for deciding how the API v0.4 §3 envelope maps onto callables | A ratified wire contract |

## 2. Environment and versions

| Component | Version / value |
|---|---|
| Node | v22.18.0 (project pin: `22`), npm 10.9.3, Windows 11 (win32) |
| `firebase-functions` (runtime dep) | 7.4.0 (released 2026-09-15) |
| `firebase-admin` (runtime dep) | 14.5.0 (2026-09-23) |
| `firebase-tools` (dev, emulators) | 15.34.1 (2026-10-21) |
| `firebase` JS client (dev) | 12.19.0 (2026-09-09): `@firebase/app` 0.16.2, `@firebase/auth` 1.13.6, `@firebase/functions` 0.14.0 |
| `typescript` / `@types/node` | 6.0.3 / 22.20.5 (same as `backend/functions`) |
| Emulators | `auth` 127.0.0.1:9099, `functions` 127.0.0.1:5001. No Firestore emulator, so no Java needed. |
| Project | `demo-newbaileyscart`. The emulator reported: "Detected demo project ID … attempts to access non-emulated services for this project will fail." |
| Region | `us-central1` (default) |
| Command | `npx firebase emulators:exec --only auth,functions --project demo-newbaileyscart "node lib/probe.js"` (exit 0) |
| Probe source | `backend/w01-probe/src/functions.ts` (SHA-256 `e5c79b46…de74`), `backend/w01-probe/src/probe.ts` (`eef84074…1171`) |
| Raw output | `backend/w01-probe/evidence/w01-probe-output.json`, 57 cases. Run 1 (`npm install`): SHA-256 `07ed96e2…fd86`, log `evidence/emulator-run.log` (`e5f29a89…37ba`). Run 2 (clean `npm ci --ignore-scripts` + `npm run probe`), currently on disk: `4192bd35…49a2`, log `evidence/emulator-run-2.log` (`e024ba9b…57a6`). |
| Reproducibility | Runs 1 and 2 agree on all 57 cases. They differ only in `serverTime` and emulator-generated UIDs. |
| Lockfile | `backend/w01-probe/package-lock.json` (`93095da4…3b25`), lockfileVersion 3, 737 packages |

## 3. Observed wire envelopes

### 3.1 Request
Raw HTTP: `POST /{project}/{region}/{function}` with `Content-Type: application/json` and body `{"data": <payload>}`. The ID token travels as `Authorization: Bearer <token>`, and App Check as `X-Firebase-AppCheck`. The SDK builds all of this. The caller passes only `<payload>`.

### 3.2 Success
```http
HTTP 200  content-type: application/json; charset=utf-8
{"result": <handler return value>}
```
The SDK resolves with `{ data: <handler return value> }`. When the handler returns the API v0.4 §3 success envelope, the client receives it **nested** under `result` on the wire. Example (`echo.verified.raw`):
```json
{"result":{"apiVersion":"v0.4","opId":"3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b","status":"COMMITTED","serverTime":"2026-10-28T19:13:12.168Z","data":{…}}}
```

### 3.3 `HttpsError`
```http
HTTP <mapped status>  content-type: application/json; charset=utf-8
{"error":{"message":"<message>","status":"<CANONICAL_CODE>","details":<details, omitted if undefined>}}
```
JS SDK rejection: `FirebaseError` with `code = "functions/<code>"`, `message = "<message> [<HTTP status>]"` and `details` passed through unchanged. **The SDK adds the HTTP status in brackets to the message.**

| `HttpsError` code | HTTP | Wire `status` | SDK `code` |
|---|---|---|---|
| cancelled | 499 | CANCELLED | functions/cancelled |
| unknown | 500 | UNKNOWN | functions/unknown |
| invalid-argument | 400 | INVALID_ARGUMENT | functions/invalid-argument |
| deadline-exceeded | 504 | DEADLINE_EXCEEDED | functions/deadline-exceeded |
| not-found | 404 | NOT_FOUND | functions/not-found |
| already-exists | 409 | ALREADY_EXISTS | functions/already-exists |
| permission-denied | 403 | PERMISSION_DENIED | functions/permission-denied |
| resource-exhausted | 429 | RESOURCE_EXHAUSTED | functions/resource-exhausted |
| failed-precondition | 400 | FAILED_PRECONDITION | functions/failed-precondition |
| aborted | 409 | ABORTED | functions/aborted |
| out-of-range | 400 | OUT_OF_RANGE | functions/out-of-range |
| unimplemented | 501 | UNIMPLEMENTED | functions/unimplemented |
| internal | 500 | INTERNAL | functions/internal |
| unavailable | 503 | UNAVAILABLE | functions/unavailable |
| data-loss | 500 | DATA_LOSS | functions/data-loss |
| unauthenticated | 401 | UNAUTHENTICATED | functions/unauthenticated |

For all 16 codes, the full API v0.4 §3 domain-error envelope (`{"apiVersion","opId","status":"REJECTED","error":{"code":"STALE_EPOCH_REJECTED","retryable":false,"details":{}}}`) passed as `details` arrived **byte-for-byte intact** in both the wire `error.details` and the SDK's `err.details`. With no details, the SDK's `details` is `null`, and the wire omits the key.

### 3.4 Other observed behaviors

| Case | Observation |
|---|---|
| No `Authorization` header | **The handler still runs**, with `request.auth = null`, and returns 200. The framework does not reject unauthenticated calls. The handler must. |
| Handler throws `unauthenticated` | 401 `{"error":{"message":"probe: authentication required","status":"UNAUTHENTICATED"}}` |
| Uncaught non-`HttpsError` | 500 `{"error":{"message":"INTERNAL","status":"INTERNAL"}}`. The internal message did **not** leak to the client (it was logged server-side). |
| Unverified email | Token accepted. `email_verified: false` is visible to the handler. Enforcement is up to the handler. |
| Verified email | After an Admin `updateUser(emailVerified: true)` and a forced client token refresh, `email_verified: true` is visible. Without the refresh, the old claim persists. |
| `uid` sent in the body | Delivered to the handler as ordinary data. `request.auth.uid` comes from the token. Ignoring body fields is up to the handler. |
| Token claim keys | `aud, auth_time, email, email_verified, exp, firebase, iat, iss, sub, uid, user_id` |
| `enforceAppCheck: true`, no App Check token | 401 `{"error":{"message":"Unauthenticated","status":"UNAUTHENTICATED"}}`. The handler never runs. **This is indistinguishable from an auth failure.** |
| `enforceAppCheck: true`, bogus App Check token | **200, accepted** (`request.app.appId = null`). The emulator does not verify App Check tokens. |
| Return value serialization | `Date` → `{}` (**lossy**), `undefined` → `null`, nested `null` kept, `MAX_SAFE_INTEGER+2` → `9007199254740992` (precision loss) |
| Body without `data` key, `text/plain` content type, or `GET` | 400 `{"error":{"message":"Bad Request","status":"INVALID_ARGUMENT"}}`. The handler is not invoked. |
| Invalid JSON body | 400 **`text/html`** page with a stack trace including local filesystem paths. This comes from the emulator's body-parser, before the callable. Production behavior is not evidenced. |
| `Authorization: Bearer garbage` | **200, handler runs** with `request.auth` **present** but `uid = undefined`. The token has only a `uid` key, and there is no `firebase` claim. A first version of the probe crashed dereferencing `token.firebase` (500 INTERNAL). |
| Unsigned forged JWT (`alg: none`, `sub: forged-uid`, `email_verified: true`) | **200, accepted.** The handler saw `uid = "forged-uid"` and `email_verified = true`. |
| 1 MB and 11 MB request bodies | Both 200 in the emulator. **There is no evidence of the production request-size limit.** |

## 4. Discrepancies against API v0.4 (§3, §8) and open questions

| # | Finding | Impact | Needs |
|---|---|---|---|
| **D-1** | The v0.4 success envelope is not the top-level wire body. It sits inside `{"result": …}`, and the SDK's `.data` returns it. | Low. The SDK hides the wrapper. API v0.4 §3 should say the envelope is the callable *result*, not the HTTP body. | CipherMuse wording |
| **D-2** | v0.4's domain-error example (`status: "REJECTED"` + `error.code`) cannot also be an SDK rejection unless it is sent as `HttpsError.details`. A handler that *returns* it gets HTTP 200, and the SDK resolves successfully. | **High. This is the core W-01 decision.** Either (a) throw `HttpsError(<canonical code>, <message>, <v0.4 error envelope>)` with a fixed domain→canonical code table, or (b) always return 200 and have clients branch on `status`. Option (a) keeps transport and SDK retry semantics aligned. Option (b) makes every domain rejection look like success to generic tooling. | CipherMuse + GAI decision; a domain→canonical mapping table for the Slice 1 codes |
| **D-3** | Several canonical codes share an HTTP status (400: invalid-argument / failed-precondition / out-of-range; 409: already-exists / aborted; 500: unknown / internal / data-loss). | Clients must branch on `status` / SDK `code` and `details.error.code`, never on HTTP status. | Contract note |
| **D-4** | `APP_CHECK_REQUIRED` (API §8) cannot be produced with `enforceAppCheck: true`. The framework rejects first, with a generic `UNAUTHENTICATED` "Unauthenticated". | A distinct domain code would need `enforceAppCheck: false` plus a manual check of `request.app`, or else drop the code. The emulator does not verify App Check, so any App Check behavior needs non-emulator evidence. | CipherMuse decision; App Check evidence stays open |
| **D-5** | **The emulator does not verify ID-token signatures.** It accepted an unsigned forged token (any UID, `email_verified: true`) and a non-JWT string (auth present, `uid` undefined). | **High for test design.** D2/D3 emulator tests cannot show that auth or email verification are unforgeable. That property relies on production token verification, which is not evidenced here. The production adapter must also fail closed when `request.auth` is present but `uid` is missing or empty. | Adapter rule: require `typeof request.auth?.uid === "string" && uid !== ""`. D4 note. Production verification evidence stays open (W-01). |
| **D-6** | The SDK error `message` gets a ` [<HTTP status>]` suffix. | Clients must not parse or display `message` verbatim. Use `code` / `details`. | Contract note |
| **D-7** | `Date` serializes to `{}`. | All timestamps (`serverTime`, `trialEndsAt`, `reservationExpiresAt`) must be serialized explicitly as RFC 3339 strings, which matches v0.4 §3 `serverTime`. | Adapter rule |
| **D-8** | The production request-size limit, deadline and payload limits were not observable (the emulator accepted 11 MB). | W-01 "request limits" stays open. | Production-docs or staging evidence (not authorized) |
| **D-9** | The JS client is not the production client. The Android SDK's mapping (`FirebaseFunctionsException.Code`, `details` type) is not evidenced. | W-01 stays open for the Android consumer. A D3 Android check belongs to WP-01/WP-02 or a separately authorized probe. | Scheduling decision |
| **D-10** | `firebase` JS client **13.x** (current, 2026-10-21) requires **Node ≥ 24.12** (`@firebase/app` 0.16.4, `@firebase/auth` 1.13.8, `@firebase/ai` 3.0.0). With the project's Node 22 pin and `engine-strict=true`, the install fails with `EBADENGINE`. I used 12.19.0. | The D3 test client is pinned to v12, or the project moves to Node 24. Neither is decided. | PL / version-record decision |
| **D-11** | `npm audit`: runtime deps (`firebase-functions`, `firebase-admin`) **0 vulnerabilities**. With dev deps: **4 high, 6 moderate**. The highs are `@grpc/grpc-js ≤ 1.13.5` (GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4), nested under `firebase@12.19.0` → `@firebase/firestore` (plus `firestore-compat` and `firebase`). The moderates are in `firebase-tools` (`re2`, `uuid`/`gaxios`, `@opentelemetry/core`/`@google-cloud/pubsub`). | FORGE's `npm audit --audit-level=high` would **fail** if these dev deps were added to `backend/functions` as-is. The probe package is outside FORGE's scan scope. | Slice 1 dependency decision (override, a separate test package, or an exception record) |
| **D-12** | The callable success envelope cannot carry v0.4's `opId` and `status` automatically. The handler must echo them. | Expected. Adapter responsibility. | — |

## 5. What remains open under W-01
- Production ID-token and App Check verification behavior (D-4, D-5).
- Production request limits and deadlines (D-8).
- Android client SDK error surface (D-9).
- The ratified domain→canonical error mapping and envelope placement (D-2), which is a decision rather than an observation.
- Version-string policy: `apiVersion: "v0.4"` travels intact as data. Rejection of an unsupported version (`API_VERSION_UNSUPPORTED`) is handler logic, and was not probed.
- Confirmation-token constraints (API §3): not applicable to Slice 1, and not probed.

## 6. Reproduction
```sh
cd backend/w01-probe
npm ci --ignore-scripts
npm run probe            # builds, then runs firebase emulators:exec (auth, functions; demo project)
# output: evidence/w01-probe-output.json
```
No Java, no network credentials and no real Firebase project are needed. `scripts/check-no-real-firebase.sh` passes with the probe present.
