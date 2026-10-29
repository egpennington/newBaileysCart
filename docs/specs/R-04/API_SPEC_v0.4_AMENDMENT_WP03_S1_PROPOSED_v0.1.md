# Bailey's Cart — API v0.4 Amendment A1: Callable Transport, Errors and Session (WP-03 Slice 1)

**Status:** PROPOSED. For CipherMuse review and Project Lead approval **before merge**. Not ratified.
**Version:** 0.1 · **Date:** 2026-10-28 · **Drafted by:** CODI
**Amends:** `docs/specs/R-04/API_SPEC_v0.4_CANONICAL.md` (SHA-256 `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d`), §3, §4 (`account.getSession`) and §8. The canonical file is **not modified**. Where this amendment and v0.4 differ on the points below, this amendment controls once ratified. Everything else in v0.4 is unchanged.
**Basis:**
- PL acceptance of escalations E-1..E-5 (WP-03 Slice 1 FORGE CI Authorization, 2026-10-28)
- GAI W-01 decision D-2 (Option A) and its mapping table
- `docs/specs/R-04/W01_CALLABLE_WIRE_EVIDENCE_v1.0.md`
- The implementation at `feature/wp03-s1-family-ownership` @ `fa5b329bbf124ccbd9a5f8506d3b457b8312ac1f`

**Scope:** the two Slice 1 commands and the error codes they raise. Later slices extend these tables through their own amendments.

## A1.1 Logical API names and deployed callable names (E-5)

Firebase callable names cannot contain `.`. The logical command name (used in this specification, the idempotency `command` binding and request hashing) maps to a deployed callable name as follows:

| Logical command (API v0.4) | Deployed callable | Region |
|---|---|---|
| `families.create` | `familiesCreate` | `us-central1` (provisional; a deployment decision) |
| `account.getSession` | `accountGetSession` | `us-central1` (provisional) |

**Rule for later commands:** remove the `.` and capitalize the following letter. For example, `families.waiveRecovery` becomes `familiesWaiveRecovery`. Idempotency records always store the **logical** name.

## A1.2 Transport (replaces the "candidate" wording of v0.4 §3)

Commands are Firebase HTTPS callables (W-01 evidence D-1).

- **Request:**
  - **Wire:** `POST`, body `{"data": <request envelope>}`.
  - The client SDK builds the wire format; callers pass only the request envelope.
  - The caller's identity comes only from the verified Firebase Auth context. Request bodies never carry identity or verification state.
- **Success:**
  - **Wire:** HTTP 200 with `{"result": <success envelope>}`.
  - SDKs return the success envelope as the call's data.
- **Domain rejection** (E-1, GAI D-2 Option A):
  - The server throws a native `HttpsError(<canonical code>, <fixed message>, <rejection envelope>)`.
  - **Wire:** HTTP status mapped from the canonical code, with body `{"error":{"message","status","details":<rejection envelope>}}`.
  - SDKs reject with the canonical code, and their `details` property holds the rejection envelope.
- **Clients MUST:**
  - Determine the domain outcome **only** from `details.error.code`. **Never** use the HTTP status, which several codes share (W-01 D-3), or the message, which SDKs alter, for example by appending ` [<HTTP status>]` (W-01 D-6).
  - Treat a missing or unparseable `details` envelope as `INTERNAL`.
- **Timestamps:** all timestamps are RFC 3339 UTC strings with millisecond precision, for example `2026-10-28T12:00:00.000Z` (W-01 D-7).
- **App Check:** not enforced in Slice 1. `APP_CHECK_REQUIRED` stays reserved (W-01 D-4).

### Envelopes (exact)

The success envelope:
```json
{"apiVersion":"v0.4","opId":"<lowercase UUID v4 | null>","status":"COMMITTED","serverTime":"<RFC 3339 UTC>","data":{}}
```

The rejection envelope (E-1). The keys are exactly these, and there is **no** `error.message`:
```json
{"apiVersion":"v0.4","opId":"<lowercase UUID v4 | null>","status":"REJECTED","error":{"code":"<DOMAIN_CODE>","retryable":true,"details":{}}}
```

- **Values in `error.details`:** only flat string, number or boolean values, which must be non-sensitive. Slice 1 uses `{field, reason}` for `VALIDATION_FAILED` and `{supported}` for `API_VERSION_UNSUPPORTED`.
- **The `HttpsError` message:** a fixed string per code (§A1.4). It is diagnostic only, and clients must not display it or parse it.

### `opId` handling
- **Mutations** (`families.create`) require `opId`: a lowercase, canonical UUID v4 (8-4-4-4-12 hex, version nibble `4`, variant `8`–`b`).
  - Uppercase or other forms are `VALIDATION_FAILED`. This prevents one operation from having two idempotency keys.
- **Reads** (`account.getSession`) accept an optional `opId`, which must be valid if supplied.
- **Echo rule:** responses and rejections echo the caller's `opId` **only** if it is valid. Otherwise they carry `opId: null`. Invalid input is never reflected.

### Request strictness
- Request envelopes and payloads reject unknown fields with `VALIDATION_FAILED` (`reason: "UNKNOWN_FIELD"`). This applies to `familyId` and `familyEpoch` on `families.create` too.
- `apiVersion` must be exactly `"v0.4"`:
  - absent or a non-string value is `VALIDATION_FAILED`
  - any other string is `API_VERSION_UNSUPPORTED`

### Evaluation precedence (Slice 1)
1. Authentication.
2. Request validation (`apiVersion`, fields, `opId`, payload).
3. Verified email (create only).
4. Inside one Firestore transaction: idempotency replay or reuse, then the owner limit, then the trial or reservation decision.

Rejections are not recorded as idempotent outcomes. Only committed results are replayed.

## A1.3 Authentication

- A request is authenticated only if the auth context exists **and** `uid` is a string that is non-empty after trimming. Anything else is `UNAUTHENTICATED`. Emulators accept malformed and forged tokens (W-01 D-5), and production code must not assume a non-null auth context carries a usable `uid`.
- Verified email means the token claim `email_verified === true`, exactly.

## A1.4 Slice 1 domain codes: transport mapping and retryability (E-2, E-3)

`retryable` means **the identical request (same `opId` and payload) may succeed later without user or client changes**. Clients retry only retryable rejections, with the same `opId` and payload and bounded jittered backoff (v0.4 §5). Idempotency guarantees no duplicate effects.

| Domain code | Canonical code | HTTP | `retryable` | Fixed message | Basis |
|---|---|---|---|---|---|
| `UNAUTHENTICATED` | `unauthenticated` | 401 | false | "Authentication required." | Needs new credentials |
| `EMAIL_VERIFICATION_REQUIRED` | `failed-precondition` | 400 | false | "Email verification required." | Needs user action and a token refresh. After that, the same `opId` may be resubmitted, because rejections are not recorded. |
| `OWNER_ALREADY_HAS_FAMILY` | `failed-precondition` | 400 | false | "Caller already owns a family." | D42; persists until ownership release (PL-2) |
| `IDEMPOTENCY_KEY_REUSED` | `invalid-argument` | 400 | false | "Operation ID reused." | v0.4 §5 |
| `VALIDATION_FAILED` | `invalid-argument` | 400 | false | "Request validation failed." | Request must change |
| `API_VERSION_UNSUPPORTED` | `invalid-argument` | 400 | false | "API version unsupported." | Matrix: queue retained for upgrade, no automatic retry |
| `RATE_LIMITED` | `resource-exhausted` | 429 | true | "Rate limited." | Reserved; not raised in Slice 1 |
| **`INTERNAL`** (new, E-2) | `internal` | 500 | true | "Internal error." | Matrix: outages retry the identical `opId` and payload |

### `INTERNAL` semantics (E-2; adds to v0.4 §8)
- **When used:** any failure that is not a domain rejection. Examples: an unexpected exception, a storage error, or transaction contention exhausted after 10 attempts.
- **What is sent:** the client receives only the envelope above with `error.details: {}`. Exception text, stack traces, paths and identifiers are logged server-side and never returned.
- **Effects:** an `INTERNAL` rejection means no committed effect is known to the caller. A retry with the same `opId` either commits once or replays the earlier commit.

## A1.5 `account.getSession` response (E-4; replaces the v0.4 §4 summary)

**Request:** `{"apiVersion":"v0.4","opId"?: "<UUID v4>"}`.
- Authentication is required. Verified email is not.
- The response is computed in one read-only transaction, so all reads come from one consistent snapshot.

**Response `data`:**
```json
{
  "ownedFamilyId": "<familyId> | null",
  "joinedFamilies": [
    {
      "familyId": "<familyId>",
      "role": "OWNER | MEMBER",
      "accessMode": "READ_WRITE | READ_ONLY | NONE",
      "displayName": "<string, if set>",
      "lifecycleState": "<owner only>",
      "trialEndsAt": "<RFC 3339, owner only, if trial>",
      "reservationExpiresAt": "<RFC 3339, owner only, if reservation>"
    }
  ],
  "trialEligible": true,
  "selectedFamilySuggestion": "<familyId> | null"
}
```

**Membership and privacy rules:**
- **`joinedFamilies`** includes every family the caller currently belongs to, including the owned one.
  - A family is included only if the caller's reverse-index edge **and** the family's own member edge both exist and are `ACTIVE`.
  - Stale, inactive or dangling reverse edges grant nothing.
- **`role` is `OWNER`** only if the member edge says `OWNER` **and** the family's immutable `ownerUid` equals the caller. Otherwise it is `MEMBER`.
- **Owner-only fields** (`lifecycleState`, `trialEndsAt`, `reservationExpiresAt`) are returned only for the family the caller owns. Joined families expose only `familyId`, `role`, `accessMode` and `displayName`. No billing, trial or reservation data from other families is ever returned.
- **`trialEligible`** is the caller's own account-level eligibility (PL-9), meaning no trial-ledger entry. It never reflects another user.

**`accessMode`** is evaluated at server time:

| Lifecycle | Condition | `accessMode` |
|---|---|---|
| `ACTIVE` with trial | now < `trialEndsAt` | `READ_WRITE` |
| `ACTIVE` with trial | now ≥ `trialEndsAt` (no paid entitlement exists in Slice 1) | `READ_ONLY` (v0.4 invariant 4) |
| `UNENTITLED_AWAITING_PAYMENT` | before or after `reservationExpiresAt` | `NONE` (no shopping access) |
| Any other or unknown state | — | `NONE` (fail closed) |

**Family selection (`selectedFamilySuggestion`):** a UI hint only. It is never an authorization credential (v0.4 §4).
1. The owned family, if its `accessMode` is not `NONE`.
2. Otherwise, the first family by `familyId` order whose `accessMode` is not `NONE`.
3. Otherwise `null`. An owner whose only family is an unpaid reservation gets `null`.

## A1.6 `families.create` response `data` (records Slice 1 behavior)

```json
{"familyId":"…","lifecycleState":"ACTIVE","familyEpoch":1,"displayName"?:"…","trialStartedAt":"…","trialEndsAt":"…"}
{"familyId":"…","lifecycleState":"UNENTITLED_AWAITING_PAYMENT","familyEpoch":1,"displayName"?:"…","reservationCreatedAt":"…","reservationExpiresAt":"…"}
```

`displayName` follows PL-5:
- optional and trimmed
- 1–50 Unicode code points
- rejects control characters (including tab and line breaks), format characters (including ZWJ, so emoji ZWJ sequences are rejected), line and paragraph separators, lone surrogates and blank-rendering Hangul fillers
- no normalization or canonicalization

A replay returns the original response byte for byte, including the original `serverTime` and timestamps.

## A1.7 Open items not resolved by this amendment
- **W-01, still open:**
  - production ID-token and App Check verification
  - production request limits
  - the Android SDK error surface
- **Final region and deployment naming.**
- **Error codes from later slices.** Each later slice adds rows to §A1.4 through its own amendment.

## Approval
| Role | Decision | Date |
|---|---|---|
| CipherMuse (spec owner) | _pending review_ | |
| Project Lead | _pending approval (required before merge)_ | |
