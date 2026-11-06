#!/usr/bin/env node
// FORGE-FP-01 change classifier. Decides whether a FORGE run may take the FAST path (approved
// documentation and Verity metadata only) or must take the FULL path (everything else).
//
// Fail closed:
//   - Only an exhaustive allowlist of paths, modes and change types can be FAST. Anything else,
//     including deletions, renames into or out of the allowlist (seen as delete + add), type or mode
//     changes, symlinks, unusual path characters and an empty change set, is FULL.
//   - main, workflow_dispatch and every unsupported event are FULL regardless of paths.
//   - A missing, all-zero or unreachable comparison base is FULL.
//   - An internal error exits non-zero and writes no path; the "Path verification" job and the
//     FORGE gate then fail. The script never reports FAST by default.
//
// It reads only the GitHub event context passed in environment variables and local git objects.
// No labels, commit messages or other user-controlled hints are consulted.
// Uses only Node.js built-ins.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FAST = 'FAST';
export const FULL = 'FULL';
export const MAX_PATH_LENGTH = 255;
const ZERO_SHA = /^0+$/;
const SHA = /^[0-9a-f]{40}$/;

/** Exhaustive FAST allowlist. Each segment starts with an alphanumeric (no dot files, no `..`). */
export const FAST_RULES = [
  { id: 'readme', re: /^README\.md$/ },
  { id: 'docs-markdown', re: /^docs\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md$/ },
  { id: 'verity-proofpoint', re: /^tests\/verity\/proofpoints\/PL-PP-WP[0-9]{2}-[0-9]{2}[a-z]?\.yaml$/ },
  { id: 'verity-suite', re: /^tests\/verity\/suites\/PS-[A-Z0-9]+(?:-[A-Z0-9]+)*\.yaml$/ },
];

/** Regular, non-executable file in both old (or absent) and new state. */
const OK_NEW_MODE = '100644';
const OK_OLD_MODES = new Set(['100644', '000000']);

export function ruleFor(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) return null;
  // Control characters, backslashes and non-ASCII never qualify.
  if (/[^\x21-\x7e]/.test(path) || path.includes('\\') || path.includes('//')) return null;
  if (path.split('/').some((s) => s === '.' || s === '..')) return null;
  const rule = FAST_RULES.find((r) => r.re.test(path));
  return rule ? rule.id : null;
}

/**
 * Parse `git diff --raw -z --no-renames` output. Records are
 * ":<oldmode> <newmode> <oldsha> <newsha> <status>\0<path>\0".
 * Throws on anything unexpected (the caller fails closed).
 */
export function parseRawDiff(buf) {
  const parts = buf.toString('utf8').split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.length % 2 !== 0) throw new Error('raw diff: odd number of fields');
  const entries = [];
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])$/.exec(parts[i]);
    if (!m) throw new Error(`raw diff: malformed record header at field ${i}`);
    entries.push({ oldMode: m[1], newMode: m[2], status: m[3], path: parts[i + 1] });
  }
  return entries;
}

/** Decide FAST/FULL for a list of changed entries. Returns { path, reason, files }. */
export function classifyEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { path: FULL, reason: 'no changed files detected', files: [] };
  const files = [];
  for (const e of entries) {
    const rule = ruleFor(e.path);
    let why = null;
    if (rule === null) why = 'path not on the FAST allowlist';
    else if (e.status !== 'A' && e.status !== 'M') why = `change type ${e.status} requires FULL`;
    else if (e.newMode !== OK_NEW_MODE || !OK_OLD_MODES.has(e.oldMode)) why = `file mode ${e.oldMode}->${e.newMode} requires FULL`;
    files.push({ path: e.path, status: e.status, rule, fast: why === null, why });
    if (why !== null) return { path: FULL, reason: `${JSON.stringify(e.path)}: ${why}`, files };
  }
  return { path: FAST, reason: `${files.length} file(s), all on the FAST allowlist`, files };
}

/**
 * Choose the comparison range from the event context. Returns { base, head } or { full: reason }.
 * `git` is a function(args[]) -> Buffer that throws on failure.
 */
export function resolveRange(ctx, git) {
  const ev = ctx.eventName;
  const ref = ctx.ref || '';
  const isCommit = (sha) => {
    if (!SHA.test(sha || '')) return false;
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };
  const mergeBase = (a, b) => {
    try {
      const out = git(['merge-base', a, b]).toString('utf8').trim();
      return SHA.test(out) ? out : null;
    } catch {
      return null;
    }
  };

  if (ev === 'pull_request') {
    if (ctx.baseRef !== 'develop') return { full: `pull request into ${JSON.stringify(ctx.baseRef)} (only develop may take FAST)` };
    if (!isCommit(ctx.prBaseSha) || !isCommit(ctx.prHeadSha)) return { full: 'pull request base or head commit unavailable' };
    const base = mergeBase(ctx.prBaseSha, ctx.prHeadSha);
    if (base === null) return { full: 'no merge base between pull request base and head' };
    return { base, head: ctx.prHeadSha };
  }
  if (ev === 'push') {
    if (ref === 'refs/heads/main') return { full: 'push to main always runs FULL' };
    if (!isCommit(ctx.sha)) return { full: 'pushed commit unavailable' };
    if (ref === 'refs/heads/develop') {
      if (!ctx.before || ZERO_SHA.test(ctx.before)) return { full: 'push has no previous commit (new branch)' };
      if (!isCommit(ctx.before)) return { full: 'previous commit of the push unavailable' };
      return { base: ctx.before, head: ctx.sha };
    }
    if (/^refs\/heads\/(feature|fix)\/./.test(ref)) {
      // Whole-branch comparison against develop, consistent with the pull request run.
      if (!isCommit(ctx.developSha)) return { full: 'origin/develop unavailable for the branch comparison' };
      const base = mergeBase(ctx.developSha, ctx.sha);
      if (base === null) return { full: 'no merge base with origin/develop' };
      return { base, head: ctx.sha };
    }
    return { full: `push to unsupported ref ${JSON.stringify(ref)}` };
  }
  return { full: `event ${JSON.stringify(ev)} always runs FULL` };
}

/** Full decision. Range problems are FULL; programming or git output errors throw. */
export function decide(ctx, git) {
  const range = resolveRange(ctx, git);
  if ('full' in range) return { path: FULL, reason: range.full, files: [], range: null };
  if (range.base === range.head) return { path: FULL, reason: 'empty comparison range', files: [], range };
  const raw = git(['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', range.base, range.head]);
  const result = classifyEntries(parseRawDiff(raw));
  return { ...result, range };
}

export function contextFromEnv(env) {
  return {
    eventName: env.FORGE_EVENT_NAME || '',
    ref: env.FORGE_REF || '',
    sha: env.FORGE_SHA || '',
    before: env.FORGE_BEFORE || '',
    baseRef: env.FORGE_BASE_REF || '',
    prBaseSha: env.FORGE_PR_BASE_SHA || '',
    prHeadSha: env.FORGE_PR_HEAD_SHA || '',
    developSha: env.FORGE_DEVELOP_SHA || '',
  };
}

function main() {
  const git = (args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const ctx = contextFromEnv(process.env);
  const d = decide(ctx, git);
  if (d.path !== FAST && d.path !== FULL) throw new Error('classifier produced no decision');
  const lines = [
    `### FORGE change classification: ${d.path}`,
    '',
    `- Event: \`${ctx.eventName}\` on \`${ctx.ref}\``,
    `- Range: ${d.range ? `\`${d.range.base}..${d.range.head}\`` : 'none'}`,
    `- Reason: ${d.reason}`,
    `- Files examined: ${d.files.length}`,
  ];
  for (const f of d.files.slice(0, 200)) lines.push(`  - ${f.fast ? 'FAST' : 'FULL'} ${f.status} \`${f.path}\`${f.rule ? ` (${f.rule})` : ''}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `path=${d.path}\nreason=${d.reason.replace(/[\r\n]/g, ' ')}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(`::error title=FORGE classifier failed::${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  }
}
