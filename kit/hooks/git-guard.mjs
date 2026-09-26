#!/usr/bin/env node
// Git hooks (pre-commit, pre-push) that hold the branching contract for EVERY agent
// and human using this clone — Codex, Cursor, Gemini CLI, Copilot, scripts and people —
// not only Claude Code sessions.
//
//   <git-dir>/agent-setup/hooks/pre-commit → node <git-dir>/agent-setup/git-guard.mjs pre-commit
//   <git-dir>/agent-setup/hooks/pre-push   → node <git-dir>/agent-setup/git-guard.mjs pre-push <remote> <url>
//
// Installed per clone by setup-clone.mjs (which explains why the git directory, and
// not a versioned folder, is where the hooks live). It can also be called from
// husky/lefthook hooks as `node .claude/hooks/git-guard.mjs pre-commit|pre-push`.
//
// Why this exists as well as guard-git.mjs: the Claude Code hooks enforce the contract
// only inside Claude Code. An enforcement register that lists "production never moves
// on an agent's initiative" as enforced, while Codex or Cursor can push to main
// unopposed, is the overstated-coverage failure the register exists to prevent.
//
// Unlike the Claude Code hooks, a git hook denies by exiting non-zero. It still fails
// OPEN on its own bugs — a broken guard must never stop a human from committing — and
// logs the error so it is findable.
//
// Escape hatch for a human doing a deliberate release: AGENT_SETUP_ALLOW_PROTECTED=1
// (or git's own --no-verify). The Claude Code guard denies agents both.

import { loadConfig, git, currentBranch, refMatches, logError } from './_config.mjs';

const hook = process.argv[2];

function block(lines) {
  process.stderr.write(
    `\n✖ agent-setup ${hook}: ${lines.join('\n  ')}\n\n` +
      '  Human doing this on purpose (e.g. a release the user asked for)? Re-run with\n' +
      '  AGENT_SETUP_ALLOW_PROTECTED=1. Agents: do not bypass this — stop and ask the user.\n\n',
  );
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  if (process.env.AGENT_SETUP_ALLOW_PROTECTED === '1') {
    process.stderr.write('agent-setup: AGENT_SETUP_ALLOW_PROTECTED=1 — protected-branch checks skipped for this command.\n');
    return;
  }
  const cfg = loadConfig();
  const b = cfg.branching;
  const g = cfg.guard;
  const productionWritesDenied = g.denyProductionWrites !== false && b.releaseOnRequestOnly !== false;
  const protectedPatterns = [b.production, ...b.protectedRefs].filter(Boolean);
  const isProtected = (ref) => refMatches(protectedPatterns, ref);
  const twoLines = b.integration && b.integration !== b.production;

  if (hook === 'pre-commit') {
    const here = currentBranch();
    if (here && isProtected(here) && b.model !== 'trunk' && g.denyCommitOnProduction !== false) {
      block([
        `'${here}' is production — commits land here only through a release the user asked for.`,
        `Switch to '${b.integration}' (or a branch cut from it) and commit there.`,
      ]);
    }
    return;
  }

  if (hook === 'pre-push') {
    // stdin lines: <local ref> <local sha> <remote ref> <remote sha>
    const ZERO = /^0+$/;
    for (const line of (await readStdin()).split(/\r?\n/).filter(Boolean)) {
      const [, localSha = '', remoteRef = '', remoteSha = ''] = line.trim().split(/\s+/);
      if (!remoteRef.startsWith('refs/heads/')) continue; // tags and notes are not branches
      const dst = remoteRef.slice('refs/heads/'.length);
      const deleting = ZERO.test(localSha);

      if (productionWritesDenied && isProtected(dst)) {
        block([
          `${deleting ? 'Deleting' : 'Pushing to'} '${dst}' — production. It moves only when the user explicitly asks for a release.`,
          `Push your branch and open a pull request into '${b.integration}' instead.`,
        ]);
      }

      if (g.denyForcePushShared !== false && twoLines && dst === b.integration) {
        if (deleting) block([`Deleting '${dst}', the shared integration branch.`]);
        const remoteKnown = !ZERO.test(remoteSha) && git('cat-file', '-e', `${remoteSha}^{commit}`) !== null;
        if (remoteKnown && git('merge-base', '--is-ancestor', remoteSha, localSha) === null) {
          block([
            `Force-pushing '${dst}', the shared integration branch — it rewrites history every other clone is built on.`,
            'Push a new commit instead (revert, or fix forward).',
          ]);
        }
      }
    }
  }
}

try {
  await main();
} catch (err) {
  logError('git-guard', err); // fail open on our own bugs
}
process.exit(0);
