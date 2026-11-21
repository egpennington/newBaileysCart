// FORGE-FP-01 workflow structure test. Parses .github/workflows/forge-wp00.yml (yaml package from
// backend/functions, installed by npm ci) and asserts the fast-path wiring cannot silently skip
// required work: the gate identity, its needs, the conditional FULL-only jobs, the always-run path
// verification, unchanged triggers, and no path filters.
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FULL_ONLY_JOBS } from '../path-verdict.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(`${root}backend/functions/package.json`);
const YAML = require('yaml');
const text = fs.readFileSync(`${root}.github/workflows/forge-wp00.yml`, 'utf8');
const doc = YAML.parseDocument(text, { uniqueKeys: true, strict: true });
const wf = doc.toJS();
const jobs = wf.jobs;
const asList = (n) => (n === undefined ? [] : Array.isArray(n) ? n : [n]);
const FULL_IF = "needs.classify.outputs.path == 'FULL'";
const ALWAYS_JOBS = ['classify', 'docs-validate', 'wrapper-validation', 'dependency-audit', 'secrets', 'firebase-guard'];

describe('FORGE workflow wiring (FORGE-FP-01)', () => {
  test('parses strictly', () => {
    assert.deepEqual(doc.errors, []);
    assert.deepEqual(doc.warnings, []);
  });

  test('triggers: integration-branch pushes, PRs into main/develop, manual; no path filters anywhere', () => {
    // BC-FORGE-R1: feature/** and fix/** pushes removed; PR runs supply the required check.
    assert.deepEqual(wf.on.push.branches, ['develop', 'main']);
    assert.deepEqual(Object.keys(wf.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
    assert.equal(wf.on.push.tags, undefined);
    assert.equal(wf.on.pull_request.types, undefined);
    assert.deepEqual(wf.on.pull_request.branches, ['main', 'develop']);
    assert.ok('workflow_dispatch' in wf.on);
    assert.doesNotMatch(text, /paths-ignore|^\s+paths:/m);
    assert.doesNotMatch(text, /skip[- ]ci|\[skip/i);
  });

  test('FORGE gate keeps its identity and needs every always-run job plus path verification', () => {
    const g = jobs['forge-gate'];
    assert.equal(g.name, 'FORGE gate');
    assert.equal(g.if, 'always()');
    assert.deepEqual([...asList(g.needs)].sort(), [...ALWAYS_JOBS, 'path-verdict'].sort());
    assert.equal(g['continue-on-error'], undefined);
  });

  test('FULL-only jobs run exactly when classify says FULL, and path verification covers all of them', () => {
    const conditional = Object.entries(jobs).filter(([, j]) => j.if === FULL_IF).map(([k]) => k).sort();
    assert.deepEqual(conditional, [...FULL_ONLY_JOBS].sort());
    for (const k of FULL_ONLY_JOBS) assert.ok(asList(jobs[k].needs).includes('classify'), `${k} needs classify`);
    const pv = jobs['path-verdict'];
    assert.equal(pv.name, 'Path verification');
    assert.equal(pv.if, 'always()');
    assert.deepEqual([...asList(pv.needs)].sort(), ['classify', ...FULL_ONLY_JOBS].sort());
    assert.match(JSON.stringify(pv.steps), /toJSON\(needs\)/);
  });

  test('every job is checked by the gate directly or through path verification; always-run jobs are unconditional', () => {
    const covered = new Set(['forge-gate', ...asList(jobs['forge-gate'].needs), ...asList(jobs['path-verdict'].needs)]);
    for (const k of Object.keys(jobs)) assert.ok(covered.has(k), `job ${k} is not checked by the gate`);
    for (const k of ALWAYS_JOBS) {
      assert.equal(jobs[k].if, undefined, `${k} must not be conditional`);
      assert.equal(jobs[k]['continue-on-error'], undefined, `${k} must not continue on error`);
    }
    for (const [k, j] of Object.entries(jobs)) {
      assert.equal(j['continue-on-error'], undefined, `${k}`);
      for (const s of j.steps ?? []) assert.equal(s['continue-on-error'], undefined, `${k} step ${s.name ?? s.uses}`);
    }
  });

  test('classify reads only event context, with full history, and runs the in-repo classifier', () => {
    const c = jobs.classify;
    const steps = c.steps;
    assert.equal(steps[0].with['fetch-depth'], 0);
    assert.equal(steps[0].with['persist-credentials'], false);
    const step = steps.find((s) => s.id === 'classify');
    assert.ok(step && /node scripts\/forge\/classify\.mjs/.test(step.run));
    assert.equal(c.outputs.path, '${{ steps.classify.outputs.path }}');
    assert.doesNotMatch(JSON.stringify(step.env), /label|head_commit|title|body/i, 'no user-controlled hints');
  });

  test('docs-validate runs the self-tests, Markdown check and Verity check on every path', () => {
    const runs = jobs['docs-validate'].steps.map((s) => s.run ?? '').join('\n');
    assert.match(runs, /node --test "scripts\/forge\/tests\/\*\.test\.mjs"/);
    assert.match(runs, /node scripts\/forge\/docs-check\.mjs/);
    assert.match(runs, /node scripts\/verity-check\.cjs/);
  });

  test('third-party actions remain pinned by commit SHA', () => {
    for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  });

  // BC-GRADLE-DIAG-01 (temporary diagnostic): the probe cannot gate or skip the build, the Gradle
  // commands keep their task lists and exit codes, and diagnostics upload even when the build fails.
  test('Gradle diagnostics are nonblocking and leave the Android builds intact (BC-GRADLE-DIAG-01)', () => {
    const PROBE = 'Probe Maven Central (Kotlin JVM marker, diagnostic)';
    const builds = {
      // BC-GRADLE-429-R1: Gradle now runs through gradle-retry-429.sh, which writes the same "$log".
      android: { step: 'Build, lint, unit tests', cmds: [/bash \.\.\/scripts\/forge\/gradle-retry-429\.sh "\$log" -- \.\/gradlew assembleDebug assembleRelease test lint --no-daemon --stacktrace --info \|\| rc=\$\?/, /exit "\$rc"/] },
      'repeat-build': { step: 'Two independent clean builds', cmds: [/set -euo pipefail/, /gw "run\$run-clean\.info\.log" clean --no-daemon/, /gw "run\$run-build\.info\.log" :app:assembleRelease :core:model:jar --no-daemon --no-build-cache --rerun-tasks/, /bash \.\.\/scripts\/forge\/gradle-retry-429\.sh "\$log" -- \.\/gradlew "\$@" --info \|\| rc=\$\?/, /return "\$rc"/] },
    };
    for (const [k, { step, cmds }] of Object.entries(builds)) {
      const steps = jobs[k].steps;
      const p = steps.findIndex((s) => s.name === PROBE);
      const b = steps.findIndex((s) => s.name === step);
      assert.ok(p >= 0 && b === p + 1, `${k}: probe runs immediately before "${step}"`);
      assert.deepEqual(Object.keys(steps[p]).sort(), ['name', 'run'], `${k}: probe has only name and run`);
      assert.match(steps[p].run, /^PROBE_LABEL=[a-z-]+ bash \.\.\/scripts\/forge\/diag\/probe-kotlin-marker\.sh "\$RUNNER_TEMP\/gradle-diag"$/);
      assert.equal(steps[b].if, undefined, `${k}: build step is unconditional`);
      for (const re of cmds) assert.match(steps[b].run, re, `${k}: ${re}`);
      const up = steps.find((s) => s.with?.name === `gradle-diagnostics-${k}`);
      assert.ok(up, `${k}: diagnostics upload step`);
      assert.equal(up.if, 'always()');
      assert.equal(up.with['if-no-files-found'], 'ignore');
    }
    const script = fs.readFileSync(`${root}scripts/forge/diag/probe-kotlin-marker.sh`, 'utf8');
    assert.match(script, /\} \|\| true\r?\nexit 0\r?\n$/, 'probe always exits 0');
    assert.doesNotMatch(script, /--user\b|--netrc|--header\b|\s-H\s|Authorization|GITHUB_TOKEN|secrets\./i, 'probe sends no credentials');
  });

  // BC-GRADLE-429-R1 (PL-PP-WP00-07): every Gradle build invocation in the two Gradle jobs goes through
  // the bounded-retry wrapper exactly once; caching stays disabled; nothing can skip or soften a failure.
  test('Gradle builds use the bounded 429 retry wrapper; caching stays disabled (BC-GRADLE-429-R1)', () => {
    const WRAP = 'bash ../scripts/forge/gradle-retry-429.sh "$log" -- ./gradlew ';
    const builds = { android: 'Build, lint, unit tests', 'repeat-build': 'Two independent clean builds' };
    for (const [k, name] of Object.entries(builds)) {
      const steps = jobs[k].steps;
      const sg = steps.filter((s) => typeof s.uses === 'string' && s.uses.startsWith('gradle/actions/setup-gradle@'));
      assert.equal(sg.length, 1, `${k}: one setup-gradle`);
      assert.deepEqual(sg[0].with, { 'cache-disabled': true }, `${k}: caching disabled`);
      for (const s of steps) {
        assert.equal(s['continue-on-error'], undefined, `${k}: no continue-on-error`);
        assert.ok(!s.uses?.startsWith('actions/cache'), `${k}: no actions/cache`);
      }
      assert.equal(jobs[k]['continue-on-error'], undefined, `${k}: job has no continue-on-error`);
      const run = steps.find((s) => s.name === name).run;
      assert.equal(run.split(WRAP).length - 1, 1, `${k}: exactly one wrapped Gradle invocation`);
      const direct = run.split('\n').filter((l) => /\.\/gradlew\b/.test(l) && !l.includes(WRAP));
      assert.deepEqual(direct, [], `${k}: no unwrapped Gradle build invocation`);
    }
    assert.doesNotMatch(text, /FORGE_RETRY_SLEEP/, 'the workflow never overrides the retry sleep');
    assert.doesNotMatch(text, /gradle-retry-429\.sh[^\n]*\|\| true/, 'the wrapper exit code is never discarded');
  });
});
