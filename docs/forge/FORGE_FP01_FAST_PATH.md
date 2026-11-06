# FORGE-FP-01: CI fast path

**Status:** merged to `develop` in PR #13 (merge commit `cb80649`). This file is the first documentation-only change made through it (smoke test `FORGE-FP01-FAST-PROOF-01`).
**Speed-up:** not yet proven. It is only claimed once a real documentation-only run has been observed.

## What it does

Every FORGE run (`.github/workflows/forge-wp00.yml`) starts with **Change classification** (`scripts/forge/classify.mjs`). It decides **FAST** or **FULL** using only GitHub event SHAs and refs and local git objects. Labels, titles and commit messages are never read.

- **FAST:** the four heavy jobs are skipped:
  - Android compile, lint, unit tests
  - Clean repeat build
  - Backend typecheck, tests, npm audit
  - Backend emulator tests
- **FULL:** every job runs, exactly as before FORGE-FP-01.

## Which changes can be FAST

A run is FAST only if **every** changed file meets **all** of these conditions:

| Condition | Rule |
|---|---|
| Path | `README.md`, `docs/**/*.md`, `tests/verity/proofpoints/PL-PP-WPnn-nn[a-z].yaml` (letter optional) or `tests/verity/suites/PS-*.yaml` (upper-case name) |
| Path characters | Printable ASCII; no spaces, backslashes, `.` or `..` segments, or dot-files; at most 255 characters |
| Change type | Added or modified only |
| File mode | Regular, non-executable file (`100644`) |
| Event | A pull request into `develop`, or a push to `develop`, `feature/**` or `fix/**` |

Everything else is **FULL**. That includes:
- **Code and configuration:** source, tests, scripts, workflows, lockfiles, Firebase configuration and unknown file types.
- **Mixed changes:** documentation together with code.
- **Change types:** deletions, renames (treated as a delete plus an add), mode or type changes, symlinks and empty diffs.
- **Events and refs:** any push to `main`, a pull request into `main`, manual runs, other events or refs, and a missing or unknown comparison base.

If the classifier itself fails, it writes no decision. Path verification and the gate then fail.

### What is compared

| Event | Range |
|---|---|
| Pull request into `develop` | merge base of the base and head → head |
| Push to `develop` | previous `develop` commit → new commit (covers merge commits) |
| Push to `feature/**` or `fix/**` | merge base with `origin/develop` → pushed commit (the whole branch, same as its pull request) |

## Gate safeguards

- **The required check is unchanged.** The only required status check is still **`FORGE gate`**. Its body is unchanged and pinned by `scripts/check-osv-exceptions.mjs`; only its `needs` list changed.
- **Jobs that always run:** the gate needs every job that runs on every path:
  - Change classification
  - Documentation and Verity validation: classifier self-tests, Markdown structure, Verity cross-references
  - Gradle wrapper integrity
  - Dependency vulnerability scan and SBOM, including the `WP03-S2-SEC-DISP` exception policy and its 2026-12-01 expiry
  - Secret scan
  - No real Firebase configuration
  - Path verification
- **Path verification always runs.** It fails unless classification succeeded and the four heavy jobs are:
  - all **success** on FULL, or
  - all **skipped** on FAST.

  Any failure, cancellation, missing job or missing decision fails the gate.
- **Nothing else skips work.** No `paths-ignore`, path filters or skip-ci directives are used. Triggers, concurrency, action pins and the branch ruleset are unchanged.
- **Workflow changes always run FULL,** because `.github/**` is not on the allowlist.
