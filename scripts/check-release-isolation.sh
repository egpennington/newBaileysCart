#!/usr/bin/env bash
# BC-S2-LOCAL-PERSIST LP-2: release isolation check (NC-98; E-11a demo identity exclusion).
#
# usage: scripts/check-release-isolation.sh <apk> <evidence-dir> [expected-apk-sha256]
#
# Retains raw evidence (dexdump class list, aapt2 badging/permissions/resources, APK entry list)
# in <evidence-dir>, then FAILS (exit 1) if the APK contains any of:
#   - classes from :core:storage, Room, androidx.sqlite, SQLCipher (net.zetetic) or the LOCAL DEMO
#     (com.penningtonlabs.baileyscart.demo, which includes the E-11a identity provider);
#   - any native library (lib/**.so) other than the allowlisted Compose library, e.g. libsqlcipher;
#   - the android.permission.INTERNET permission;
#   - the E-11a identity, its Keystore alias prefix or its storage directory name, or the LP-3a
#     trace tag, as UTF-8 or UTF-16LE bytes in any APK entry (dex, resources.arsc, manifest, assets);
#   - BC-FAMILY-SYNC-01 Step 2 (Sync Contract Rev 2 section 6): any com.google.firebase or
#     com.google.android.gms class, any class of the debug family-sync app
#     (com.penningtonlabs.baileyscart.family), the ACCESS_NETWORK_STATE permission, or the emulator
#     host 10.0.2.2, the demo project ID, the family store directory, its alias prefix or its trace tag;
# or, when given, if the APK's SHA-256 differs from [expected-apk-sha256].
# It also fails if app/src/main or app/src/release reference :core:storage or the demo identity.
#
# Needs: unzip, sha256sum, grep with -P, and SDK build-tools (dexdump, aapt2). Set BUILD_TOOLS
# to the build-tools directory, or ANDROID_HOME (the newest build-tools is then used).
# Not wired into FORGE (a workflow change needs separate PL authorization); run locally.
set -uo pipefail

APK=${1:?apk}; OUT=${2:?evidence dir}; EXPECTED_SHA=${3:-}
REPO=$(cd "$(dirname "$0")/.." && pwd)

# Fixed strings that must never reach a release build (E-11a, app/src/debug/.../DemoIdentity.kt).
# LP-3a: the debug-only lifecycle trace tag (app/src/debug/.../demo/DemoPersistence.kt).
FORBIDDEN_STRINGS=("demo-local-list-e11a" "bcdemo_" "bc-local-demo-store" "BCLP3-TRACE")
# BC-FAMILY-SYNC-01 Step 2: the emulator host, the demo project, the family store, its aliases and trace tag.
FORBIDDEN_STRINGS+=("10.0.2.2" "demo-newbaileyscart" "bc-family-sync-store" "bcfs_" "BCFS-TRACE")
# Native libraries already in the WP-00 release APK (androidx.compose.ui graphics path, per ABI).
ALLOWED_NATIVE_LIBS='libandroidx\.graphics\.path\.so'

if [ -z "${BUILD_TOOLS:-}" ]; then
  BUILD_TOOLS=$(ls -d "${ANDROID_HOME:?set ANDROID_HOME or BUILD_TOOLS}"/build-tools/*/ | sort -V | tail -1)
fi
BUILD_TOOLS=${BUILD_TOOLS%/}
tool() { if [ -x "$BUILD_TOOLS/$1.exe" ]; then echo "$BUILD_TOOLS/$1.exe"; else echo "$BUILD_TOOLS/$1"; fi; }
DEXDUMP=$(tool dexdump); AAPT2=$(tool aapt2)

mkdir -p "$OUT"
sha256sum "$APK" > "$OUT/apk.sha256"
"$AAPT2" dump badging "$APK" > "$OUT/aapt2-badging.txt" 2>&1
"$AAPT2" dump permissions "$APK" > "$OUT/aapt2-permissions.txt" 2>&1
"$AAPT2" dump resources "$APK" > "$OUT/aapt2-resources.txt" 2>&1
unzip -l "$APK" > "$OUT/apk-entries.txt"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
unzip -q -o "$APK" -d "$WORK/x"
: > "$OUT/classes.txt"
dex_files=0; dex_errors=0
for d in "$WORK"/x/classes*.dex; do
  [ -f "$d" ] || continue
  dex_files=$((dex_files + 1))
  # Native Windows tools need a Windows path (MSYS_NO_PATHCONV may disable conversion).
  dp=$d; command -v cygpath > /dev/null && dp=$(cygpath -m "$d")
  "$DEXDUMP" "$dp" > "$WORK/dexdump.txt" 2> "$WORK/dexdump.err" || dex_errors=$((dex_errors + 1))
  n=$(grep -c "Class descriptor" "$WORK/dexdump.txt" || true)
  [ "$n" -gt 0 ] || dex_errors=$((dex_errors + 1))
  grep -o "Class descriptor *: '[^']*'" "$WORK/dexdump.txt" | sed "s/.*'\(.*\)'/\1/" >> "$OUT/classes.txt"
done
sort -u -o "$OUT/classes.txt" "$OUT/classes.txt"
# Fail closed if the class inventory could not be read: an empty list would hide every class check.
[ "$dex_files" -gt 0 ] && [ "$dex_errors" -eq 0 ] && [ "$(wc -l < "$OUT/classes.txt")" -gt 0 ] || dex_errors=$((dex_errors + 1))
echo "dex_files=$dex_files dex_errors=$dex_errors" > "$OUT/dex-inventory.txt"

count() { grep -c "$1" "$2" || true; }
storage=$(count '^Lcom/penningtonlabs/baileyscart/core/storage/' "$OUT/classes.txt")
room=$(count '^Landroidx/room/' "$OUT/classes.txt")
sqlite=$(count '^Landroidx/sqlite/' "$OUT/classes.txt")
zetetic=$(count '^Lnet/zetetic/' "$OUT/classes.txt")
demo=$(count '^Lcom/penningtonlabs/baileyscart/demo/' "$OUT/classes.txt")
firebase=$(count '^Lcom/google/firebase/' "$OUT/classes.txt")
gms=$(count '^Lcom/google/android/gms/' "$OUT/classes.txt")
family=$(count '^Lcom/penningtonlabs/baileyscart/family/' "$OUT/classes.txt")
# Native libraries: only the allowlisted Compose library that the WP-00 release already ships.
grep -oE 'lib/[^[:space:]]+\.so$' "$OUT/apk-entries.txt" > "$OUT/native-libs.txt" || true
so=$(grep -cvE "^lib/[^/]+/(${ALLOWED_NATIVE_LIBS})$" "$OUT/native-libs.txt" || true)
sqlcipher_so=$(count 'libsqlcipher' "$OUT/apk-entries.txt")
internet=$(count 'android.permission.INTERNET' "$OUT/aapt2-permissions.txt")
netstate=$(count 'android.permission.ACCESS_NETWORK_STATE' "$OUT/aapt2-permissions.txt")

# Byte search of every extracted entry. UTF-8 directly; UTF-16LE by deleting NUL bytes first
# (ASCII text in UTF-16LE becomes plain ASCII). The NUL-stripped search can over-match, never
# under-match, so it fails closed. A grep error (exit 2) fails the check.
: > "$OUT/forbidden-strings.txt"
strings_hits=0; search_errors=0
for s in "${FORBIDDEN_STRINGS[@]}"; do
  n8=0; n16=0
  while IFS= read -r -d '' f; do
    LC_ALL=C grep -qaF -- "$s" "$f"; rc=$?
    [ $rc -eq 0 ] && n8=$((n8 + 1)); [ $rc -gt 1 ] && search_errors=$((search_errors + 1))
    tr -d '\000' < "$f" | LC_ALL=C grep -qaF -- "$s"; rc=$?
    [ $rc -eq 0 ] && n16=$((n16 + 1)); [ $rc -gt 1 ] && search_errors=$((search_errors + 1))
  done < <(find "$WORK/x" -type f -print0)
  echo "$s utf8_files=$n8 nul_stripped_files=$n16" >> "$OUT/forbidden-strings.txt"
  strings_hits=$((strings_hits + n8 + n16))
done
echo "search_errors=$search_errors" >> "$OUT/forbidden-strings.txt"
strings_hits=$((strings_hits + search_errors))

# Shared and release source sets must not reference storage or the demo identity.
src_hits=$(grep -rlE 'core\.storage|demo\.persist|FakeVerifiedSession|demo-local-list-e11a|com\.google\.firebase|baileyscart\.family|10\.0\.2\.2' \
  "$REPO/android/app/src/main" "$REPO/android/app/src/release" 2>/dev/null | tee "$OUT/source-set-hits.txt" | wc -l)

sha_ok=true
actual_sha=$(cut -d' ' -f1 "$OUT/apk.sha256")
if [ -n "$EXPECTED_SHA" ] && [ "$actual_sha" != "$EXPECTED_SHA" ]; then sha_ok=false; fi

v=PASS
[ $((storage + room + sqlite + zetetic + demo + so + sqlcipher_so + internet + strings_hits + src_hits + dex_errors)) -eq 0 ] || v=FAIL
[ $((firebase + gms + family + netstate)) -eq 0 ] || v=FAIL
$sha_ok || v=FAIL
echo "dex_errors=$dex_errors classes=$(wc -l < "$OUT/classes.txt") storage=$storage room=$room androidx_sqlite=$sqlite sqlcipher=$zetetic demo=$demo" \
  "| firebase=$firebase gms=$gms family=$family ACCESS_NETWORK_STATE=$netstate | unexpected_native_so=$so libsqlcipher_so=$sqlcipher_so | INTERNET=$internet | e11a_strings=$strings_hits | main_release_src_refs=$src_hits" \
  "| sha256=$actual_sha expected=${EXPECTED_SHA:-none} | VERDICT=$v" | tee "$OUT/verdict.txt"
[ "$v" = PASS ]
