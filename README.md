# Bailey's Cart

**A simple, offline-first grocery list for families.**  
*Software built for the real world.* — Pennington Labs

> **Project status:** WP-00 (Android and backend foundations, FORGE build contract) is complete and merged into `develop`. The application's product features are not yet implemented or released.

Bailey's Cart is being rebuilt as a native Android app designed to make shared grocery shopping straightforward. The goal is to preserve the speed and familiarity of the original experience while improving reliability, accessibility, privacy, and offline synchronization.

## Planned Version 1 features

- One shared shopping list per family, supporting up to six members.
- Six fixed categories: **Produce, Dairy, Dry, Frozen, Misc, Meat**.
- Quick item entry, editing, and accessible removal with a five-second Undo option.
- Offline viewing and list changes after initial online setup, with durable synchronization when connectivity returns.
- Secure account and family isolation, with owner-managed invitations and membership.
- A family-owner subscription model with a planned 21-day promotional trial, eligible 14-day billing grace, and 30-day read-only retention policy.

These are **product requirements**, not claims of implemented or verified functionality. Billing and retention implementation details remain subject to technical and platform validation.

## Project repositories

- **New Android application (this repository):** [egpennington/newBaileysCart](https://github.com/egpennington/newBaileysCart)
- **Original Bailey's Cart (legacy reference):** [egpennington/Bailey-s-Cart](https://github.com/egpennington/Bailey-s-Cart)
- **Original web experience:** [baileyscart.netlify.app](https://baileyscart.netlify.app/)

The new application is a clean rewrite. The legacy repository is reference material; its implementation is not automatically carried forward.

## Engineering workflow

Development follows **Pennington Labs Engineering Workflow v2.4** in **Production Engineering** mode.

| Role | Responsibility |
| --- | --- |
| Project Lead | Final authority for architecture, merges, releases, and deployment |
| CipherMuse | Product requirements, architecture, and technical specifications |
| CODI | Implementation and executable verification |
| GAI | Independent review and adversarial verification |
| FORGE | Automated builds, checks, and deployments |

Verification uses the **Verity** framework, including ProofPoints, ProofSuites, and risk-appropriate four-deep testing. No tests, builds, or deployments are claimed as complete by this README.

## Current phase

Phase 1 product definition received GAI's **conditional pass**, and the Project Lead authorized progression to Phase 2. Current work includes:

- Designing the Android application, data model, authorization, and offline synchronization architecture.
- Investigating Google Play Billing integration with the backend-managed promotional trial.
- Auditing the legacy app for behavior and potential data-migration needs.
- Defining retention, purge, account-deletion, and accessibility verification contracts.

Since then, the Phase 4 planning reconciliation was certified, and the Project Lead authorized work package WP-00 (see the decision register). WP-00 was merged into `develop` through PR #1 on 2026-10-27, and the Project Lead formally closed it.

**Implementation beyond Project Lead-authorized work packages, production deployment, and release are not authorized.**

## Getting started

WP-00 provides the Android foundation (`android/`: `:app` and `:core:model`), a TypeScript backend skeleton (`backend/functions`, demo-only Firebase emulator configuration), and the FORGE CI pipeline. It contains placeholder code only; no product features yet.

- **Build and verify locally:** [`docs/BUILD.md`](docs/BUILD.md) covers the pinned toolchain, build and check commands, dependency regeneration, the repeat-build check and the demo-only Firebase emulator plan.
- **Versions and dependency decisions:** [`docs/wp00/VERSION_DECISION_RECORD.md`](docs/wp00/VERSION_DECISION_RECORD.md).
- **Approved decisions:** [`docs/decisions/DECISION_REGISTER.md`](docs/decisions/DECISION_REGISTER.md).
- **Verification evidence:** [`docs/wp00/evidence/EVIDENCE_MANIFEST.md`](docs/wp00/evidence/EVIDENCE_MANIFEST.md) and the Verity ProofPoints in [`tests/verity/`](tests/verity/).

## Branches and integration

- **`develop`** is the integration branch. It is protected, and work reaches it only by pull request.
- **`main`** is protected and remains at the initial baseline. No release has been made.
- **New work** branches from `develop` as `feature/*` or `fix/*` and returns by a pull request into `develop`.
- **Merging** requires a passing `FORGE gate` status check, a branch that is up to date with `develop`, and resolved conversations. Only the merge-commit method is allowed, and force pushes and branch deletion are blocked.
- **Authority:** the Project Lead performs every merge. Agents do not approve or merge pull requests.
- **FORGE** (`.github/workflows/forge-wp00.yml`) runs on pushes to `feature/**`, `fix/**`, `develop` and `main`, and on pull requests into `develop` and `main`.

## License

No license has been selected or granted in this repository. All rights reserved unless the Project Lead specifies otherwise.
