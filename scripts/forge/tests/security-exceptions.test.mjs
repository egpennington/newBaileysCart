// BC-SEC-FORGE-22 boundary tests (GAI Option E, GAI-SEC-REV-PR22-DISP-001).
//
// Part 1 exercises scripts/check-npm-audit.mjs on the real full npm audit report recorded on
// 2026-11-17 (fixtures/npm-audit-bc-sec-forge-22.json, npm 10.9.9 / Node 22) and the real
// backend/functions/package-lock.json, with a fixed clock, then mutates exactly one thing per
// negative test. Part 2 runs scripts/check-osv-exceptions.mjs, unmodified, against a temporary
// copy of the repository files it inspects, again mutating one thing per negative test.
//
// The OSV policy check and the CLI tests use the real clock: from 2026-12-01T00:00:00Z the
// exception is expired and the PASS cases are expected to fail (asserted, not skipped).
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { APPROVED, InspectionError, evaluate } from '../../check-npm-audit.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const AUDIT = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/npm-audit-bc-sec-forge-22.json', import.meta.url)), 'utf8'));
const LOCK = JSON.parse(read('backend/functions/package-lock.json'));
const NOW = Date.parse('2026-11-17T23:00:00Z');
const UNTIL = Date.parse(APPROVED.until);
const LIVE = Date.now() < UNTIL; // real-clock expectation for CLI and OSV PASS cases
const clone = o => JSON.parse(JSON.stringify(o));

/** Recount metadata after a mutation so only the intended change is under test. */
function recount(a) {
  const m = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of Object.values(a.vulnerabilities)) m[v.severity]++;
  a.metadata.vulnerabilities = { ...m, total: Object.keys(a.vulnerabilities).length };
  return a;
}
const advisory = (id, name, severity) => ({ source: 1, name, dependency: name, title: 't', url: `https://github.com/advisories/${id}`, severity, cwe: [], range: '*' });
const violationsOf = (audit, lock = LOCK, now = NOW) => evaluate(audit, lock, now).violations;

describe('check-npm-audit: the recorded full audit', () => {
  test('passes: exactly the 10 HIGH picomatch-chain findings are excepted; 11 MODERATE stay non-blocking', () => {
    const r = evaluate(AUDIT, LOCK, NOW);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.excepted.map(e => e.name), ['anymatch', 'chokidar', 'fdir', 'firebase-tools', 'node-gyp', 'picomatch', 're2', 'readdirp', 'superstatic', 'tinyglobby']);
    assert.equal(r.nonBlocking.length, 11);
    assert.ok(r.nonBlocking.every(n => n.severity === 'moderate'));
    assert.deepEqual(r.excepted.find(e => e.name === 'picomatch').nodes, ['node_modules/picomatch', 'node_modules/tinyglobby/node_modules/picomatch']);
  });
  test('the policy is pinned to one advisory, one package, one dev root and the 2026-12-01 ceiling', () => {
    assert.deepEqual({ ...APPROVED, devRoots: [...APPROVED.devRoots] }, {
      id: 'GHSA-fc5q-39xc-vjpf', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', package: 'picomatch',
      severity: 'high', until: '2026-12-01T00:00:00Z', devRoots: ['firebase-tools'],
    });
    assert.ok(Object.isFrozen(APPROVED));
  });
});

describe('check-npm-audit: expiry is a hard stop', () => {
  test('1 ms before the ceiling passes', () => assert.deepEqual(violationsOf(AUDIT, LOCK, UNTIL - 1), []));
  test('at the ceiling fails', () => assert.match(violationsOf(AUDIT, LOCK, UNTIL).join('\n'), /expired at 2026-12-01T00:00:00Z/));
  test('after the ceiling fails even with no picomatch finding left', () => {
    const a = clone(AUDIT); a.vulnerabilities = {}; recount(a);
    assert.match(violationsOf(a, LOCK, UNTIL + 86400000).join('\n'), /expired/);
  });
});

describe('check-npm-audit: anything else HIGH or CRITICAL still blocks', () => {
  test('an unknown HIGH advisory on a development package', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.ajv = { name: 'ajv', severity: 'high', isDirect: true, via: [advisory('GHSA-2222-3333-4444', 'ajv', 'high')], effects: [], range: '*', nodes: ['node_modules/ajv'], fixAvailable: false };
    assert.match(violationsOf(recount(a)).join('\n'), /ajv: HIGH finding not explained/);
  });
  test('a CRITICAL finding on an unrelated package', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.typescript = { name: 'typescript', severity: 'critical', isDirect: true, via: [advisory('GHSA-2222-3333-5555', 'typescript', 'critical')], effects: [], range: '*', nodes: ['node_modules/typescript'], fixAvailable: false };
    assert.match(violationsOf(recount(a)).join('\n'), /typescript: CRITICAL finding/);
  });
  test('the approved advisory itself escalated to CRITICAL', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.picomatch.severity = 'critical';
    a.vulnerabilities.picomatch.via[0].severity = 'critical';
    const v = violationsOf(recount(a)).join('\n');
    assert.match(v, /picomatch: CRITICAL finding/);
    assert.match(v, /anymatch: HIGH finding not explained/);
  });
  test('a HIGH finding with the approved chain plus one unknown HIGH advisory', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.anymatch.via.push(advisory('GHSA-2222-3333-6666', 'anymatch', 'high'));
    assert.match(violationsOf(a).join('\n'), /anymatch: HIGH finding not explained/);
  });
  test('the approved advisory URL on a different package', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.picomatch.via[0].name = 'minimatch';
    assert.match(violationsOf(a).join('\n'), /picomatch: HIGH finding not explained/);
  });
  test('a HIGH finding with no HIGH contributor is not explained', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.archiver.severity = 'high';
    assert.match(violationsOf(recount(a)).join('\n'), /archiver: HIGH finding not explained/);
  });
  test('boundary: an unknown MODERATE advisory stays non-blocking (unchanged --audit-level=high threshold)', () => {
    const a = clone(AUDIT);
    a.vulnerabilities.ajv = { name: 'ajv', severity: 'moderate', isDirect: true, via: [advisory('GHSA-2222-3333-7777', 'ajv', 'moderate')], effects: [], range: '*', nodes: ['node_modules/ajv'], fixAvailable: false };
    assert.deepEqual(violationsOf(recount(a)), []);
  });
});

describe('check-npm-audit: the exception holds only in the verified development scope', () => {
  test('a picomatch node that is not development-only', () => {
    const l = clone(LOCK); delete l.packages['node_modules/picomatch'].dev;
    assert.match(violationsOf(AUDIT, l).join('\n'), /node_modules\/picomatch is not development-only/);
  });
  test('picomatch reachable through a production dependency', () => {
    const l = clone(LOCK);
    l.packages[''].dependencies['glob-prod'] = '1.0.0';
    l.packages['node_modules/glob-prod'] = { version: '1.0.0', dependencies: { picomatch: '2.3.2' }, dev: true };
    assert.match(violationsOf(AUDIT, l).join('\n'), /reachable through glob-prod/);
  });
  test('picomatch reachable through another development root', () => {
    const l = clone(LOCK);
    l.packages[''].devDependencies['other-tool'] = '1.0.0';
    l.packages['node_modules/other-tool'] = { version: '1.0.0', dev: true, dependencies: { picomatch: '2.3.2' } };
    assert.match(violationsOf(AUDIT, l).join('\n'), /reachable through other-tool/);
  });
  test('an excepted finding whose node is missing from the lockfile', () => {
    const a = clone(AUDIT); a.vulnerabilities.readdirp.nodes = ['node_modules/not-installed'];
    assert.match(violationsOf(a).join('\n'), /not in package-lock.json/);
  });
  test('a direct dependency other than the approved root', () => {
    const a = clone(AUDIT); a.vulnerabilities.anymatch.isDirect = true;
    assert.match(violationsOf(a).join('\n'), /anymatch: direct dependency outside/);
  });
  test('firebase-tools as a production dependency makes the lockfile untrusted', () => {
    const l = clone(LOCK); l.packages[''].dependencies['firebase-tools'] = l.packages[''].devDependencies['firebase-tools'];
    assert.throws(() => evaluate(AUDIT, l, NOW), InspectionError);
  });
});

describe('check-npm-audit: missing or malformed input fails closed', () => {
  const bad = {
    'not an object': null,
    'an npm error object': { error: { code: 'ENOTFOUND', summary: 'request failed' } },
    'report version 1': { ...clone(AUDIT), auditReportVersion: 1 },
    'a count that does not match': (() => { const a = clone(AUDIT); a.metadata.vulnerabilities.high = 9; return a; })(),
    'a total that does not match': (() => { const a = clone(AUDIT); a.metadata.vulnerabilities.total = 20; return a; })(),
    'an unknown via reference': (() => { const a = clone(AUDIT); a.vulnerabilities.anymatch.via = ['does-not-exist']; return a; })(),
    'a finding without nodes': (() => { const a = clone(AUDIT); delete a.vulnerabilities.picomatch.nodes; return a; })(),
    'an unknown severity': (() => { const a = clone(AUDIT); a.vulnerabilities.picomatch.severity = 'severe'; return a; })(),
    'a lower severity than its critical advisory': (() => { const a = clone(AUDIT); a.vulnerabilities.picomatch.via[0].severity = 'critical'; return a; })(),
  };
  for (const [name, a] of Object.entries(bad)) test(name, () => assert.throws(() => evaluate(a, LOCK, NOW), InspectionError));
  test('an unsupported lockfile', () => assert.throws(() => evaluate(AUDIT, { lockfileVersion: 1 }, NOW), InspectionError));
});

describe('check-npm-audit: command line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sec22-cli-'));
  const lock = path.join(root, 'backend/functions/package-lock.json');
  const fixture = fileURLToPath(new URL('./fixtures/npm-audit-bc-sec-forge-22.json', import.meta.url));
  const run = args => spawnSync(process.execPath, [path.join(root, 'scripts/check-npm-audit.mjs'), ...args], { encoding: 'utf8' });
  test(`the recorded audit ${LIVE ? 'passes (exit 0)' : 'fails after expiry (exit 1)'}`, () => {
    const r = run([fixture, lock]);
    assert.equal(r.status, LIVE ? 0 : 1, r.stdout + r.stderr);
  });
  test('an empty report exits 2', () => {
    const f = path.join(tmp, 'empty.json'); fs.writeFileSync(f, '');
    assert.equal(run([f, lock]).status, 2);
  });
  test('a missing report exits 2', () => assert.equal(run([path.join(tmp, 'absent.json'), lock]).status, 2));
  test('a non-JSON report exits 2', () => {
    const f = path.join(tmp, 'text.json'); fs.writeFileSync(f, 'npm ERR! audit endpoint returned an error');
    assert.equal(run([f, lock]).status, 2);
  });
  test('wrong argument count exits 2', () => assert.equal(run([fixture]).status, 2));
  test('the clock cannot be moved through the environment', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/check-npm-audit.mjs'), fixture, lock], { encoding: 'utf8', env: { ...process.env, TZ: 'Pacific/Kiritimati', FAKETIME: '2026-11-01', NOW: '2026-11-01' } });
    assert.equal(r.status, LIVE ? 0 : 1);
  });
});

// ---- Part 2: scripts/check-osv-exceptions.mjs (unmodified) on a temporary repository copy ----
const OSV_FILES = ['scripts/check-osv-exceptions.mjs', '.github/workflows/forge-wp00.yml', 'backend/functions/package-lock.json', 'backend/functions/osv-scanner.toml'];

function osvCheck(mutate = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sec22-osv-'));
  for (const rel of OSV_FILES) {
    let text = read(rel);
    if (mutate[rel]) {
      const next = mutate[rel](text);
      assert.notEqual(next, text, `mutation of ${rel} changed nothing`);
      text = next;
    }
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/check-osv-exceptions.mjs')], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr };
}
const TOML = 'backend/functions/osv-scanner.toml', WF = '.github/workflows/forge-wp00.yml', LOCKF = 'backend/functions/package-lock.json';
const lockEdit = fn => text => { const l = JSON.parse(text); fn(l); return JSON.stringify(l, null, 2); };
const FC5Q = /(id = "GHSA-fc5q-39xc-vjpf"\r?\nignoreUntil = )2026-12-01T00:00:00Z/;

describe('check-osv-exceptions: GHSA-fc5q-39xc-vjpf boundaries', () => {
  test(`the repository as committed ${LIVE ? 'passes' : 'fails after expiry'}`, () => {
    const r = osvCheck();
    assert.equal(r.status, LIVE ? 0 : 1, r.out);
    if (LIVE) assert.match(r.out, /PASS exception GHSA-fc5q-39xc-vjpf expires 2026-12-01T00:00:00Z/);
  });
  const negatives = {
    'a reason that does not cite BC-SEC-FORGE-22': [{ [TOML]: t => t.replace('reason = "BC-SEC-FORGE-22 (GAI Option E)', 'reason = "WP03-S2 picomatch exception (GAI Option E)') }, /reason for GHSA-fc5q-39xc-vjpf must cite BC-SEC-FORGE-22/],
    'a WP03-S2 entry citing BC-SEC-FORGE-22 instead': [{ [TOML]: t => t.replace('reason = "WP03-S2 PILOT: glob', 'reason = "BC-SEC-FORGE-22 PILOT: glob') }, /reason for GHSA-3g3m-2fjr-6pw4 must cite WP03-S2/],
    'an expiry one second past the ceiling': [{ [TOML]: t => t.replace(FC5Q, '$12026-12-01T00:00:01Z') }, /later than the approved ceiling/],
    'an expiry in the past': [{ [TOML]: t => t.replace(FC5Q, '$12026-11-01T00:00:00Z') }, /exception expired at 2026-11-01T00:00:00Z/],
    'no expiry (permanent exception)': [{ [TOML]: t => t.replace(/id = "GHSA-fc5q-39xc-vjpf"\r?\nignoreUntil = 2026-12-01T00:00:00Z\r?\n/, 'id = "GHSA-fc5q-39xc-vjpf"\n') }, /missing required key ignoreUntil/],
    'an advisory that is not on the allowlist': [{ [TOML]: t => t.replace('id = "GHSA-fc5q-39xc-vjpf"', 'id = "GHSA-2222-3333-4444"') }, /GHSA-2222-3333-4444 is not on the approved allowlist/],
    'a CVE alias instead of the GHSA id': [{ [TOML]: t => t.replace('id = "GHSA-fc5q-39xc-vjpf"', 'id = "CVE-2026-112366"') }, /quoted GHSA identifier/],
    'an installed picomatch that is not development-only': [{ [LOCKF]: lockEdit(l => { delete l.packages['node_modules/tinyglobby/node_modules/picomatch'].dev; }) }, /node_modules\/tinyglobby\/node_modules\/picomatch .* is not development-only/],
    'no picomatch left (the exception must be removed)': [{ [LOCKF]: lockEdit(l => { for (const k of Object.keys(l.packages)) if (k.endsWith('node_modules/picomatch')) delete l.packages[k]; }) }, /no picomatch remains/],
    'npm audit limited to production dependencies': [{ [WF]: t => t.replace('run: npm audit --json >', 'run: npm audit --omit=dev --json >') }, /npm audit must audit the full tree/],
    'npm audit with a severity threshold': [{ [WF]: t => t.replace('run: npm audit --json >', 'run: npm audit --audit-level=critical --json >') }, /npm audit must audit the full tree/],
    'the evaluation step removed': [{ [WF]: t => t.replace(/      - name: Evaluate npm audit \(BC-SEC-FORGE-22 pinned exception\)\r?\n        run: .*\r?\n/, '') }, /step "Evaluate npm audit \(BC-SEC-FORGE-22 pinned exception\)" missing from backend/],
    'the evaluation step allowed to fail': [{ [WF]: t => t.replace(/(      - name: Evaluate npm audit \(BC-SEC-FORGE-22 pinned exception\)\r?\n)/, '$1        continue-on-error: true\n') }, /has unexpected keys: continue-on-error/],
    'the evaluation command changed': [{ [WF]: t => t.replace('node ../../scripts/check-npm-audit.mjs "$RUNNER_TEMP/npm-audit.json" package-lock.json', 'node ../../scripts/check-npm-audit.mjs "$RUNNER_TEMP/npm-audit.json" package-lock.json || true') }, /command changed/],
    'the backend job allowed to fail': [{ [WF]: t => t.replace(/(  backend:\r?\n    name: Backend typecheck, tests, npm audit\r?\n)/, '$1    continue-on-error: true\n') }, /backend must not be continue-on-error/],
    'path-verdict no longer waiting for backend': [{ [WF]: t => t.replace('needs: [classify, android, repeat-build, backend, backend-emulator]', 'needs: [classify, android, repeat-build, backend-emulator]') }, /path-verdict must still need backend/],
  };
  for (const [name, [mutate, why]] of Object.entries(negatives)) {
    test(`fails: ${name}`, () => {
      const r = osvCheck(mutate);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, why);
    });
  }
});
