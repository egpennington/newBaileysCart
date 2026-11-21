// BC-GRADLE-429-R1 (PL-PP-WP00-07) behaviour tests for scripts/forge/gradle-retry-429.sh.
// Gradle is replaced by a stub that replays one fixture log and exit code per call; the sleep command
// is replaced by a stub that records the requested delay. Each test gets its own RUNNER_TEMP, which
// is what scopes the one-retry budget to a job.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = path.join(root, 'scripts/forge/gradle-retry-429.sh');
const REAL_429 = fs.readFileSync(path.join(root, 'scripts/forge/tests/fixtures/gradle-429/android-build-429.info.log'), 'utf8');
const posix = (p) => p.replace(/\\/g, '/');

const CENTRAL_429 = 'Failed to get resource: GET. [HTTP 429: https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/jvm/org.jetbrains.kotlin.jvm.gradle.plugin/2.4.10/org.jetbrains.kotlin.jvm.gradle.plugin-2.4.10.pom)]';
const FAIL_TAIL = 'FAILURE: Build failed with an exception.\n\nBUILD FAILED in 17s\n';
const OK = '> Configure project :\n> Task :core:model:compileKotlin\n> Task :core:model:jar\n\nBUILD SUCCESSFUL in 51s\n';
const FIX = {
  compileFailure: `> Configure project :\n> Task :core:model:compileKotlin FAILED\ne: file:///w/android/core/model/src/main/kotlin/X.kt:3:5 Unresolved reference 'y'.\n${FAIL_TAIL}`,
  testFailure: `> Configure project :\n> Task :app:compileDebugKotlin\n> Task :app:testDebugUnitTest FAILED\nAppModuleGraphTest > graph FAILED\nThere were failing tests. See the report at: file:///w/android/app/build/reports/tests/index.html\n${FAIL_TAIL}`,
  verification: `> Configure project :\nDependency verification failed for configuration ':app:debugRuntimeClasspath'\nOne artifact failed verification: kotlin-stdlib-2.4.10.jar (org.jetbrains.kotlin:kotlin-stdlib:2.4.10) from repository MavenRepo\n${FAIL_TAIL}`,
  verificationPlus429: `${CENTRAL_429}\n${CENTRAL_429}\nDependency verification failed for configuration 'classpath'\n${FAIL_TAIL}`,
  after429Task: `> Configure project :\n> Task :app:preBuild UP-TO-DATE\n> Task :app:lintAnalyzeDebug\n${CENTRAL_429}\nCould not resolve all files for configuration ':app:lintChecks'.\n${FAIL_TAIL}`,
  google429: `Failed to get resource: GET. [HTTP 429: https://dl.google.com/dl/android/maven2/com/android/application/com.android.application.gradle.plugin/9.4.0/com.android.application.gradle.plugin-9.4.0.pom)]\n${FAIL_TAIL}`,
  portal429: `Failed to get resource: GET. [HTTP 429: https://plugins.gradle.org/m2/org/jetbrains/kotlin/jvm/org.jetbrains.kotlin.jvm.gradle.plugin/2.4.10/org.jetbrains.kotlin.jvm.gradle.plugin-2.4.10.pom)]\n${FAIL_TAIL}`,
  success429: `${CENTRAL_429}\nResolved plugin [id: 'org.jetbrains.kotlin.jvm', version: '2.4.10', apply: false]\n> Task :core:model:jar\nBUILD SUCCESSFUL in 40s\n`,
  generic: `> Configure project :\nFAILURE: Build failed with an exception.\n* What went wrong:\nSDK location not found.\n${FAIL_TAIL}`,
};

function job() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-retry429-'));
  const temp = path.join(dir, 'runner-temp');
  const diag = path.join(temp, 'gradle-diag');
  fs.mkdirSync(diag, { recursive: true });
  const stub = path.join(dir, 'gradle-stub.sh');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env bash',
    'n=$(( $(cat "$STUB_DIR/count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_DIR/count"',
    'echo "$*" >> "$STUB_DIR/args"',
    'cat "$STUB_DIR/call-$n.log"; exit "$(cat "$STUB_DIR/call-$n.rc")"',
    '',
  ].join('\n'));
  const sleep = path.join(dir, 'sleep-stub.sh');
  // The wrapper executes FORGE_RETRY_SLEEP directly, so the stub needs the execute bit on POSIX
  // runners (Windows/Git Bash runs it regardless). The fail-closed test rewrites this file in place,
  // which keeps the mode.
  fs.writeFileSync(sleep, '#!/usr/bin/env bash\necho "$1" >> "$STUB_DIR/slept"\n', { mode: 0o755 });
  let queued = 0;
  const j = {
    dir, diag,
    // Queue the stub's responses: each entry is [log text, exit code] for the next Gradle call.
    queue(...calls) { for (const [log, rc] of calls) { queued += 1; fs.writeFileSync(path.join(dir, `call-${queued}.log`), log); fs.writeFileSync(path.join(dir, `call-${queued}.rc`), String(rc)); } return j; },
    run(logName, args = ['assembleRelease', '--info']) {
      const r = spawnSync('bash', [posix(SCRIPT), posix(path.join(diag, logName)), '--', 'bash', posix(stub), ...args], {
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: posix(temp), STUB_DIR: posix(dir), FORGE_RETRY_SLEEP: posix(sleep), GITHUB_STEP_SUMMARY: posix(path.join(dir, 'summary.md')) },
      });
      return { rc: r.status, out: r.stdout + r.stderr };
    },
    calls: () => Number(read(path.join(dir, 'count')) || 0),
    slept: () => (read(path.join(dir, 'slept')) || '').split('\n').filter(Boolean),
    marker: () => fs.existsSync(path.join(diag, 'retry-429.used')),
    record: () => read(path.join(diag, 'retry-429.txt')) || '',
    summary: () => read(path.join(dir, 'summary.md')) || '',
    log: (name) => read(path.join(diag, name)),
  };
  return j;
}
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

function assertNoRetry(j, r, rc, logText, logName = 'b.info.log') {
  assert.equal(r.rc, rc, 'exit code passed through unchanged');
  assert.equal(j.calls(), 1, 'Gradle invoked exactly once');
  assert.deepEqual(j.slept(), [], 'no sleep');
  assert.equal(j.marker(), false, 'retry budget untouched');
  assert.equal(j.log(`${logName}.attempt1`), null, 'no .attempt1 log');
  assert.equal(j.log(logName), logText, 'log holds the only attempt, unchanged');
  assert.doesNotMatch(r.out, /BC-GRADLE-429-R1/, 'no retry annotation');
}

describe('gradle-retry-429.sh (BC-GRADLE-429-R1)', () => {
  test('positive: the real FORGE 429 log is retried once after exactly 120 s, with full evidence', () => {
    const j = job().queue([REAL_429, 1], [OK, 0]);
    const r = j.run('android-build.info.log');
    assert.equal(r.rc, 0, 'final exit code is the second attempt');
    assert.equal(j.calls(), 2);
    assert.deepEqual(j.slept(), ['120']);
    assert.equal(j.marker(), true, 'retry budget spent');
    assert.equal(j.log('android-build.info.log.attempt1'), REAL_429, 'first attempt preserved byte for byte');
    assert.equal(j.log('android-build.info.log'), OK, 'log holds the final attempt');
    assert.match(r.out, /::warning title=BC-GRADLE-429-R1 retry::Maven Central returned HTTP 429 before any task ran \(android-build\.info\.log, exit 1\)/);
    assert.match(r.out, /::warning title=BC-GRADLE-429-R1 retry result::android-build\.info\.log second attempt exited 0; this result is final\./);
    assert.match(j.record(), /log=android-build\.info\.log decision=retry attempt1_exit=1 delay_seconds=120/);
    assert.match(j.record(), /matched=Failed to get resource: GET\. \[HTTP 429: https:\/\/repo\.maven\.apache\.org\/maven2\//);
    assert.match(j.record(), /decision=final attempt2_exit=0/);
    assert.match(j.summary(), /BC-GRADLE-429-R1: `android-build\.info\.log` hit Maven Central HTTP 429/);
  });

  test('the same arguments are passed to both attempts', () => {
    const j = job().queue([REAL_429, 1], [OK, 0]);
    j.run('b.info.log', [':app:assembleRelease', ':core:model:jar', '--no-daemon', '--no-build-cache', '--rerun-tasks', '--info']);
    const args = read(path.join(j.dir, 'args')).trim().split('\n');
    assert.equal(args.length, 2);
    assert.equal(args[0], args[1]);
    assert.equal(args[0], ':app:assembleRelease :core:model:jar --no-daemon --no-build-cache --rerun-tasks --info');
  });

  for (const rc of [0, 1, 7]) {
    test(`at most one retry: the second attempt's exit code ${rc} is final, even after another 429`, () => {
      const j = job().queue([REAL_429, 1], [rc === 0 ? OK : REAL_429, rc], [OK, 0]);
      const r = j.run('b.info.log');
      assert.equal(r.rc, rc);
      assert.equal(j.calls(), 2, 'never a third attempt');
      assert.deepEqual(j.slept(), ['120']);
    });
  }

  const negatives = [
    ['T3: ordinary compilation failure', FIX.compileFailure, 1],
    ['T3: failed unit tests', FIX.testFailure, 1],
    ['T4: dependency verification failure', FIX.verification, 1],
    ['T4: dependency verification failure alongside a Maven Central 429', FIX.verificationPlus429, 1],
    ['T3: Maven Central 429 after tasks started', FIX.after429Task, 1],
    ['T2: HTTP 429 from Google Maven', FIX.google429, 1],
    ['T2: HTTP 429 from the Gradle Plugin Portal', FIX.portal429, 1],
    ['T2: generic configuration failure without 429', FIX.generic, 1],
    ['T1: successful build that logged a Maven Central 429', FIX.success429, 0],
    ['T1 alone: successful build with a Maven Central 429 and no task started', `${CENTRAL_429}\nBUILD SUCCESSFUL in 3s\n`, 0],
    ['exit code 7 is passed through for a compilation failure', FIX.compileFailure, 7],
  ];
  for (const [name, text, rc] of negatives) {
    test(`no retry - ${name}`, () => {
      const j = job().queue([text, rc], [OK, 0]);
      assertNoRetry(j, j.run('b.info.log'), rc, text);
    });
  }

  test('one retry per job across the four repeat-build invocations (429 on calls 1 and 3)', () => {
    // Mirrors gw under set -e: run1 clean, run1 build, run2 clean, run2 build; the step stops at the first failure.
    const j = job().queue([REAL_429, 1], [OK, 0], [OK, 0], [REAL_429, 1], [OK, 0]);
    const seq = ['run1-clean.info.log', 'run1-build.info.log', 'run2-clean.info.log', 'run2-build.info.log'];
    const results = [];
    for (const name of seq) { const r = j.run(name); results.push([name, r]); if (r.rc !== 0) break; }
    assert.deepEqual(results.map(([n, r]) => [n, r.rc]), [['run1-clean.info.log', 0], ['run1-build.info.log', 0], ['run2-clean.info.log', 1]]);
    assert.equal(j.calls(), 4, 'call 1, its single retry, call 2, call 3; no retry of call 3');
    assert.deepEqual(j.slept(), ['120'], 'slept once for the whole job');
    assert.equal(j.log('run1-clean.info.log.attempt1'), REAL_429);
    assert.equal(j.log('run2-clean.info.log.attempt1'), null);
    assert.equal(j.log('run2-clean.info.log'), REAL_429, 'unretried failure log kept as is');
    assert.match(results[2][1].out, /::warning title=BC-GRADLE-429-R1 retry budget spent::run2-clean\.info\.log hit Maven Central HTTP 429 again, but this job already used its one retry \(exit 1\)\./);
    assert.match(j.record(), /log=run2-clean\.info\.log decision=no-retry-budget-spent exit=1/);
  });

  test('fail closed: if the delay fails, there is no retry and the first exit code stands', () => {
    const j = job().queue([REAL_429, 1], [OK, 0]);
    fs.writeFileSync(path.join(j.dir, 'sleep-stub.sh'), '#!/usr/bin/env bash\necho "$1" >> "$STUB_DIR/slept"\nexit 1\n');
    const r = j.run('b.info.log');
    assert.equal(r.rc, 1);
    assert.equal(j.calls(), 1, 'no second attempt without the delay');
    assert.deepEqual(j.slept(), ['120']);
    assert.equal(j.log('b.info.log'), REAL_429, 'first attempt log left in place');
    assert.equal(j.log('b.info.log.attempt1'), null);
    assert.equal(j.marker(), true, 'budget still counts as spent');
    assert.match(r.out, /::warning title=BC-GRADLE-429-R1 retry abandoned::/);
    assert.match(j.record(), /decision=no-retry-delay-failed exit=1/);
  });

  test('a retry marker left by an earlier invocation blocks any retry', () => {
    const j = job().queue([REAL_429, 1], [OK, 0]);
    fs.mkdirSync(path.join(j.diag, 'retry-429.used'));
    const r = j.run('b.info.log');
    assert.equal(r.rc, 1);
    assert.equal(j.calls(), 1);
    assert.deepEqual(j.slept(), []);
    assert.equal(j.log('b.info.log.attempt1'), null);
    assert.match(r.out, /retry budget spent/);
  });

  test('usage errors fail closed (exit 2) without running anything', () => {
    for (const args of [[], ['x.log'], ['x.log', 'bash', 'stub'], ['x.log', '--']]) {
      const r = spawnSync('bash', [posix(SCRIPT), ...args], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: posix(os.tmpdir()) } });
      assert.equal(r.status, 2, JSON.stringify(args));
    }
    const r = spawnSync('bash', [posix(SCRIPT), 'x.log', '--', 'true'], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: '' } });
    assert.notEqual(r.status, 0, 'RUNNER_TEMP is required');
  });

  test('static: fixed 120 s delay, no network access, exact T2 pattern, exit code is the final attempt', () => {
    const s = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(s, /^readonly DELAY_SECONDS=120$/m);
    assert.equal((s.match(/DELAY_SECONDS=/g) || []).length, 1, 'delay assigned once');
    assert.match(s, /^readonly T2_RE='\^Failed to get resource: \(GET\|HEAD\)\\\. \\\[HTTP 429: https:\/\/repo\\\.maven\\\.apache\\\.org\/maven2\/'$/m);
    assert.doesNotMatch(s, /\b(curl|wget|nc|ssh)\b|\/dev\/tcp/, 'no network tools');
    assert.doesNotMatch(s, /Retry-After|retry-after|probe/i, 'does not read probe output or Retry-After');
    assert.match(s, /\nexit "\$rc"\n$/, 'exits with the final attempt code');
    assert.doesNotMatch(s, /\|\| true/, 'never discards an exit code');
  });
});
