# BC-SEC-REMEDIATE-01: PR #25 FORGE failure investigation

| Field | Value |
|---|---|
| Author | CODI, 2026-11-19 |
| PR | #25 `fix/bc-sec-remediate-01` → `develop` |
| Head commit | `edb85e9758e053594b198b9839a9015caf332788` |
| PR merge commit (tested by run #99) | `102cae1c1e0da85a1f70d6e7fcb18c7fd7b3304d`, parents `f3c68da` + `edb85e9` |
| Failing run | #99 `44614595322` (pull_request) |
| Passing run | #98 `44604960563` (push) |
| Merge / deploy | **None.** Not merged or deployed. GAI D4 and penguinPrime merge approval are still mandatory. |

## 1. Root cause and evidence

**Conclusion: this is a transient CI environment failure, probably in Gradle plugin resolution over the network on a single runner. It is not a defect in the PR, its merge revision, or the Gradle/Kotlin configuration.** The exact network error is **NOT VERIFIED**: the job-log endpoint returns `403 Must have admin rights to Repository` without authentication, so CODI has not read the raw log. The error text quoted below comes from the PL's report.

### 1.1 Same source tree in both runs (verified)

| Item | Run #98 (push) | Run #99 (pull_request) |
|---|---|---|
| Checked-out revision | `edb85e9` | `102cae1` (`refs/pull/25/merge`) |
| Git tree | `56d6265ccf10141f7e0daeb06c0ccbd7e0f03570` | `56d6265ccf10141f7e0daeb06c0ccbd7e0f03570` (**identical**) |
| Base | n/a | `develop` = `f3c68da`, which is `edb85e9`'s parent, so `develop` has not moved |

`git diff edb85e9 102cae1` is empty. Within the source, the effective merge revision can't explain the failure.

### 1.2 The PR changes no Android or Gradle input (verified)

`git diff --name-only f3c68da edb85e9 -- android gradle '*.gradle*' '*.toml'` lists only `backend/functions/osv-scanner.toml` (deleted, backend). The PR doesn't touch `android/build.gradle.kts`, `settings.gradle.kts`, `gradle/libs.versions.toml` (`kotlin = "2.4.10"`), `verification-metadata.xml`, the wrapper or `gradle.properties`.

### 1.3 Same plugins block, same run, different outcome (verified from job conclusions)

| Run #99 job | Plugins block | Result |
|---|---|---|
| Android compile, lint, unit tests `135879958869` | `android/build.gradle.kts` (same) | **success** (3 m 25 s) |
| Clean repeat build `135879958586` | `android/build.gradle.kts` (same) | **failure** in step 6 "Two independent clean builds", 42 s after job start; step 7 "Compare hashes" skipped; evidence upload found no files |

Both jobs run on fresh `ubuntu-24.04` runners, the same JDK and `setup-gradle` with `cache-disabled: true`, so both resolve plugins over the network. One resolved `org.jetbrains.kotlin.jvm:2.4.10` and the other did not, **in the same run on the same tree**.

### 1.4 This exact failure has happened before (repository record)

`DECISION_REGISTER.md` WP03-D4-FORGE62 and `docs/wp03/evidence/EVIDENCE_MANIFEST.md` record FORGE run **#62** (`42350124922`, 2026-11-07):
- The Android job failed after 21 s with the **same** message: `Plugin [id: 'org.jetbrains.kotlin.jvm', version: '2.4.10', apply: false] was not found`.
- The clean repeat build in the same run resolved the same plugins block.
- A PL-authorized "Re-run failed jobs" with no code change → **success, 12/12**.

Run #77 (`43823025883`, push, `78e889f`) also failed in Android "Build, lint, unit tests" after 45 s. PR run #78 on the **same SHA** passed. Its log has not been inspected, so it is consistent with the pattern but not confirmed.

### 1.5 Configuration and artifacts are valid (verified locally)

- **Offline build of the PR tree:** `./gradlew :app:assembleRelease :core:model:jar --offline --no-daemon --no-build-cache --rerun-tasks` in the `edb85e9` worktree (Temurin 21.0.13) → **BUILD SUCCESSFUL, 53 tasks executed**. Gradle resolved and verified every plugin, including `org.jetbrains.kotlin.jvm` 2.4.10, against `verification-metadata.xml` from the existing cache, with no network. The worktree stayed clean afterwards.
- **Artifact availability now:** the plugin marker POM returns HTTP 200 on both Maven Central and the Gradle Plugin Portal.
- **Checksums:** the Maven Central marker POM sha256 is `202ec7f5…3f80`, which matches `verification-metadata.xml` line 2610.

### 1.6 Probable mechanism (hypothesis, not proven)

- `org.jetbrains.kotlin.jvm` is the **first plugin in the build that `google()` cannot serve**. The two Android plugins before it come from `google()`. That makes it the build's first request to Maven Central.
- Gradle reports a network or TLS failure during plugin resolution only as "Plugin … was not found". `docs/BUILD.md` "Known local-environment issue" documents this, and so does CODI's desktop TLS record.
- A transient failure from that runner to Maven Central (timeout, 5xx or rate limit) therefore produces exactly this symptom at exactly this line.

**Secondary observation:** the Plugin Portal serves a **different, synthetic** marker POM for this plugin (sha256 `5b762d1f…6992`). That hash is **not** in `verification-metadata.xml`. So even if Gradle fell back to `gradlePluginPortal()`, dependency verification would reject the portal copy, and the fallback gives no resilience for Kotlin plugins. This is fail-closed, which is correct for supply chain, and **must not be "fixed" by adding the portal hash without a separate PL decision.**

### 1.7 Path verification is a downstream failure, not an independent one (verified)

- Path verification `135899797917` annotation: `FORGE path verification failed :: FULL path requires repeat-build to be success, found "failure"`.
- FORGE gate `135899878280` failed in "Require every upstream job to succeed" because path verification failed.
- Both behaved as designed: fail-closed.

### 1.8 Summary of the diagnostic questions

| Question | Answer |
|---|---|
| Different source revision? | No. The trees are identical. |
| Caused by the PR's merge revision? | No. The merge tree equals the head tree. |
| Gradle/Kotlin configuration defect? | No. The PR doesn't change it, the same run's Android job resolved it, and the offline build passes. |
| Reproducible? | **Not reproduced.** Run #98 passed, and #62 and #99 failed on trees that passed elsewhere. It is intermittent and environment-specific. |
| Path verification independent? | No. It is a downstream consequence. |

## 2. Files changed and reasons

**None.** The diagnosis doesn't justify any code, dependency, Gradle, Kotlin or workflow change:
- Changing Kotlin or Gradle versions would be a blind change, which the assignment prohibits.
- Changing repositories or verification metadata, or enabling Gradle caching, would weaken or alter supply-chain gates. That is out of scope and needs PL approval.

The security remediation (`edb85e9`), zero-exception policy and FORGE gates are unchanged.

This report is the only new file. It is saved untracked in `reports/` of the main checkout (`C:\dev\newBaileysCart\reports\`), following the existing convention for review reports there. It is **not committed to the PR**, so it doesn't widen the security PR's scope or trigger extra FORGE runs. Zion's three Gradle files were not touched.

## 3. Commands executed

All commands were read-only against GitHub (public REST API, unauthenticated) unless noted.

```text
GET /repos/egpennington/newBaileysCart/actions/runs?branch=fix/bc-sec-remediate-01
GET /repos/egpennington/newBaileysCart/pulls/25                       # base f3c68da, merge 102cae1, mergeable=true
GET /repos/.../actions/runs/{44614595322,44604960563}/jobs           # job conclusions and timings
GET /repos/.../check-runs/{135879958586,135899797917,135899878280}/annotations
GET /repos/.../actions/jobs/135879958586/logs                         # 403: needs admin auth (log NOT read)
GET /repos/.../actions/runs?per_page=40                               # FORGE history (#62, #77, #85, #86, #63, #76 failures)
GET /repos/.../actions/runs/{43823025883,44184325259,44185244858,42391884159,43354277635}/jobs + annotations
git fetch origin +refs/pull/25/merge:refs/remotes/pr25-merge          # in worktree C:\dev\bc-sec-remediate
git rev-parse 102cae1^{tree} edb85e9^{tree}; git diff --stat edb85e9 refs/remotes/pr25-merge
git diff --name-only f3c68da edb85e9 -- android gradle '*.gradle*' '*.toml'
curl -I / curl | sha256sum  marker POM on plugins.gradle.org and repo.maven.apache.org
grep verification-metadata.xml (marker hash, configuration); grep libs.versions.toml
(local build) ANDROID_HOME=<local SDK> ./gradlew :app:assembleRelease :core:model:jar --offline --no-daemon --no-build-cache --rerun-tasks
git status --short                                                    # worktree clean afterwards
```

## 4. Verification results

| Check | Result | Evidence |
|---|---|---|
| Merge tree equals head tree | **PASS** | both `56d6265c…` |
| PR touches Android/Gradle inputs | **PASS** (none touched) | `git diff --name-only` |
| Offline Android release build and `:core:model:jar` on PR tree | **PASS** (53 tasks) | local log `scratchpad\local-offline-build.log` |
| Kotlin marker available and checksum matches metadata (Maven Central) | **PASS** | HTTP 200; sha256 `202ec7f5…` |
| Local clean **repeat** build with JAR hash comparison (online) | **NOT RUN** | The desktop's TLS-inspecting antivirus breaks online Gradle resolution (documented); trust changes need PL approval. The offline build covers configuration validity only. |
| Run #98 (push, `edb85e9`) | **PASS** 12/12 | `44604960563` |
| Run #99 (PR, `102cae1`) | **FAIL**: repeat-build, then path-verdict and gate downstream; the other 9 jobs passed | `44614595322` |
| Fresh PR verification after diagnosis | **NOT RUN (PENDING)** | Re-running needs repo write auth, and CODI has no token (`gh` absent). PL action required; see below. |
| Unit / emulator / FORGE self-tests (unchanged from BC-SEC-REMEDIATE-01) | PASS (356/356, 356/356, 83/83) | Not re-run, because nothing changed. Run #99's backend jobs passed again in CI. |

**Required action (PL):**
- Open run `44614595322` and choose **"Re-run failed jobs"**. This re-runs repeat-build, path verification and the gate on the same merge commit, about 4 minutes. It is the same remedy as #62 attempt 2.
- Alternatively, choose **"Re-run all jobs"** for a fully fresh 12-job result, about 34 minutes.
- CODI will record the attempt-2 job IDs and conclusions once the re-run finishes.

## 5. FORGE fail-fast proposal (design only, not implemented)

**Problem:** in run #99, repeat-build failed at about 42 s, but the run concluded at 33 m 57 s. `backend-emulator` (`needs: classify`) runs in parallel with everything else and dominates wall time, about 33 min. The gate can only conclude after `path-verdict`, which waits for the emulator.

**Current graph (relevant part):** `classify` → {android, repeat-build, backend, backend-emulator} → path-verdict (`if: always()`) → forge-gate (`if: always()`, plus docs, wrapper, dependency-audit, secrets, firebase-guard).

### Options

| Option | Change | Saves on failure | Cost on green runs | Effect on re-runs |
|---|---|---|---|---|
| **A (recommended)** | `backend-emulator.needs: [classify, backend, dependency-audit, secrets, firebase-guard]` | about 33 min when a **deterministic, cheap** prerequisite fails (typecheck, unit tests, npm audit, OSV, secrets) | about +40–60 s wall time (the emulator starts after backend, roughly 40 s) | A code fix is needed anyway, so nothing is lost |
| B | Option A plus `android` and `repeat-build` | Would also have saved about 30 min in #99 | about +3.5–5 min on **every** green run | **Worse for flakes:** "Re-run failed jobs" would then also re-run the skipped emulator (+33 min) instead of about 4 min |
| C | Watcher job that cancels the run on the first failure | Maximum | No latency cost | Needs `actions: write` on a job token (privilege increase); cancellation discards independent evidence; complex |

### Invariants each option must keep
- **Gate stays fail-closed:** a skipped FULL-path job must count as not-success. `path-verdict` already requires `success` for every FULL job, so a skipped emulator fails path verification, and the gate fails. A negative-control FORGE self-test should assert that skipped equals failure.
- **No security check is skipped or reordered behind a flaky job:** dependency-audit, secrets, firebase-guard, docs and wrapper still run unconditionally in parallel.
- **Diagnostic evidence:**
  - Failed jobs still upload their artifacts (`if: always()` uploads are unchanged).
  - The emulator's log is not produced when the emulator is skipped. That is acceptable, because the prerequisite failure invalidates the run anyway.

### Tradeoff
- **Fail-fast saves runner time and gives earlier feedback.** In exchange, you lose independent results from the same run. When the early failure is *transient* (this incident and #62), the parallel design was actually better: the emulator's 33-minute success was kept, and only about 4 minutes needed re-running.
- **Recommendation:** gate the emulator only on cheap, deterministic prerequisites (Option A). Keep Android and repeat-build parallel and independent.

### Separate follow-up (also needs approval)
The recurring Kotlin plugin resolution flake (#62, #99, possibly #77) deserves its own work item. Candidates, each evaluated against the supply-chain gates:
- Gradle HTTP retry and timeout properties for CI.
- Fetching the job log with an authenticated token to confirm the actual network error.

**Do not** enable the Gradle cache in repeat-build (independence requirement) or trust portal-synthesized markers without a PL decision.

## 6. Remaining risks and GAI D4 considerations

1. **Root cause not proven.** The raw log of `135879958586` hasn't been read. If the PL or GAI can read it, it would confirm the network error type. If it shows something other than a resolution or network failure, this diagnosis must be revisited.
2. **Intermittent CI flake (3 occurrences, 1 unconfirmed).** It can recur on the re-run. A second failure on the same tree would strengthen the case for the follow-up item, not for a code change in PR #25.
3. **Re-run semantics:**
   - "Re-run failed jobs" keeps attempt 1's nine successful jobs, including the 33-minute emulator suite. Precedent: #62 was accepted on that basis.
   - GAI may prefer "Re-run all jobs" for fully fresh evidence.
4. **Unchanged from the PR body:**
   - Fresh transitive packages (minimatch 11.0.9).
   - No local osv-scanner binary run (FORGE's pinned scanner is authoritative and passed in #98 and #99).
   - Emulator run 1 invalidation disclosure.
   - `develop` still carries the exceptions until merge, and they expire 2026-12-01T00:00:00Z.
5. **D4 focus additions:**
   - Confirm that no file in PR #25 changed because of this incident (head still `edb85e9`).
   - Confirm that the dependency-audit and backend jobs passed on the merge commit in #99 (`135879755158`, `135879958580`), independently of the push run.

## 7. Final recommendation

**BLOCKED.** The block isn't caused by any code defect. It remains only until a fresh FORGE verification of PR #25 passes, which requires a PL-initiated re-run of run `44614595322`.

If the re-run concludes **success, 12/12**, the status becomes **READY FOR REVIEW** (GAI D4). Merge still requires penguinPrime's explicit approval. No merge or deployment has been performed.
