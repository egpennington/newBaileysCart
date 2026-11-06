// FORGE-FP-01 classifier tests: pure rules, raw-diff parsing, and real git histories in a
// temporary repository (pull request, develop push and merge, feature push, renames, deletions,
// modes, symlinks, missing bases, unsupported events, classifier failure). Node built-ins only.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FAST, FULL, classifyEntries, decide, parseRawDiff, resolveRange, ruleFor } from '../classify.mjs';

const CLI = fileURLToPath(new URL('../classify.mjs', import.meta.url));
let dir;
const git = (args, opts = {}) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.filemode=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
const sha = (rev = 'HEAD') => git(['rev-parse', rev]).toString().trim();
const write = (p, text = `content ${Math.random()}\n`) => {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), text);
};
const commit = (msg) => {
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', msg]);
  return sha();
};
let BASE;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-classify-'));
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'forge@example.invalid']);
  git(['config', 'user.name', 'FORGE test']);
  for (const p of [
    'README.md',
    'docs/specs/R-04/report.md',
    'docs/decisions/DECISION_REGISTER.md',
    'docs/wp03/evidence/EVIDENCE_MANIFEST.md',
    'tests/verity/proofpoints/PL-PP-WP03-33.yaml',
    'tests/verity/suites/PS-BILLING-LIFECYCLE.yaml',
    'backend/functions/src/index.ts',
    'backend/functions/test/unit/a.test.ts',
    'backend/functions/package-lock.json',
    'android/app/build.gradle.kts',
    'android/app/src/main/Main.kt',
    '.github/workflows/forge-wp00.yml',
    'scripts/check-osv-exceptions.mjs',
    'backend/firestore.rules',
  ]) {
    write(p, `base ${p}\nline two, with a comma\n`);
  }
  BASE = commit('base');
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Branch from BASE, apply `change`, commit; return the decision for push(develop), feature push and PR. */
function scenario(name, change) {
  git(['checkout', '-q', '-B', `s/${name}`, BASE]);
  const head = change() === 'committed' ? sha() : commit(name);
  const g = (args) => git(args);
  return {
    head,
    develop: decide({ eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: head }, g),
    feature: decide({ eventName: 'push', ref: `refs/heads/feature/${name}`, sha: head, developSha: BASE }, g),
    pr: decide({ eventName: 'pull_request', ref: 'refs/pull/1/merge', baseRef: 'develop', prBaseSha: BASE, prHeadSha: head }, g),
  };
}
const all = (r, want, reason) => {
  for (const k of ['develop', 'feature', 'pr']) {
    assert.equal(r[k].path, want, `${k}: ${r[k].reason}`);
    if (reason) assert.match(r[k].reason, reason, `${k}: ${r[k].reason}`);
  }
};

describe('allowlist rules', () => {
  test('exact allowlist', () => {
    for (const p of [
      'README.md',
      'docs/a.md',
      'docs/specs/R-04/CODI_X_v1.0.md',
      'tests/verity/proofpoints/PL-PP-WP03-33.yaml',
      'tests/verity/proofpoints/PL-PP-WP00-04b.yaml',
      'tests/verity/suites/PS-BUILD-SUPPLY-CHAIN.yaml',
    ]) {
      assert.notEqual(ruleFor(p), null, p);
    }
    for (const p of [
      '',
      'readme.md',
      'docs/README',
      'docs/a.txt',
      'docs/a.MD',
      'docs/a.md.exe',
      'docs/specs/pkg.zip',
      'docs/.hidden.md',
      'docs/../backend/x.md',
      'docs/./a.md',
      'docs//a.md',
      'docs/a b.md',
      'docs/café.md',
      'docs\\a.md',
      'docs/a\n.md',
      '/docs/a.md',
      'notes.md',
      'android/README.md',
      'backend/functions/README.md',
      '.github/workflows/forge-wp00.yml',
      'scripts/forge/classify.mjs',
      'tests/verity/proofpoints/foo.yaml',
      'tests/verity/proofpoints/PL-PP-WP03-33.yml',
      'tests/verity/proofpoints/sub/PL-PP-WP03-33.yaml',
      'tests/verity/suites/ps-lower.yaml',
      'tests/verity/run.yaml',
      `docs/${'a'.repeat(260)}.md`,
    ]) {
      assert.equal(ruleFor(p), null, JSON.stringify(p));
    }
  });

  test('change type and mode', () => {
    const e = (status, oldMode, newMode, p = 'docs/a.md') => ({ status, oldMode, newMode, path: p });
    assert.equal(classifyEntries([e('M', '100644', '100644')]).path, FAST);
    assert.equal(classifyEntries([e('A', '000000', '100644')]).path, FAST);
    for (const bad of [e('D', '100644', '000000'), e('T', '100644', '120000'), e('M', '100644', '100755'), e('A', '000000', '120000'), e('A', '000000', '160000'), e('R', '100644', '100644'), e('C', '100644', '100644'), e('U', '100644', '100644')]) {
      assert.equal(classifyEntries([bad]).path, FULL, JSON.stringify(bad));
    }
    assert.equal(classifyEntries([]).path, FULL);
    assert.equal(classifyEntries(undefined).path, FULL);
    assert.equal(classifyEntries([e('M', '100644', '100644'), e('M', '100644', '100644', 'backend/x.ts')]).path, FULL);
  });

  test('raw diff parsing rejects malformed input', () => {
    const ok = Buffer.from(':100644 100644 aaaaaaa bbbbbbb M\0docs/a.md\0');
    assert.deepEqual(parseRawDiff(ok), [{ oldMode: '100644', newMode: '100644', status: 'M', path: 'docs/a.md' }]);
    assert.deepEqual(parseRawDiff(Buffer.alloc(0)), []);
    for (const bad of [':100644 100644 aaaa bbbb M\0', 'garbage\0docs/a.md\0', ':100644 100644 aaaa bbbb R100\0a\0b\0', ':1006 100644 aa bb M\0docs/a.md\0']) {
      assert.throws(() => parseRawDiff(Buffer.from(bad)), /raw diff/, JSON.stringify(bad));
    }
  });
});

describe('real git histories', () => {
  test('single comma edit in a Markdown report -> FAST', () => {
    all(scenario('comma', () => write('docs/specs/R-04/report.md', 'base docs/specs/R-04/report.md\nline two with a comma\n')), FAST);
  });
  test('decision register and evidence manifest edit -> FAST', () => {
    all(scenario('register', () => {
      write('docs/decisions/DECISION_REGISTER.md');
      write('docs/wp03/evidence/EVIDENCE_MANIFEST.md');
    }), FAST);
  });
  test('Verity metadata only -> FAST; Markdown + Verity -> FAST; new docs file -> FAST', () => {
    all(scenario('verity', () => write('tests/verity/proofpoints/PL-PP-WP03-33.yaml')), FAST);
    all(scenario('mdverity', () => {
      write('README.md');
      write('tests/verity/suites/PS-BILLING-LIFECYCLE.yaml');
      write('tests/verity/proofpoints/PL-PP-WP03-40.yaml');
    }), FAST);
    all(scenario('newdoc', () => write('docs/specs/R-04/CODI_NEW_v1.0.md')), FAST);
  });
  test('backend, Android, workflow, scripts, lockfile, rules, unfamiliar path -> FULL', () => {
    for (const p of [
      'backend/functions/src/index.ts',
      'backend/functions/test/unit/a.test.ts',
      'android/app/build.gradle.kts',
      'android/app/src/main/Main.kt',
      '.github/workflows/forge-wp00.yml',
      'scripts/check-osv-exceptions.mjs',
      'backend/functions/package-lock.json',
      'backend/firestore.rules',
      'unfamiliar/thing.cfg',
      'docs/notes.txt',
      'docs/diagram.png',
    ]) {
      all(scenario(`full-${p.replace(/[^a-z0-9]/gi, '-')}`, () => write(p)), FULL, /not on the FAST allowlist/);
    }
  });
  test('docs + code together -> FULL', () => {
    all(scenario('mixed', () => {
      write('docs/specs/R-04/report.md');
      write('backend/functions/src/index.ts');
    }), FULL, /backend\/functions\/src\/index\.ts/);
  });
  test('renames to/from forbidden paths, renames inside docs, deletions -> FULL', () => {
    all(scenario('ren-out', () => git(['mv', 'docs/specs/R-04/report.md', 'backend/functions/src/report.md'])), FULL, /not on the FAST allowlist|change type D/);
    all(scenario('ren-in', () => git(['mv', 'scripts/check-osv-exceptions.mjs', 'docs/check.md'])), FULL, /scripts\/check-osv-exceptions\.mjs/);
    all(scenario('ren-docs', () => git(['mv', 'docs/specs/R-04/report.md', 'docs/specs/R-04/report2.md'])), FULL, /change type D/);
    all(scenario('del-doc', () => git(['rm', '-q', 'docs/specs/R-04/report.md'])), FULL, /change type D/);
  });
  test('executable bit and symlink on an allowlisted path -> FULL', () => {
    all(scenario('chmod', () => {
      git(['update-index', '--chmod=+x', 'README.md']);
      git(['commit', '-q', '-m', 'chmod']);
      return 'committed';
    }), FULL, /mode 100644->100755/);
    all(scenario('symlink', () => {
      const blob = git(['hash-object', '-w', '--stdin'], { input: '../backend/functions/src/index.ts' }).toString().trim();
      git(['update-index', '--add', '--cacheinfo', `120000,${blob},docs/link.md`]);
      git(['commit', '-q', '-m', 'symlink']);
      return 'committed';
    }), FULL, /mode 000000->120000/);
  });
  test('empty change set -> FULL', () => {
    git(['checkout', '-q', '-B', 's/empty', BASE]);
    const head = commit('empty');
    assert.match(decide({ eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: head }, git).reason, /no changed files/);
    assert.match(decide({ eventName: 'push', ref: 'refs/heads/develop', before: head, sha: head }, git).reason, /empty comparison range/);
  });

  test('merge into develop: range is before..after; develop code already verified is not re-counted', () => {
    git(['checkout', '-q', '-B', 'dev2', BASE]);
    write('backend/functions/src/index.ts');
    const devCode = commit('code already on develop');
    git(['checkout', '-q', '-B', 'docsbranch', BASE]);
    write('docs/specs/R-04/report.md');
    const docsHead = commit('docs');
    // PR context: develop moved on with code; the PR itself is docs-only.
    assert.equal(decide({ eventName: 'pull_request', baseRef: 'develop', prBaseSha: devCode, prHeadSha: docsHead }, git).path, FAST);
    git(['checkout', '-q', 'dev2']);
    git(['merge', '-q', '--no-ff', '-m', 'Merge docs', 'docsbranch']);
    const merge = sha();
    assert.equal(decide({ eventName: 'push', ref: 'refs/heads/develop', before: devCode, sha: merge }, git).path, FAST);
    // If the push range also covers the code commit, it is FULL.
    assert.equal(decide({ eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: merge }, git).path, FULL);
  });

  test('merge of a mixed branch into develop -> FULL', () => {
    git(['checkout', '-q', '-B', 'mixedbranch', BASE]);
    write('docs/a.md');
    commit('docs');
    write('android/app/src/main/Main.kt');
    commit('code');
    write('docs/b.md');
    const head = commit('more docs');
    git(['checkout', '-q', '-B', 'dev3', BASE]);
    git(['merge', '-q', '--no-ff', '-m', 'Merge mixed', 'mixedbranch']);
    assert.equal(decide({ eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: sha() }, git).path, FULL);
    assert.equal(decide({ eventName: 'pull_request', baseRef: 'develop', prBaseSha: BASE, prHeadSha: head }, git).path, FULL);
    // Feature push of only the last docs commit still compares the whole branch with develop.
    assert.equal(decide({ eventName: 'push', ref: 'refs/heads/feature/mixed', before: sha('mixedbranch~1'), sha: head, developSha: BASE }, git).path, FULL);
  });
});

describe('ranges and events fail closed', () => {
  test('missing, zero, malformed or unknown bases -> FULL', () => {
    const head = sha('docsbranch');
    const cases = [
      { eventName: 'push', ref: 'refs/heads/develop', before: '0000000000000000000000000000000000000000', sha: head },
      { eventName: 'push', ref: 'refs/heads/develop', before: '', sha: head },
      { eventName: 'push', ref: 'refs/heads/develop', before: 'abc', sha: head },
      { eventName: 'push', ref: 'refs/heads/develop', before: 'f'.repeat(40), sha: head },
      { eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: 'e'.repeat(40) },
      { eventName: 'push', ref: 'refs/heads/feature/x', sha: head, developSha: '' },
      { eventName: 'push', ref: 'refs/heads/feature/x', sha: head, developSha: 'd'.repeat(40) },
      { eventName: 'pull_request', baseRef: 'develop', prBaseSha: '', prHeadSha: head },
      { eventName: 'pull_request', baseRef: 'develop', prBaseSha: BASE, prHeadSha: 'c'.repeat(40) },
    ];
    for (const c of cases) assert.equal(decide(c, git).path, FULL, JSON.stringify(c));
  });

  test('main, manual, unsupported events and refs -> FULL regardless of docs-only paths', () => {
    const head = sha('docsbranch');
    const cases = [
      { eventName: 'push', ref: 'refs/heads/main', before: BASE, sha: head },
      { eventName: 'pull_request', baseRef: 'main', prBaseSha: BASE, prHeadSha: head },
      { eventName: 'workflow_dispatch', ref: 'refs/heads/develop', sha: head },
      { eventName: 'pull_request_target', baseRef: 'develop', prBaseSha: BASE, prHeadSha: head },
      { eventName: 'schedule', ref: 'refs/heads/develop', sha: head },
      { eventName: 'release', ref: 'refs/tags/v1', sha: head },
      { eventName: 'push', ref: 'refs/tags/v1', before: BASE, sha: head },
      { eventName: 'push', ref: 'refs/heads/other', before: BASE, sha: head },
      { eventName: '', ref: '', sha: head },
    ];
    for (const c of cases) {
      const d = decide(c, git);
      assert.equal(d.path, FULL, JSON.stringify(c));
      assert.equal(resolveRange(c, git).full !== undefined, true);
    }
  });

  test('a broken git answer makes the classifier throw (never FAST)', () => {
    const head = sha('docsbranch');
    const broken = (args) => (args[0] === 'diff' ? Buffer.from('not a raw diff\0x\0') : git(args));
    assert.throws(() => decide({ eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: head }, broken));
    const failing = (args) => {
      if (args[0] === 'diff') throw new Error('git diff failed');
      return git(args);
    };
    assert.throws(() => decide({ eventName: 'push', ref: 'refs/heads/develop', before: BASE, sha: head }, failing));
  });

  test('CLI writes path=FAST/FULL to GITHUB_OUTPUT; a crash exits 1 and writes no path', () => {
    const out = path.join(dir, 'gh-output.txt');
    const run = (env, cwd = dir) =>
      execFileSync(process.execPath, [CLI], { cwd, env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '', ...env }, stdio: 'pipe' });
    const head = sha('docsbranch');
    fs.writeFileSync(out, '');
    run({ FORGE_EVENT_NAME: 'push', FORGE_REF: 'refs/heads/develop', FORGE_BEFORE: BASE, FORGE_SHA: head });
    assert.match(fs.readFileSync(out, 'utf8'), /^path=FAST$/m);
    fs.writeFileSync(out, '');
    run({ FORGE_EVENT_NAME: 'push', FORGE_REF: 'refs/heads/main', FORGE_BEFORE: BASE, FORGE_SHA: head });
    assert.match(fs.readFileSync(out, 'utf8'), /^path=FULL$/m);
    // Outside a git repository every commit is unavailable: FULL, not a crash.
    fs.writeFileSync(out, '');
    run({ FORGE_EVENT_NAME: 'push', FORGE_REF: 'refs/heads/develop', FORGE_BEFORE: BASE, FORGE_SHA: head }, os.tmpdir());
    assert.match(fs.readFileSync(out, 'utf8'), /^path=FULL$/m);
    // Crash: GITHUB_OUTPUT points at a directory, so writing the decision fails.
    let code = 0;
    try {
      run({ FORGE_EVENT_NAME: 'push', FORGE_REF: 'refs/heads/develop', FORGE_BEFORE: BASE, FORGE_SHA: head, GITHUB_OUTPUT: dir });
    } catch (e) {
      code = e.status;
    }
    assert.equal(code, 1, 'classifier failure exits non-zero');
  });
});
