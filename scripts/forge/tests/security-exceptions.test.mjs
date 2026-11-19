// BC-SEC-REMEDIATE-01 security gate boundary tests (supersede the BC-SEC-FORGE-22 exception tests).
//
// Part 1 exercises scripts/check-npm-audit.mjs, which now has NO advisory exceptions:
//   - fixtures/npm-audit-bc-sec-remediate-01.json is the real full npm audit of the remediated
//     backend/functions tree (2026-11-19, npm 10.9.9 / Node 22): zero findings, so it passes;
//   - fixtures/npm-audit-bc-sec-forge-22.json is the real report recorded on 2026-11-17, while the
//     picomatch advisory GHSA-fc5q-39xc-vjpf was still published (10 HIGH findings). It was the
//     exception's positive case and is now the negative control: it must FAIL.
// Part 2 runs scripts/check-osv-exceptions.mjs, unmodified, against a temporary copy of the
// repository files it inspects, mutating one thing per negative test. The allowlist is empty, so
// re-adding any retired exception (or any scanner configuration file) must fail.
// Nothing here depends on the clock: no exception expires because none exists.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXCEPTIONS, InspectionError, evaluate } from '../../check-npm-audit.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const fixturePath = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const CLEAN = JSON.parse(fs.readFileSync(fixturePath('npm-audit-bc-sec-remediate-01.json'), 'utf8'));
const PICOMATCH = JSON.parse(fs.readFileSync(fixturePath('npm-audit-bc-sec-forge-22.json'), 'utf8'));
const LOCK = JSON.parse(read('backend/functions/package-lock.json'));
const clone = o => JSON.parse(JSON.stringify(o));

/** Recount metadata after a mutation so only the intended change is under test. */
function recount(a) {
  const m = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of Object.values(a.vulnerabilities)) m[v.severity]++;
  a.metadata.vulnerabilities = { ...m, total: Object.keys(a.vulnerabilities).length };
  return a;
}
const advisory = (id, name, severity) => ({ source: 1, name, dependency: name, title: 't', url: `https://github.com/advisories/${id}`, severity, cwe: [], range: '*' });
const finding = (name, severity, id) => ({ name, severity, isDirect: true, via: [advisory(id, name, severity)], effects: [], range: '*', nodes: [`node_modules/${name}`], fixAvailable: false });
const withFinding = (name, severity, id) => { const a = clone(CLEAN); a.vulnerabilities[name] = finding(name, severity, id); return recount(a); };
const violationsOf = (audit, lock = LOCK) => evaluate(audit, lock).violations;

describe('check-npm-audit: no exceptions remain', () => {
  test('the exception list is empty and frozen', () => {
    assert.deepEqual([...EXCEPTIONS], []);
    assert.ok(Object.isFrozen(EXCEPTIONS));
  });
  test('the real audit of the remediated tree passes with zero findings', () => {
    const r = evaluate(CLEAN, LOCK);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.nonBlocking, []);
    assert.match(r.summary, /total=0 \| exceptions=0/);
  });
  test('negative control: the 2026-11-17 picomatch report (formerly excepted) now fails on all 10 HIGH findings', () => {
    const v = violationsOf(PICOMATCH);
    assert.equal(v.length, 10, v.join('\n'));
    for (const n of ['anymatch', 'chokidar', 'fdir', 'firebase-tools', 'node-gyp', 'picomatch', 're2', 'readdirp', 'superstatic', 'tinyglobby']) {
      assert.ok(v.some(x => x.startsWith(`${n}: HIGH finding`)), `${n} must block`);
    }
  });
  test('the formerly approved advisory on a development-only package blocks', () => {
    assert.match(violationsOf(withFinding('picomatch', 'high', 'GHSA-fc5q-39xc-vjpf')).join('\n'), /picomatch: HIGH finding \(via GHSA-fc5q-39xc-vjpf/);
  });
});

describe('check-npm-audit: the blocking threshold is unchanged', () => {
  test('an unknown HIGH advisory blocks', () => assert.match(violationsOf(withFinding('ajv', 'high', 'GHSA-2222-3333-4444')).join('\n'), /ajv: HIGH finding/));
  test('a CRITICAL advisory blocks', () => assert.match(violationsOf(withFinding('typescript', 'critical', 'GHSA-2222-3333-5555')).join('\n'), /typescript: CRITICAL finding/));
  test('a HIGH finding reached only through a chain blocks', () => {
    const a = withFinding('picomatch', 'high', 'GHSA-2222-3333-8888');
    a.vulnerabilities.readdirp = { name: 'readdirp', severity: 'high', isDirect: false, via: ['picomatch'], effects: [], range: '*', nodes: ['node_modules/readdirp'], fixAvailable: false };
    assert.equal(violationsOf(recount(a)).length, 2);
  });
  test('boundary: a MODERATE advisory stays non-blocking (--audit-level=high threshold)', () => {
    const r = evaluate(withFinding('ajv', 'moderate', 'GHSA-2222-3333-7777'), LOCK);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.nonBlocking.map(n => n.name), ['ajv']);
  });
  test('boundary: a LOW advisory stays non-blocking', () => assert.deepEqual(violationsOf(withFinding('ajv', 'low', 'GHSA-2222-3333-9999')), []));
});

describe('check-npm-audit: missing or malformed input fails closed', () => {
  const bad = {
    'not an object': null,
    'an npm error object': { error: { code: 'ENOTFOUND', summary: 'request failed' } },
    'report version 1': { ...clone(CLEAN), auditReportVersion: 1 },
    'no vulnerabilities object': (() => { const a = clone(CLEAN); delete a.vulnerabilities; return a; })(),
    'no metadata counts': (() => { const a = clone(CLEAN); delete a.metadata; return a; })(),
    'a count that does not match': (() => { const a = clone(PICOMATCH); a.metadata.vulnerabilities.high = 9; return a; })(),
    'a total that does not match': (() => { const a = clone(CLEAN); a.metadata.vulnerabilities.total = 1; return a; })(),
    'a hidden finding (counts zero, one finding present)': (() => { const a = clone(CLEAN); a.vulnerabilities.ajv = finding('ajv', 'high', 'GHSA-2222-3333-4444'); return a; })(),
    'an unknown via reference': (() => { const a = clone(PICOMATCH); a.vulnerabilities.anymatch.via = ['does-not-exist']; return a; })(),
    'a finding without nodes': (() => { const a = clone(PICOMATCH); delete a.vulnerabilities.picomatch.nodes; return a; })(),
    'an unknown severity': (() => { const a = clone(PICOMATCH); a.vulnerabilities.picomatch.severity = 'severe'; return a; })(),
    'a lower severity than its critical advisory': (() => { const a = clone(PICOMATCH); a.vulnerabilities.picomatch.via[0].severity = 'critical'; return a; })(),
  };
  for (const [name, a] of Object.entries(bad)) test(name, () => assert.throws(() => evaluate(a, LOCK), InspectionError));
  test('an unsupported lockfile', () => assert.throws(() => evaluate(CLEAN, { lockfileVersion: 1 }), InspectionError));
  test('a lockfile without a root entry', () => assert.throws(() => evaluate(CLEAN, { lockfileVersion: 3, packages: {} }), InspectionError));
});

describe('check-npm-audit: command line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sec-remediate-cli-'));
  const lock = path.join(root, 'backend/functions/package-lock.json');
  const run = (args, env) => spawnSync(process.execPath, [path.join(root, 'scripts/check-npm-audit.mjs'), ...args], { encoding: 'utf8', env: env || process.env });
  test('the remediated audit passes (exit 0)', () => { const r = run([fixturePath('npm-audit-bc-sec-remediate-01.json'), lock]); assert.equal(r.status, 0, r.stdout + r.stderr); });
  test('the picomatch report fails (exit 1)', () => { const r = run([fixturePath('npm-audit-bc-sec-forge-22.json'), lock]); assert.equal(r.status, 1, r.stdout + r.stderr); });
  test('an empty report exits 2', () => {
    const f = path.join(tmp, 'empty.json'); fs.writeFileSync(f, '');
    assert.equal(run([f, lock]).status, 2);
  });
  test('a missing report exits 2', () => assert.equal(run([path.join(tmp, 'absent.json'), lock]).status, 2));
  test('a non-JSON report exits 2', () => {
    const f = path.join(tmp, 'text.json'); fs.writeFileSync(f, 'npm ERR! audit endpoint returned an error');
    assert.equal(run([f, lock]).status, 2);
  });
  test('wrong argument count exits 2', () => assert.equal(run([fixturePath('npm-audit-bc-sec-remediate-01.json')]).status, 2));
  test('the result does not depend on clock or environment', () => {
    const env = { ...process.env, TZ: 'Pacific/Kiritimati', FAKETIME: '2026-11-01', NOW: '2026-11-01' };
    assert.equal(run([fixturePath('npm-audit-bc-sec-forge-22.json'), lock], env).status, 1);
    assert.equal(run([fixturePath('npm-audit-bc-sec-remediate-01.json'), lock], env).status, 0);
  });
});

// ---- Part 2: scripts/check-osv-exceptions.mjs (unmodified) on a temporary repository copy ----
const TOML = 'backend/functions/osv-scanner.toml', WF = '.github/workflows/forge-wp00.yml', LOCKF = 'backend/functions/package-lock.json';
const OSV_FILES = ['scripts/check-osv-exceptions.mjs', WF, LOCKF];
const EVAL_STEP = 'Evaluate npm audit (HIGH/CRITICAL block, no exceptions)';
const EVAL_STEP_RE = EVAL_STEP.replace(/[()/]/g, m => '\\' + m);

/** Copy the inspected files; `add` creates extra files (path -> text); `mutate` edits copied ones. */
function osvCheck({ mutate = {}, add = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sec-remediate-osv-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  for (const rel of OSV_FILES) {
    let text = read(rel);
    if (mutate[rel]) {
      const next = mutate[rel](text);
      assert.notEqual(next, text, `mutation of ${rel} changed nothing`);
      text = next;
    }
    put(rel, text);
  }
  for (const [rel, text] of Object.entries(add)) put(rel, text);
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/check-osv-exceptions.mjs')], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr };
}
const entry = (id, until, reason) => `[[IgnoredVulns]]\nid = "${id}"\nignoreUntil = ${until}\nreason = "${reason}"\n`;
const FUTURE = '2026-11-30T23:59:59Z';

describe('check-osv-exceptions: no exception file and an empty allowlist', () => {
  test('the repository has no scanner configuration file', () => assert.equal(fs.existsSync(path.join(root, TOML)), false));
  test('the repository as committed passes with no exceptions', () => {
    const r = osvCheck();
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /no exception file; no advisories are excepted/);
    assert.match(r.out, /0 exception\(s\)/);
  });
  const negatives = {
    're-adding the retired glob exception': [{ add: { [TOML]: entry('GHSA-3g3m-2fjr-6pw4', FUTURE, 'WP03-S2 PILOT: glob@10.5.0 via rimraf and firebase-tools dev tree') } }, /GHSA-3g3m-2fjr-6pw4 is not on the approved allowlist/],
    're-adding the retired minimatch exception': [{ add: { [TOML]: entry('GHSA-g3hv-75wg-m249', FUTURE, 'WP03-S2 PILOT: minimatch 9.0.9 and the firebase-tools dev tree') } }, /GHSA-g3hv-75wg-m249 is not on the approved allowlist/],
    're-adding the retired picomatch exception': [{ add: { [TOML]: entry('GHSA-fc5q-39xc-vjpf', FUTURE, 'BC-SEC-FORGE-22 (GAI Option E): picomatch dev-only via firebase-tools') } }, /GHSA-fc5q-39xc-vjpf is not on the approved allowlist/],
    'an empty exception file': [{ add: { [TOML]: '# nothing\n' } }, /has no \[\[IgnoredVulns\]\] entries; delete the file instead/],
    'a package-wide override': [{ add: { [TOML]: '[[PackageOverrides]]\nname = "glob"\nignore = true\n' } }, /table not permitted/],
    'a scanner configuration file elsewhere': [{ add: { 'android/osv-scanner.toml': entry('GHSA-2222-3333-4444', FUTURE, 'a rogue configuration file outside backend/functions') } }, /unauthorized scanner configuration file: android\/osv-scanner\.toml/],
    'a dot-named scanner configuration file at the root': [{ add: { '.osv-scanner.toml': entry('GHSA-2222-3333-4444', FUTURE, 'a rogue configuration file at the repository root') } }, /unauthorized scanner configuration file: \.osv-scanner\.toml/],
    'a workflow pointing the scanner at a config file': [{ mutate: { [WF]: t => t.replace(/\.\/osv-scanner scan source(\r?\n)/, './osv-scanner scan source --config=x.toml$1') } }, /forbidden osv-scanner flag|command changed/],
    'the scan step allowed to fail': [{ mutate: { [WF]: t => t.replace(/(      - name: Scan lockfiles\r?\n)/, '$1        continue-on-error: true\n') } }, /has unexpected keys: continue-on-error/],
    'the policy step removed': [{ mutate: { [WF]: t => t.replace(/      - name: Verify security exception policy\r?\n        run: .*\r?\n/, '') } }, /step "Verify security exception policy" missing/],
    'npm audit limited to production dependencies': [{ mutate: { [WF]: t => t.replace('run: npm audit --json >', 'run: npm audit --omit=dev --json >') } }, /npm audit must audit the full tree/],
    'npm audit with a severity threshold': [{ mutate: { [WF]: t => t.replace('run: npm audit --json >', 'run: npm audit --audit-level=critical --json >') } }, /npm audit must audit the full tree/],
    'the evaluation step removed': [{ mutate: { [WF]: t => t.replace(new RegExp(`      - name: ${EVAL_STEP_RE}\\r?\\n        run: .*\\r?\\n`), '') } }, new RegExp(`step "${EVAL_STEP_RE}" missing from backend`)],
    'the evaluation step allowed to fail': [{ mutate: { [WF]: t => t.replace(new RegExp(`(      - name: ${EVAL_STEP_RE}\\r?\\n)`), '$1        continue-on-error: true\n') } }, /has unexpected keys: continue-on-error/],
    'the evaluation command changed': [{ mutate: { [WF]: t => t.replace('node ../../scripts/check-npm-audit.mjs "$RUNNER_TEMP/npm-audit.json" package-lock.json', 'node ../../scripts/check-npm-audit.mjs "$RUNNER_TEMP/npm-audit.json" package-lock.json || true') } }, /command changed/],
    'the old exception step name restored': [{ mutate: { [WF]: t => t.replace(EVAL_STEP, 'Evaluate npm audit (BC-SEC-FORGE-22 pinned exception)') } }, new RegExp(`step "${EVAL_STEP_RE}" missing from backend`)],
    'the backend job allowed to fail': [{ mutate: { [WF]: t => t.replace(/(  backend:\r?\n    name: Backend typecheck, tests, npm audit\r?\n)/, '$1    continue-on-error: true\n') } }, /backend must not be continue-on-error/],
    'path-verdict no longer waiting for backend': [{ mutate: { [WF]: t => t.replace('needs: [classify, android, repeat-build, backend, backend-emulator]', 'needs: [classify, android, repeat-build, backend-emulator]') } }, /path-verdict must still need backend/],
    'the FORGE gate tolerating failures': [{ mutate: { [WF]: t => t.replace(/              exit 1(\r?\n            fi\r?\n          done\r?\n          echo "FORGE gate passed")/, '              exit 0$1') } }, /forge-gate job body changed/],
  };
  for (const [name, [opts, why]] of Object.entries(negatives)) {
    test(`fails: ${name}`, () => {
      const r = osvCheck(opts);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, why);
    });
  }
});
