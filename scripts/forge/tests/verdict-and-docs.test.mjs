// FORGE-FP-01: path verdict (every FAST/FULL x job-result combination that must fail) and the
// documentation structure check. Node built-ins only.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMarkdown } from '../docs-check.mjs';
import { FULL_ONLY_JOBS, verdict } from '../path-verdict.mjs';

const VERDICT_CLI = fileURLToPath(new URL('../path-verdict.mjs', import.meta.url));
const needs = (path, result, classifyResult = 'success') => ({
  classify: { result: classifyResult, outputs: path === undefined ? {} : { path, reason: 'x' } },
  ...Object.fromEntries(FULL_ONLY_JOBS.map((j) => [j, { result, outputs: {} }])),
});

describe('path verdict', () => {
  test('FAST with all FULL-only jobs skipped, FULL with all succeeded -> pass', () => {
    assert.equal(verdict(needs('FAST', 'skipped')).ok, true);
    assert.equal(verdict(needs('FULL', 'success')).ok, true);
  });

  test('any FULL-only failure, cancellation or skip on FULL -> fail', () => {
    for (const r of ['failure', 'cancelled', 'skipped', '', undefined]) {
      for (const j of FULL_ONLY_JOBS) {
        const n = needs('FULL', 'success');
        n[j] = { result: r };
        assert.equal(verdict(n).ok, false, `${j}=${r}`);
      }
    }
  });

  test('FAST but a FULL-only job ran (success, failure or cancelled) -> fail', () => {
    for (const r of ['success', 'failure', 'cancelled']) {
      const n = needs('FAST', 'skipped');
      n.backend = { result: r };
      assert.equal(verdict(n).ok, false, r);
    }
  });

  test('missing or invalid classification, failed classify, malformed needs -> fail', () => {
    assert.equal(verdict(needs(undefined, 'skipped')).ok, false, 'missing classifier output');
    assert.equal(verdict(needs('', 'skipped')).ok, false);
    assert.equal(verdict(needs('fast', 'skipped')).ok, false);
    assert.equal(verdict(needs('MAYBE', 'success')).ok, false);
    for (const cr of ['failure', 'cancelled', 'skipped']) assert.equal(verdict(needs('FAST', 'skipped', cr)).ok, false, cr);
    assert.equal(verdict(null).ok, false);
    assert.equal(verdict([]).ok, false);
    const missing = needs('FULL', 'success');
    delete missing['backend-emulator'];
    assert.equal(verdict(missing).ok, false, 'missing job');
    const extra = { ...needs('FULL', 'success'), surprise: { result: 'success' } };
    assert.equal(verdict(extra).ok, false, 'unexpected job');
    const noClassify = needs('FULL', 'success');
    delete noClassify.classify;
    assert.equal(verdict(noClassify).ok, false);
  });

  test('CLI exit codes, including unparsable and absent input', () => {
    const run = (json) => {
      try {
        execFileSync(process.execPath, [VERDICT_CLI], {
          env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...(json === undefined ? {} : { FORGE_NEEDS_JSON: json }) },
          stdio: 'pipe',
        });
        return 0;
      } catch (e) {
        return e.status;
      }
    };
    assert.equal(run(JSON.stringify(needs('FAST', 'skipped'))), 0);
    assert.equal(run(JSON.stringify(needs('FULL', 'success'))), 0);
    assert.equal(run(JSON.stringify(needs('FULL', 'failure'))), 1);
    assert.equal(run(JSON.stringify(needs(undefined, 'skipped'))), 1);
    assert.equal(run('{not json'), 1);
    assert.equal(run(''), 1);
    assert.equal(run(undefined), 1);
  });
});

describe('Markdown structure check', () => {
  const ok = (t) => checkMarkdown('t.md', Buffer.from(t));
  test('valid documents pass', () => {
    assert.deepEqual(ok('# T\n\n| a | b |\n|---|---|\n| 1 | `x|y` |\n| 2 | a \\| b |\n\n```\n| not | a | table |\n```\n'), []);
    assert.deepEqual(ok('~~~~\ncode\n~~~~\n'), []);
  });
  test('broken tables, unclosed fences, invalid UTF-8 and NUL bytes fail', () => {
    assert.equal(ok('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n').length, 1);
    assert.equal(ok('```\nnever closed\n').length, 1);
    assert.equal(ok('````\n```\n').length, 1, 'a shorter fence does not close a longer one');
    assert.equal(checkMarkdown('t.md', Buffer.from([0xc3, 0x28])).length, 1);
    assert.equal(checkMarkdown('t.md', Buffer.from('a\0b')).length, 1);
  });
});
