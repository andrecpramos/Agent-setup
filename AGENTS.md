# Agent_Setup — instructions for agents working on the kit

This repository **is** the product: a portable, self-improving agent setup that
`agent-setup install` injects into other projects. Changes here reach every project on the
next `update`, so the bar is higher than in an ordinary repo. Humans start at `README.md`.

## Layout

One place per theme. `agent-setup lint` checks the tree against these two tables in both
directions: an entry that is not listed is an error, and so is a listed path that does not
exist. A new place gets its row here in the same change — or it belongs in an existing one.

| Path | What | Rule |
|---|---|---|
| `kit/` | the payload installed into projects; also the Claude Code plugin | see the next table |
| `bin/` | the CLI entry point, `agent-setup` | Node 18+, **zero dependencies** — keep it that way |
| `lib/` | the CLI's modules: install/update (`sync`), vendoring (`vendor`), portable copies (`export`), routing evals (`routing`), `lint` | same |
| `tests/` | `node:test` suites; hook and CLI tests run real git repos | |
| `docs/` | ARCHITECTURE, AUTHORING, SELF-IMPROVEMENT, sdlc-changes | keep true to the code |
| `inbox/` | kit-improvement proposals harvested from projects | triage with `/harvest` |
| `.claude/` | this repo's own maintainer skills, `/harvest` and `/release` | never installed into projects |
| `.claude-plugin/` | the local plugin marketplace: one plugin, `./kit` | |
| `README.md`, `CHANGELOG.md` | for humans | a CHANGELOG line for every user-visible change |
| `AGENTS.md`, `CLAUDE.md` | for agents: this file, and Claude Code's import of it | |
| `package.json`, `.gitignore`, `.gitattributes` | version and scripts; machine-local state kept out of git; LF line endings in every checkout | |

| Path in `kit/` | What | Rule |
|---|---|---|
| `kit/skills/` | every skill, one folder each — own and vendored side by side | own: `docs/AUTHORING.md`; vendored: never hand-edit |
| `kit/catalog.json` | each skill's group (`domain`, `core`, `design`), the agents, the install profiles | every skill and agent is listed |
| `kit/vendor.json` | everything that comes from elsewhere: vendored skills with each local override and its `why`, and the derived source (sdlc-kit) | edit this, then `vendor sync` |
| `kit/vendor.lock.json` | the exact upstream commits, and the derived source's file fingerprints | written only by `vendor sync` and `vendor record` |
| `kit/licenses/` | one licence text per upstream source, shared by all its skills | written only by `vendor sync` |
| `kit/agents/` | subagents | |
| `kit/hooks/` | Claude Code hooks, the git guard, and `setup-clone` (per-clone `.agents/` links and git hooks) | fail open and log |
| `kit/templates/` | the project AGENTS.md, CLAUDE.md and GEMINI.md blocks, the learnings and overlays READMEs, the `.gitignore` block | |
| `kit/settings.fragment.json` | hooks and permissions merged into a project's `.claude/settings.json` | |
| `kit/.claude-plugin/` | the plugin manifest | its version is package.json's |

## Where the skills come from

- **Own skills** are written here, to `docs/AUTHORING.md`: each reads its project overlay, says
  when to use it, names the mistakes that matter, and has evals.
  `node bin/agent-setup.mjs new-skill <name> --group <group>` scaffolds one that passes lint.
- **Vendored skills** are third-party skills listed in `kit/vendor.json` and rebuilt by
  `agent-setup vendor sync`. Never hand-edit a vendored folder — nor
  `design-md-library/INDEX.md` or `design-md-library/assets/`, which are vendored too: the next
  sync overwrites them. Frontmatter changes go in `vendor.json` as overrides, each with a
  `why`. Add a skill with `agent-setup import <github-url>`.
- **The derived source** is the user's sdlc-kit, `C:\Users\andre\Desktop\sdlc-kit`. The kit's
  hooks, `sdlc-init` and `enforcement-audit` are improved derivatives of it; every change and
  its reason is in `docs/sdlc-changes.md`. **Never modify that folder** — it is only read.
  `agent-setup vendor status` reports when it changes; port what applies into `kit/`, then run
  `agent-setup vendor record sdlc-kit`.

## Commands

| Task | Command |
|---|---|
| The gate: skills, catalog, vendoring, licences, layout, duplicates, corrupted text | `node bin/agent-setup.mjs lint` |
| All tests | `npm test` (≈ 30 s; creates temp git repos) |
| One test file | `node --test tests/hooks.test.mjs` |
| One test by name | `node --test --test-name-pattern="shared tree" tests/hooks.test.mjs` |
| Lint + tests | `npm run check` |
| Try an install | `node bin/agent-setup.mjs install <temp-project> --dry-run` |
| Rebuild vendored skills exactly as locked | `node bin/agent-setup.mjs vendor sync --locked` |
| Take upstream changes into vendored skills | `node bin/agent-setup.mjs vendor sync`, then review the diff |
| What changed upstream (GitHub repos and sdlc-kit) | `node bin/agent-setup.mjs vendor status` |
| Which skill a real agent picks for a prompt | `node bin/agent-setup.mjs eval-routing` (Claude Code; `--cmd` and `--assume` for other agents) |
| Self-contained copies for `npx skills add` or claude.ai upload | `node bin/agent-setup.mjs export <dir-outside-the-kit>` |
| The official Agent Skills validator | `PYTHONUTF8=1 skills-ref validate kit/skills/<name>` (`pip install skills-ref`) |

Tests that call the CLI set `AGENT_SETUP_STATE_DIR` and `AGENT_SETUP_INBOX_DIR` (and
`AGENT_SETUP_VENDOR_LOCK` when they need other fingerprints) so they never touch the real
registry, inbox or lock — do the same in any new test.

## Rules

1. **Own skills meet `docs/AUTHORING.md`; vendored skills meet the Agent Skills spec.** Lint
   enforces the mechanical parts of both.
2. **Behaviour changes come with tests.** A hook change without a case in
   `tests/hooks.test.mjs` is not done; a skill change comes with an eval case; a routing
   change (a description, the design router) is checked with `eval-routing` — a harmless-looking
   description edit can steal prompts from another skill.
3. **Hooks fail open and log.** Never exit non-zero from a Claude Code hook, never throw; write
   swallowed errors with `logError`; keep the entry point at the bottom of the file (a
   top-level-await TDZ bug hid twice behind fail-open). Git hooks (`git-guard.mjs`) block by
   exiting 1 but still fail open on their own errors.
4. **Nothing destructive in projects.** The installer never overwrites a project-owned or
   locally modified file; new behaviour must keep `update`/`uninstall` exact (see the ownership
   model in `docs/ARCHITECTURE.md`). Links are removed with unlink, never a recursive delete —
   a recursive delete through a Windows junction reaches the real files.
5. **Portable first.** Portable frontmatter only (`name`, `description`, `license`,
   `compatibility`, `metadata`, `allowed-tools`) unless a Claude-only key degrades gracefully.
   In skill instructions, name no single vendor's tools ("fetch the URL", "run the command");
   link skills by relative path (`../<skill>/SKILL.md`) as well as by name; declare needed CLIs,
   network access or image generation in `compatibility`.
6. **One copy of everything.** Lint fails on two files with the same content. A skill in two
   places, or a second folder for a theme that already has one, is a defect — merge it. In
   projects, skills and licences exist once in `.claude/`; other agents get links. Copies that
   must be self-contained (a skill folder installed on its own needs its LICENSE) are build
   output of `agent-setup export`, written outside the repository — never committed here.
7. **Design-skill conflicts are settled in one place:** `frontend-design-workflow` §3. Add a
   row there rather than patching either skill.
8. **Write files with the editor tools or a quoted bash heredoc — never through PowerShell
   strings.** PowerShell turns `` `a `` into a BEL character, drops other backticks and expands
   `$names`. Lint catches the control characters; it cannot catch a backtick silently lost.
9. **Version together.** `package.json` and `kit/.claude-plugin/plugin.json` share one version;
   every user-visible change gets a line in `CHANGELOG.md` under Unreleased.

## Workflows

- Improving a skill from project lessons: `/harvest` (`.claude/skills/harvest/`).
- Shipping: `/release` (`.claude/skills/release/`).
- New skill: `node bin/agent-setup.mjs new-skill <name> --group domain|core|design`; a
  third-party one: `node bin/agent-setup.mjs import <github-url>`.
