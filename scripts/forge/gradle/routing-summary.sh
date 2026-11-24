#!/usr/bin/env bash
# BC-CI-429-REL-01 (PL-PP-WP00-08): report which repository hosts Gradle contacted, from the Gradle --info
# logs in <diag> (*.info.log and the BC-GRADLE-429-R1 *.info.log.attempt1 copies).
# Report only: it always exits 0 and gates nothing. The fail-closed check is in central-mirror.init.gradle.
# The BC-GRADLE-DIAG-01 probe (curl; <label>.txt in the same folder) is separate traffic and is not counted.
# Usage: routing-summary.sh <diag-dir> <job-label>
set -u
diag="${1:?usage: routing-summary.sh <diag-dir> <job-label>}"
label="${2:?usage: routing-summary.sh <diag-dir> <job-label>}"
readonly REQ='^(Downloading|Failed to get resource: (GET|HEAD)\. \[HTTP [0-9]+:|Resource missing\. \[HTTP (GET|HEAD):) https://[^/ ]+'
readonly MARKER='^BC-CI-429-REL-01: Maven Central routed to '

{
  shopt -s nullglob
  logs=("$diag"/*.info.log "$diag"/*.info.log.attempt1)
  central=0; marked=0
  if [ "${#logs[@]}" -gt 0 ]; then
    central=$(grep -hE "$REQ" "${logs[@]}" | grep -cE 'https://repo\.maven\.apache\.org' || true)
    marked=$(grep -lE "$MARKER" "${logs[@]}" | wc -l | tr -d ' ' || true)
  fi
  {
    echo "### BC-CI-429-REL-01 Gradle repository routing ($label)"
    echo
    echo "Gradle --info logs: ${#logs[@]}; logs with the mirror routing line: $marked."
    echo "The Maven Central diagnostic probe (BC-GRADLE-DIAG-01) is a separate curl request and is not counted here."
    echo
    echo '```'
    if [ "${#logs[@]}" -gt 0 ]; then
      grep -hoE "$REQ" "${logs[@]}" | sort | uniq -c || true
    fi
    echo '```'
    echo
    echo "Gradle requests to repo.maven.apache.org: $central"
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  if [ "$central" -ne 0 ]; then
    echo "::warning title=BC-CI-429-REL-01 routing::$label: Gradle made $central request(s) to repo.maven.apache.org"
  fi
  if [ "${#logs[@]}" -gt 0 ] && [ "$marked" -ne "${#logs[@]}" ]; then
    echo "::warning title=BC-CI-429-REL-01 routing::$label: $marked of ${#logs[@]} Gradle logs show the mirror routing line"
  fi
} || true
exit 0
