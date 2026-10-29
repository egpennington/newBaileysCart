# Bailey's Cart — API v0.4 Amendment A1: Callable Transport, Errors and Session (WP-03 Slice 1)

**Status:** PROPOSED. CipherMuse CONDITIONAL APPROVAL on v0.1; this revision addresses the three conditions. Requires CipherMuse review, then Project Lead approval **before merge**. Not ratified.
**Version:** 0.2 · **Date:** 2026-10-28 · **Drafted by:** CODI
**Supersedes:** `API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.1.md`, which is kept unmodified.
**Amends:** `docs/specs/R-04/API_SPEC_v0.4_CANONICAL.md` (SHA-256 `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d`), §3, §4 (`account.getSession`) and §8. The canonical file is **not modified**. Where this amendment and v0.4 differ on the points below, this amendment controls once ratified. Everything else in v0.4 is unchanged.
**Basis:**
- PL acceptance of E-1..E-5 (2026-10-28) and PL-1..PL-10
- GAI W-01 decision D-2 (Option A)
- `docs/specs/R-04/W01_CALLABLE_WIRE_EVIDENCE_v1.0.md`
- The implementation at `feature/wp03-s1-family-ownership` @ `8d2bfa041641b559b8bfd3b07ad4acfd2744d92e`. The application code is unchanged since `d7beae8`, and FORGE run #19 passed 137/137.

**Normative language:** MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## Changes from v0.1

| # | CipherMuse condition | Change | API behavior change? |
|---|---|---|---|
| C-1 | `INTERNAL` retryability | §A1.4: `retryable: true` permits safe, bounded retries with the identical `opId` and payload, but guarantees neither recovery nor success. `INTERNAL` is **indeterminate**: the operation may or may not have committed. v0.1's "no committed effect is known to the caller" is replaced. | **No.** Wording now matches existing behavior (§A1.4 note). |
| C-2 | "byte for byte" | §A1.6: replay returns the **logically identical** success envelope, with all field values including timestamps. No transport-serialization identity is claimed. | **No.** Matches the stored-and-parsed implementation and the deep-equality tests. |
| C-3 | `account.getSession` field presence | §A1.5 rewritten with presence rules, absent-versus-null rules, valid JSON examples and a normative JSON Schema. §A1.6 gets the same treatment for `families.create`. | **No** for all data Slice 1 writes. Two malformed-storage edge cases are flagged in §A1.8 for a decision. |

The E-1..E-5 decisions and PL-1..PL-10 are unchanged.

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
  - The caller's identity comes only from the verified Firebase Auth context. Request bodies MUST NOT carry identity or verification state.
- **Success:**
  - **Wire:** HTTP 200 with `{"result": <success envelope>}`.
  - SDKs return the success envelope as the call's data.
- **Domain rejection** (E-1, GAI D-2 Option A):
  - The server throws a native `HttpsError(<canonical code>, <fixed message>, <rejection envelope>)`.
  - **Wire:** HTTP status mapped from the canonical code, with body `{"error":{"message","status","details":<rejection envelope>}}`.
  - SDKs reject with the canonical code, and their `details` property holds the rejection envelope.
- **Clients MUST:**
  - Determine the domain outcome **only** from `details.error.code`. **Never** use the HTTP status, which several codes share (W-01 D-3), or the message, which SDKs alter, for example by appending ` [<HTTP status>]` (W-01 D-6).
  - Treat a missing or unparseable `details` envelope, or a transport or network failure with no envelope, as an **indeterminate** outcome. Handle it like `INTERNAL` (§A1.4).
- **Timestamps:** all timestamps are RFC 3339 UTC strings with exactly three fractional-second digits and a `Z` suffix, for example `2026-10-28T12:00:00.000Z` (W-01 D-7).
- **App Check:** not enforced in Slice 1. `APP_CHECK_REQUIRED` stays reserved (W-01 D-4).

### Envelopes

The success envelope. Every key is always present; `opId` is `null` only as described below.
```json
{"apiVersion": "v0.4", "opId": "3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b", "status": "COMMITTED", "serverTime": "2026-10-28T12:00:00.000Z", "data": {}}
```

The rejection envelope (E-1). The keys are exactly these, and there is **no** `error.message`:
```json
{"apiVersion": "v0.4", "opId": null, "status": "REJECTED", "error": {"code": "VALIDATION_FAILED", "retryable": false, "details": {"field": "opId", "reason": "NOT_A_UUID_V4"}}}
```

- **Values in `error.details`:** an object with only flat string, number or boolean values, which must be non-sensitive. It is `{}` when there is nothing to add. Slice 1 uses `{field, reason}` for `VALIDATION_FAILED` and `{supported}` for `API_VERSION_UNSUPPORTED`.
- **The `HttpsError` message:** a fixed string per code (§A1.4). It is diagnostic only, and clients MUST NOT display it or parse it.

### `opId` handling
- **Mutations** (`families.create`) require `opId`: a lowercase, canonical UUID v4 (8-4-4-4-12 hex, version nibble `4`, variant `8`–`b`).
  - Uppercase or other forms are `VALIDATION_FAILED`. This prevents one operation from having two idempotency keys.
- **Reads** (`account.getSession`) accept an optional `opId`, which must be valid if supplied.
- **Echo rule:** the `opId` key is always present in both envelopes. It holds the caller's `opId` **only** if that value is valid, and `null` otherwise, including when none was supplied. Invalid input is never reflected.

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

Rejections are not recorded as idempotent outcomes. Only committed results are replayed (§A1.6).

## A1.3 Authentication

- A request is authenticated only if the auth context exists **and** `uid` is a string that is non-empty after trimming. Anything else is `UNAUTHENTICATED`. Emulators accept malformed and forged tokens (W-01 D-5), and production code MUST NOT assume a non-null auth context carries a usable `uid`.
- Verified email means the token claim `email_verified === true`, exactly.

## A1.4 Slice 1 domain codes: transport mapping and retryability (E-2, E-3)

**Definition of `retryable`:**
- `retryable: true` means a client MAY resubmit the **identical request** (same `opId` and the same payload) without user action, with bounded retries and jittered exponential backoff (v0.4 §5).
- It states that such a retry is **safe**: idempotency prevents duplicate effects. It **does not** guarantee that the retry will succeed, or that the underlying condition will clear.
- `retryable: false` means the identical request will not succeed without a change to the request, the credentials or the account state. Clients MUST NOT retry it automatically.

| Domain code | Canonical code | HTTP | `retryable` | Fixed message | Basis |
|---|---|---|---|---|---|
| `UNAUTHENTICATED` | `unauthenticated` | 401 | false | "Authentication required." | Needs new credentials |
| `EMAIL_VERIFICATION_REQUIRED` | `failed-precondition` | 400 | false | "Email verification required." | Needs user action and a token refresh. After that, the same `opId` MAY be resubmitted, because rejections are not recorded. |
| `OWNER_ALREADY_HAS_FAMILY` | `failed-precondition` | 400 | false | "Caller already owns a family." | D42; persists until ownership release (PL-2) |
| `IDEMPOTENCY_KEY_REUSED` | `invalid-argument` | 400 | false | "Operation ID reused." | v0.4 §5 |
| `VALIDATION_FAILED` | `invalid-argument` | 400 | false | "Request validation failed." | Request must change |
| `API_VERSION_UNSUPPORTED` | `invalid-argument` | 400 | false | "API version unsupported." | Matrix: queue retained for upgrade, no automatic retry |
| `RATE_LIMITED` | `resource-exhausted` | 429 | true | "Rate limited." | Reserved; not raised in Slice 1 |
| **`INTERNAL`** (new, E-2) | `internal` | 500 | true | "Internal error." | Matrix: outages retry the identical `opId` and payload |

### `INTERNAL` semantics (E-2; adds to v0.4 §8; revised for C-1)

**When used:** any failure that is not a domain rejection. Examples: an unexpected exception, a storage error, or transaction contention exhausted after 10 attempts.

**What is sent:** the client receives only the envelope with `error.code: "INTERNAL"`, `retryable: true` and `error.details: {}`. Exception text, stack traces, paths and identifiers are logged server-side and MUST NOT be returned.

**The outcome is indeterminate.** An `INTERNAL` rejection does **not** state whether the operation committed. For example, a storage commit can succeed before an error surfaces.

**Client behavior for a mutation:**
- **(a)** Retries MUST reuse the identical `opId` and payload. A new `opId` could create a second operation.
- **(b)** Retries MUST be bounded in count and time, with jittered backoff.
- **(c)** Retries MUST happen within the server's idempotency retention window. Slice 1 retains records for at least 37 days after commit (PL-8). Retries SHOULD also follow v0.4 §5's client replay-age limits (≥ 21 days or uncertain age requires review).
- **(d)** If the earlier attempt committed, a retry returns the original committed response (§A1.6). If it did not, the retry is evaluated as a new attempt.
- **(e)** When retries are exhausted, the client MUST keep the operation pending or surface it for review. It MUST NOT assume success or failure.

**For a read** (`account.getSession`): a retry is always side-effect-free.

> **Behavior note (C-1):** this matches the implementation. Unexpected failures are mapped to `INTERNAL` with `retryable: true`, and replay is keyed on `(uid, opId)` with a payload hash. The revision removes only v0.1's implication that `INTERNAL` meant nothing had committed.

## A1.5 `account.getSession` (E-4; replaces the v0.4 §4 summary; revised for C-3)

### Request
```json
{"apiVersion": "v0.4"}
```
```json
{"apiVersion": "v0.4", "opId": "3f1c2a9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b"}
```
- Authentication is required. Verified email is not.
- The response is computed in one read-only transaction, so all reads come from one consistent snapshot.

### Field-presence rules (normative)

**General rule:** a key is either **always present** (with the stated type, and `null` only where the type allows it) or **conditionally present**. A conditionally present key is **omitted** when its condition is false. Conditional keys MUST NOT be sent as `null`, and clients MUST treat a missing conditional key as "not applicable".

| Field | Presence | Type and value |
|---|---|---|
| `data.ownedFamilyId` | **always** | string, or `null` when the caller owns no unreleased family |
| `data.joinedFamilies` | **always** | array, possibly empty, ordered by `familyId` ascending (UTF-16 code-unit order) |
| `data.trialEligible` | **always** | boolean: the caller's own account-level eligibility (PL-9) |
| `data.selectedFamilySuggestion` | **always** | string, or `null` (selection rule below) |
| `joinedFamilies[].familyId` | **always** | string |
| `joinedFamilies[].role` | **always** | `"OWNER"` or `"MEMBER"` |
| `joinedFamilies[].accessMode` | **always** | `"READ_WRITE"`, `"READ_ONLY"` or `"NONE"` |
| `joinedFamilies[].displayName` | **conditional:** present iff the family has a display name | string, 1–50 code points (PL-5) |
| `joinedFamilies[].lifecycleState` | **conditional:** present iff `role` is `"OWNER"` | string; in Slice 1, `"ACTIVE"` or `"UNENTITLED_AWAITING_PAYMENT"` |
| `joinedFamilies[].trialEndsAt` | **conditional:** present iff `role` is `"OWNER"` **and** the family has a trial | RFC 3339 UTC string |
| `joinedFamilies[].reservationExpiresAt` | **conditional:** present iff `role` is `"OWNER"` **and** the family is an unentitled reservation | RFC 3339 UTC string |

**Owned family consistency:** `trialEndsAt` and `reservationExpiresAt` are never both present on one entry. For an `"OWNER"` entry, `ownedFamilyId` equals its `familyId`. A response contains at most one `"OWNER"` entry.

`opId` in the envelope follows §A1.2: the valid caller value, or `null`.

### Membership and privacy rules
- **Inclusion:** a family appears in `joinedFamilies` only if the caller's reverse-index edge **and** the family's own member edge both exist and are `ACTIVE`. Stale, inactive or dangling reverse edges grant nothing.
- **`role` is `"OWNER"`** only if the member edge says `OWNER` **and** the family's immutable `ownerUid` equals the caller. Otherwise it is `"MEMBER"`.
- **Owner-only fields** (`lifecycleState`, `trialEndsAt`, `reservationExpiresAt`) MUST NOT appear on `"MEMBER"` entries. No billing, trial or reservation data from another owner's family is returned.
- **`trialEligible`** reflects only the caller's own trial ledger.

### `accessMode` (evaluated at server time)

| Lifecycle | Condition | `accessMode` |
|---|---|---|
| `ACTIVE` with trial | now < `trialEndsAt` | `READ_WRITE` |
| `ACTIVE` with trial | now ≥ `trialEndsAt` (no paid entitlement exists in Slice 1) | `READ_ONLY` (v0.4 invariant 4) |
| `UNENTITLED_AWAITING_PAYMENT` | before or after `reservationExpiresAt` | `NONE` (no shopping access) |
| Any other or unknown state, or `ACTIVE` with no trial end | — | `NONE` (fail closed) |

### Family selection (`selectedFamilySuggestion`)

This is a UI hint only, never an authorization credential (v0.4 §4).
1. `ownedFamilyId`, if that family's entry has `accessMode` other than `"NONE"`.
2. Otherwise, the first entry in `joinedFamilies` order whose `accessMode` is not `"NONE"`.
3. Otherwise `null`. An owner whose only family is an unpaid reservation gets `null`.

### Examples (valid JSON; `data` only)

A new account, with nothing owned or joined:
```json
{"ownedFamilyId": null, "joinedFamilies": [], "trialEligible": true, "selectedFamilySuggestion": null}
```

The owner of a named trial family, also a member of an unnamed family:
```json
{
  "ownedFamilyId": "aB3dE5fG7hJ9kL1mN2pQ",
  "joinedFamilies": [
    {"familyId": "Zx8Wv6Ut4Sr2Qp0OnMlK", "role": "MEMBER", "accessMode": "READ_WRITE"},
    {
      "familyId": "aB3dE5fG7hJ9kL1mN2pQ",
      "role": "OWNER",
      "accessMode": "READ_WRITE",
      "displayName": "The Smiths",
      "lifecycleState": "ACTIVE",
      "trialEndsAt": "2026-11-18T12:00:00.000Z"
    }
  ],
  "trialEligible": false,
  "selectedFamilySuggestion": "aB3dE5fG7hJ9kL1mN2pQ"
}
```
(Order is by `familyId` code units, and `"Z"` (U+005A) sorts before `"a"` (U+0061).)

The owner of an unpaid reservation only:
```json
{
  "ownedFamilyId": "Qr7St9Uv1Wx3Yz5Ab7Cd",
  "joinedFamilies": [
    {
      "familyId": "Qr7St9Uv1Wx3Yz5Ab7Cd",
      "role": "OWNER",
      "accessMode": "NONE",
      "lifecycleState": "UNENTITLED_AWAITING_PAYMENT",
      "reservationExpiresAt": "2026-10-29T12:00:00.000Z"
    }
  ],
  "trialEligible": false,
  "selectedFamilySuggestion": null
}
```

### Normative schema (JSON Schema 2020-12, `data` only)
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:baileyscart:api:v0.4:a1:account.getSession:data",
  "type": "object",
  "additionalProperties": false,
  "required": ["ownedFamilyId", "joinedFamilies", "trialEligible", "selectedFamilySuggestion"],
  "properties": {
    "ownedFamilyId": {"type": ["string", "null"], "minLength": 1},
    "trialEligible": {"type": "boolean"},
    "selectedFamilySuggestion": {"type": ["string", "null"], "minLength": 1},
    "joinedFamilies": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["familyId", "role", "accessMode"],
        "properties": {
          "familyId": {"type": "string", "minLength": 1},
          "role": {"enum": ["OWNER", "MEMBER"]},
          "accessMode": {"enum": ["READ_WRITE", "READ_ONLY", "NONE"]},
          "displayName": {"type": "string", "minLength": 1},
          "lifecycleState": {"type": "string", "minLength": 1},
          "trialEndsAt": {"$ref": "#/$defs/rfc3339utc"},
          "reservationExpiresAt": {"$ref": "#/$defs/rfc3339utc"}
        },
        "allOf": [
          {
            "if": {"properties": {"role": {"const": "MEMBER"}}},
            "then": {"not": {"anyOf": [
              {"required": ["lifecycleState"]},
              {"required": ["trialEndsAt"]},
              {"required": ["reservationExpiresAt"]}
            ]}}
          },
          {
            "if": {"properties": {"role": {"const": "OWNER"}}},
            "then": {"required": ["lifecycleState"]}
          },
          {"not": {"required": ["trialEndsAt", "reservationExpiresAt"]}}
        ]
      }
    }
  },
  "$defs": {
    "rfc3339utc": {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"}
  }
}
```

The 50-code-point maximum on `displayName` is not expressible in JSON Schema's `maxLength`, which counts code points in some implementations and UTF-16 units in others. It is normative through PL-5. Cross-entry rules (at most one `"OWNER"` entry; `ownedFamilyId` consistency; selection and order rules) are normative prose above.

## A1.6 `families.create` response and replay (revised for C-2, C-3)

### Field-presence rules (`data`)

| Field | Presence | Type and value |
|---|---|---|
| `familyId` | **always** | string |
| `lifecycleState` | **always** | `"ACTIVE"` (trial) or `"UNENTITLED_AWAITING_PAYMENT"` (reservation) |
| `familyEpoch` | **always** | integer `1` |
| `displayName` | **conditional:** present iff the request supplied `payload.displayName` | string: the trimmed value (PL-5) |
| `trialStartedAt`, `trialEndsAt` | **conditional:** both present iff `lifecycleState` is `"ACTIVE"` | RFC 3339 UTC; `trialEndsAt − trialStartedAt` = exactly 21 × 86,400 s |
| `reservationCreatedAt`, `reservationExpiresAt` | **conditional:** both present iff `lifecycleState` is `"UNENTITLED_AWAITING_PAYMENT"` | RFC 3339 UTC; difference = exactly 86,400 s |

Conditional keys are omitted, never `null`. No other keys are present.

```json
{"familyId": "aB3dE5fG7hJ9kL1mN2pQ", "lifecycleState": "ACTIVE", "familyEpoch": 1, "displayName": "The Smiths", "trialStartedAt": "2026-10-28T12:00:00.000Z", "trialEndsAt": "2026-11-18T12:00:00.000Z"}
```
```json
{"familyId": "Qr7St9Uv1Wx3Yz5Ab7Cd", "lifecycleState": "UNENTITLED_AWAITING_PAYMENT", "familyEpoch": 1, "reservationCreatedAt": "2026-10-28T12:00:00.000Z", "reservationExpiresAt": "2026-10-29T12:00:00.000Z"}
```

`displayName` follows PL-5:
- optional and trimmed
- 1–50 Unicode code points
- rejects control characters (including tab and line breaks), format characters (including ZWJ, so emoji ZWJ sequences are rejected), line and paragraph separators, lone surrogates and blank-rendering Hangul fillers
- no normalization or canonicalization

### Idempotent replay (C-2)
- **What a replay returns.** A replay (same caller, same `opId`, same canonical request) returns the **same logical success envelope** as the original commit. Every field and value is equal, including `opId`, `serverTime`, `familyId` and all trial or reservation timestamps. It does not reflect the time of the replay, and it never extends a TTL.
- **What it does not claim.** Equality is defined on the parsed JSON value: same keys, same values, any key order. This specification does **not** guarantee identical transport bytes, key order or whitespace between the original response and a replay.
- **Basis.** The implementation stores the committed envelope as JSON and returns the parsed value. Tests assert deep structural equality: D2 replay after 25 h, D2 concurrent same-`opId` callers, and D3 replay over the callable wire.

## A1.7 Open items not resolved by this amendment
- **W-01, still open:**
  - production ID-token and App Check verification
  - production request limits
  - the Android SDK error surface
- **Final region and deployment naming.**
- **Error codes from later slices.** Each later slice adds rows to §A1.4 through its own amendment.
- **The two edge cases in §A1.8.**

## A1.8 Flagged: contract statements that are stricter than malformed-storage behavior

The behavior below is **unchanged and has not been silently resolved**. Data written by Slice 1 always satisfies §A1.5. The cases arise only if a `families/{id}` document were written by something else, or were corrupted.

| # | Contract (§A1.5) | Current behavior with malformed storage | Options |
|---|---|---|---|
| F-1 | `lifecycleState` is a non-empty string on `"OWNER"` entries | If the stored family lacks `lifecycleState`, the handler sets the key to `undefined`. The callable serializer sends `undefined` as `null` (W-01 D-7). `accessMode` is `NONE` (fail closed). | **(a)** Accept: no Slice 1 path writes such a document; document it as storage-integrity-dependent. **(b)** Authorize a small code change: omit the entry, or substitute a defined value, when `lifecycleState` is missing. That is an API behavior change for malformed data only. |
| F-2 | `displayName`, when present, is a non-empty string | If storage held `displayName: null`, the handler would send `"displayName": null`. A stored non-string or over-length value would be returned as is. | As F-1: **(a)** accept as storage-integrity-dependent, or **(b)** authorize returning `displayName` only when it is a valid PL-5 string. |

CODI recommends **(a)** for Slice 1. All writes go through `families.create`, which validates `displayName` and always sets `lifecycleState`. Revisit **(b)** when later slices add other writers, such as rename or migration. Either way, a CipherMuse or PL decision is needed; CODI has made no code change.

## Approval
| Role | Decision | Date |
|---|---|---|
| CipherMuse (spec owner) | _pending review of v0.2_ | |
| Project Lead | _pending approval (required before merge)_ | |
