// Behavioural tests for the runtime hooks. Every case runs the real hook as a
// child process against a real temporary git repository.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, runHook, guard, gitIn, cleanupTemp, tempDir, TWO_TRUNK, HOOKS } from './helpers.mjs';

after(cleanupTemp);

// ---------------------------------------------------------------------------
describe('guard-git: production writes (two-trunk, on develop)', () => {
  const repo = makeRepo({ config: TWO_TRUNK });

  const denied = [
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin +feature:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin :main',
    'git push origin --delete main',
    'git push --all origin',
    'git checkout main && git merge develop',
    'git switch main; git merge --ff-only develop',
    'gh pr create --base main --title "release"',
    'gh pr create --title x --base=main',
    'bash -c "git push origin main"',
    'x=$(git push origin main)',
    'cd sub && git push origin main',
    'git -c core.pager=cat push origin main',
    'timeout 30 git push origin main',
    'GIT_TRACE=1 git push origin main',
  ];
  for (const cmd of denied) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd), `expected deny for: ${cmd}`));
  }

  test('denies the same command through the PowerShell tool', () => {
    assert.ok(guard(repo, 'git push origin main', 'PowerShell'));
    assert.ok(guard(repo, '& git push origin main', 'PowerShell'));
    assert.ok(guard(repo, 'pwsh -Command "git push origin main"', 'PowerShell'));
  });

  const allowed = [
    'git push origin feature/main-menu', // upstream false positive: \bmain\b matched inside main-menu
    'git push origin fix-main',
    'git push -u origin HEAD',
    'git push origin develop',
    'git push origin v1.2.0',
    'git log main..HEAD',
    'git diff main...HEAD --stat',
    'git fetch origin main',
    'git show main:README.md',
    'git checkout main',
    'git merge main',
    'git branch --show-current',
    'gh pr create --base develop --title x',
    'git commit -m "docs: never git push origin main"',
    "echo 'git push origin main' | node hook.mjs",
    'printf "%s" "git push origin main"',
  ];
  for (const cmd of allowed) {
    test(`allows: ${cmd}`, () => assert.equal(guard(repo, cmd), null, `unexpected deny for: ${cmd}`));
  }

  test('allows heredoc bodies that mention a production push', () => {
    const cmd = "cat > notes.md <<'EOF'\nnever run git push origin main\nEOF";
    assert.equal(guard(repo, cmd), null);
  });

  test('allows PowerShell here-string bodies that mention a production push', () => {
    const cmd = "$s = @'\ngit push origin main\n'@\nSet-Content notes.md $s";
    assert.equal(guard(repo, cmd, 'PowerShell'), null);
  });

  test('ignores non-shell tools and garbage payloads', () => {
    const r1 = runHook('guard-git.mjs', { tool_name: 'Read', tool_input: { file_path: 'x' } }, { cwd: repo });
    assert.equal(r1.code, 0);
    assert.equal(r1.stdout, '');
    const r2 = runHook('guard-git.mjs', 'not json at all', { cwd: repo });
    assert.equal(r2.code, 0);
    assert.equal(r2.stdout, '');
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: branching from production', () => {
  const repo = makeRepo({ config: TWO_TRUNK });

  for (const cmd of [
    'git checkout -b feature/x main',
    'git checkout -b feature/x origin/main',
    'git switch -c feature/x main',
    'git branch feature/x main',
    'git worktree add -b feature/x ../wt main',
  ]) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }

  test('allows cutting from integration', () => {
    assert.equal(guard(repo, 'git checkout -b feature/x develop'), null);
    assert.equal(guard(repo, 'git switch -c feature/x'), null); // standing on develop
  });

  test('denies an implicit cut while standing on production', () => {
    const onMain = makeRepo({ branch: 'main', config: TWO_TRUNK });
    const reason = guard(onMain, 'git checkout -b feature/x');
    assert.ok(reason);
    assert.match(reason, /standing on 'main'/);
  });

  test('resolves git aliases', () => {
    const r = makeRepo({ config: TWO_TRUNK });
    gitIn(r, 'config', 'alias.co', 'checkout');
    assert.ok(guard(r, 'git co -b feature/x main'));
  });

  test('gitflow allows hotfix branches from production', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, model: 'gitflow' } } });
    assert.equal(guard(r, 'git checkout -b hotfix/1.0.1 main'), null);
    assert.ok(guard(r, 'git checkout -b feature/y main'));
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: standing on production', () => {
  const repo = makeRepo({ branch: 'main', config: TWO_TRUNK });

  test('denies a bare push from production', () => assert.match(guard(repo, 'git push'), /bare `git push`/));
  test('denies commit on production', () => assert.ok(guard(repo, 'git commit -m "x"')));
  test('denies merge on production', () => assert.ok(guard(repo, 'git merge develop')));
  test('denies pulling another branch into production', () => assert.ok(guard(repo, 'git pull origin develop')));
  test('allows a plain pull on production', () => assert.equal(guard(repo, 'git pull'), null));
  test('allows read-only commands', () => {
    assert.equal(guard(repo, 'git status'), null);
    assert.equal(guard(repo, 'git log --oneline -5'), null);
  });
  test('allows switching away', () => assert.equal(guard(repo, 'git switch develop'), null));
  test('allows committing after switching away in the same command', () =>
    assert.equal(guard(repo, 'git switch develop && git commit -m "x"'), null));
});

// ---------------------------------------------------------------------------
describe('guard-git: integration branch safety', () => {
  const repo = makeRepo({ config: TWO_TRUNK });
  test('denies force-push to integration', () => {
    assert.ok(guard(repo, 'git push --force origin develop'));
    assert.ok(guard(repo, 'git push -f origin develop'));
    assert.ok(guard(repo, 'git push origin +develop'));
  });
  test('allows force-with-lease on a feature branch', () =>
    assert.equal(guard(repo, 'git push --force-with-lease origin feature/x'), null));
  test('denies deleting shared branches', () => {
    assert.ok(guard(repo, 'git branch -D develop'));
    assert.ok(guard(repo, 'git branch -d main'));
  });
  test('allows deleting a feature branch', () => assert.equal(guard(repo, 'git branch -D feature/old'), null));
});

// ---------------------------------------------------------------------------
describe('guard-git: discarding uncommitted work', () => {
  const repo = makeRepo({ config: TWO_TRUNK });
  writeFileSync(join(repo, 'README.md'), '# changed by the user\n');

  for (const cmd of ['git reset --hard', 'git reset --hard origin/develop', 'git checkout -- .', 'git checkout .', 'git restore .', 'git restore -- .']) {
    test(`denies on a dirty tree: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }
  test('allows unstaging', () => assert.equal(guard(repo, 'git restore --staged .'), null));
  test('allows restoring one explicit file', () => assert.equal(guard(repo, 'git restore README.md'), null));

  test('allows reset --hard on a clean tree', () => {
    const clean = makeRepo({ config: TWO_TRUNK });
    assert.equal(guard(clean, 'git reset --hard'), null);
  });

  test('git clean', () => {
    const r = makeRepo({ config: TWO_TRUNK });
    writeFileSync(join(r, 'new-work.txt'), 'untracked\n');
    assert.ok(guard(r, 'git clean -fd'));
    assert.ok(guard(r, 'git clean -fdx'));
    assert.equal(guard(r, 'git clean -n'), null);
    assert.equal(guard(r, 'git clean -nd'), null);
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: shared tree', () => {
  const repo = makeRepo({ config: { ...TWO_TRUNK, sharedTree: true } });
  for (const cmd of ['git add -A', 'git add .', 'git add --all', 'git add -u', 'git commit -am "x"', 'git commit --all -m x', 'git stash']) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }
  for (const cmd of ['git add src/a.ts src/b.ts', 'git add -u src/', 'git commit -m "x"', 'git stash push -- src/a.ts', 'git stash list', 'git stash pop']) {
    test(`allows: ${cmd}`, () => assert.equal(guard(repo, cmd), null));
  }
  test('broad staging is allowed on a solo tree', () => {
    const solo = makeRepo({ config: TWO_TRUNK });
    assert.equal(guard(solo, 'git add -A'), null);
    assert.equal(guard(solo, 'git stash'), null);
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: model and config variations', () => {
  test('trunk: commit on main allowed, push to main denied', () => {
    const r = makeRepo({ branch: 'main', branches: [], config: { version: 1, branching: { model: 'trunk', production: 'main' }, gates: [] } });
    assert.equal(guard(r, 'git commit -m "fix: typo"'), null);
    assert.ok(guard(r, 'git push origin main'));
    assert.ok(guard(r, 'git push'));
  });

  test('releaseOnRequestOnly: false lets production move', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, releaseOnRequestOnly: false } } });
    assert.equal(guard(r, 'git push origin main'), null);
  });

  test('protectedRefs globs', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, protectedRefs: ['release/*'] } } });
    assert.ok(guard(r, 'git push origin release/2.0'));
    assert.equal(guard(r, 'git push origin feature/release-notes'), null);
  });

  test('extraDeny from the config', () => {
    const r = makeRepo({
      config: { ...TWO_TRUNK, guard: { extraDeny: [{ pattern: 'npm\\s+publish', reason: 'Publishing is manual.', instead: 'ask the user' }] } },
    });
    const reason = guard(r, 'npm publish --access public');
    assert.match(reason, /Publishing is manual/);
    assert.match(reason, /Instead: ask the user/);
  });

  test('works with no config at all (defaults: main/develop)', () => {
    const r = makeRepo();
    assert.ok(guard(r, 'git push origin main'));
  });

  test('tolerates a BOM-prefixed, PowerShell-written config', () => {
    const r = makeRepo();
    mkdirSync(join(r, '.claude'), { recursive: true });
    writeFileSync(join(r, '.claude', 'sdlc.config.json'), '\uFEFF' + JSON.stringify({ ...TWO_TRUNK, branching: { ...TWO_TRUNK.branching, production: 'prod' } }));
    gitIn(r, 'branch', 'prod');
    assert.ok(guard(r, 'git push origin prod'));
    assert.equal(guard(r, 'git push origin main'), null);
  });
});

// ---------------------------------------------------------------------------
describe('guard-git: bypassing hooks', () => {
  const repo = makeRepo({ config: TWO_TRUNK });
  for (const cmd of [
    'git commit --no-verify -m "x"',
    'git commit -n -m "x"',
    'git push --no-verify origin feature/x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath .nothing',
    'HUSKY=0 git commit -m x',
    'AGENT_SETUP_ALLOW_PROTECTED=1 git push origin main',
  ]) {
    test(`denies: ${cmd}`, () => assert.ok(guard(repo, cmd)));
  }
  test('PowerShell env assignment is caught too', () => {
    assert.ok(guard(repo, '$env:HUSKY = "0"; git commit -m x', 'PowerShell'));
  });
  test('allowed when the config opts out', () => {
    const r = makeRepo({ config: { ...TWO_TRUNK, guard: { denyNoVerify: false } } });
    assert.equal(guard(r, 'git commit --no-verify -m "x"'), null);
  });
  test('ordinary flags that merely contain n are not mistaken for -n', () => {
    assert.equal(guard(repo, 'git commit --amend --no-edit'), null);
    assert.equal(guard(repo, 'git push -u origin feature/x'), null);
  });
});

// ---------------------------------------------------------------------------
describe('git-guard (git hooks for every agent)', () => {
  const run = (repo, hook, stdin = '', env = {}) =>
    spawnSync(process.execPath, [join(HOOKS, 'git-guard.mjs'), hook], { cwd: repo, input: stdin, encoding: 'utf8', env: { ...process.env, ...env } });
  const ZERO = '0'.repeat(40);

  test('pre-commit blocks on production, allows elsewhere', () => {
    const onMain = makeRepo({ branch: 'main', config: TWO_TRUNK });
    assert.equal(run(onMain, 'pre-commit').status, 1);
    const onDevelop = makeRepo({ config: TWO_TRUNK });
    assert.equal(run(onDevelop, 'pre-commit').status, 0);
  });

  test('pre-push blocks production and integration deletion, allows feature branches', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    const sha = gitIn(repo, 'rev-parse', 'HEAD');
    assert.equal(run(repo, 'pre-push', `refs/heads/main ${sha} refs/heads/main ${ZERO}\n`).status, 1);
    assert.equal(run(repo, 'pre-push', `(delete) ${ZERO} refs/heads/develop ${sha}\n`).status, 1);
    assert.equal(run(repo, 'pre-push', `refs/heads/feature/x ${sha} refs/heads/feature/x ${ZERO}\n`).status, 0);
    assert.equal(run(repo, 'pre-push', `refs/tags/v1 ${sha} refs/tags/v1 ${ZERO}\n`).status, 0);
  });

  test('pre-push blocks a history rewrite of the integration branch', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    const base = gitIn(repo, 'rev-parse', 'HEAD');
    writeFileSync(join(repo, 'a.txt'), 'a');
    gitIn(repo, 'add', 'a.txt');
    gitIn(repo, 'commit', '-q', '-m', 'a');
    const remoteTip = gitIn(repo, 'rev-parse', 'HEAD');
    gitIn(repo, 'reset', '-q', '--hard', base);
    writeFileSync(join(repo, 'b.txt'), 'b');
    gitIn(repo, 'add', 'b.txt');
    gitIn(repo, 'commit', '-q', '-m', 'b');
    const rewritten = gitIn(repo, 'rev-parse', 'HEAD');
    assert.equal(run(repo, 'pre-push', `refs/heads/develop ${rewritten} refs/heads/develop ${remoteTip}\n`).status, 1);
    // a fast-forward is fine
    assert.equal(run(repo, 'pre-push', `refs/heads/develop ${rewritten} refs/heads/develop ${base}\n`).status, 0);
  });

  test('the human escape hatch works', () => {
    const repo = makeRepo({ branch: 'main', config: TWO_TRUNK });
    assert.equal(run(repo, 'pre-commit', '', { AGENT_SETUP_ALLOW_PROTECTED: '1' }).status, 0);
  });

  test('trunk model: commits on main allowed, pushes to main blocked', () => {
    const repo = makeRepo({ branch: 'main', branches: [], config: { version: 1, branching: { model: 'trunk', production: 'main' }, gates: [] } });
    const sha = gitIn(repo, 'rev-parse', 'HEAD');
    assert.equal(run(repo, 'pre-commit').status, 0);
    assert.equal(run(repo, 'pre-push', `refs/heads/main ${sha} refs/heads/main ${ZERO}\n`).status, 1);
  });
});

// ---------------------------------------------------------------------------
describe('branch-check', () => {
  const ctx = (r) => r.json?.hookSpecificOutput?.additionalContext ?? '';

  test('emits the contract on startup, exit 0, valid JSON', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(ctx(r), /BRANCH CHECK/);
    assert.match(ctx(r), /integration, the default branch/);
  });

  test('flags production', () => {
    const repo = makeRepo({ branch: 'main', config: TWO_TRUNK });
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'compact' }, { cwd: repo });
    assert.match(ctx(r), /PRODUCTION/);
  });

  test('flags a stale feature branch', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    gitIn(repo, 'checkout', '-q', '-b', 'feature/x');
    gitIn(repo, 'checkout', '-q', 'develop');
    writeFileSync(join(repo, 'a.txt'), 'a');
    gitIn(repo, 'add', 'a.txt');
    gitIn(repo, 'commit', '-q', '-m', 'a');
    gitIn(repo, 'checkout', '-q', 'feature/x');
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'resume' }, { cwd: repo });
    assert.match(ctx(r), /0 ahead, 1 behind/);
    assert.match(ctx(r), /does NOT contain the tip/);
  });

  test('handles detached HEAD', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    gitIn(repo, 'checkout', '-q', '--detach');
    const r = runHook('branch-check.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.match(ctx(r), /detached/);
  });

  test('says when the config is missing or provisional', () => {
    const none = makeRepo();
    assert.match(ctx(runHook('branch-check.mjs', { hook_event_name: 'SessionStart' }, { cwd: none })), /\/sdlc-init/);
    const prov = makeRepo({ config: { ...TWO_TRUNK, _provisional: true } });
    assert.match(ctx(runHook('branch-check.mjs', { hook_event_name: 'SessionStart' }, { cwd: prov })), /PROVISIONAL/);
  });

  test('fails open on garbage and outside git', () => {
    const repo = makeRepo({ config: TWO_TRUNK });
    const g = runHook('branch-check.mjs', 'not json', { cwd: repo });
    assert.equal(g.code, 0);
    assert.ok(!g.json?.__unparseable);
    const plain = tempDir();
    const o = runHook('branch-check.mjs', { hook_event_name: 'SessionStart' }, { cwd: plain });
    assert.equal(o.code, 0);
    assert.equal(o.stdout, '');
  });
});

// ---------------------------------------------------------------------------
describe('check-gates', () => {
  test('silent when nothing matches', () => {
    const repo = makeRepo({ config: { ...TWO_TRUNK, postEdit: [{ paths: ['src/**/*.ts'], remind: 'x' }] } });
    const r = runHook('check-gates.mjs', { tool_name: 'Edit', tool_input: { file_path: join(repo, 'docs', 'a.md') } }, { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });

  test('reminds and reports a failing check', () => {
    const repo = makeRepo({
      config: {
        ...TWO_TRUNK,
        postEdit: [
          { paths: ['src/**/*.{ts,tsx}'], remind: 'Regenerate the client.' },
          { paths: ['src/**'], run: 'node -e "process.exit(3)"', timeoutMs: 5000 },
        ],
      },
    });
    const r = runHook('check-gates.mjs', { tool_name: 'Write', tool_input: { file_path: join(repo, 'src', 'ui', 'a.tsx') } }, { cwd: repo });
    const text = r.json.hookSpecificOutput.additionalContext;
    assert.match(text, /Regenerate the client/);
    assert.match(text, /GATE FAILED after editing src\/ui\/a.tsx/);
  });

  test('covers MultiEdit and NotebookEdit', () => {
    const repo = makeRepo({ config: { ...TWO_TRUNK, postEdit: [{ paths: ['**/*.ipynb'], remind: 'Clear outputs.' }] } });
    const r = runHook('check-gates.mjs', { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(repo, 'n', 'x.ipynb') } }, { cwd: repo });
    assert.match(r.json.hookSpecificOutput.additionalContext, /Clear outputs/);
  });
});

// ---------------------------------------------------------------------------
describe('learning-signals', () => {
  const prompt = (repo, text) =>
    runHook('learning-signals.mjs', { hook_event_name: 'UserPromptSubmit', prompt: text }, { cwd: repo }).json?.hookSpecificOutput
      ?.additionalContext ?? null;

  test('inert where the kit is not installed', () => {
    const repo = makeRepo();
    assert.equal(prompt(repo, 'I told you not to use npm'), null);
  });

  test('detects corrections in English and Portuguese', () => {
    const repo = makeRepo({ learnings: true });
    for (const t of [
      'I told you not to use npm here, this repo uses pnpm',
      "that's wrong, the handler lives in src/api",
      "don't use any in TypeScript",
      'Why did you delete the migration?',
      'from now on always run the typecheck before committing',
      'Remember to update the changelog',
      'já te disse para não usar npm',
      'não faças commits diretamente na main',
      'isso está errado, o ficheiro é outro',
      'a partir de agora usa sempre pnpm',
    ]) {
      assert.ok(prompt(repo, t), `expected a signal for: ${t}`);
    }
  });

  test('stays quiet on ordinary requests', () => {
    const repo = makeRepo({ learnings: true });
    for (const t of [
      'Please add a login page with email and password',
      "No worries, let's go with option B",
      'Can you explain how the router works?',
      'Fix the failing test in src/cart.test.ts',
      'Implementa a página de perfil do jogador',
      '```\n// don\'t use this\n```\nwhat does this snippet do?',
    ]) {
      assert.equal(prompt(repo, t), null, `unexpected signal for: ${t}`);
    }
  });

  test('announces pending lessons at session start', () => {
    const repo = makeRepo({ learnings: true });
    writeFileSync(join(repo, '.claude', 'learnings', 'inbox.md'), '# Inbox\n\n## 2026-09-26 — a\n- x\n\n## 2026-09-26 — b\n- y\n');
    const r = runHook('learning-signals.mjs', { hook_event_name: 'SessionStart', source: 'startup' }, { cwd: repo });
    assert.match(r.json.hookSpecificOutput.additionalContext, /2 unprocessed lesson/);
  });

  test('friction log: redacts secrets and flags the third identical failure', () => {
    const repo = makeRepo({ learnings: true });
    const fail = () =>
      runHook(
        'learning-signals.mjs',
        {
          hook_event_name: 'PostToolUseFailure',
          session_id: 's1',
          tool_name: 'Bash',
          tool_input: { command: 'curl -H "Authorization: Bearer abcdef1234567890SECRET" https://api.example.com' },
          tool_error: 'exit code 7',
        },
        { cwd: repo },
      );
    assert.equal(fail().stdout, '');
    assert.equal(fail().stdout, '');
    const third = fail();
    assert.match(third.json.hookSpecificOutput.additionalContext, /failed 3 times/);
    const log = readFileSync(join(repo, '.claude', 'learnings', 'signals.jsonl'), 'utf8');
    assert.ok(!log.includes('abcdef1234567890SECRET'), 'secret leaked into the friction log');
    assert.equal(log.trim().split('\n').length, 3);
  });

  test('no friction log without the learnings directory', () => {
    const repo = makeRepo();
    runHook('learning-signals.mjs', { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' } }, { cwd: repo });
    assert.equal(existsSync(join(repo, '.claude', 'learnings', 'signals.jsonl')), false);
  });
});
