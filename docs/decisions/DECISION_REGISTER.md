# newBaileysCart Decision Register

- **Register version:** 1.1. WP00-OPEN-02 resolved by PL remediation authorization.
- **Created:** 2026-10-26 by CODI, recording Project Lead (penguinPrime) decisions
- **Rule:** entries record decisions and their sources. They do not change the API contract. Canonical API incorporation is a separate, controlled CipherMuse change that must be recorded here when it happens.

## Ratifications

| ID | Decision | Authority | Date | Source |
|---|---|---|---|---|
| R-01 | Phase 4 planning reconciliation certified **PASS** | GAI (document review, not executed tests) | 2026-10-26 | GAI Phase 4 Focused Reconciliation Recheck Report |
| R-02 | `API_SPEC_v0.3_PROPOSED_AMENDMENTS_REV1.md` (completeness code `8723434126`) **ratified as API v0.3 Rev 1** | PL, following GAI R-01 PASS | 2026-10-26 | CODI WP-00 Implementation Handoff v1.0 §1; PL clarification to CODI, 2026-10-26 |
| R-03 | `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md` received a separate **GAI PASS**; PL policy decisions approved | GAI; PL | 2026-10-26 | Handoff v1.0 §1; PL clarification, 2026-10-26 |
| R-04 | Incorporation of R-02 and R-03 into a canonical API document | CipherMuse (owner); PL approval | **PENDING** | Handoff v1.0 §1 ("controlled incorporation into canonical API must be recorded") |

The document headers of R-02 still read "REVISED PROPOSAL … NOT AN APPROVED API BASELINE". Those headers predate ratification. Per PL direction (2026-10-26), the handoff and later PL decisions supersede older headers **only for the specific decisions amended**.

## Product and architecture decisions

| ID | Decision | Status | Date | Source |
|---|---|---|---|---|
| P4-D01 | Canonical repository `https://github.com/egpennington/newBaileysCart.git`; baseline `b6ac365a471f77e0b0dcfb488dc064c106e782c4` | PL VERIFIED; CODI checkout certified PASS | 2026-10-26 | Addendum v0.4 §3; WP-00 checkout certification |
| P4-D03 | Ordinary edits: last server-accepted commit wins (Option B); destructive commands keep version/snapshot guards | PL APPROVED | 2026-10-26 | Addendum v0.4 §3; API v0.3 Rev 1 §4 |
| P4-D10 | Trial starts on first successful family creation | PL APPROVED (future integration contract; not WP-00 scope) | 2026-10-26 | Handoff v1.0 §1; R-03 |
| P4-D11 | Verified email required for family creation and invite acceptance | PL APPROVED (future integration contract; not WP-00 scope) | 2026-10-26 | Handoff v1.0 §1; R-03 |
| **P4-ADR-11** | **Android platform floor: minSdk = 26** | **PL APPROVED** | 2026-10-26 | PL clarification to CODI, 2026-10-26. Opened as P4-ADR-11 because ADR-07 is already used for branding rights (Addendum v0.4 §4.8). |
| P4-CI-01 | **GitHub Actions** is the CI provider for FORGE WP-00 build and check workflows | **PL APPROVED** | 2026-10-26 | PL clarification to CODI, 2026-10-26 |
| P4-WP00-SCOPE | WP-00 only, on `feature/wp00-foundations` from the certified baseline. No WP-03/WP-01/WP-02, SQLCipher spike, provisioning, merge or deploy. | PL AUTHORIZED | 2026-10-26 | Handoff v1.0 §2; PL WP-00 implementation authorization |

## Open decisions raised by WP-00 (not decided)

| ID | Question | Raised by | Notes |
|---|---|---|---|
| WP00-OPEN-01 | Permanent Play `applicationId` | CODI | WP-00 uses the nonproduction placeholder `com.penningtonlabs.baileyscart.wp00placeholder`. An applicationId cannot change after Play publication. |
| WP00-OPEN-02 | Disposition of vulnerabilities in Android Lint tool dependencies (`androidLintTool` configuration, bundled by AGP 9.4.0) | CODI | **RESOLVED 2026-10-26.** The PL authorized Fix B: patched versions for the lint tool configuration only. No suppression or exception was applied. See the version decision record. |
| WP00-FIX-A | Repair verification metadata after FORGE run 40447910773 clean-cache failure | PL AUTHORIZED 2026-10-26 | Additions only. Each new checksum validated against publisher SHA-1. |
| WP00-OPEN-03 | Branch target: Workflow v2.4 §10 creates `feature/*` from `develop`, but `develop` does not exist; handoff specifies `main` at the baseline | CODI | No merge in WP-00. PL to decide whether to create `develop` before the WP-00 PR. |
