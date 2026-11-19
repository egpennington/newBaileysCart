#!/usr/bin/env node
// FORGE npm audit gate (BC-SEC-REMEDIATE-01). It evaluates the FULL npm audit (development
// dependencies included; no --omit=dev) with NO advisory exceptions.
//
// History: BC-SEC-FORGE-22 (GAI Option E) allowed one time-boxed HIGH exception here
// (GHSA-fc5q-39xc-vjpf, picomatch, firebase-tools dev tree, until 2026-12-01T00:00:00Z). GitHub
// withdrew that advisory on 2026-11-18, and BC-SEC-REMEDIATE-01 retired the exception. Adding any
// exception back requires a new PL decision and a change to this file, its tests and the pinned
// workflow step in scripts/check-osv-exceptions.mjs.
//
// usage: node scripts/check-npm-audit.mjs <npm-audit.json> <package-lock.json>
//
// Blocking rule (unchanged threshold): every HIGH or CRITICAL finding fails the gate. MODERATE and
// LOW findings are reported and do not block (the original --audit-level=high threshold).
// Fail closed (exit 2) on a missing, empty, malformed or error audit report, an unsupported report
// version, counts that do not match the findings, a finding that references an unknown entry, or
// an unreadable or unsupported lockfile.
// Exit codes: 0 pass, 1 policy violation, 2 inspection could not complete.
// Only Node.js built-ins. The result does not depend on the clock or the environment.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- Approved policy. No advisory is excepted. Changing this requires a new PL decision. ----
export const EXCEPTIONS = Object.freeze([]);
const BLOCKING = new Set(['high', 'critical']);
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export class InspectionError extends Error {}

/**
 * Evaluate a parsed npm audit report (auditReportVersion 2) against a parsed package-lock.json.
 * Returns { violations: string[], nonBlocking: object[], summary: string }.
 * Throws InspectionError when the inputs cannot be trusted (callers must fail closed).
 */
export function evaluate(audit, lock) {
  validateAudit(audit);
  validateLock(lock);
  const vulns = audit.vulnerabilities;
  const violations = [], nonBlocking = [];
  for (const name of Object.keys(vulns).sort()) {
    const v = vulns[name];
    const advisories = v.via.filter(x => typeof x === 'object').map(x => advisoryId(x));
    if (!BLOCKING.has(v.severity)) { nonBlocking.push({ name, severity: v.severity, advisories }); continue; }
    violations.push(`${name}: ${v.severity.toUpperCase()} finding (via ${describeVia(v)}); no advisory is excepted`);
  }
  const counts = SEVERITIES.map(s => `${s}=${audit.metadata.vulnerabilities[s]}`).join(' ');
  const summary = `npm audit: ${counts} total=${audit.metadata.vulnerabilities.total} | exceptions=0 | non-blocking=${nonBlocking.length} | violations=${violations.length}`;
  return { violations, nonBlocking, summary };
}

function advisoryId(a) {
  return typeof a.url === 'string' ? a.url.split('/').pop() : `source:${a.source}`;
}

function describeVia(v) {
  return v.via.map(x => (typeof x === 'string' ? x : `${advisoryId(x)}/${x.name}/${x.severity}`)).join(', ');
}

/** package-lock v2/v3 with a root package entry; anything else is untrusted. */
function validateLock(lock) {
  if (!lock || typeof lock !== 'object' || ![2, 3].includes(lock.lockfileVersion)) throw new InspectionError('package-lock.json must be lockfileVersion 2 or 3');
  if (!lock.packages || typeof lock.packages !== 'object' || !lock.packages['']) throw new InspectionError('package-lock.json has no root package entry');
}

function validateAudit(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new InspectionError('audit report is not a JSON object');
  if ('error' in a) throw new InspectionError(`npm audit reported an error: ${JSON.stringify(a.error).slice(0, 300)}`);
  if (a.auditReportVersion !== 2) throw new InspectionError(`unsupported auditReportVersion ${JSON.stringify(a.auditReportVersion)} (2 required)`);
  const v = a.vulnerabilities, m = a.metadata && a.metadata.vulnerabilities;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InspectionError('audit report has no vulnerabilities object');
  if (!m || typeof m !== 'object') throw new InspectionError('audit report has no metadata.vulnerabilities counts');
  const counted = Object.fromEntries(SEVERITIES.map(s => [s, 0]));
  for (const [name, e] of Object.entries(v)) {
    if (!e || typeof e !== 'object' || e.name !== name) throw new InspectionError(`malformed finding ${name}`);
    if (!SEVERITIES.includes(e.severity)) throw new InspectionError(`finding ${name} has unknown severity ${JSON.stringify(e.severity)}`);
    if (!Array.isArray(e.via) || e.via.length === 0 || !Array.isArray(e.nodes)) throw new InspectionError(`finding ${name} lacks via/nodes`);
    for (const via of e.via) {
      if (typeof via === 'string') {
        if (!v[via]) throw new InspectionError(`finding ${name} references an unknown entry: ${via}`);
        continue;
      }
      if (!via || typeof via !== 'object' || typeof via.url !== 'string' || typeof via.name !== 'string' || !SEVERITIES.includes(via.severity)) throw new InspectionError(`finding ${name} has a malformed advisory`);
      if (via.severity === 'critical' && e.severity !== 'critical') throw new InspectionError(`finding ${name} is ${e.severity} but carries a critical advisory`);
    }
    counted[e.severity]++;
  }
  for (const s of SEVERITIES) if (m[s] !== counted[s]) throw new InspectionError(`metadata count ${s}=${m[s]} does not match ${counted[s]} findings`);
  if (m.total !== Object.keys(v).length) throw new InspectionError(`metadata total ${m.total} does not match ${Object.keys(v).length} findings`);
}

function readJson(p, what) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) { throw new InspectionError(`cannot read ${what} ${p}: ${e.code || e.message}`); }
  if (text.trim() === '') throw new InspectionError(`${what} ${p} is empty`);
  try { return JSON.parse(text); } catch (e) { throw new InspectionError(`${what} ${p} is not valid JSON: ${e.message}`); }
}

function main(argv) {
  if (argv.length !== 2) throw new InspectionError('usage: check-npm-audit.mjs <npm-audit.json> <package-lock.json>');
  const r = evaluate(readJson(argv[0], 'audit report'), readJson(argv[1], 'lockfile'));
  for (const n of r.nonBlocking) console.log(`non-blocking ${n.severity} ${n.name}${n.advisories.length ? ' [' + n.advisories.join(',') + ']' : ''}`);
  console.log(r.summary);
  if (r.violations.length) {
    console.error('FAIL npm audit gate (HIGH/CRITICAL block; no exceptions)');
    for (const v of r.violations) console.error('  - ' + v);
    return 1;
  }
  console.log('PASS npm audit gate (HIGH/CRITICAL block; no exceptions)');
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let code;
  try { code = main(process.argv.slice(2)); }
  catch (e) {
    console.error(`FAIL npm audit gate: inspection could not complete (${e instanceof InspectionError ? e.message : 'unexpected error: ' + (e && e.stack || e)})`);
    code = 2;
  }
  process.exitCode = code;
}
