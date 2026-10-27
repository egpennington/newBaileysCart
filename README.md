# Bailey's Cart

**A simple, offline-first grocery list for families.**  
*Software built for the real world.* — Pennington Labs

> **Project status:** Phase 2 — Architecture & Technical Design. The application is not yet implemented or released.

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

**Implementation, production deployment, and release are not yet authorized.**

## Getting started

WP-00 (Android foundations and FORGE build contract) is in progress on `feature/wp00-foundations`. See [`docs/BUILD.md`](docs/BUILD.md) for the pinned toolchain, local build and check commands, CI behavior, and the demo-only Firebase emulator plan. Approved decisions are recorded in [`docs/decisions/DECISION_REGISTER.md`](docs/decisions/DECISION_REGISTER.md).

## License

No license has been selected or granted in this repository. All rights reserved unless the Project Lead specifies otherwise.
