#!/usr/bin/env node
// FORGE policy gate for time-boxed osv-scanner advisory exceptions (PL-PP-WP00-04b).
//
// osv-scanner 2.7.0 accepts exceptions with no expiry, with any future expiry, by CVE alias, and
// package-wide [[PackageOverrides]] (Operation Gatekeeper pilot NC-6f, X3, A1). This script runs
// immediately before the "Scan lockfiles" step and fails closed unless ALL of these hold:
//   1. The only scanner config file anywhere in the repository is backend/functions/osv-scanner.toml
//      (any osv-scanner.toml / .osv-scanner.toml elsewhere, in any letter case, is rejected).
//   2. If that file exists, it contains only [[IgnoredVulns]] entries with exactly the keys
//      id, ignoreUntil, reason; ids are on the allowlist, unique; ignoreUntil is an unquoted
//      RFC 3339 UTC date-time (Z, no offsets), a real calendar instant, in the future, and no later
//      than the approved ceiling; reason is a meaningful plain string that cites the decision that
//      approved that id. A scoped id is valid only while its scope holds.
//      BC-SEC-REMEDIATE-01: the allowlist is EMPTY. Every former exception was remediated or its
//      advisory withdrawn, and the file was deleted, so any scanner configuration file now fails.
//   3. The FORGE workflow still runs this check, unconditionally, immediately before the unchanged
//      scan command; no osv-scanner invocation in any workflow uses a configuration flag; the
//      dependency-audit job is still required by the FORGE gate, and the gate's evaluation logic is
//      unchanged (it must still fail on any non-success upstream result).
//   4. The backend job still runs the FULL npm audit (no --omit, --production,
//      --only or --audit-level anywhere) and evaluates it with scripts/check-npm-audit.mjs
//      immediately afterwards, with the pinned commands, unconditionally; the backend job keeps
//      its condition and working directory and still feeds the FORGE gate through path-verdict.
// Exit codes: 0 pass, 1 policy violation, 2 inspection could not complete (also fail closed).
// The script takes no arguments and uses only Node.js built-ins.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- Approved policy. Changing any value requires a new PL decision. ----
// Allowlist: id -> { token: the decision its reason must cite, scope?: { lockfile, package } }.
// EMPTY since BC-SEC-REMEDIATE-01. Retired entries, all remediated or withdrawn before expiry:
//   GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch), WP03-S2-SEC-DISP: remediated by
//     @google-cloud/firestore 9.4.1 (lockfile) and the PL-approved npm override glob 14.0.6.
//   GHSA-fc5q-39xc-vjpf (picomatch), BC-SEC-FORGE-22: advisory withdrawn by GitHub 2026-11-18.
const POLICY = new Map([]);
// Ceiling of the retired exceptions; with an empty allowlist no entry can reach this check unflagged.
const MAX_UNTIL = '2026-12-01T00:00:00Z';
// The backend npm audit gate (full tree, evaluated by scripts/check-npm-audit.mjs; no exceptions).
const NPM_AUDIT_STEP = { name: 'npm audit (full tree, JSON evidence)', run: 'npm audit --json > "$RUNNER_TEMP/npm-audit.json" || true' };
const NPM_EVAL_STEP = { name: 'Evaluate npm audit (HIGH/CRITICAL block, no exceptions)', run: 'node ../../scripts/check-npm-audit.mjs "$RUNNER_TEMP/npm-audit.json" package-lock.json' };
const BACKEND_JOB_IF = "needs.classify.outputs.path == 'FULL'";
const FORBIDDEN_AUDIT_FLAGS = /npm\s+audit\b.*(--omit\b|--production\b|--only\b|--audit-level\b|--dry-run\b|--registry\b)/;
const REASON_MIN_LENGTH = 40;
const APPROVED_CONFIG = 'backend/functions/osv-scanner.toml';
const CONFIG_NAMES = new Set(['osv-scanner.toml', '.osv-scanner.toml']);
const MAX_CONFIG_BYTES = 8192;
const WORKFLOW = '.github/workflows/forge-wp00.yml';
const POLICY_STEP = { name: 'Verify security exception policy', run: 'node scripts/check-osv-exceptions.mjs' };
const SCAN_STEP = {
  name: 'Scan lockfiles',
  run: './osv-scanner scan source -L android/app/gradle.lockfile -L android/core/model/gradle.lockfile -L android/core/storage/gradle.lockfile -L backend/functions/package-lock.json',
};
const SBOM_STEP = {
  name: 'CycloneDX SBOM',
  run: './osv-scanner scan source --all-packages --format cyclonedx-1-6 --output-file sbom.cdx.json -L android/app/gradle.lockfile -L android/core/model/gradle.lockfile -L android/core/storage/gradle.lockfile -L backend/functions/package-lock.json || true',
};
// Flags that change which configuration osv-scanner applies, or that skip/alter scanning.
const FORBIDDEN_SCANNER_FLAGS = /(^|\s)(--config\b|--no-ignore\b|--experimental-[\w-]+|--allow-no-lockfiles\b|--offline\b|--no-resolve\b|-r\b|--recursive\b)/;

class InspectionError extends Error {}
const violations = [];
const violate = msg => violations.push(msg);

function main() {
  if (process.argv.length > 2) throw new InspectionError('this check takes no arguments');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const marker of [WORKFLOW, 'backend/functions/package-lock.json']) {
    if (!isRegularFile(path.join(root, marker))) throw new InspectionError(`repository marker missing or not a regular file: ${marker}`);
  }
  checkRogueConfigs(root);
  checkWorkflows(root);
  const active = checkExceptionFile(root);
  checkScopes(root, active);
  if (violations.length) {
    console.error('FAIL security exception policy (PL-PP-WP00-04b)');
    for (const v of violations) console.error('  - ' + v);
    return 1;
  }
  if (active.length === 0) console.log(`PASS security exception policy: no exception file; no advisories are excepted.`);
  else for (const e of active) console.log(`PASS exception ${e.id} expires ${e.until} (${e.daysLeft} day(s) left)`);
  console.log(`PASS security exception policy: ${active.length} exception(s); workflow scan step and gate verified.`);
  return 0;
}

function isRegularFile(p) {
  try { return fs.lstatSync(p).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw new InspectionError(`cannot stat ${p}: ${e.code || e.message}`); }
}

// 1. Repository-wide search for scanner configuration files (no symlink following; only .git skipped).
function checkRogueConfigs(root) {
  const stack = [''];
  let dirs = 0;
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); }
    catch (e) { throw new InspectionError(`cannot read directory ${rel || '.'}: ${e.code || e.message}`); }
    dirs++;
    for (const d of entries) {
      const relPath = rel ? `${rel}/${d.name}` : d.name;
      if (CONFIG_NAMES.has(d.name.toLowerCase())) {
        if (relPath !== APPROVED_CONFIG) violate(`unauthorized scanner configuration file: ${relPath}`);
        else if (!d.isFile()) violate(`${relPath} must be a regular file (found ${d.isSymbolicLink() ? 'symlink' : 'non-file'})`);
      }
      if (d.isDirectory() && !(rel === '' && d.name === '.git')) stack.push(relPath);
    }
  }
  if (dirs === 0) throw new InspectionError('repository walk visited no directories');
}

// 2. The exception file itself (optional; absent means no exceptions).
function checkExceptionFile(root) {
  const file = path.join(root, APPROVED_CONFIG);
  let st;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return []; throw new InspectionError(`cannot stat ${APPROVED_CONFIG}: ${e.code || e.message}`); }
  if (!st.isFile()) return []; // already reported by the repository walk
  if (st.size > MAX_CONFIG_BYTES) { violate(`${APPROVED_CONFIG} exceeds ${MAX_CONFIG_BYTES} bytes`); return []; }
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new InspectionError(`cannot read ${APPROVED_CONFIG}: ${e.code || e.message}`); }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { violate(`${APPROVED_CONFIG}: byte-order mark not permitted`); return []; }
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD') || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) { violate(`${APPROVED_CONFIG}: only printable ASCII is permitted`); return []; }

  const entries = []; let cur = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (/\r/.test(raw)) { violate(`line ${n}: stray carriage return`); return; }
    const line = raw.trim();
    if (line === '' || /^#/.test(line)) return;                        // blank or full-line comment only
    if (line === '[[IgnoredVulns]]') { cur = { line: n, keys: {} }; entries.push(cur); return; }
    if (line.startsWith('[')) { violate(`line ${n}: table not permitted: ${line}`); cur = null; return; }
    const m = /^(id|ignoreUntil|reason) = (.+)$/.exec(line);
    if (!m) { violate(`line ${n}: unsupported content (only id, ignoreUntil, reason inside [[IgnoredVulns]]): ${line}`); return; }
    if (!cur) { violate(`line ${n}: key outside an [[IgnoredVulns]] entry: ${m[1]}`); return; }
    if (m[1] in cur.keys) { violate(`line ${n}: duplicate key ${m[1]}`); return; }
    cur.keys[m[1]] = { value: m[2], line: n };
  });
  if (entries.length === 0) { violate(`${APPROVED_CONFIG} has no [[IgnoredVulns]] entries; delete the file instead`); return []; }

  const now = Date.now(); const max = Date.parse(MAX_UNTIL); const seen = new Set(); const active = [];
  for (const e of entries) {
    const at = `entry at line ${e.line}`;
    for (const k of ['id', 'ignoreUntil', 'reason']) if (!e.keys[k]) violate(`${at}: missing required key ${k}${k === 'ignoreUntil' ? ' (no permanent exceptions)' : ''}`);
    let id = null, until = null, ok = true;
    if (e.keys.id) {
      const m = /^"(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})"$/.exec(e.keys.id.value);
      if (!m) { violate(`${at}: id must be a quoted GHSA identifier (aliases not accepted): ${e.keys.id.value}`); ok = false; }
      else if (!POLICY.has(m[1])) { violate(`${at}: id ${m[1]} is not on the approved allowlist`); ok = false; }
      else if (seen.has(m[1])) { violate(`${at}: duplicate id ${m[1]}`); ok = false; }
      else { seen.add(m[1]); id = m[1]; }
    }
    if (e.keys.ignoreUntil) {
      const v = e.keys.ignoreUntil.value;
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(v);
      if (!m) { violate(`${at}: ignoreUntil must be an unquoted UTC date-time YYYY-MM-DDTHH:MM:SSZ (no offsets, fractions or quotes): ${v}`); ok = false; }
      else {
        const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        if (new Date(t).toISOString() !== `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`) { violate(`${at}: ignoreUntil is not a real calendar instant: ${v}`); ok = false; }
        else if (t > max) { violate(`${at}: ignoreUntil ${v} is later than the approved ceiling ${MAX_UNTIL}`); ok = false; }
        else if (t <= now) { violate(`${at}: exception expired at ${v}; remove it or obtain a new PL decision`); ok = false; }
        else until = { v, t };
      }
    }
    if (e.keys.reason) {
      const m = /^"([^"\\]*)"$/.exec(e.keys.reason.value);
      if (!m) { violate(`${at}: reason must be a plain double-quoted string without escapes`); ok = false; }
      else if (m[1].trim().length < REASON_MIN_LENGTH) { violate(`${at}: reason must be at least ${REASON_MIN_LENGTH} characters`); ok = false; }
      else if (id && !m[1].includes(POLICY.get(id).token)) { violate(`${at}: reason for ${id} must cite ${POLICY.get(id).token}`); ok = false; }
    }
    if (ok && id && until) active.push({ id, until: until.v, daysLeft: Math.ceil((until.t - now) / 86400000) });
  }
  return active;
}

// 3. Workflow integrity: the check cannot be skipped and the scan cannot be redirected.
function checkWorkflows(root) {
  const dir = path.join(root, '.github/workflows');
  let names;
  try { names = fs.readdirSync(dir).filter(n => /\.ya?ml$/i.test(n)); } catch (e) { throw new InspectionError(`cannot list workflows: ${e.code || e.message}`); }
  for (const n of names) {
    let text;
    try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch (e) { throw new InspectionError(`cannot read workflow ${n}: ${e.code || e.message}`); }
    text.split(/\r?\n/).forEach((l, i) => {
      if (/osv-scanner/.test(l) && FORBIDDEN_SCANNER_FLAGS.test(l)) violate(`${n}:${i + 1}: forbidden osv-scanner flag: ${l.trim()}`);
      if (/osv-scanner\.toml/i.test(l)) violate(`${n}:${i + 1}: workflows must not reference scanner configuration files: ${l.trim()}`);
      if (FORBIDDEN_AUDIT_FLAGS.test(l)) violate(`${n}:${i + 1}: npm audit must audit the full tree without severity or scope filters: ${l.trim()}`);
    });
    if (n === path.basename(WORKFLOW)) { checkForge(text); checkBackendAudit(text); }
  }
}

function checkForge(text) {
  const lines = text.split(/\r?\n/);
  const job = sliceJob(lines, 'dependency-audit');
  if (!job) { violate(`${WORKFLOW}: job dependency-audit not found`); return; }
  if (job.some(l => /^    (continue-on-error|if):/.test(l))) violate(`${WORKFLOW}: dependency-audit must not be conditional or continue-on-error`);
  if (job.some(l => /^    (defaults|container):/.test(l))) violate(`${WORKFLOW}: dependency-audit must not set defaults or container (they can redirect the scan)`);
  const steps = parseSteps(job);
  const idx = name => steps.findIndex(s => s.name === name);
  const p = idx(POLICY_STEP.name), s = idx(SCAN_STEP.name), b = idx(SBOM_STEP.name);
  if (p < 0) violate(`${WORKFLOW}: step "${POLICY_STEP.name}" missing from dependency-audit`);
  if (s < 0) violate(`${WORKFLOW}: step "${SCAN_STEP.name}" missing from dependency-audit`);
  if (b < 0) violate(`${WORKFLOW}: step "${SBOM_STEP.name}" missing from dependency-audit`);
  if (p >= 0 && s >= 0 && s !== p + 1) violate(`${WORKFLOW}: "${POLICY_STEP.name}" must run immediately before "${SCAN_STEP.name}"`);
  for (const [i, want] of [[p, POLICY_STEP], [s, SCAN_STEP], [b, SBOM_STEP]]) {
    if (i < 0) continue;
    const st = steps[i];
    if (st.run !== want.run) violate(`${WORKFLOW}: step "${want.name}" command changed:\n      expected: ${want.run}\n      found:    ${st.run}`);
    const extra = Object.keys(st.keys).filter(k => !['name', 'run'].includes(k) && !(want === SBOM_STEP && k === 'if'));
    if (extra.length) violate(`${WORKFLOW}: step "${want.name}" has unexpected keys: ${extra.join(', ')}`);
  }
  if (b >= 0 && steps[b].keys.if !== undefined && steps[b].keys.if !== 'always()') violate(`${WORKFLOW}: SBOM step condition changed`);
  const scanCount = steps.filter(x => /osv-scanner(\s|$)/.test(x.run) && /\bscan\b/.test(x.run)).length;
  if (scanCount !== 2) violate(`${WORKFLOW}: dependency-audit must contain exactly the approved scan and SBOM invocations (found ${scanCount})`);
  const gate = sliceJob(lines, 'forge-gate');
  const needs = gate && gate.find(l => /^    needs:/.test(l));
  if (!needs || !/\bdependency-audit\b/.test(needs)) violate(`${WORKFLOW}: forge-gate must still need dependency-audit`);
  // The gate's evaluation logic is pinned (only its needs list may change).
  const body = gate ? gate.filter(l => !/^    needs:/.test(l)).map(l => l.trimEnd()).join('\n').trim() : '';
  if (body !== GATE_BODY) violate(`${WORKFLOW}: forge-gate job body changed; the gate must still fail on any non-success upstream result`);
}
// 4. The backend npm audit gate (full tree; no exceptions since BC-SEC-REMEDIATE-01).
function checkBackendAudit(text) {
  const lines = text.split(/\r?\n/);
  const job = sliceJob(lines, 'backend');
  if (!job) { violate(`${WORKFLOW}: job backend not found`); return; }
  if (job.some(l => /^    continue-on-error:/.test(l))) violate(`${WORKFLOW}: backend must not be continue-on-error`);
  const jobIf = job.find(l => /^    if:/.test(l));
  if (!jobIf || jobIf.replace(/^    if:\s*/, '').trim() !== BACKEND_JOB_IF) violate(`${WORKFLOW}: backend job condition changed (expected: if: ${BACKEND_JOB_IF})`);
  const d = job.findIndex(l => /^    defaults:\s*$/.test(l));
  if (d < 0 || !/^      run:\s*$/.test(job[d + 1] || '') || (job[d + 2] || '').trim() !== 'working-directory: backend/functions') {
    violate(`${WORKFLOW}: backend must keep defaults.run.working-directory: backend/functions`);
  }
  const steps = parseSteps(job);
  const a = steps.findIndex(s => s.name === NPM_AUDIT_STEP.name);
  const e = steps.findIndex(s => s.name === NPM_EVAL_STEP.name);
  if (a < 0) violate(`${WORKFLOW}: step "${NPM_AUDIT_STEP.name}" missing from backend`);
  if (e < 0) violate(`${WORKFLOW}: step "${NPM_EVAL_STEP.name}" missing from backend`);
  if (a >= 0 && e >= 0 && e !== a + 1) violate(`${WORKFLOW}: "${NPM_EVAL_STEP.name}" must run immediately after "${NPM_AUDIT_STEP.name}"`);
  for (const [i, want] of [[a, NPM_AUDIT_STEP], [e, NPM_EVAL_STEP]]) {
    if (i < 0) continue;
    if (steps[i].run !== want.run) violate(`${WORKFLOW}: step "${want.name}" command changed:\n      expected: ${want.run}\n      found:    ${steps[i].run}`);
    const extra = Object.keys(steps[i].keys).filter(k => !['name', 'run'].includes(k));
    if (extra.length) violate(`${WORKFLOW}: step "${want.name}" has unexpected keys: ${extra.join(', ')}`);
  }
  const pv = sliceJob(lines, 'path-verdict');
  const pvNeeds = pv && pv.find(l => /^    needs:/.test(l));
  if (!needsList(pvNeeds).includes('backend')) violate(`${WORKFLOW}: path-verdict must still need backend`);
  const gate = sliceJob(lines, 'forge-gate');
  const gateNeeds = gate && gate.find(l => /^    needs:/.test(l));
  if (!needsList(gateNeeds).includes('path-verdict')) violate(`${WORKFLOW}: forge-gate must still need path-verdict`);
}

// Exact job names from a one-line needs entry ("needs: a" or "needs: [a, b]"); a substring such
// as backend-emulator never counts as backend.
const needsList = l => (l ? l.replace(/^    needs:\s*/, '').replace(/[[\]]/g, '').split(',').map(x => x.trim()).filter(Boolean) : []);

// Scoped exceptions are valid only while their scope holds in the scanned lockfile.
function checkScopes(root, active) {
  for (const e of active) {
    const scope = POLICY.get(e.id).scope;
    if (!scope) continue;
    let lock;
    try { lock = JSON.parse(fs.readFileSync(path.join(root, scope.lockfile), 'utf8')); }
    catch (err) { throw new InspectionError(`cannot read ${scope.lockfile} for the ${e.id} scope: ${err.code || err.message}`); }
    const pkgs = lock && lock.packages;
    if (!pkgs || typeof pkgs !== 'object') throw new InspectionError(`${scope.lockfile} has no packages map`);
    const hits = Object.keys(pkgs).filter(k => k === 'node_modules/' + scope.package || k.endsWith('/node_modules/' + scope.package));
    if (hits.length === 0) violate(`${e.id}: no ${scope.package} remains in ${scope.lockfile}; remove the exception`);
    for (const k of hits) if (pkgs[k].dev !== true) violate(`${e.id}: ${k} in ${scope.lockfile} is not development-only; the exception does not cover it`);
  }
}

const GATE_BODY = [
  'name: FORGE gate',
  '    if: always()',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - name: Require every upstream job to succeed',
  '        env:',
  "          RESULTS: ${{ join(needs.*.result, ' ') }}",
  '        run: |',
  '          echo "Upstream results: $RESULTS"',
  '          for r in $RESULTS; do',
  '            if [ "$r" != "success" ]; then',
  '              echo "FORGE gate FAILED"',
  '              exit 1',
  '            fi',
  '          done',
  '          echo "FORGE gate passed"',
].join('\n');

function sliceJob(lines, name) {
  const start = lines.findIndex(l => l === `  ${name}:`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) { end = i; break; }
  return lines.slice(start + 1, end);
}

// Minimal parser for this workflow's step style: "      - key: value" items, scalar values,
// and "run: >" / "run: |" block scalars indented deeper than the step keys.
function parseSteps(job) {
  const steps = []; let cur = null; let block = null;
  for (const raw of job) {
    if (block) {
      if (raw.trim() === '' || indent(raw) > block.indent) { block.buf.push(raw.trim()); continue; }
      cur.keys[block.key] = block.buf.filter(Boolean).join(' '); block = null;
    }
    const item = /^      - ([A-Za-z-]+):\s?(.*)$/.exec(raw);
    const key = /^        ([A-Za-z-]+):\s?(.*)$/.exec(raw);
    const m = item || key;
    if (item) { cur = { keys: {} }; steps.push(cur); }
    if (!m || !cur) continue;
    const [, k, v] = m;
    if (/^[>|][-+]?$/.test(v)) block = { key: k, indent: item ? 8 : indent(raw), buf: [] };
    else cur.keys[k] = v.trim();
  }
  if (block) cur.keys[block.key] = block.buf.filter(Boolean).join(' ');
  for (const s of steps) { s.name = (s.keys.name || '').replace(/^["']|["']$/g, ''); s.run = (s.keys.run || '').replace(/\s+/g, ' ').trim(); }
  return steps;
}
const indent = l => l.length - l.trimStart().length;

let code;
try { code = main(); }
catch (e) {
  console.error(`FAIL security exception policy: inspection could not complete (${e instanceof InspectionError ? e.message : 'unexpected error: ' + (e && e.stack || e)})`);
  code = 2;
}
process.exitCode = code;
