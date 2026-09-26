// End-to-end tests for the agent-setup CLI against real temporary repositories.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, unlinkSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeRepo, runCli, gitIn, cleanupTemp, tempDir, ROOT, testInbox } from './helpers.mjs';
import { hashText } from '../lib/util.mjs';
import { specProblems } from '../lib/vendor.mjs';

after(cleanupTemp);

const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const manifest = (repo) => json(join(repo, '.claude', 'agent-setup.json'));
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const catalog = json(join(ROOT, 'kit', 'catalog.json'));
const group = (g) => Object.entries(catalog.skills).filter(([, m]) => m.group === g).map(([n]) => n);
const DOMAIN = group('domain');
const CORE = group('core');
const DESIGN = group('design');

function nodeApp() {
  const repo = makeRepo({ branch: 'develop', branches: ['develop'] });
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' }, dependencies: { react: '19.0.0' } }),
  );
  writeFileSync(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  return repo;
}

const setupClone = (repo, ...args) => spawnSync(process.execPath, [join(repo, '.claude', 'hooks', 'setup-clone.mjs'), ...args], { cwd: repo, encoding: 'utf8' });

// ---------------------------------------------------------------------------
describe('install into a fresh repository (standard profile)', () => {
  const repo = nodeApp();
  const r = runCli(['install', repo]);

  test('exits 0 and reports what it did', () => {
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /agent-setup install/);
    assert.match(r.out, /Run \/sdlc-init/);
    assert.match(r.out, /profile standard/);
  });

  test('installs the domain and core skills once, in .claude/skills, and no design skill', () => {
    for (const s of [...DOMAIN, ...CORE]) assert.ok(existsSync(join(repo, '.claude', 'skills', s, 'SKILL.md')), `.claude/skills/${s}`);
    for (const s of DESIGN) assert.equal(existsSync(join(repo, '.claude', 'skills', s)), false, `${s} is opt-in`);
    assert.equal(existsSync(join(repo, '.claude', 'licenses')), false, 'no vendored skill, no licence');
  });

  test('gives other agents links to the same skills, not a second copy', () => {
    for (const s of [...DOMAIN, ...CORE]) {
      const link = join(repo, '.agents', 'skills', s);
      assert.ok(isLink(link), `.agents/skills/${s} is a link`);
      assert.ok(same(realpathSync(link), join(repo, '.claude', 'skills', s)), `${s} points at .claude/skills`);
    }
    assert.deepEqual(Object.keys(manifest(repo).links).sort(), [...DOMAIN, ...CORE].map((s) => `.agents/skills/${s}`).sort());
    assert.equal(Object.keys(manifest(repo).files).some((f) => f.startsWith('.agents/')), false, 'links are not kit files');
  });

  test('keeps the links out of git', () => {
    const gi = read(join(repo, '.gitignore'));
    assert.match(gi, /^\.agents\/skills\/frontend$/m);
    const status = gitIn(repo, 'status', '--porcelain', '--untracked-files=all');
    assert.doesNotMatch(status, /\.agents\//, status);
  });

  test('installs agents and hooks, including the per-clone setup script', () => {
    for (const a of ['gate-runner', 'security-reviewer', 'architecture-reviewer', 'docs-keeper']) assert.ok(existsSync(join(repo, '.claude', 'agents', `${a}.md`)));
    for (const h of ['_config.mjs', 'branch-check.mjs', 'guard-git.mjs', 'check-gates.mjs', 'learning-signals.mjs', 'git-guard.mjs', 'setup-clone.mjs']) {
      assert.ok(existsSync(join(repo, '.claude', 'hooks', h)), h);
    }
    assert.equal(existsSync(join(repo, '.claude', 'hooks', 'install-git-hooks.mjs')), false);
  });

  test('never installs skill evals into projects', () => {
    assert.equal(existsSync(join(repo, '.claude', 'skills', 'frontend', 'evals')), false);
  });

  test('writes AGENTS.md with detected commands and the managed block', () => {
    const a = read(join(repo, 'AGENTS.md'));
    assert.match(a, /pnpm install --frozen-lockfile/);
    assert.match(a, /pnpm run typecheck/);
    assert.match(a, /<!-- agent-setup:begin -->[\s\S]*## Working agreement[\s\S]*<!-- agent-setup:end -->/);
    assert.match(a, /\.agents\/skills/);
    assert.match(a, /setup-clone\.mjs/);
    assert.doesNotMatch(a, /\{\{[A-Z_]+\}\}/, 'unrendered placeholder');
  });

  test('writes CLAUDE.md that imports AGENTS.md', () => {
    const c = read(join(repo, 'CLAUDE.md'));
    assert.match(c, /^@AGENTS\.md$/m);
    assert.match(c, /gate-runner/);
  });

  test('wires hooks in exec form and adds permissions', () => {
    const s = json(join(repo, '.claude', 'settings.json'));
    const guard = s.hooks.PreToolUse.find((g) => g.matcher === 'Bash|PowerShell');
    assert.equal(guard.hooks[0].command, 'node');
    assert.deepEqual(guard.hooks[0].args, ['${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-git.mjs']);
    assert.ok(s.permissions.ask.includes('Edit(.claude/sdlc.config.json)'));
    for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure']) assert.ok(s.hooks[e], e);
  });

  test('writes a provisional two-trunk config from the branches it found', () => {
    const cfg = json(join(repo, '.claude', 'sdlc.config.json'));
    assert.equal(cfg._provisional, true);
    assert.equal(cfg.branching.model, 'two-trunk');
    assert.equal(cfg.branching.production, 'main');
    assert.equal(cfg.branching.integration, 'develop');
  });

  test('adds the gitignore block and the learning loop scaffolding', () => {
    assert.match(read(join(repo, '.gitignore')), /\.claude\/learnings\/signals\.jsonl/);
    assert.ok(existsSync(join(repo, '.claude', 'learnings', 'inbox.md')));
    assert.ok(existsSync(join(repo, '.claude', 'learnings', 'README.md')));
    assert.ok(existsSync(join(repo, '.claude', 'overlays', 'README.md')));
  });

  test('records every kit file in the manifest', () => {
    const m = manifest(repo);
    assert.equal(m.kit.name, 'agent-setup');
    assert.equal(m.selection.profile, 'standard');
    assert.ok(Object.keys(m.files).length > 50);
    assert.ok(m.files['.claude/hooks/guard-git.mjs']);
  });

  test('refuses a second install', () => {
    const again = runCli(['install', repo]);
    assert.equal(again.code, 1);
    assert.match(again.out, /already installed/);
  });

  test('status is healthy apart from the provisional config', () => {
    const st = runCli(['status', repo]);
    assert.equal(st.code, 0, st.out);
    assert.match(st.out, /provisional/);
    assert.doesNotMatch(st.out, /link\(s\) missing/);
  });

  test('a second update changes nothing', () => {
    const u = runCli(['update', repo]);
    assert.equal(u.code, 0, u.out);
    assert.doesNotMatch(u.out, /\b(added|updated|restored|conflict|removed)\b/);
  });
});

// ---------------------------------------------------------------------------
describe('the design group', () => {
  const repo = nodeApp();
  const r = runCli(['install', repo, '--profile', 'web']);

  test('the web profile installs every design skill', () => {
    assert.equal(r.code, 0, r.out);
    for (const s of DESIGN) assert.ok(existsSync(join(repo, '.claude', 'skills', s, 'SKILL.md')), s);
    assert.match(r.out, /design\s+17 skills, entry point frontend-design-workflow/);
  });

  test('warns about the size before the brand library lands in the repository', () => {
    assert.match(r.out, /\d+\.\d MB to this repository/);
  });

  test('installs one licence per upstream source, reachable from both skill folders', () => {
    const licences = readdirSync(join(repo, '.claude', 'licenses')).sort();
    assert.deepEqual(licences, readdirSync(join(ROOT, 'kit', 'licenses')).sort());
    assert.ok(isLink(join(repo, '.agents', 'licenses')));
    const lic = read(join(repo, '.claude', 'skills', 'brandkit', 'SKILL.md')).match(/^license: .*\(see ([^)]+)\)/m)?.[1];
    assert.ok(lic, 'brandkit names its licence file');
    assert.ok(existsSync(join(repo, '.claude', 'skills', 'brandkit', lic)), 'from .claude/skills');
    assert.ok(existsSync(join(repo, '.agents', 'skills', 'brandkit', lic)), 'from .agents/skills');
    for (const s of DESIGN) assert.equal(existsSync(join(repo, '.claude', 'skills', s, 'LICENSE')), false, `${s} carries no copy`);
  });

  test('AGENTS.md lists the design group as one row that names its entry point', () => {
    const a = read(join(repo, 'AGENTS.md'));
    assert.match(a, /`frontend-design-workflow` and 16 more design skills/);
    assert.doesNotMatch(a, /\| `brandkit` \|/);
  });

  test('--skills @design adds the group to any profile; --exclude removes one skill', () => {
    const other = nodeApp();
    const i = runCli(['install', other, '--profile', 'minimal', '--skills', '@design', '--exclude', 'brandkit']);
    assert.equal(i.code, 0, i.out);
    const installed = readdirSync(join(other, '.claude', 'skills')).sort();
    assert.deepEqual(installed, [...CORE, ...DESIGN.filter((s) => s !== 'brandkit')].sort());
  });
});

// ---------------------------------------------------------------------------
describe('install into an existing setup (brownfield)', () => {
  const repo = makeRepo({ branch: 'main', branches: [] });
  writeFileSync(join(repo, 'CLAUDE.md'), '# Existing\n\nUse pnpm, never npm.\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Existing agents file\n\nKeep this.\n');
  mkdirSync(join(repo, '.claude', 'skills', 'design-system'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'skills', 'design-system', 'SKILL.md'), '---\nname: design-system\ndescription: ours\n---\n# ours\n');

  // An sdlc-kit install: hooks the kit recognises as pristine sdlc-kit files by their
  // fingerprints, wired the sdlc-kit way (Bash only). The fingerprints come from a copy of
  // the vendor lock, so the test needs neither the original folder nor a snapshot of it.
  mkdirSync(join(repo, '.claude', 'hooks'), { recursive: true });
  const lock = json(join(ROOT, 'kit', 'vendor.lock.json'));
  lock.derived['sdlc-kit'].files = {};
  for (const h of ['_config.mjs', 'branch-check.mjs', 'guard-git.mjs', 'check-gates.mjs']) {
    const text = `// sdlc-kit ${h} (pristine stand-in)\nexport {};\n`;
    writeFileSync(join(repo, '.claude', 'hooks', h), text);
    lock.derived['sdlc-kit'].files[`runtime/hooks/${h}`] = hashText(text);
  }
  const lockFile = join(tempDir('as-lock-'), 'vendor.lock.json');
  writeFileSync(lockFile, JSON.stringify(lock));
  const env = { AGENT_SETUP_VENDOR_LOCK: lockFile };

  writeFileSync(
    join(repo, '.claude', 'settings.json'),
    JSON.stringify({
      permissions: { allow: ['Bash(npm run lint:*)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard-git.mjs' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      },
    }),
  );
  const r = runCli(['install', repo], { env });

  test('succeeds', () => assert.equal(r.code, 0, r.out));

  test('keeps the project content of CLAUDE.md and AGENTS.md', () => {
    const c = read(join(repo, 'CLAUDE.md'));
    assert.match(c, /Use pnpm, never npm\./);
    assert.match(c, /@AGENTS\.md/);
    const a = read(join(repo, 'AGENTS.md'));
    assert.match(a, /Keep this\./);
    assert.match(a, /agent-setup:begin/);
  });

  test("skips a kit skill the project already has, and says so", () => {
    assert.match(read(join(repo, '.claude', 'skills', 'design-system', 'SKILL.md')), /# ours/);
    assert.match(r.out, /skipped\s+skill design-system/);
    assert.ok(manifest(repo).skipped.skills.includes('design-system'));
    assert.equal(manifest(repo).links['.agents/skills/design-system'], undefined, 'no link to a skill the kit does not own');
  });

  test('upgrades pristine sdlc-kit hooks in place', () => {
    assert.match(r.out, /upgraded/);
    assert.match(read(join(repo, '.claude', 'hooks', 'guard-git.mjs')), /PowerShell/);
  });

  test('a hook that is not a pristine sdlc-kit file is never overwritten', () => {
    const other = makeRepo({ branch: 'main', branches: [] });
    mkdirSync(join(other, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(other, '.claude', 'hooks', 'guard-git.mjs'), '// my own guard\n');
    const i = runCli(['install', other], { env });
    assert.equal(i.code, 0, i.out);
    assert.equal(read(join(other, '.claude', 'hooks', 'guard-git.mjs')), '// my own guard\n');
    assert.ok(existsSync(join(other, '.claude', 'hooks', 'guard-git.mjs.kit-new')));
  });

  test('adds only the missing PowerShell coverage to the existing guard wiring', () => {
    const s = json(join(repo, '.claude', 'settings.json'));
    const groups = s.hooks.PreToolUse;
    const guards = groups.flatMap((g) => g.hooks.map((h) => ({ m: g.matcher, cmd: `${h.command} ${(h.args ?? []).join(' ')}` }))).filter((x) => x.cmd.includes('guard-git'));
    assert.equal(guards.length, 2, JSON.stringify(groups));
    assert.ok(guards.some((g) => g.m === 'Bash'));
    assert.ok(guards.some((g) => g.m === 'PowerShell'));
    assert.deepEqual(s.hooks.Stop, [{ hooks: [{ type: 'command', command: 'echo mine' }] }]);
    assert.ok(s.permissions.allow.includes('Bash(npm run lint:*)'));
  });

  test('uninstall removes exactly what it added', () => {
    const u = runCli(['uninstall', repo], { env });
    assert.equal(u.code, 0, u.out);
    const s = json(join(repo, '.claude', 'settings.json'));
    assert.deepEqual(s.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard-git.mjs' }] }]);
    assert.deepEqual(s.permissions, { allow: ['Bash(npm run lint:*)'] });
    assert.equal(read(join(repo, 'CLAUDE.md')), '# Existing\n\nUse pnpm, never npm.\n');
    assert.equal(read(join(repo, 'AGENTS.md')), '# Existing agents file\n\nKeep this.\n');
    assert.match(read(join(repo, '.claude', 'skills', 'design-system', 'SKILL.md')), /# ours/);
    assert.equal(existsSync(join(repo, '.claude', 'skills', 'frontend')), false);
    assert.equal(existsSync(join(repo, '.agents')), false);
    assert.equal(existsSync(join(repo, '.claude', 'agent-setup.json')), false);
    // project-owned files stay
    assert.ok(existsSync(join(repo, '.claude', 'learnings', 'inbox.md')));
  });
});

// ---------------------------------------------------------------------------
describe('links for other agents, per clone', () => {
  const repo = nodeApp();
  runCli(['install', repo, '--profile', 'minimal']);
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '-m', 'chore: agent-setup');

  test('a fresh clone has no links until setup-clone runs, then has all of them', () => {
    const clone = join(tempDir('as-clone-'), 'c');
    gitIn(repo, 'clone', '-q', repo, clone);
    assert.equal(existsSync(join(clone, '.agents')), false, 'links are never committed');
    const s = setupClone(clone);
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /6 link\(s\) created/);
    for (const k of CORE) assert.ok(existsSync(join(clone, '.agents', 'skills', k, 'SKILL.md')), k);
    assert.match(setupClone(clone).stdout, /already in place/, 'idempotent');
  });

  test('status reports missing links and setup-clone repairs them', () => {
    unlinkSync(join(repo, '.agents', 'skills', 'gates'));
    assert.match(runCli(['status', repo]).out, /1 of 6 \.agents\/ link\(s\) missing/);
    setupClone(repo);
    assert.ok(isLink(join(repo, '.agents', 'skills', 'gates')));
  });

  test('a real folder where a link belongs is left alone and reported', () => {
    const p = join(repo, '.agents', 'skills', 'handoff');
    unlinkSync(p);
    mkdirSync(p);
    writeFileSync(join(p, 'mine.md'), 'mine\n');
    assert.match(setupClone(repo).stdout, /handoff is a real folder, not a link — left alone/);
    assert.equal(read(join(p, 'mine.md')), 'mine\n');
    rmSync(p, { recursive: true });
    setupClone(repo);
  });

  test('uninstall removes the links, never what they point to', () => {
    const skill = join(repo, '.claude', 'skills', 'gates', 'SKILL.md');
    writeFileSync(skill, `${read(skill)}\n<!-- local change -->\n`);
    const u = runCli(['uninstall', repo]);
    assert.equal(u.code, 0, u.out);
    assert.equal(existsSync(join(repo, '.agents')), false);
    assert.match(read(skill), /local change/, 'the modified skill survives');
    assert.equal(existsSync(join(repo, '.claude', 'skills', 'handoff')), false, 'unmodified skills are removed');
  });
});

// ---------------------------------------------------------------------------
describe('upgrade from 1.0 (skill copies in .agents, the design pack)', () => {
  const repo = nodeApp();
  runCli(['install', repo, '--profile', 'minimal', '--skills', 'frontend-design-workflow']);
  // Rewrite the install the way 1.0 left it: a second copy of every skill in .agents/skills,
  // recorded as kit files, and the design pack selected by name.
  setupClone(repo, '--uninstall');
  const m = manifest(repo);
  for (const [rel, h] of Object.entries(m.files)) {
    if (!rel.startsWith('.claude/skills/')) continue;
    const copy = rel.replace('.claude/skills/', '.agents/skills/');
    mkdirSync(join(repo, copy, '..'), { recursive: true });
    cpSync(join(repo, rel), join(repo, copy));
    m.files[copy] = h;
  }
  m.selection = { ...m.selection, skills: [], packs: ['frontend-kit'] };
  delete m.links;
  writeFileSync(join(repo, '.claude', 'agent-setup.json'), JSON.stringify(m));
  const u = runCli(['update', repo]);

  test('replaces the copies with links', () => {
    assert.equal(u.code, 0, u.out);
    assert.ok(isLink(join(repo, '.agents', 'skills', 'gates')));
    assert.equal(Object.keys(manifest(repo).files).some((f) => f.startsWith('.agents/')), false);
  });

  test('keeps the design skills a pack install had', () => {
    for (const s of DESIGN) assert.ok(existsSync(join(repo, '.claude', 'skills', s, 'SKILL.md')), s);
    assert.deepEqual(manifest(repo).selection.skills, ['@design']);
    assert.equal(manifest(repo).selection.packs, undefined);
  });
});

// ---------------------------------------------------------------------------
describe('update never destroys local work', () => {
  const repo = nodeApp();
  runCli(['install', repo, '--targets', 'claude']);

  test('a locally modified kit file is kept; the new version lands beside it', () => {
    const skill = join(repo, '.claude', 'skills', 'backend', 'SKILL.md');
    writeFileSync(skill, `${read(skill)}\n<!-- local tweak -->\n`);
    // Pretend the kit shipped a different version of the file.
    const m = manifest(repo);
    m.files['.claude/skills/backend/SKILL.md'] = '0'.repeat(32);
    writeFileSync(join(repo, '.claude', 'agent-setup.json'), JSON.stringify(m));
    const u = runCli(['update', repo]);
    assert.equal(u.code, 0, u.out);
    assert.match(read(skill), /local tweak/);
    assert.ok(existsSync(`${skill}.kit-new`));
    assert.match(u.out, /conflict/);
  });

  test('a deleted kit file is restored', () => {
    rmSync(join(repo, '.claude', 'agents', 'gate-runner.md'));
    const u = runCli(['update', repo]);
    assert.match(u.out, /restored/);
    assert.ok(existsSync(join(repo, '.claude', 'agents', 'gate-runner.md')));
  });

  test('a hook handler the user removed stays removed', () => {
    const p = join(repo, '.claude', 'settings.json');
    const s = json(p);
    delete s.hooks.UserPromptSubmit;
    writeFileSync(p, JSON.stringify(s, null, 2));
    runCli(['update', repo]);
    assert.equal(json(p).hooks.UserPromptSubmit, undefined);
    runCli(['update', repo, '--reset-hooks']);
    assert.ok(json(p).hooks.UserPromptSubmit, '--reset-hooks brings it back');
  });

  test('excluding a skill on update removes it when unmodified', () => {
    const u = runCli(['update', repo, '--exclude', 'design-system']);
    assert.equal(u.code, 0, u.out);
    assert.equal(existsSync(join(repo, '.claude', 'skills', 'design-system')), false);
  });

  test('refuses to touch invalid settings.json', () => {
    const p = join(repo, '.claude', 'settings.json');
    const good = read(p);
    writeFileSync(p, '{ not json');
    const u = runCli(['update', repo]);
    assert.equal(u.code, 1);
    assert.match(u.out, /not valid JSON/);
    assert.equal(read(p), '{ not json');
    writeFileSync(p, good);
  });
});

// ---------------------------------------------------------------------------
describe('selection options', () => {
  test('--dry-run writes nothing', () => {
    const repo = nodeApp();
    const r = runCli(['install', repo, '--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /dry run/);
    assert.equal(existsSync(join(repo, '.claude')), false);
    assert.equal(existsSync(join(repo, '.agents')), false);
    assert.equal(existsSync(join(repo, 'AGENTS.md')), false);
  });

  test('profile minimal installs only the workflow skills and the gate runner', () => {
    const repo = nodeApp();
    runCli(['install', repo, '--profile', 'minimal']);
    const skills = readdirSync(join(repo, '.claude', 'skills')).sort();
    assert.deepEqual(skills, [...CORE].sort());
    const agents = readdirSync(join(repo, '.claude', 'agents')).sort();
    assert.deepEqual(agents, ['docs-keeper.md', 'gate-runner.md']);
  });

  test('--targets claude creates no links; gemini adds GEMINI.md', () => {
    const a = nodeApp();
    runCli(['install', a, '--targets', 'claude']);
    assert.equal(existsSync(join(a, '.agents')), false);
    assert.deepEqual(manifest(a).links, {});
    const b = nodeApp();
    runCli(['install', b, '--targets', 'claude,agents,gemini']);
    const g = read(join(b, 'GEMINI.md'));
    assert.match(g, /@\.\/AGENTS\.md/);
    assert.match(g, /setup-clone\.mjs/);
  });

  test('--no-hooks installs no Claude Code hooks and no hook wiring, but still the per-clone setup', () => {
    const repo = nodeApp();
    runCli(['install', repo, '--no-hooks']);
    assert.equal(existsSync(join(repo, '.claude', 'hooks', 'guard-git.mjs')), false);
    assert.ok(existsSync(join(repo, '.claude', 'hooks', 'setup-clone.mjs')));
    const s = json(join(repo, '.claude', 'settings.json'));
    assert.equal(s.hooks, undefined);
  });

  test('unknown profile, skill or group is an error', () => {
    const repo = nodeApp();
    assert.equal(runCli(['install', repo, '--profile', 'nope']).code, 1);
    assert.equal(runCli(['install', repo, '--skills', 'nope']).code, 1);
    const g = runCli(['install', repo, '--skills', '@nope']);
    assert.equal(g.code, 1);
    assert.match(g.out, /unknown group "@nope"/);
  });

  test('--packs explains its replacement instead of running', () => {
    const r = runCli(['install', nodeApp(), '--packs', 'frontend-kit']);
    assert.equal(r.code, 1);
    assert.match(r.out, /--skills @design/);
  });
});

// ---------------------------------------------------------------------------
describe('git hooks layer (every agent)', () => {
  const repo = makeRepo({ branch: 'develop', branches: ['develop'] });
  // A pre-existing repo hook that must keep running.
  writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\necho LEGACY-HOOK >&2\n');
  const r = runCli(['install', repo, '--git-hooks', '--profile', 'minimal']);
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '-m', 'chore: agent-setup');

  const tryGit = (...args) => {
    try {
      gitIn(repo, ...args);
      return { ok: true };
    } catch (err) {
      return { ok: false, stderr: String(err.stderr ?? err.message) };
    }
  };

  test('installs into the git directory and points core.hooksPath at it', () => {
    assert.equal(r.code, 0, r.out);
    assert.match(gitIn(repo, 'config', '--get', 'core.hooksPath'), /\.git\/agent-setup\/hooks$/);
  });

  test('blocks a commit on production even where production lacks the install commit', () => {
    gitIn(repo, 'checkout', '-q', 'main');
    assert.equal(existsSync(join(repo, '.claude', 'hooks')), false, 'main does not contain the kit');
    const c = tryGit('commit', '--allow-empty', '-m', 'x');
    assert.equal(c.ok, false);
    assert.match(c.stderr, /production/);
    gitIn(repo, 'checkout', '-q', 'develop');
  });

  test('allows ordinary commits and keeps the existing hook running', () => {
    const c = tryGit('commit', '--allow-empty', '-m', 'feat: y');
    assert.equal(c.ok, true);
  });

  test('uninstall removes the hooks and unsets core.hooksPath', () => {
    const u = runCli(['uninstall', repo]);
    assert.equal(u.code, 0, u.out);
    let value = null;
    try {
      value = gitIn(repo, 'config', '--get', 'core.hooksPath');
    } catch {
      value = null; // `git config --get` exits 1 when the key is unset — the expected state
    }
    assert.equal(value, null);
    assert.equal(existsSync(join(repo, '.git', 'agent-setup')), false);
  });
});

// ---------------------------------------------------------------------------
describe('harvest', () => {
  test('moves outbox proposals into the kit inbox and archives them in the project', () => {
    const repo = nodeApp();
    runCli(['install', repo, '--profile', 'minimal']);
    const outbox = join(repo, '.claude', 'learnings', 'outbox');
    mkdirSync(outbox, { recursive: true });
    writeFileSync(join(outbox, '2026-09-26-backend-race.md'), '# Proposal: check-then-act\n');
    const h = runCli(['harvest', '--from', repo]);
    assert.equal(h.code, 0, h.out);
    assert.ok(readdirSync(testInbox()).some((f) => f.endsWith('2026-09-26-backend-race.md')));
    assert.ok(existsSync(join(outbox, 'harvested', '2026-09-26-backend-race.md')));
    assert.equal(existsSync(join(outbox, '2026-09-26-backend-race.md')), false);
  });
});

// ---------------------------------------------------------------------------
describe('kit commands', () => {
  test('lint passes on the kit with no warnings', () => {
    const l = runCli(['lint']);
    assert.equal(l.code, 0, l.out);
    assert.match(l.out, /0 errors, 0 warning\(s\)/);
  });

  test('list shows every group, the agents and the profiles', () => {
    const l = runCli(['list']);
    assert.equal(l.code, 0, l.out);
    for (const g of ['@domain', '@core', '@design']) assert.match(l.out, new RegExp(g));
    assert.match(l.out, /brandkit\s+vendored/);
    assert.match(l.out, /frontend-design-workflow\s+own/);
    assert.match(l.out, /default: standard/);
  });

  test('vendor status works offline and names the derived source', () => {
    const v = runCli(['vendor', 'status', '--offline']);
    assert.match(v.out, /sdlc-kit/);
    assert.match(v.out, /taste-skill\s+locked [0-9a-f]{12}/);
  });

  test('help and version', () => {
    const h = runCli(['help']).out;
    assert.match(h, /install <project>/);
    assert.match(h, /vendor sync/);
    assert.match(h, /eval-routing/);
    assert.match(runCli(['version']).out, /^\d+\.\d+\.\d+/);
  });

  test('retired commands and options explain their replacement', () => {
    const u = runCli(['upstream']);
    assert.equal(u.code, 1);
    assert.match(u.out, /vendor status/);
    const n = runCli(['new-skill', 'x-y', '--pack', 'vendor']);
    assert.equal(n.code, 1);
    assert.match(n.out, /--group/);
  });

  test('unknown command fails', () => assert.equal(runCli(['frobnicate']).code, 1));

  test('refuses to install into the kit itself', () => {
    const r = runCli(['install', ROOT]);
    assert.equal(r.code, 1);
    assert.match(r.out, /into itself/);
  });
});

// ---------------------------------------------------------------------------
describe('export: self-contained copies for routes that copy one folder at a time', () => {
  const out = join(tempDir('as-export-'), 'portable');
  const r = runCli(['export', out, '--profile', 'full']);
  const skills = join(out, 'skills');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

  test('exports every selected skill, without evals', () => {
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(readdirSync(skills).sort(), Object.keys(catalog.skills).sort());
    assert.equal(walk(skills).some((f) => /[\\/]evals[\\/]/.test(f)), false);
    assert.ok(existsSync(join(out, 'README.md')));
  });

  test('each vendored folder carries its licence, and its frontmatter points at it', () => {
    assert.equal(read(join(skills, 'brandkit', 'LICENSE')), read(join(ROOT, 'kit', 'licenses', 'taste-skill.txt')));
    assert.equal(read(join(skills, 'agent-browser', 'LICENSE')), read(join(ROOT, 'kit', 'licenses', 'agent-browser.txt')));
    assert.match(read(join(skills, 'brandkit', 'SKILL.md')), /^license: "MIT \(see LICENSE\)"$/m);
    assert.equal(existsSync(join(skills, 'web-design-guidelines', 'LICENSE')), false, 'no licence upstream, none invented');
  });

  test("vendored assets get their licence where they live, and the skill's link follows it", () => {
    assert.equal(read(join(skills, 'design-md-library', 'assets', 'brands', 'LICENSE')), read(join(ROOT, 'kit', 'licenses', 'awesome-design-md.txt')));
    assert.match(read(join(skills, 'design-md-library', 'SKILL.md')), /\(assets\/brands\/LICENSE\)/);
  });

  test('nothing refers to the shared licences folder, and every SKILL.md is within the spec', () => {
    for (const f of walk(skills).filter((x) => x.endsWith('.md'))) assert.doesNotMatch(read(f), /\.\.\/\.\.\/licenses\//, f);
    for (const s of readdirSync(skills)) assert.deepEqual(specProblems(read(join(skills, s, 'SKILL.md')), s), [], s);
    assert.doesNotMatch(read(join(skills, 'sdlc-init', 'SKILL.md')), /^(context|agent|background):/m);
    assert.match(r.out, /removed Claude-only keys: enforcement-audit \(context, agent, background\)/);
  });

  test('refuses a non-empty target without --force, and a target inside the kit', () => {
    const again = runCli(['export', out]);
    assert.equal(again.code, 1);
    assert.match(again.out, /not empty/);
    assert.equal(runCli(['export', out, '--force']).code, 0);
    const inside = runCli(['export', join(ROOT, 'dist')]);
    assert.equal(inside.code, 1);
    assert.match(inside.out, /outside the kit/);
    assert.equal(existsSync(join(ROOT, 'dist')), false);
  });
});

// ---------------------------------------------------------------------------
describe('lint keeps the repository tidy', () => {
  // A copy of the kit with one of each kind of pollution the gate exists to stop.
  const copy = join(tempDir('as-kit-'), 'Agent_Setup');
  cpSync(ROOT, copy, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.state)([\\/]|$)/.test(src.slice(ROOT.length)) });
  mkdirSync(join(copy, 'frontend-kit'));
  writeFileSync(join(copy, 'frontend-kit', 'README.md'), '# a second home for a theme\n');
  cpSync(join(copy, 'kit', 'licenses', 'taste-skill.txt'), join(copy, 'docs', 'taste-licence-copy.txt'));
  writeFileSync(join(copy, 'docs', 'shell-mangled.md'), `**Skills:** ${String.fromCharCode(7)}gent-eval\n`);
  writeFileSync(join(copy, 'docs', 'hidden.md'), `before${String.fromCharCode(0xfeff)}after\n`);
  writeFileSync(join(copy, 'lib', 'hidden.mjs'), `export const x = '${String.fromCharCode(0x200b)}';\n`);
  mkdirSync(join(copy, 'docs', 'empty'));
  const l = spawnSync(process.execPath, [join(copy, 'bin', 'agent-setup.mjs'), 'lint'], { cwd: copy, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const out = `${l.stdout}${l.stderr}`;

  test('fails', () => assert.equal(l.status, 1, out));
  test('a folder that is not in the documented layout', () => assert.match(out, /frontend-kit\n\s+✖ error\s+not in the Layout tables of AGENTS\.md/));
  test('two files with the same content', () => {
    assert.match(out, /(docs\/taste-licence-copy\.txt|kit\/licenses\/taste-skill\.txt)\n\s+✖ error\s+identical to (kit\/licenses\/taste-skill\.txt|docs\/taste-licence-copy\.txt)/);
  });
  test('a control character left by shell quoting', () => assert.match(out, /docs\/shell-mangled\.md\n\s+✖ error\s+control character 0x07 on line 1/));
  test('an invisible BOM in prose and a zero-width space in code', () => {
    assert.match(out, /docs\/hidden\.md\n\s+✖ error\s+invisible character U\+FEFF/);
    assert.match(out, /lib\/hidden\.mjs\n\s+✖ error\s+invisible character U\+200B/);
  });
  test('an empty folder', () => assert.match(out, /docs\/empty\n\s+⚠ warn\s+empty folder/));
});
