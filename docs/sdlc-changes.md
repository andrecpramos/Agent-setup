# What changed from sdlc-kit — and why

Agent_Setup derives from sdlc-kit — the user's `C:\Users\andre\Desktop\sdlc-kit`, which is only
ever read — and ships an improved derivative in `kit/`. It keeps no copy of the original: a
snapshot inside this repository would be forty files identical to a folder on the same
machine. Instead `kit/vendor.lock.json` holds a fingerprint of every sdlc-kit file
(`derived.sdlc-kit`), recorded when it was last ported. `agent-setup vendor status` names the
files that changed since, so their improvements can be ported here too (then
`agent-setup vendor record sdlc-kit`), and the installer recognises a pristine sdlc-kit hook in
a project by the same fingerprints and upgrades it in place.

Each entry names the defect or the incident behind it — sdlc-kit's own rule: *a rule without
its incident tends to get optimised away.* Every behavioural change is covered by
`tests/hooks.test.mjs`.

## Where each upstream piece went

| sdlc-kit | Agent_Setup |
|---|---|
| `runtime/hooks/*.mjs` | `kit/hooks/` — `branch-check`, `guard-git`, `check-gates`, `_config` (improved), plus `learning-signals`, `git-guard`, `setup-clone` (new) |
| `runtime/settings.json` | `kit/settings.fragment.json` — merged by the installer, never copied |
| `BOOTSTRAP.md` | the `sdlc-init` skill |
| `patterns/workflow.md` | `kit/skills/sdlc-init/references/workflow.md` |
| `patterns/enforcement.md` | the `enforcement-audit` skill and its reference |
| `templates/`, `examples/`, `sdlc.config.schema.json` | `kit/skills/sdlc-init/assets/` |
| `tooling/check-kit-sync.mjs` | superseded — the manifest hashes every kit-owned file and `agent-setup status` reports drift in all of them, not only hooks |

## The command guard (`guard-git.mjs`)

**1 · The PowerShell tool bypassed every denial.** The upstream guard inspected only the `Bash`
tool and was wired with `matcher: "Bash"`. On Windows, Claude Code also has a `PowerShell` tool
— this very machine offers it — so `git push origin main` through PowerShell met no guard at
all. Now: matcher `Bash|PowerShell`, both tool names handled, and PowerShell here-strings
(`@' … '@`) stripped the way heredocs are.

**2 · Regex over the whole command both over- and under-matched.** `\bmain\b` matches inside
`feature/main-menu`, so pushing that branch was denied; meanwhile a bare `git push` while
standing on `main`, `git checkout -b x` while on `main`, and `git checkout -b x origin/main`
all passed, because none of them spells the protected ref the way the regex expected. The
guard now splits the command into invocations (respecting quotes, `&&`, `;`, pipes,
subshells and `$(…)`), tokenises each, resolves the **current branch** for commands that act
on it implicitly, strips remote prefixes, and compares refs exactly (globs for
`protectedRefs`). Nested shells (`bash -c`, `pwsh -Command`, `cmd /c`), wrappers (`timeout`,
`env`, `VAR=…`) and git aliases are followed.

**3 · "Do not commit here" was stated, not enforced.** `branch-check` told the agent not to
commit on production; nothing denied it. `guard.denyCommitOnProduction` (default on, not in
the trunk model) now does — together with merges, rebases, cherry-picks and `pull <other>`
while standing on production.

**4 · Gitflow contradicted itself.** The branching template shows `hotfix/*` cut from
production; the guard denied branching from production in every model. Gitflow now exempts
`branching.hotfixPrefix`.

**5 · `releaseOnRequestOnly: false` did nothing.** The schema described it as the switch the
guard enforces, but the guard only read `guard.denyProductionWrites`. Production-write
denials now require both to be true, so the documented switch works.

**6 · New, config-gated protections**, each for a failure seen in agent sessions:

| Setting (default) | Denies | Because |
|---|---|---|
| `denyForcePushShared` (on) | force-pushing or deleting the integration branch | it rewrites history every clone is built on |
| `denyDiscardUncommitted` (on) | `reset --hard`, `checkout .`, `restore .` over uncommitted changes; `clean -f` over untracked files | an agent "cleaning up" destroys the user's work in progress, unrecoverably |
| `denyNoVerify` (on) | `--no-verify`, `-c core.hooksPath=…`, `HUSKY=0`, `SKIP=…`, the git-hook escape variable | skipping a hook ships the problem it caught |
| `sharedTree` (extended) | also `git add -u` and `git stash` without paths | both sweep in another session's work |

## All hooks

**7 · Fail-open hid two real bugs.** Hooks must never block a session on their own error, so
upstream swallowed every exception. During development two hooks shipped a
temporal-dead-zone `ReferenceError` (module-level constants read before initialisation under
top-level `await`) — and both *looked like they worked*, because failing open is
indistinguishable from "nothing to say". Hooks now write swallowed errors to stderr (which
Claude Code keeps in its debug log for an exit-0 hook, at no cost to the session), put their
entry point at the end of the file, and the test suite fails on any stderr.

**8 · Wiring depended on the shell and the cwd.** Upstream wired `node .claude/hooks/x.mjs`
with `"shell": "bash"`: a relative path (breaks when the session starts in a subdirectory)
through a named shell (on this machine `bash` on PATH is WSL's `System32\bash.exe`, not Git
Bash). The kit uses exec form — `"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/…"]` — so
no shell parses anything.

**9 · `PreCompact` wiring removed.** `SessionStart` already fires with source `compact` after
compaction and re-injects the contract into the fresh window; the `PreCompact` injection
landed in the context about to be summarised.

**10 · `check-gates` never ran for notebooks.** The script handled `NotebookEdit`, but its
wiring matched only `Edit|Write`. Now `Edit|Write|MultiEdit|NotebookEdit`; brace globs
(`src/**/*.{ts,tsx}`) are supported, matching Claude Code's own `paths:` syntax; a timed-out
check says so instead of reporting a generic failure.

**11 · `branch-check`** handles a detached HEAD, words the trunk model correctly, mentions the
gitflow hotfix exception, and distinguishes *no config* from a *provisional* one (the
installer now writes one from what git shows, so the hooks are accurate from minute one).

## Settings

**12 · The `ask` protections protected nothing — twice over.** Upstream's `ask` rules guarded
`.ai/decisions/**`, `.ai/sdlc.config.json` and friends, while the kit's default root is
`.claude/` — the protection silently applied to nothing. And `Write(…)` rules are not matched
at all: an end-to-end run of Claude Code against an installed project reported *"Write(path) is
not matched by file permission checks — only Edit(path) rules are"*; `Edit(…)` rules cover every
file-editing tool. Fixed (Edit rules on `.claude/` paths), and extended to
`.claude/settings.json` and `.claude/hooks/**`, so an agent cannot quietly disable its own
guardrails.

**13 · Merge semantics sharpened.** Handlers are added only for the events and tools no
equivalent handler (same script) already covers — a repo with upstream's `Bash` guard gains
`PowerShell` coverage instead of a duplicate guard — and everything added is recorded so
`update` and `uninstall` remove exactly that. A handler the user deleted is not re-added.

## Enforcement beyond Claude Code

**14 · "Enforced" meant "enforced in Claude Code".** The register would list "production
never moves on an agent's initiative" as enforced while Codex, Cursor or a human could push to
`main` unopposed — the overstated-coverage failure the register exists to prevent. New:
`git-guard.mjs` holds the same rules in `pre-commit`/`pre-push`, installed **per clone** into
the git directory by `setup-clone.mjs`. (The first version kept versioned hooks in
`.githooks/`; a test showed that checking out a branch without the install commit — usually
production — removed the hooks from exactly the branch they protect.) Existing
`.git/hooks` are chained, not disabled; husky/lefthook setups are left alone with the two lines
to add. The enforcement method now records **coverage** for every mechanism.

## Schema

**15 · The examples failed their own schema.** Both shipped examples carry `_comment`, and the
schema's root had `additionalProperties: false`. Keys starting with `_` are now allowed at
every level (`_comment`, `_provisional`).

**16 · Location drift.** The schema said the config lives at `.ai/sdlc.config.json` with
`docs.root` defaulting to `.ai`; the loader defaulted to `.claude/`. Aligned on `.claude/`
(`.ai/` still read).

**17 · New fields:** `branching.hotfixPrefix`, `gates[].timeoutMs` (an inconclusive gate fails
closed), and the guard settings above.

## Method and templates

**18 · BOOTSTRAP became a skill.** `sdlc-init` runs in a forked context — BOOTSTRAP's own
advice ("run it in its own context") — and `branch-check`'s instruction to "run /sdlc-init" now
resolves; upstream referenced a command it never shipped.

**19 · "Generate, don't copy", refined.** Upstream shipped no skills because copied ones
drifted (10 of 18 files within one session). The drift was repo-specific knowledge living in
copied files. Agent_Setup separates the two: **universal, config-driven** assets (`gates`,
`ship-it`, `handoff`, `enforcement-audit`, `gate-runner`, `docs-keeper`, the domain skills) are
kit-owned and copied — like upstream's hooks — while **repo-specific** knowledge is generated
into overlays (`.claude/overlays/<skill>.md`), project skills and the config. `sdlc-init` writes
the first overlays from its survey.

**20 · Templates:** eight files referenced `.ai/sdlc.config.json` (fixed); the knowledge-base
README was titled "`.ai/`" and labelled `roles/` as `agents/` (fixed); role briefs now point to
the kit skill for their role; `agent-workflow.md` and `branching.md` document the current hook
layers — upstream's `branching.md` still listed `PreCompact` and called the command guard "the
only layer that catches a local push" — and state which agents each layer covers;
`docs/lessons.md` added (BOOTSTRAP told agents to write `lessons.md` but shipped no template);
references to skills and agents the kit never ships (`write-adr`, `/rules-check`,
`boundary-auditor` as a given) now name the ones it does. The ADR template gained
**Deciders**, a quality-attribute scenario table and a stricter **Compliance** section, and it is
the only ADR template in the kit — the `architecture` skill uses the same file instead of a
second copy.

## Porting back

Everything above is independent of the rest of Agent_Setup except items 18–19. To port a hook
fix upstream, copy the file from `kit/hooks/` and its tests from `tests/hooks.test.mjs`; the
hooks read only `sdlc.config.json`.
