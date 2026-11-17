#!/usr/bin/env node
// FORGE npm audit gate with ONE pinned, time-boxed exception (BC-SEC-FORGE-22; GAI Option E,
// GAI-SEC-REV-PR22-DISP-001; PL-authorized). It replaces `npm audit --audit-level=high` with an
// evaluation of the FULL audit (development dependencies included; no --omit=dev) that is exactly
// as strict as before, except for one approved advisory in one verified development-only scope.
//
// usage: node scripts/check-npm-audit.mjs <npm-audit.json> <package-lock.json>
//
// Blocking rule (unchanged threshold): every HIGH or CRITICAL finding fails the gate, unless it is
// HIGH and fully explained by the approved advisory below:
//   - every advisory in its chain is GHSA-fc5q-39xc-vjpf on package picomatch at severity high;
//   - every installed node of the finding is marked dev in package-lock.json;
//   - every such node is reachable from the root ONLY through the approved development root
//     (firebase-tools, which must be a root devDependency and not a production dependency);
//   - the evaluation runs before 2026-12-01T00:00:00Z (after that the gate always fails until the
//     exception is removed or a new PL decision replaces it).
// Any CRITICAL finding fails, including one for the approved advisory. MODERATE and LOW findings
// are reported and do not block (the previous --audit-level=high threshold).
// Fail closed (exit 2) on a missing, empty, malformed or error audit report, an unsupported report
// version, counts that do not match the findings, a finding that references an unknown entry, or
// an unreadable or unsupported lockfile.
// Exit codes: 0 pass, 1 policy violation, 2 inspection could not complete.
// Only Node.js built-ins. The clock cannot be overridden from the command line or environment.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- Approved policy (BC-SEC-FORGE-22). Changing any value requires a new PL decision. ----
export const APPROVED = Object.freeze({
  id: 'GHSA-fc5q-39xc-vjpf',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  package: 'picomatch',
  severity: 'high',
  until: '2026-12-01T00:00:00Z',
  devRoots: Object.freeze(['firebase-tools']),
});
const BLOCKING = new Set(['high', 'critical']);
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export class InspectionError extends Error {}

/**
 * Evaluate a parsed npm audit report (auditReportVersion 2) against a parsed package-lock.json.
 * Returns { violations: string[], excepted: object[], nonBlocking: object[], summary: string }.
 * Throws InspectionError when the inputs cannot be trusted (callers must fail closed).
 */
export function evaluate(audit, lock, now = Date.now()) {
  validateAudit(audit);
  const graph = lockGraph(lock);
  const violations = [];
  const until = Date.parse(APPROVED.until);
  const expired = !(now < until);
  if (expired) violations.push(`exception ${APPROVED.id} expired at ${APPROVED.until}; remove it or obtain a new PL decision`);

  const vulns = audit.vulnerabilities;
  const memo = new Map();
  const explained = name => {
    if (memo.has(name)) return memo.get(name);
    const v = vulns[name];
    if (!v) throw new InspectionError(`finding references an unknown entry: ${name}`);
    memo.set(name, true); // cycles: a member is explained only if everything outside the cycle is
    // Only contributors at the blocking threshold matter; below-threshold contributors (for
    // example the moderate glob/minimatch chain) stay non-blocking exactly as under
    // --audit-level=high. At least one blocking contributor must exist and all must be approved.
    let ok = true, contributors = 0;
    for (const via of v.via) {
      if (typeof via === 'string') {
        const c = vulns[via];
        if (!c) throw new InspectionError(`finding ${name} references an unknown entry: ${via}`);
        if (!BLOCKING.has(c.severity)) continue;
        contributors++;
        if (c.severity === 'critical' || !explained(via)) ok = false;
      } else {
        if (!BLOCKING.has(via.severity)) continue;
        contributors++;
        if (!isApprovedAdvisory(via)) ok = false;
      }
    }
    if (contributors === 0) ok = false;
    memo.set(name, ok);
    return ok;
  };

  const excepted = [], nonBlocking = [];
  for (const name of Object.keys(vulns).sort()) {
    const v = vulns[name];
    const advisories = v.via.filter(x => typeof x === 'object').map(x => advisoryId(x));
    if (!BLOCKING.has(v.severity)) { nonBlocking.push({ name, severity: v.severity, advisories }); continue; }
    if (v.severity === 'critical') { violations.push(`${name}: CRITICAL finding (never excepted)`); continue; }
    if (!explained(name)) { violations.push(`${name}: HIGH finding not explained by the approved advisory ${APPROVED.id} (via ${describeVia(v)})`); continue; }
    const scope = scopeProblems(name, v, graph);
    if (scope.length) { violations.push(...scope); continue; }
    excepted.push({ name, severity: v.severity, nodes: v.nodes.slice().sort(), advisories });
  }
  if (expired) excepted.length = 0;
  const counts = SEVERITIES.map(s => `${s}=${audit.metadata.vulnerabilities[s]}`).join(' ');
  const daysLeft = Math.ceil((until - now) / 86400000);
  const summary = `npm audit: ${counts} total=${audit.metadata.vulnerabilities.total} | excepted HIGH=${excepted.length} under ${APPROVED.id} (expires ${APPROVED.until}, ${expired ? 'EXPIRED' : daysLeft + ' day(s) left'}) | non-blocking=${nonBlocking.length} | violations=${violations.length}`;
  return { violations, excepted, nonBlocking, summary };
}

function isApprovedAdvisory(a) {
  return a.url === APPROVED.url && a.name === APPROVED.package && a.severity === APPROVED.severity;
}

function advisoryId(a) {
  return typeof a.url === 'string' ? a.url.split('/').pop() : `source:${a.source}`;
}

function describeVia(v) {
  return v.via.map(x => (typeof x === 'string' ? x : `${advisoryId(x)}/${x.name}/${x.severity}`)).join(', ');
}

/** The finding's installed nodes must all be dev-only and reachable only from the approved dev roots. */
function scopeProblems(name, v, graph) {
  const problems = [];
  if (v.isDirect && !APPROVED.devRoots.includes(name)) problems.push(`${name}: direct dependency outside the approved development roots`);
  if (v.nodes.length === 0) problems.push(`${name}: finding lists no installed nodes`);
  for (const node of v.nodes) {
    const pkg = graph.packages[node];
    if (!pkg) { problems.push(`${name}: node ${node} is not in package-lock.json`); continue; }
    if (pkg.dev !== true) problems.push(`${name}: node ${node} is not development-only (lockfile dev flag missing)`);
    const roots = rootsOf(node, graph);
    const outside = [...roots].filter(r => !APPROVED.devRoots.includes(r));
    if (roots.size === 0) problems.push(`${name}: node ${node} is not reachable from the root package`);
    if (outside.length) problems.push(`${name}: node ${node} is reachable through ${outside.join(', ')} (only ${APPROVED.devRoots.join(', ')} is approved)`);
  }
  return problems;
}

/** Root dependency names through which [node] is reachable. */
function rootsOf(node, graph) {
  const roots = new Set(); const seen = new Set([node]); const queue = [node];
  while (queue.length) {
    const k = queue.shift();
    for (const parent of graph.parents.get(k) || []) {
      if (parent === '') { roots.add(nameOf(k)); continue; }
      if (!seen.has(parent)) { seen.add(parent); queue.push(parent); }
    }
  }
  return roots;
}

function nameOf(key) {
  const i = key.lastIndexOf('node_modules/');
  return i < 0 ? key : key.slice(i + 'node_modules/'.length);
}

/** package-lock v2/v3: packages map plus a reverse dependency map (child key -> parent keys). */
function lockGraph(lock) {
  if (!lock || typeof lock !== 'object' || ![2, 3].includes(lock.lockfileVersion)) throw new InspectionError('package-lock.json must be lockfileVersion 2 or 3');
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object' || !packages['']) throw new InspectionError('package-lock.json has no root package entry');
  const root = packages[''];
  for (const r of APPROVED.devRoots) {
    if (!root.devDependencies || !(r in root.devDependencies)) throw new InspectionError(`approved development root ${r} is not a root devDependency`);
    if ((root.dependencies && r in root.dependencies) || (root.optionalDependencies && r in root.optionalDependencies)) throw new InspectionError(`approved development root ${r} is also a production dependency`);
  }
  const parents = new Map();
  for (const [key, pkg] of Object.entries(packages)) {
    if (pkg.link) continue;
    const deps = Object.assign({}, pkg.dependencies, pkg.optionalDependencies, pkg.peerDependencies, key === '' ? pkg.devDependencies : {});
    for (const dep of Object.keys(deps)) {
      const child = resolve(packages, key, dep);
      if (!child) continue; // optional or peer dependency that is not installed
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child).add(key);
    }
  }
  return { packages, parents };
}

/** Node module resolution inside the lockfile: nearest node_modules/<dep> walking up from [from]. */
function resolve(packages, from, dep) {
  let base = from;
  for (;;) {
    const candidate = (base ? base + '/' : '') + 'node_modules/' + dep;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i < 0 ? '' : base.slice(0, i);
  }
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
      if (typeof via === 'string') continue;
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
  for (const e of r.excepted) console.log(`EXCEPTED ${e.severity.toUpperCase()} ${e.name} [${e.advisories.join(',') || 'via chain'}] nodes: ${e.nodes.join(', ')}`);
  for (const n of r.nonBlocking) console.log(`non-blocking ${n.severity} ${n.name}${n.advisories.length ? ' [' + n.advisories.join(',') + ']' : ''}`);
  console.log(r.summary);
  if (r.violations.length) {
    console.error('FAIL npm audit gate (BC-SEC-FORGE-22)');
    for (const v of r.violations) console.error('  - ' + v);
    return 1;
  }
  console.log('PASS npm audit gate (BC-SEC-FORGE-22)');
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
