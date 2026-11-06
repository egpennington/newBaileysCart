#!/usr/bin/env node
// FORGE-FP-01 documentation structure check. Every tracked README.md and docs/**/*.md must be valid
// UTF-8 without NUL bytes, have balanced ``` code fences, and keep a constant column count within
// each Markdown table (escaped pipes and pipes in inline code are ignored). Exit 0 pass, 1 violation,
// 2 inspection error. Uses only Node.js built-ins.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function checkMarkdown(name, buf) {
  const problems = [];
  if (buf.includes(0)) return [`${name}: contains NUL bytes`];
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return [`${name}: not valid UTF-8`];
  }
  const lines = text.split(/\r?\n/);
  let fence = null;
  let cols = null;
  lines.forEach((line, i) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = { mark: f[1][0], len: f[1].length, line: i + 1 };
      else if (f[1][0] === fence.mark && f[1].length >= fence.len && line.trim() === f[1]) fence = null;
      cols = null;
      return;
    }
    if (fence !== null) return;
    if (/^\s*\|/.test(line)) {
      const c = line.replace(/\\\|/g, '').replace(/`[^`]*`/g, 'x').split('|').length;
      if (cols === null) cols = c;
      else if (c !== cols) problems.push(`${name}:${i + 1}: table row has ${c - 2} cells, header has ${cols - 2}`);
    } else {
      cols = null;
    }
  });
  if (fence !== null) problems.push(`${name}:${fence.line}: code fence never closed`);
  return problems;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'README.md', 'docs/*.md', 'docs/**/*.md'])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  if (files.length === 0) throw new Error('no tracked Markdown files found');
  const problems = files.flatMap((f) => checkMarkdown(f, fs.readFileSync(f)));
  for (const p of problems) console.log(`  - ${p}`);
  console.log(problems.length ? `FAIL: ${problems.length} problem(s) in ${files.length} Markdown file(s)` : `PASS: ${files.length} Markdown file(s)`);
  process.exitCode = problems.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(`::error title=FORGE docs check could not run::${err && err.message ? err.message : String(err)}`);
    process.exit(2);
  }
}
