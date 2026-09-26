# Agent workflow — branch discipline

How agents working in this repository decide where their commits go, and which mechanism
stops them when they get it wrong.

This document is about the **branching** half of the agent workflow, which is the part that
actually bites. Skills, subagents and the learning loop are described in `AGENTS.md` (the
managed block) and `.claude/learnings/README.md`.

## The rule

**At the start of every new context window, the agent asks whether to keep working on the
current branch or cut a new one from `{{INTEGRATION}}` — and waits for the answer before making
any code change.**

Read-only work is exempt: a question, a review, an explanation that writes no files does not
need a branch. The question is asked once per context window, not before every edit.

The branch it proposes is never arbitrary. The full policy, including how a release is
performed, is [branching.md](./branching.md); the version every agent receives each session is
`AGENTS.md`; the version the *tooling* reads is `.claude/sdlc.config.json`.

Those three must agree. If you edit a branch name, edit it in the config first.

## How it is enforced — and for whom

A hook, not a convention: **an instruction in a document is only followed by an agent that has
already read the document**, which is precisely not the case at the start of a fresh context
window. Different agents are reached by different layers, so the table says who each one
covers:

| Layer | File | Covers | Role |
|---|---|---|---|
| Session context | `.claude/hooks/branch-check.mjs` | Claude Code | Injects live git state and the contract on `SessionStart` (startup, resume, clear, compact) |
| Command guard | `.claude/hooks/guard-git.mjs` | Claude Code — **Bash and PowerShell tools** | Denies the command itself, and names the alternative |
| Post-edit checks | `.claude/hooks/check-gates.mjs` | Claude Code | Surfaces the cheapest gate an edit could have broken |
| Learning signals | `.claude/hooks/learning-signals.mjs` | Claude Code | Flags corrections, pending lessons and repeated failures |
| Git hooks *(optional)* | `pre-commit` + `pre-push`, installed per clone into the git directory by `node .claude/hooks/setup-clone.mjs` → `git-guard.mjs` | **every agent and every human** in a clone where the installer ran, unless bypassed with `--no-verify` | The same production and integration rules, at commit and push time; the repo's own hooks keep running, chained |
| Repository | {{CI job / branch protection}} | everyone | Fails any PR into production that did not come from integration |
| Instructions | `AGENTS.md` | every agent that reads it | The contract in words — necessary, never sufficient |

> **Survey:** fill the Repository row honestly. If there is no CI job or branch-protection
> rule, write "none" and add it to the [gap list](../docs/critical-infrastructure.md). If the
> git-hooks layer is not installed, say so — agents other than Claude Code are then protected
> by instructions only.

### What the command guard denies

| Denied | Because | Configured by |
|---|---|---|
| Any push, merge, PR or commit that writes to production — including a bare `git push` while standing on it | Production moves only on the user's explicit request, in that session | `branching.releaseOnRequestOnly`, `guard.denyProductionWrites`, `guard.denyCommitOnProduction` |
| Branching from production — explicitly or by standing on it | A branch cut from production silently reverts integration work on merge | `guard.denyBranchFromProduction` (gitflow allows `hotfix/*`) |
| Force-pushing or deleting the integration branch | It rewrites history every other clone is built on | `guard.denyForcePushShared` |
| `reset --hard`, `checkout .`, `restore .`, `clean -f` over uncommitted or untracked work | It destroys work no command can bring back — often the user's | `guard.denyDiscardUncommitted` |
| `--no-verify`, and the git-hook escape variable | Hooks catch problems; the fix is the cause, not the hook | `guard.denyNoVerify` |
| `git add -A` / `.` / `-u`, `git commit -a`, `git stash` without paths | The tree is shared; broad operations sweep in another session's work | `sharedTree` |
| Repo-specific commands | Whatever this repo learned the hard way | `guard.extraDeny` |

Each denial names the correct alternative, so the agent retries without needing the user.
Read-only commands against production — `log`, `diff`, `show`, `fetch` — stay allowed.

**Two subtleties, both learned the hard way.** Heredoc bodies (and PowerShell here-strings) are
stripped before matching: the first version of the guard blocked its own documentation because
a file written with `cat > file <<'EOF'` contained `git push origin main`. And refs are compared
exactly after tokenising the command: a regex over the whole line denied
`git push origin feature/main-menu` while letting a bare `git push` from `main` through.

### Immediate feedback on edits

`check-gates.mjs` runs after `Edit`/`Write`/`MultiEdit`/`NotebookEdit` and surfaces the cheapest
check the edit could have broken, driven by `postEdit` in the config. It is **silent
otherwise, deliberately**: a hook that comments on every write becomes noise an agent learns to
skim. Keep `postEdit` commands under a second.

### Implementation notes

Written in Node, not shell: an earlier version used `jq`, which is missing from many Windows
machines that otherwise have a POSIX shell — the hook silently emitted nothing and appeared to
work. Hooks are wired in exec form (`"command": "node", "args": [...]`) so no shell re-parses
the path; on Windows the `bash` on `PATH` may be WSL's rather than Git Bash.

The scripts never exit non-zero and never throw: they swallow malformed input, return cleanly
outside a git work tree, and treat every git call as fallible. **A `SessionStart` hook that
errors blocks the session**, so failing open is the only acceptable behaviour — but a swallowed
error is written to stderr, which Claude Code keeps in its debug log (`claude --debug`), so a
broken hook is findable.

Verify with the payload shapes they receive (see the `sdlc-init` skill, Phase 4).

### Changing or disabling it

Review with `/hooks`. To disable one, delete its handler from `.claude/settings.json`
(`agent-setup update` respects a handler you removed). A newly created `.claude/settings.json`
may not be picked up until `/hooks` is opened once or the session restarts.

## Why this exists

**Long sessions drift.** Work that began as a focused change accretes across a compaction
boundary until a branch named for one thing contains three. The compaction boundary is the
natural place to ask, because it is exactly where the agent loses the context that would have
reminded it.

**Shared trees lose work.** {{Keep this section only if `sharedTree` is true.}}
More than one session works in this checkout at once. Files you did not touch appear, change,
and disappear mid-session. The discipline:

- **Never `git add -A` or `git commit -a`.** Stage explicit paths, always.
- **Re-check `git status` immediately before committing.** The tree may have moved since you
  last looked.
- A modified or untracked file you did not create belongs to someone else. Leave it. Do not
  commit it, revert it, or "clean it up".

The worked example from the repository the sdlc-kit came from: while a CI change was being
implemented on one branch, another session wrote nine component files, a modified manifest,
and a lockfile-rewriting install into the **same working tree** inside a four-minute window.
Nothing was lost — because the CI work committed named paths rather than `git add -A`.

## Related

- [branching.md](./branching.md) — the branching model in full
- [ci-cd.md](./ci-cd.md) — what a branch must pass to merge
- [critical-infrastructure.md](../docs/critical-infrastructure.md) — whether any of this is actually enforced
