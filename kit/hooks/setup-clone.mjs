#!/usr/bin/env node
// Per-clone setup for what git does not carry. Reads the kit manifest
// (.claude/agent-setup.json) and makes this clone match it:
//
//   1. .agents/skills/<name> → links to .claude/skills/<name>, so agents that read the
//      Agent Skills folder (Codex, Cursor, Copilot, Gemini CLI…) see every skill
//      without a second copy in the repository; .agents/licenses → .claude/licenses,
//      so a vendored skill's licence path resolves from either folder. The links are
//      git-ignored: git on Windows walks through a junction and would commit its
//      contents twice.
//   2. The git hooks (pre-commit, pre-push) that hold the branching contract for every
//      agent and person — when the project selected them. They live in the git
//      directory, not the working tree: versioned hooks vanished on checkout of any
//      branch without the install commit, usually production, the one they protect.
//
//   node .claude/hooks/setup-clone.mjs              set up or repair (idempotent)
//   node .claude/hooks/setup-clone.mjs --uninstall  remove both
//
// Teammates run it once per clone. Links are removed with unlink, never a recursive
// delete — a recursive delete through a junction would reach the real skill files.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const quiet = args.includes('--quiet');
const lines = [];
const log = (m) => lines.push(m);

const git = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const same = (a, b) => resolve(a).replace(/\\/g, '/').toLowerCase() === resolve(b).replace(/\\/g, '/').toLowerCase();
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const root = git('rev-parse', '--show-toplevel') ?? resolve(here, '..', '..');
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(root, '.claude', 'agent-setup.json'), 'utf8').replace(/^\uFEFF/, ''));
} catch {
  // not installed, or unreadable
}

// ---------------------------------------------------------------- 1. links

const skillsDir = join(root, '.claude', 'skills');
const licensesDir = join(root, '.claude', 'licenses');
const agentsDir = join(root, '.agents', 'skills');
const wanted = uninstall || !manifest ? {} : (manifest.links ?? {});

/** Remove links that are ours (they point into this clone's .claude/) and no longer wanted. */
function removeOurLinks(keep) {
  const candidates = ['.agents/licenses'];
  try {
    for (const name of readdirSync(agentsDir)) candidates.push(`.agents/skills/${name}`);
  } catch {
    // no .agents/skills
  }
  let removed = 0;
  for (const rel of candidates) {
    const p = join(root, rel);
    if (!isLink(p) || keep.has(rel)) continue;
    let real = null;
    try {
      real = realpathSync(p);
    } catch {
      real = null; // dangling link
    }
    if (real === null || same(dirname(real), skillsDir) || same(real, licensesDir)) {
      unlinkSync(p);
      removed++;
    }
  }
  for (const d of [agentsDir, dirname(agentsDir)]) {
    try {
      if (!readdirSync(d).length) rmdirSync(d);
    } catch {
      // not empty, or already gone
    }
  }
  return removed;
}

let created = 0;
let blocked = [];
for (const [rel, targetRel] of Object.entries(wanted)) {
  const abs = join(root, rel);
  const target = join(root, targetRel);
  if (!existsSync(target)) continue;
  if (isLink(abs)) {
    if (existsSync(abs)) continue; // a live link
    unlinkSync(abs); // dangling (moved project): recreate below
  } else if (existsSync(abs)) {
    blocked.push(rel);
    continue;
  }
  mkdirSync(dirname(abs), { recursive: true });
  symlinkSync(process.platform === 'win32' ? target : relative(dirname(abs), target), abs, 'junction');
  created++;
}
const removed = removeOurLinks(new Set(Object.keys(wanted)));
if (created || removed) log(`skills for other agents: ${created} link(s) created, ${removed} removed in .agents/`);
else if (Object.keys(wanted).length) log(`skills for other agents: ${Object.keys(wanted).length} link(s) in .agents/ already in place`);
for (const b of blocked) log(`skills for other agents: ${b} is a real folder, not a link — left alone`);

// ---------------------------------------------------------------- 2. git hooks

const common = git('rev-parse', '--path-format=absolute', '--git-common-dir') ?? git('rev-parse', '--git-common-dir');
if (common) {
  const gitDir = resolve(common);
  const dest = join(gitDir, 'agent-setup');
  const hooksDest = join(dest, 'hooks');
  const current = git('config', '--get', 'core.hooksPath');
  const ours = current && same(current, hooksDest);
  const wantHooks = !uninstall && manifest?.selection?.gitHooks === true;

  if (!wantHooks) {
    if (ours) git('config', '--unset', 'core.hooksPath');
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
      log('git hooks: removed from this clone');
    }
  } else if (current && !ours) {
    log(
      `git hooks: core.hooksPath is "${current}" (husky, lefthook or a team hooks folder) — left unchanged. ` +
        'Add `node .claude/hooks/git-guard.mjs pre-commit` to its pre-commit and `node .claude/hooks/git-guard.mjs pre-push "$@"` to its pre-push.',
    );
  } else if (!existsSync(join(here, '_config.mjs')) || !existsSync(join(here, 'git-guard.mjs'))) {
    log('git hooks: _config.mjs or git-guard.mjs is missing from .claude/hooks — run agent-setup update');
  } else {
    mkdirSync(hooksDest, { recursive: true });
    copyFileSync(join(here, '_config.mjs'), join(dest, '_config.mjs'));
    copyFileSync(join(here, 'git-guard.mjs'), join(dest, 'git-guard.mjs'));
    for (const f of readdirSync(hooksDest)) rmSync(join(hooksDest, f), { force: true });

    // Hooks the repository already had in the default location keep running, chained.
    const defaultHooks = join(gitDir, 'hooks');
    let existing = [];
    try {
      existing = readdirSync(defaultHooks).filter((f) => !f.endsWith('.sample') && statSync(join(defaultHooks, f)).isFile());
    } catch {
      // no hooks folder
    }
    const GUARDED = new Set(['pre-commit', 'pre-push']);
    for (const name of new Set([...existing, ...GUARDED])) {
      const readsStdin = name === 'pre-push' || name === 'pre-receive' || name === 'post-rewrite';
      const pipe = readsStdin ? `printf '%s\\n' "$input" | ` : '';
      const body = [
        '#!/bin/sh',
        `# agent-setup ${name} wrapper — this clone only, not versioned.`,
        '# Re-create with: node .claude/hooks/setup-clone.mjs   Remove with: --uninstall',
        'gitdir="$(git rev-parse --git-common-dir)"',
      ];
      if (readsStdin) body.push('input="$(cat)"');
      body.push(`if [ -x "$gitdir/hooks/${name}" ]; then ${pipe}"$gitdir/hooks/${name}" "$@" || exit $?; fi`);
      if (GUARDED.has(name)) {
        body.push('command -v node >/dev/null 2>&1 || exit 0');
        body.push('[ -f "$gitdir/agent-setup/git-guard.mjs" ] || exit 0');
        body.push(`${pipe}exec node "$gitdir/agent-setup/git-guard.mjs" ${name} "$@"`);
      }
      const file = join(hooksDest, name);
      writeFileSync(file, `${body.join('\n')}\n`);
      try {
        chmodSync(file, 0o755);
      } catch {
        // Windows: Git for Windows runs hooks by their shebang
      }
    }
    git('config', 'core.hooksPath', hooksDest.replace(/\\/g, '/'));
    log(`git hooks: active in this clone${existing.length ? `; existing hooks chained: ${existing.join(', ')}` : ''}`);
  }
}

if (!manifest && !uninstall) log('agent-setup is not installed here (.claude/agent-setup.json missing) — nothing to set up');
if (!quiet) for (const l of lines) process.stdout.write(`agent-setup: ${l}\n`);
