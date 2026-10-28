# Bailey's Cart — R-04 Authorization and Error Matrix
**Candidate v0.2 | 2026-10-27 | NOT RATIFIED | All tests NOT_RUN**

Codes are **proposed domain labels**, not verified Firebase callable transport mappings. Authenticated status reads must never disclose billing details to non-owners. Membership checks precede entitlement disclosure; closure status is a narrow original-owner exception.

| Operation/scenario | Allowed actor and state | Expected result / candidate error | Retry and UI |
|---|---|---|---|
| Create first family, verified eligible account | Authenticated verified UID; other family memberships permitted | New familyId, ownerUid=UID; atomic trial claim at successful commit | Idempotent opId retry returns same family/trial timestamps |
| Create additional family after trial consumed | Verified UID; other families permitted | New isolated family; no new trial; paid onboarding required, sequencing **OPEN B01** | Never imply free trial or cross-family entitlement |
| Create/accept invite with unverified email | Authenticated but unverified | `EMAIL_VERIFICATION_REQUIRED`, no invite consumption | Verify email, retry unchanged operation when safe |
| Owner billing verification | Current family owner only | Provider-verified entitlement for that family | Non-owner `OWNER_REQUIRED`; no purchase data leakage |
| Expired subscription: active member read | Current member, ACTIVE family | Read-only list access | Neutral notice; owner sees renewal control |
| Expired subscription: mutation | Current member, ACTIVE family | `ENTITLEMENT_READ_ONLY` | Preserve eligible pending ops, do not mutate |
| Revoked member: any family read/write | Revoked / no current membership | Privacy-safe `FORBIDDEN` or `MEMBERSHIP_REVOKED` | Stop family sync after authoritative status; no protected response leakage |
| Another family's status/items | Member of A, not B | Denied regardless of A entitlement | No cross-family data or billing disclosure |
| Owner close family | Original owner, ACTIVE, online, explicit confirmation | Durable pending closure; immediate access restriction | Show billing reconciliation pending, not “closed” |
| Close request repeated with same opId/payload | Original owner | Same durable outcome | No duplicate cancellation side effects |
| Close request same opId/different payload | Authenticated actor | `IDEMPOTENCY_KEY_REUSED` | Quarantine; no new effect |
| Billing cancellation unavailable/unknown | Closure pending | `CLOSURE_BILLING_UNCONFIRMED` / pending status | Retry provider reconciliation safely; no 30-day clock |
| Billing cancellation verified | Closure pending | Transition `CLOSING`; server sets 30-day deadline | Show recovery deadline to original owner only |
| List read or item mutation during pending/closing | All members including owner | `FAMILY_CLOSURE_PENDING` or `FAMILY_CLOSING` | No list access; no queued op replay |
| Closure status during pending/closing | Original owner only | Narrow state/deadline response | Do not expose raw payment tokens |
| Restore before deadline | Original owner, `CLOSING`, online | Owner-only restored family; old memberships/invites/queues remain invalid | Invite members afresh; billing not auto restarted |
| Restore by former member | Former member, any closure state | `FORBIDDEN` | No family data |
| Restore after deadline | Original owner, `DELETION_PENDING` | `CLOSURE_RECOVERY_EXPIRED` | No recovery |
| Restore while billing cancellation pending | Original owner, `CLOSURE_PENDING_BILLING` | **UNRESOLVED B04** | No assumed behavior; block final implementation |
| Invite after restoration | Owner, restored ACTIVE, entitlement policy satisfied | Fresh invite; old codes invalid | Verify recipient; no automatic former membership |
| Old offline operation after recovery | Any actor, pre-closure epoch | Permanent replay rejection | Preserve audit; do not silently execute |
| Normal offline op <21 days | Active member, ACTIVE family, writable entitlement | Replay eligible if other safeguards pass | Same opId/payload; one in-flight per family |
| Offline op >=21 days or unreliable age | Any | Local `REVIEW_REQUIRED` | Quarantine; no auto replay |
| Add same canonical name | Authorized active member | Satisfied without duplicate item | Dependents cannot silently retarget |
| Rename into another active NameKey | Authorized active member | `DUPLICATE_NAME_EXISTS` | Explain, preserve both items |
| Edit item deleted by another device | Authorized active member | `ITEM_NOT_FOUND` or tombstone-specific error | Never resurrect |
| Unsupported contract/canonicalization version | Any mutation | `API_VERSION_UNSUPPORTED` / `CANON_VERSION_UNSUPPORTED` | No side effects; preserve queue; update required |
| Firebase outage vs revoked membership | Status unknown | Transport `UNAVAILABLE` not membership denial | Retry with jitter; do not falsely show removal |

**Open:** exact callable mapping, provider API behavior, billing-before-family onboarding, closure retention/deletion SLAs, and privacy-safe error specificity. These are specification blockers, not implementation successes.
