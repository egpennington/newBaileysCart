#!/usr/bin/env node
// FORGE-FP-01 path verdict. Runs as the always-executed "Path verification" job, which the
// FORGE gate needs. It turns the classifier decision and the results of the FULL-only jobs into a
// single success/failure, so the gate body (pinned by scripts/check-osv-exceptions.mjs) stays
// unchanged and still fails on any non-success upstream result.
//
//   classify must be `success` with path FAST or FULL; anything else fails.
//   FULL: every FULL-only job must be `success`.
//   FAST: every FULL-only job must be `skipped` (none may run, fail or be cancelled).
// A missing job, a missing output or an unexpected result fails. Uses only Node.js built-ins.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FULL_ONLY_JOBS = ['android', 'repeat-build', 'backend', 'backend-emulator'];

/** needs: the `toJSON(needs)` object from GitHub Actions. Returns { ok, path, problems }. */
export function verdict(needs) {
  const problems = [];
  if (needs === null || typeof needs !== 'object' || Array.isArray(needs)) {
    return { ok: false, path: null, problems: ['needs context missing or malformed'] };
  }
  const expected = ['classify', ...FULL_ONLY_JOBS];
  for (const k of Object.keys(needs)) if (!expected.includes(k)) problems.push(`unexpected job in needs: ${k}`);
  for (const k of expected) if (!(k in needs)) problems.push(`job missing from needs: ${k}`);

  const c = needs.classify;
  const path = c && c.outputs ? c.outputs.path : undefined;
  if (!c || c.result !== 'success') problems.push(`classify result is ${JSON.stringify(c && c.result)}, not success`);
  if (path !== 'FAST' && path !== 'FULL') problems.push(`classify path output is ${JSON.stringify(path)}, not FAST or FULL`);

  const want = path === 'FAST' ? 'skipped' : 'success';
  if (path === 'FAST' || path === 'FULL') {
    for (const j of FULL_ONLY_JOBS) {
      const r = needs[j] && needs[j].result;
      if (r !== want) problems.push(`${path} path requires ${j} to be ${want}, found ${JSON.stringify(r)}`);
    }
  }
  return { ok: problems.length === 0, path: path ?? null, problems };
}

function main() {
  let needs;
  try {
    needs = JSON.parse(process.env.FORGE_NEEDS_JSON ?? '');
  } catch {
    needs = null;
  }
  const v = verdict(needs);
  const lines = [`### FORGE path verification: ${v.ok ? 'PASS' : 'FAIL'} (${v.path ?? 'no path'})`, ''];
  for (const [k, val] of Object.entries(needs && typeof needs === 'object' ? needs : {})) lines.push(`- ${k}: ${val && val.result}`);
  for (const p of v.problems) lines.push(`- PROBLEM: ${p}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (!v.ok) {
    console.error('::error title=FORGE path verification failed::' + v.problems.join('; '));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(`::error title=FORGE path verification crashed::${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  }
}
