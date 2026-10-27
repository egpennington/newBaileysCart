#!/usr/bin/env bash
# PL-PP-WP00-05: fail if the repository contains real Firebase project configuration.
# WP-00 permits only demo-* emulator project IDs (handoff §2). Exit 0 = clean, 1 = violation.
set -euo pipefail

root="${1:-.}"
cd "$root"
status=0

fail() {
  echo "FAIL: $*"
  status=1
}

# Files that only exist when an app is connected to a real Firebase project.
# Includes gitignored copies: .gitignore blocks commits, but a local copy still must not exist in WP-00.
while IFS= read -r f; do
  fail "real Firebase client config file present: $f"
done < <(git ls-files -co -- '*google-services.json' '*GoogleService-Info.plist' '*service-account*.json' | sort -u)

# Every project ID in .firebaserc files must be a demo-* emulator ID.
while IFS= read -r rc; do
  while IFS= read -r id; do
    case "$id" in
      demo-*) ;;
      *) fail "$rc: non-demo Firebase project ID '$id'" ;;
    esac
  done < <(grep -oE '"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+"' "$rc" | sed -E 's/.*:[[:space:]]*"([^"]+)"/\1/')
done < <(git ls-files -co --exclude-standard -- '*.firebaserc')

# Real Firebase/Google API keys, OAuth client IDs, and production hostnames in tracked sources.
# Excludes only this script, which contains the patterns themselves.
patterns='AIza[0-9A-Za-z_-]{35}|[0-9]+-[0-9a-z]{32}\.apps\.googleusercontent\.com|[a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+\.firebaseapp\.com|com\.google\.gms\.google-services'
if hits=$(git ls-files -co --exclude-standard -z \
    | grep -zvE '^scripts/check-no-real-firebase\.sh$' \
    | xargs -0 -r grep -nIE "$patterns" -- 2>/dev/null); then
  while IFS= read -r line; do
    fail "production Firebase reference: ${line%%:*}:$(cut -d: -f2 <<<"$line")"
  done <<<"$hits"
fi

if [ "$status" -eq 0 ]; then
  echo "PASS: no real Firebase configuration found (demo-* only)."
fi
exit "$status"
