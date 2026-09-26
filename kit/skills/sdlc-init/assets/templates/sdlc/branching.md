# Branching model

**Adopted:** {{DATE}} · **Model:** `{{branching.model}}` · Source of truth:
`.claude/sdlc.config.json`

This document is prose for humans. The tooling reads the config. If they
disagree, the config wins and this document is stale.

## The shape

{{Keep the block matching `branching.model` and delete the others.}}

**two-trunk**
```
{{PRODUCTION}}    production. Release only.
  ^
  | merge ONLY on the user's explicit instruction
  |
{{INTEGRATION}}   integration. Default branch. Everything lands here.
  ^
  | PR
  |
<feature>         cut FROM {{INTEGRATION}}, merges back INTO {{INTEGRATION}}
```

**trunk**
```
{{PRODUCTION}}    the only long-lived branch. Always releasable.
  ^
  | PR, short-lived (< 2 days), squash-merged
  |
<feature>         cut FROM {{PRODUCTION}}, merges back INTO it
```

**gitflow**
```
{{PRODUCTION}} ◀── release/x.y.z ◀── {{INTEGRATION}} ◀── <feature>
      ▲                                    ▲
      └────────── hotfix/x.y.z+1 ──────────┘  (merges to BOTH)
```

## The rules

**1 · `{{PRODUCTION}}` is production and moves only on command.** No agent
commits, merges, pushes or opens a PR to it on its own initiative. It moves when
the user asks for a release, in that session, in words. *"The work is finished"*
is not such a request; *"ship it"* is.

**2 · `{{INTEGRATION}}` is where all work lands.** Set it as the host's default
branch, so a PR opened without an explicit base targets it automatically — the
safe thing happens when nobody is paying attention, which is the point.

**3 · Every branch is cut from `{{INTEGRATION}}` and merges back into it.** A
branch cut from production misses whatever has already been integrated and
silently reverts it on merge.

## How each rule is enforced

Independent layers, because any one of them can be missed.

| Layer | Mechanism | Catches |
|---|---|---|
| Context | [AGENTS.md](../../AGENTS.md) — `CLAUDE.md` and `GEMINI.md` import it | Loaded into every session of every agent — the contract is read before anything else |
| Session | [`branch-check.mjs`](../../.claude/hooks/branch-check.mjs) | Claude Code: fires at every new context window with live state; forces the branch question |
| Local command | [`guard-git.mjs`](../../.claude/hooks/guard-git.mjs) | Claude Code (Bash and PowerShell tools): denies the command before it runs, naming the alternative |
| Local git | `git-guard.mjs`, installed per clone by `node .claude/hooks/setup-clone.mjs` | Every agent and person in that clone: blocks the commit or push itself (bypassable only with `--no-verify`) |
| Repository | {{CI job / branch protection}} | Fails any PR into production that did not come from integration |

> **Survey:** the Repository row is the one most often missing. If there is no CI
> job or branch-protection rule, write "none" and add it to the
> [gap list](../docs/critical-infrastructure.md). Do not describe an intended rule as
> if it exists.

## Branch naming

```
{{featurePrefix}}<area>-<short-name>
```

`<area>` is a scope from `commits.scopes`. Keep names short enough to read in
`git branch` output and specific enough that a stale one is recognisable a month
later.

## Merging

- **Into `{{INTEGRATION}}`:** {{squash / merge commit}}, on green CI.
- **Into `{{PRODUCTION}}`:** `--ff-only`. Deliberate — if it refuses, production
  has commits integration does not, which means something was pushed out of band.
  Stop and find out what before forcing anything.

## Releasing

Only when the user asks:

```bash
git checkout {{PRODUCTION}}
git merge --ff-only {{INTEGRATION}}
git push origin {{PRODUCTION}}
git tag -a v{{X.Y.Z}} -m "{{summary}}" && git push origin v{{X.Y.Z}}
```

## What is deliberately not enforced

{{The gaps you chose to leave, and why. The common one: a branch-protection rule
requiring a PR into production would also block the maintainer's own push after a
local release merge — turning "only on command" into "only via the web UI". The
policy is enforced for the *agent*, while the human keeps a direct path.

State the trade-off explicitly. An unenforced rule that was *chosen* is fine; one
that was *forgotten* is a gap. A reader cannot tell them apart unless you say.}}

## Related

- [../agent-workflow.md](./agent-workflow.md) — hook mechanics and the shared-tree rules
- [ci-cd.md](ci-cd.md) — what a branch must pass to merge
- [deployment.md](deployment.md) — the release process itself
