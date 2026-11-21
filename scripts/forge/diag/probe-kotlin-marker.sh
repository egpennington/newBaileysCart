#!/usr/bin/env bash
# BC-GRADLE-DIAG-01 (temporary diagnostic; remove once the root cause is established).
# One unauthenticated GET of the Kotlin JVM plugin marker POM from Maven Central, recorded before
# Gradle runs. It records the curl exit code, HTTP status, remote IP, timing, CDN response headers
# and whether the body matches the hash trusted in android/gradle/verification-metadata.xml.
# This script never fails the job: every path exits 0, so it cannot skip or replace the build.
# Usage: probe-kotlin-marker.sh <output-dir> [url]   (the url argument exists for local tests only)
set -u
out="${1:-${RUNNER_TEMP:-/tmp}/gradle-diag}"
url="${2:-https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/jvm/org.jetbrains.kotlin.jvm.gradle.plugin/2.4.10/org.jetbrains.kotlin.jvm.gradle.plugin-2.4.10.pom}"
expected="202ec7f58c6e23fbeca29383ea33cec9a4e8547826e70ac87800374c787b3f80"
label="${PROBE_LABEL:-probe}"

{
  mkdir -p "$out" || exit 0
  body="$out/$label-marker.pom"
  headers="$out/$label-headers.txt"
  report="$out/$label.txt"

  host="${url#https://}"; host="${host%%/*}"
  dns="unavailable"
  if command -v getent > /dev/null 2>&1; then
    dns="$(getent ahosts "$host" 2> /dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  fi

  # -q ignores any .curlrc; no credentials, netrc or auth headers are used.
  metrics="$(curl -q -sS --max-time 60 -o "$body" -D "$headers" \
    -w 'http_code=%{http_code} remote_ip=%{remote_ip} remote_port=%{remote_port} http_version=%{http_version} size=%{size_download} t_dns=%{time_namelookup} t_connect=%{time_connect} t_tls=%{time_appconnect} t_first_byte=%{time_starttransfer} t_total=%{time_total}' \
    "$url" 2> "$out/$label-curl-stderr.txt")"
  curl_exit=$?

  actual="none"
  [ -s "$body" ] && actual="$(sha256sum "$body" | cut -d' ' -f1)"
  match="no"; [ "$actual" = "$expected" ] && match="yes"

  {
    echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "url=$url"
    echo "dns_$host=$dns"
    echo "curl_exit=$curl_exit $metrics"
    echo "curl_stderr=$(tr '\n' ' ' < "$out/$label-curl-stderr.txt" 2> /dev/null)"
    echo "body_sha256=$actual matches_trusted=$match"
    echo "response_headers (allowlisted):"
    grep -iE '^(HTTP/|date|server|via|age|x-served-by|x-cache|x-cache-hits|x-timer|content-length|content-type|retry-after|x-ratelimit-[a-z-]+|cf-ray):' "$headers" 2> /dev/null | tr -d '\r' | sed 's/^/  /'
  } > "$report"
  # Keep only the allowlisted headers above; the raw response headers (which may carry a CDN
  # Set-Cookie) are not uploaded.
  rm -f "$headers"

  cat "$report"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { echo "### BC-GRADLE-DIAG-01 Maven Central probe ($label)"; echo '```'; cat "$report"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
  fi
  echo "::notice title=Maven Central probe ($label)::curl_exit=$curl_exit $metrics matches_trusted=$match"
} || true
exit 0
