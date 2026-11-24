// BC-CI-429-REL-01 (PL-PP-WP00-08): content tests for scripts/forge/gradle/central-mirror.init.gradle and
// behaviour tests for scripts/forge/gradle/routing-summary.sh. Gradle itself is not run here; the
// routing, checksum and fail-closed controls with a real Gradle build are local evidence in PL-PP-WP00-08.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const INIT = fs.readFileSync(path.join(root, 'scripts/forge/gradle/central-mirror.init.gradle'), 'utf8');
const SUMMARY = path.join(root, 'scripts/forge/gradle/routing-summary.sh');
const REAL_429 = fs.readFileSync(path.join(root, 'scripts/forge/tests/fixtures/gradle-429/android-build-429.info.log'), 'utf8');
const SETTINGS = fs.readFileSync(path.join(root, 'android/settings.gradle.kts'), 'utf8');
const VERIFY = fs.readFileSync(path.join(root, 'android/gradle/verification-metadata.xml'), 'utf8');
const posix = (p) => p.replace(/\\/g, '/');
// Code only: comment lines removed, so the header cannot satisfy or trip the checks below.
const code = INIT.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CENTRAL = 'https://repo.maven.apache.org/maven2/';
const MIRROR = 'https://maven-central.storage-download.googleapis.com/maven2/';
const MARKER = `BC-CI-429-REL-01: Maven Central routed to ${MIRROR} (3 repositories)`;
const MIRROR_OK = [
  MARKER,
  `Downloading ${MIRROR}org/jetbrains/kotlin/jvm/org.jetbrains.kotlin.jvm.gradle.plugin/2.4.10/org.jetbrains.kotlin.jvm.gradle.plugin-2.4.10.pom to /home/runner/.gradle/.tmp/gradle_download1bin`,
  `Downloading ${MIRROR}org/jetbrains/kotlin/kotlin-stdlib/2.4.10/kotlin-stdlib-2.4.10.jar to /home/runner/.gradle/.tmp/gradle_download2bin`,
  'Downloading https://dl.google.com/dl/android/maven2/com/android/application/com.android.application.gradle.plugin/9.4.0/com.android.application.gradle.plugin-9.4.0.pom to /home/runner/.gradle/.tmp/gradle_download3bin',
  '> Task :core:model:jar',
  'BUILD SUCCESSFUL in 51s',
  '',
].join('\n');

function summarize(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mirror-'));
  const diag = path.join(dir, 'gradle-diag');
  fs.mkdirSync(diag);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(diag, name), body);
  const summary = path.join(dir, 'summary.md');
  const r = spawnSync('bash', [posix(SUMMARY), posix(diag), 'android'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: posix(summary) },
  });
  return { status: r.status, out: r.stdout + r.stderr, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
}

describe('central-mirror.init.gradle (BC-CI-429-REL-01)', () => {
  test('redirects only Maven Central, to the pinned mirror', () => {
    assert.match(code, new RegExp(`^final String CENTRAL = '${CENTRAL.replace(/[./]/g, '\\$&')}'$`, 'm'));
    assert.match(code, new RegExp(`^final String MIRROR = '${MIRROR.replace(/[./]/g, '\\$&')}'$`, 'm'));
    assert.equal(code.split('repo.url = MIRROR').length - 1, 1, 'exactly one URL assignment');
    assert.equal(code.split('repo.url =').length - 1, 1, 'no other URL assignment');
    assert.match(code, /if \(norm\(repo\.url\) == CENTRAL\) \{\s*repo\.url = MIRROR/, 'only a Maven Central URL is replaced');
    assert.match(code, /settings\.pluginManagement\.repositories, settings\.dependencyResolutionManagement\.repositories/);
  });

  test('adds, removes and reorders nothing; no caching, offline, verification or lock change', () => {
    for (const re of [/mavenCentral\(|google\(|gradlePluginPortal\(|mavenLocal\(|maven\s*[({]|ivy\s*[({]|flatDir/,
      /\.(add|remove|removeAll|clear|addFirst|addLast)\s*\(/, /exclusiveContent|content\s*\{|filter\s*\{/,
      /cach|offline|verification|verify|lock|buildCache|startParameter|allprojects|buildscript/i,
      /System\.(getenv|getProperty)|project\.findProperty/]) {
      assert.doesNotMatch(code, re, `forbidden in the init script: ${re}`);
    }
  });

  test('fails closed when any repository still points at Maven Central, and prints the routing line', () => {
    assert.match(code, /gradle\.settingsEvaluated \{/);
    assert.match(code, /if \(norm\(repo\.url\) == CENTRAL\) \{\s*throw new GradleException\("BC-CI-429-REL-01: repository '\$\{repo\.name\}' still points at Maven Central"\)/);
    assert.match(code, /println "BC-CI-429-REL-01: Maven Central routed to \$\{MIRROR\} \(\$\{routed\} repositories\)"/);
  });

  test('the restrictions the script relies on are still declared in the build', () => {
    assert.match(SETTINGS, /exclusiveContent \{\s*forRepository \{ mavenCentral\(\) \}\s*filter \{\s*includeGroup\("org\.jetbrains\.kotlin\.jvm"\)\s*includeGroup\("org\.jetbrains\.kotlin\.plugin\.compose"\)/);
    assert.match(SETTINGS, /repositoriesMode\.set\(RepositoriesMode\.FAIL_ON_PROJECT_REPOS\)/);
    assert.match(VERIFY, /<verify-metadata>true<\/verify-metadata>/);
  });
});

describe('routing-summary.sh (BC-CI-429-REL-01)', () => {
  test('mirror-routed logs: zero Maven Central requests, no warning, exit 0', () => {
    const r = summarize({ 'android-build.info.log': MIRROR_OK, 'android.txt': `url=${CENTRAL}x.pom\nhttp_code=429\n` });
    assert.equal(r.status, 0);
    assert.match(r.summary, /Gradle --info logs: 1; logs with the mirror routing line: 1\./);
    assert.match(r.summary, /2 Downloading https:\/\/maven-central\.storage-download\.googleapis\.com/);
    assert.match(r.summary, /1 Downloading https:\/\/dl\.google\.com/);
    assert.match(r.summary, /Gradle requests to repo\.maven\.apache\.org: 0/);
    assert.doesNotMatch(r.out, /::warning/);
  });

  test('the real FORGE 429 log: Maven Central requests counted and flagged, still exit 0', () => {
    const r = summarize({ 'android-build.info.log': REAL_429, 'android-build.info.log.attempt1': REAL_429 });
    assert.equal(r.status, 0);
    assert.match(r.summary, /Gradle requests to repo\.maven\.apache\.org: 6/);
    assert.match(r.summary, /6 Failed to get resource: GET\. \[HTTP 429: https:\/\/repo\.maven\.apache\.org/);
    assert.match(r.out, /::warning title=BC-CI-429-REL-01 routing::android: Gradle made 6 request\(s\) to repo\.maven\.apache\.org/);
    assert.match(r.out, /::warning title=BC-CI-429-REL-01 routing::android: 0 of 2 Gradle logs show the mirror routing line/);
  });

  test('the diagnostic probe file is never counted as Gradle traffic', () => {
    const r = summarize({ 'android.txt': `Failed to get resource: GET. [HTTP 429: ${CENTRAL}x.pom)]\n` });
    assert.equal(r.status, 0);
    assert.match(r.summary, /Gradle --info logs: 0;/);
    assert.match(r.summary, /Gradle requests to repo\.maven\.apache\.org: 0/);
  });

  test('a missing folder still exits 0', () => {
    const r = spawnSync('bash', [posix(SUMMARY), '/nonexistent/gradle-diag', 'repeat-build'], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    assert.equal(r.status, 0);
  });
});
