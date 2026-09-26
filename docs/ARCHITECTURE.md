# Architecture of Agent_Setup

## Contents

1. What it is made of
2. The ownership model
3. What an install writes
4. install / update / uninstall
5. Vendoring and the plugin channel
6. Which agents get what
7. Enforcement layers
8. Files and formats

## 1 · What it is made of

One kit, one place per theme. The authoritative map is the Layout tables in
[AGENTS.md](../AGENTS.md); `agent-setup lint` fails when the tree and those tables disagree.

```
Agent_Setup/
├── bin/agent-setup.mjs        the CLI (Node 18+, zero dependencies)
├── lib/                       CLI modules: sync (install/update), vendor, export, routing, lint, settings merge, blocks, detect
├── kit/                       THE PAYLOAD — also a Claude Code plugin (.claude-plugin/plugin.json)
│   ├── skills/                30 skills, own and vendored side by side, one folder each
│   ├── catalog.json           each skill's group (domain · core · design), the agents, the profiles
│   ├── vendor.json            what comes from elsewhere, and every local override with its why
│   ├── vendor.lock.json       upstream commits; the derived source's file fingerprints
│   ├── licenses/              one licence per upstream source
│   ├── agents/                4 subagents — thin wrappers that preload a skill
│   ├── hooks/                 Claude Code hooks, the git guard, setup-clone
│   ├── templates/             AGENTS.md, managed blocks, learnings and overlay scaffolds
│   └── settings.fragment.json hook wiring and permissions merged into a project
├── inbox/                     kit-improvement proposals harvested from projects
├── .claude/skills/            maintainer skills: harvest, release
├── .claude-plugin/            local plugin marketplace: one plugin, ./kit
├── docs/                      this folder
└── tests/                     node --test suites for hooks, CLI, vendoring and routing
```

**Skill groups.** `domain` (seven engineering skills written here), `core` (the delivery
workflow and the learning loop, installed in every project) and `design` (seventeen visual
design skills routed by `frontend-design-workflow`; two written here, fifteen vendored). A
group is a catalog attribute, not a folder: every skill lives in `kit/skills/`, and profiles
select by name or by `@group`.

## 2 · The ownership model

The design problem: sdlc-kit found that copying a ready-made `.claude/` into repos fails —
10 of 18 copied files diverged within one session, each a legitimate adaptation. Yet a kit
that ships no skills cannot carry expertise between projects. The resolution is to separate
knowledge by **who owns it**:

| Layer | Examples | Owner | Update behaviour |
|---|---|---|---|
| **Kit-owned** | skills, licences, agents, hooks, the learnings/overlays READMEs | the kit | hashed in the project manifest; replaced on `update` only while unmodified; a local modification is kept and the new version written beside it as `.kit-new` |
| **Managed blocks** | the `agent-setup:begin/end` sections of AGENTS.md, CLAUDE.md, GEMINI.md, .gitignore | the kit, inside the markers | rewritten on every update; everything outside the markers is the project's |
| **Project-owned** | `sdlc.config.json`, `.claude/docs/`, decisions, overlays, learnings, project skills | the project | created once if absent (from templates or by `sdlc-init`); never touched again by the kit |
| **Per clone** | `.agents/` links, git hooks | each clone | not in git at all; recorded in the manifest, created by `.claude/hooks/setup-clone.mjs` |

Kit skills are written to be repo-agnostic: whatever a skill needs to know about *this*
repository it reads from `sdlc.config.json`, the knowledge base and — above all —
`.claude/overlays/<skill>.md`, which every own skill reads before starting and which wins
where it disagrees. The part that used to drift now has a home of its own. Vendored skills
have no overlay line (they are never edited); the design router's overlay covers them.

## 3 · What an install writes

```
<project>/
├── AGENTS.md                  created from template (or a managed block appended)
├── CLAUDE.md                  managed block: @AGENTS.md + Claude Code specifics
├── GEMINI.md                  managed block: @./AGENTS.md  (--targets …,gemini)
├── .gitignore                 managed block: local agent state and the .agents/ links
├── .agents/                   per clone, git-ignored (--targets …,agents; default)
│   ├── skills/<skill>  →      link to .claude/skills/<skill>, for Codex, Cursor, Copilot, Gemini CLI…
│   └── licenses        →      link to .claude/licenses
└── .claude/
    ├── agent-setup.json       manifest: kit version + source, selection, file hashes, links, what was added
    ├── settings.json          hooks (exec form) and permissions, merged
    ├── sdlc.config.json       provisional contract from git (project-owned; /sdlc-init verifies)
    ├── skills/<skill>/        the one copy of each selected skill (evals stay in the kit)
    ├── licenses/<source>.txt  the licence of each upstream source a selected skill comes from
    ├── agents/*.md            kit subagents
    ├── hooks/*.mjs            kit hooks, and setup-clone.mjs (always)
    ├── learnings/             inbox.md, README.md, (archive/, outbox/, signals.jsonl later)
    └── overlays/README.md     how to adapt a skill without forking it
```

**Why links, not a second copy.** Claude Code reads only `.claude/skills/`; most other agents
read `.agents/skills/`. Two copies doubled every skill in the repository and drifted the
moment one was edited. Links cost nothing, but they cannot be committed: git on Windows walks
through a junction and commits its contents a second time. So the manifest records the links,
`.gitignore` lists them, and `setup-clone.mjs` creates them in each clone — junctions on
Windows (no admin rights needed), relative symlinks elsewhere. It removes them with unlink,
never a recursive delete, which through a junction would reach the real files.

`--git-hooks` additionally installs `pre-commit`/`pre-push` into `<git-dir>/agent-setup/`
(per clone, outside the working tree), chains any hooks the clone already had, and points
`core.hooksPath` there — unless husky, lefthook or a team hooks folder owns it, in which case
it prints the two lines to add. The same `setup-clone.mjs` does this.

## 4 · install / update / uninstall

`install` and `update` are one function (`lib/sync.mjs`) that makes a project match the desired
state for its selection:

1. **Resolve the selection** — profile (default `standard`) + `--skills`/`--exclude` (names or
   `@group`) + targets. The `core` group is always included; agents come with the skills they
   require.
2. **Detect collisions** — a skill or agent of the same name that the project owns is skipped
   and reported, never overwritten.
3. **Reconcile kit-owned files** against the manifest:
   - recorded and unmodified → replaced if the kit's version changed;
   - recorded and modified → kept, kit version written as `<file>.kit-new`;
   - recorded and missing → restored;
   - new → written, unless a different file is already there (then `.kit-new`);
   - a pristine sdlc-kit hook (its hash is among the fingerprints in `kit/vendor.lock.json`)
     → upgraded in place;
   - no longer desired → removed if unmodified, otherwise kept and reported.
4. **Merge settings** — remove what the previous run added, re-merge the current fragment,
   skip handlers the user deleted on purpose (per event).
5. **Write managed blocks** and create project-owned files that are missing.
6. **Write the manifest, register the project** in `.state/projects.json` (machine-local) so
   `update --all`, `status --all` and `harvest` can find it, **and run `setup-clone.mjs`** for
   this clone's links and git hooks.

Line endings are normalised before hashing, so `core.autocrlf` never makes a file look
modified. `uninstall` first runs `setup-clone.mjs --uninstall` (links and git hooks), then
reverses exactly the manifest: unmodified kit files, managed blocks, added settings; files
created from templates are deleted only if unchanged.

## 5 · Vendoring and the plugin channel

Everything that comes from elsewhere is recorded in `kit/vendor.json`, in one of two ways:

| Kind | Example | What the kit keeps | Command |
|---|---|---|---|
| **Vendored** — copied verbatim, rebuilt from upstream | taste-skill, agent-browser, playwright-cli, web-design-guidelines, the DESIGN.md brand library | the skill folders in `kit/skills/`, the commit in `vendor.lock.json`, one licence per source in `kit/licenses/` | `agent-setup vendor sync` (`--locked` rebuilds the recorded commits exactly) |
| **Derived** — improved here, no longer mirrored | sdlc-kit → the hooks, `sdlc-init`, `enforcement-audit` | a fingerprint per source file in `vendor.lock.json`; the reasons in [sdlc-changes.md](sdlc-changes.md) | `agent-setup vendor status` reports changes; `agent-setup vendor record sdlc-kit` after porting |

A vendored skill is never edited by hand: the only local changes are frontmatter overrides
(`description`, `compatibility`, `removeKeys`) in `vendor.json`, each with a `why`, re-applied
on every sync. The sync fails if any vendored skill breaks the Agent Skills spec, removes
skills dropped from the manifest, regenerates `design-md-library/INDEX.md`, and warns when an
upstream repository adds a skill that is neither vendored nor excluded. `agent-setup import
<github-url>` adds a new source and syncs it.

The repository root is also a **local plugin marketplace** with one plugin, the kit:

```bash
claude plugin marketplace add C:/Users/andre/Desktop/Agent_Setup
claude plugin install agent-setup@agent-setup     # every skill and agent, in every project
```

With a local marketplace Claude Code reads the plugin straight from this folder, so edits here
reach every session at the next start. The plugin channel carries skills and agents only;
hooks, AGENTS.md and the learning loop are per project, installed with the CLI. Use one
channel per project — a skill installed both ways appears twice.

**Routes that copy one skill folder at a time** — `npx skills add` (any agent, per project or
per user) and claude.ai upload — cannot reach `kit/licenses/`, and MIT and Apache-2.0 require
the notice to travel with every copy. They install from `agent-setup export <dir>` instead:
build output, written outside the kit, in which each vendored skill folder (and the brand
library's `assets/brands/`) carries its LICENSE, every reference points at that copy, and
frontmatter keys outside the Agent Skills spec are removed. The kit itself stays one copy; the
export checks its own result (spec valid, no reference left to `../../licenses/`) and fails
rather than write an incomplete one.

## 6 · Which agents get what

| | Claude Code | Codex · Cursor · Copilot · Gemini CLI · others |
|---|---|---|
| Instructions | `CLAUDE.md` → `@AGENTS.md` | `AGENTS.md` (Gemini: `GEMINI.md` → `@./AGENTS.md`) |
| Skills | `.claude/skills/` (auto-selected by description) | `.agents/skills/` links (Agent Skills readers); any agent can open a `SKILL.md` as AGENTS.md instructs |
| Subagents | `.claude/agents/` | — (each reviewer's procedure lives in its skill, so it can run inline) |
| Guards | Claude Code hooks (Bash and PowerShell tools) + git hooks | git hooks (`--git-hooks`) |
| Learning signals | hooks (corrections, pending lessons, friction) | AGENTS.md instructions |

Portability rules for skills: own skills use the portable frontmatter (`name`,
`description`); Claude-only keys (`context: fork`) appear only where they add real value
(`sdlc-init`, `enforcement-audit`). Other agents ignore them and run those two skills inline;
claude.ai upload and strict validators reject them, so `export` removes them, and each of the
two skills says so in its `compatibility` line. Vendored skills are patched to
the Agent Skills spec by their overrides. The design skills name no single vendor's tools and
link each other by relative path, so they work in agents without skill auto-loading. For
tools with their own skill folders (Windsurf, Roo, Kiro, Goose), `npx skills add <export> -a
<agent>` installs the same skills from an export.

## 7 · Enforcement layers

| Layer | Fires | Covers |
|---|---|---|
| `branch-check` (SessionStart) | every new context window | Claude Code |
| `guard-git` (PreToolUse) | before a shell command runs | Claude Code (Bash, PowerShell) |
| `check-gates` (PostToolUse) | after an edit to a configured path | Claude Code |
| `learning-signals` | session start, user prompt, tool failure | Claude Code |
| `git-guard` (pre-commit, pre-push) | at commit and push | every agent and person in the clone |
| gates in CI + branch protection | before merge | everyone |

The enforcement register (`enforcement-audit`) records, for each rule, which of these hold it.

## 8 · Files and formats

- **Manifest** (`.claude/agent-setup.json`): `kit {name, version, source}`, `selection
  {profile, skills, exclude, targets, hooks, gitHooks}`, `files {path: hash}`, `links
  {link: target}`, `skipped`, `created`, `blocks`, `settings.added`, `settings.removedByUser`.
- **Catalog** (`kit/catalog.json`): `groups`, skills with group and summary, agents with the
  skills they require, the `core` list, `profiles` (skill names or `@group`, or `"*"`),
  `defaultProfile`.
- **Vendoring** (`kit/vendor.json`): `repos` (GitHub source, SPDX licence, `watch` folder),
  `skills` (name, repo, path, overrides, `why`), `excluded`, `assets`, `derived`;
  `kit/vendor.lock.json`: `repos` (commits), `skills`, `assets`, `derived` (fingerprints).
- **Skill evals** stay in the kit: `evals/evals.json` (skill-creator format: `skill_name`,
  `evals[{id, prompt, expected_output, files, expectations[]}]`), `evals/trigger.json`
  (`[{query, should_trigger}]`) and, for routers, `evals/routing.json` (`scope` — skill names
  or `@group` — and `cases[{id, prompt, first[] | none, forbid[], when}]`), run by
  `agent-setup eval-routing`.
- **sdlc config**: `kit/skills/sdlc-init/assets/sdlc.config.schema.json`.
