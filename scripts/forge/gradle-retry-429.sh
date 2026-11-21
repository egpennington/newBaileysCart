#!/usr/bin/env bash
# BC-GRADLE-429-R1 (PL-PP-WP00-07): run one Gradle invocation with its output in <log>, and retry it
# exactly once, after a fixed 120 s, only when all four conditions hold:
#   T1  Gradle exited non-zero
#   T2  Gradle logged an HTTP 429 from Maven Central (repo.maven.apache.org/maven2)
#   T3  no task started (the failure happened during configuration, so no work is repeated)
#   T4  no dependency verification failure was reported
# One retry per job: the first retry atomically creates $RUNNER_TEMP/gradle-diag/retry-429.used, and
# any later invocation in the same job that meets T1-T4 is not retried. The first attempt's log is kept
# as <log>.attempt1, every decision is recorded in retry-429.txt, and a ::warning annotation is
# emitted. The exit code is always the final attempt's, unchanged.
# This script sends no network requests and caches nothing.
# usage: gradle-retry-429.sh <log> -- <gradle command and arguments...>
set -uo pipefail

usage() { echo "usage: gradle-retry-429.sh <log> -- <command...>" >&2; exit 2; }
[ $# -ge 3 ] && [ "$2" = "--" ] || usage
log="$1"; shift 2

readonly DELAY_SECONDS=120
readonly T2_RE='^Failed to get resource: (GET|HEAD)\. \[HTTP 429: https://repo\.maven\.apache\.org/maven2/'
diag="${RUNNER_TEMP:?RUNNER_TEMP must be set}/gradle-diag"
marker="$diag/retry-429.used"
record="$diag/retry-429.txt"
# Tests replace the sleep command only; the delay value is fixed.
sleep_cmd="${FORGE_RETRY_SLEEP:-sleep}"

run() { local r=0; "$@" > "$log" 2>&1 || r=$?; return "$r"; }

retryable() {
  [ "$1" -ne 0 ] || return 1                                  # T1
  grep -qE "$T2_RE" "$log" || return 1                        # T2
  if grep -qE '^> Task ' "$log"; then return 1; fi            # T3
  if grep -qF 'Dependency verification failed' "$log"; then return 1; fi   # T4
  return 0
}

rc=0
run "$@" || rc=$?

if retryable "$rc"; then
  mkdir -p "$diag"
  name="$(basename "$log")"
  if mkdir "$marker" 2> /dev/null; then
    {
      echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) log=$name decision=retry attempt1_exit=$rc delay_seconds=$DELAY_SECONDS"
      echo "matched=$(grep -m1 -E "$T2_RE" "$log")"
    } >> "$record"
    echo "::warning title=BC-GRADLE-429-R1 retry::Maven Central returned HTTP 429 before any task ran ($name, exit $rc). Retrying once after ${DELAY_SECONDS}s; the first attempt is kept as $name.attempt1."
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      echo "- BC-GRADLE-429-R1: \`$name\` hit Maven Central HTTP 429 before any task ran (exit $rc); retried once after ${DELAY_SECONDS}s." >> "$GITHUB_STEP_SUMMARY"
    fi
    # Fail closed: if the delay cannot be honoured, do not retry; the first attempt's result stands.
    if ! "$sleep_cmd" "$DELAY_SECONDS"; then
      echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) log=$name decision=no-retry-delay-failed exit=$rc" >> "$record"
      echo "::warning title=BC-GRADLE-429-R1 retry abandoned::$name: the ${DELAY_SECONDS}s delay failed, so no retry was made (exit $rc)."
      exit "$rc"
    fi
    mv "$log" "$log.attempt1"
    rc=0
    run "$@" || rc=$?
    echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) log=$name decision=final attempt2_exit=$rc" >> "$record"
    echo "::warning title=BC-GRADLE-429-R1 retry result::$name second attempt exited $rc; this result is final."
  else
    echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) log=$name decision=no-retry-budget-spent exit=$rc" >> "$record"
    echo "::warning title=BC-GRADLE-429-R1 retry budget spent::$name hit Maven Central HTTP 429 again, but this job already used its one retry (exit $rc)."
  fi
fi

exit "$rc"
