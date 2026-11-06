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

  test('triggers unchanged; no path filters anywhere', () => {
    assert.deepEqual(wf.on.push.branches, ['feature/**', 'fix/**', 'develop', 'main']);
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
});
