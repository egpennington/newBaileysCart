// Verity ProofSuite/ProofPoint consistency check (read-only). Usage: node scripts/verity-check.cjs [repoRoot]
// Brought into the repository by FORGE-FP-01 from the WP-03 evidence copy (logic unchanged) so that
// FORGE runs it on every path. Needs the `yaml` package from backend/functions (npm ci).
// Exit 0 pass, 1 any inconsistency or parse problem.
const fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const YAML = require(path.join(root, 'backend/functions/node_modules/yaml'));
const dir = path.join(root, 'tests/verity');
const errs = [], ok = [];
const load = (sub) => fs.readdirSync(path.join(dir, sub)).filter(f => /\.ya?ml$/.test(f)).map(f => {
  const p = path.join(dir, sub, f), txt = fs.readFileSync(p, 'utf8');
  const doc = YAML.parseDocument(txt, { uniqueKeys: true, strict: true });
  if (doc.errors.length) errs.push(`${sub}/${f}: parse errors: ${doc.errors.map(e => e.message).join('; ')}`);
  if (doc.warnings.length) errs.push(`${sub}/${f}: parse warnings: ${doc.warnings.map(e => e.message).join('; ')}`);
  const j = doc.toJS();
  if (!j || j.id !== f.replace(/\.ya?ml$/, '')) errs.push(`${sub}/${f}: id ${j && j.id} != filename`);
  return { f, j: j || {} };
});
const pps = load('proofpoints'), suites = load('suites');
console.log(`parsed ${pps.length} proofpoints + ${suites.length} suites = ${pps.length + suites.length} files`);
const ppIds = new Map();
for (const { f, j } of pps) { if (ppIds.has(j.id)) errs.push(`duplicate ProofPoint id ${j.id} (${f}, ${ppIds.get(j.id)})`); ppIds.set(j.id, f); }
const suiteIds = new Map(), listed = new Map();
for (const { f, j } of suites) {
  if (suiteIds.has(j.id)) errs.push(`duplicate suite id ${j.id}`); suiteIds.set(j.id, j);
  // Two schemas in use: WP-00 'proofpoints:' list; WP-03 'proofpoints_in_slice_N' / 'proofpoints_later_slices' lists
  // with optional ' (partial)' annotations. Later-slice entries are planned IDs and need not have a file yet.
  const keys = Object.keys(j).filter(k => /^proofpoints/.test(k));
  if (!keys.length) { errs.push(`${f}: no proofpoints key`); continue; }
  const list = [];
  for (const k of keys) {
    if (!Array.isArray(j[k])) { errs.push(`${f}: ${k} not a list`); continue; }
    for (const raw of j[k]) { const id = String(raw).replace(/\s+\(.*\)\s*$/, ''); if (!/^PL-PP-WP\d\d-\d\d[a-z]?$/.test(id)) errs.push(`${f}: malformed entry "${raw}"`); list.push({ id, planned: k === 'proofpoints_later_slices' }); }
  }
  const seen = new Set();
  for (const { id, planned } of list) {
    if (seen.has(id)) errs.push(`${f}: duplicate entry ${id}`); seen.add(id);
    if (!ppIds.has(id)) { if (planned) { console.log(`  note: ${j.id} later-slice ${id} has no file yet (planned)`); } else errs.push(`${f}: lists ${id} but no ProofPoint file exists`); }
    if (listed.has(id)) errs.push(`${id} listed in both ${listed.get(id)} and ${j.id}`); listed.set(id, j.id);
  }
  console.log(`suite ${j.id}: ${list.length} entries: ${list.map(x => x.id + (x.planned ? '*' : '')).join(', ')}  (* = later slice)`);
}
for (const { f, j } of pps) {
  if (!j.suite) { errs.push(`${f}: no suite field`); continue; }
  if (!suiteIds.has(j.suite)) errs.push(`${f}: suite ${j.suite} does not exist`);
  else if (listed.get(j.id) !== j.suite) errs.push(`${f}: declares suite ${j.suite} but is listed in ${listed.get(j.id) || 'no suite'}`);
}
const s = suiteIds.get('PS-BUILD-SUPPLY-CHAIN');
if (s) { const l = s.proofpoints; console.log(`PS-BUILD-SUPPLY-CHAIN proofpoints: ${JSON.stringify(l)}`); const i = l.indexOf('PL-PP-WP00-04'); console.log(`04b position: ${l.indexOf('PL-PP-WP00-04b')} (immediately after 04 at ${i}: ${l[i + 1] === 'PL-PP-WP00-04b'})`); if (l[i + 1] !== 'PL-PP-WP00-04b') errs.push('04b not immediately after 04'); }
console.log(errs.length ? 'FAIL\n' + errs.map(e => '  - ' + e).join('\n') : 'PASS: all files parse (strict, unique keys), ids match filenames, no duplicates, every suite entry resolves, every ProofPoint is listed in exactly the suite it declares');
process.exitCode = errs.length ? 1 : 0;
