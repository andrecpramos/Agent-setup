# Changelog

All notable changes to the kit. Versions follow semver as described in the `/release` skill:
patch for wording and fixes, minor for new guidance, skills or options, major for anything
that needs a manual step in projects.

## Unreleased

One kit: the design pack, the sdlc-kit snapshot and every duplicate file merged or removed.

- **Breaking — one kit, no packs.** The 17 `frontend-kit` skills are now the kit's `design`
  group in `kit/skills/`. `--packs frontend-kit` is replaced by `--skills @design` or the `web`
  and `frontend` profiles (a project installed with the pack keeps its design skills on
  `update`). The marketplace lists one plugin; `agent-setup install … --packs` and
  `new-skill --pack` explain the replacement instead of running.
- **Breaking — default profile `standard`** (domain + core skills). The design group is
  opt-in: its descriptions load into every session and its brand library adds 2.3 MB to a
  repository. `--profile full` keeps the old everything-installed behaviour.
- **Breaking — one copy of every skill in projects.** `.agents/skills/` held a second copy of
  every skill; it is now per-clone links to `.claude/skills/` (junctions on Windows, no admin
  rights), plus `.agents/licenses`, created by the new `.claude/hooks/setup-clone.mjs` and
  git-ignored. `update` removes the old copies; **teammates run
  `node .claude/hooks/setup-clone.mjs` once per clone**. The same script replaces
  `install-git-hooks.mjs` for the git hooks.
- **Vendoring in the CLI.** `agent-setup vendor sync [--locked] [--source repo=dir]`,
  `vendor status`, `vendor record` and `import <github-url>` replace the pack's
  `sync-vendor.mjs` and the `upstream` command. `kit/vendor.json` and `kit/vendor.lock.json`
  record every third-party skill, its overrides with a `why`, and the exact commits.
- **Licences once per source.** `kit/licenses/<source>.txt` replaces twelve identical per-skill
  copies; projects get `.claude/licenses/` with the licences their skills need.
- **`agent-setup export <dir>`** writes self-contained copies for the routes that copy one skill
  folder at a time (`npx skills add` for any agent, per project or per user; claude.ai
  upload): each vendored folder carries its LICENSE, references point at it, and Claude-only
  frontmatter keys are removed. Pointing `npx skills add` at `kit/` would copy vendored skills
  without their licences, so the README now routes those installs through an export.
- **`sdlc-init` and `enforcement-audit`** state in `compatibility` that they run forked only in
  Claude Code and inline elsewhere, and why their export drops the forking keys.
- **sdlc-kit without a snapshot.** `upstream/sdlc-kit/` (40 files identical to the original
  folder) is gone; `kit/vendor.lock.json` keeps a fingerprint of each file, which is all
  `vendor status` and the pristine-hook upgrade need.
- **Routing evals in the CLI.** `agent-setup eval-routing` runs `evals/routing.json` suites
  (now beside the skill they test, with a `scope`) in Claude Code or any agent via `--cmd`.
- **Lint as the tidiness gate.** One kit, own skills strict and vendored skills held to the
  Agent Skills spec; routing suites, vendoring, licences and the catalog cross-checked; and
  repository-wide: the tree must match the Layout tables in `AGENTS.md`, no two files may have
  the same content, and no file may carry control characters, U+FFFD, a BOM or (in code)
  invisible characters.
- **AGENTS.md skills table** and the install report list skills in catalog order (frontend,
  backend, api-design, security, …) instead of alphabetically.
- **Fixed:** six role-brief templates in `sdlc-init` had their **Skills** lines corrupted by
  shell quoting (backticks stripped, three letters turned into control characters); ten source
  files carried invisible literal BOM characters instead of `\uFEFF` escapes.

## 1.0.0 — 2026-09-26

First release.

- **Skills (13):** `frontend`, `backend`, `api-design`, `security`, `architecture`,
  `design-system`, `agent-eval` (domain); `self-improve`, `sdlc-init`, `gates`, `ship-it`,
  `handoff`, `enforcement-audit` (workflow). Each with references and evals in skill-creator
  format; the domain skills with trigger evals including near-misses.
- **Subagents (4):** `gate-runner`, `security-reviewer` and `architecture-reviewer` (with project
  memory), `docs-keeper`.
- **Hooks:** `branch-check`, `guard-git`, `check-gates` derived from sdlc-kit with the fixes in
  `docs/sdlc-changes.md` (PowerShell coverage, tokenised ref matching, current-branch
  awareness, commit/merge on production, force-push and discard protection, hook-bypass
  denial); new `learning-signals` (corrections in English and Portuguese, pending lessons,
  friction log) and `git-guard` + `install-git-hooks` (the contract for every agent, per clone).
- **CLI:** `install`, `update` (with `--all`), `status`, `uninstall`, `harvest`, `lint`, `list`,
  `new-skill`, `import`, `upstream`. Non-destructive by construction: hashed kit-owned files,
  managed blocks, recorded settings merges, `.kit-new` on conflict.
- **Cross-agent:** `AGENTS.md` as the shared instructions, `CLAUDE.md`/`GEMINI.md` importing it,
  skills mirrored into `.agents/skills/` by default.
- **Distribution:** local plugin marketplace with `agent-setup` and the `frontend-kit` pack.
- **sdlc-kit:** vendored pristine in `upstream/sdlc-kit/`; bootstrap, workflow and enforcement
  methods turned into skills; schema and templates corrected.
