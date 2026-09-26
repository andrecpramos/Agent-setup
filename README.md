# Agent_Setup

**A portable, self-improving agent setup for any repository.** One command gives a project
expert skills for every layer of the stack, visual-design skills that verify in a real
browser, review subagents, guardrails that actually enforce the branching contract, an
`AGENTS.md`/`CLAUDE.md` pair written for agents, the sdlc-kit method — and a learning loop
that turns every correction into a lasting improvement, in that project and, when it is
universal, in every project.

Works with Claude Code natively, and with Codex, Cursor, GitHub Copilot, Gemini CLI and any
other agent that reads `AGENTS.md` and Agent Skills folders.

```bash
node C:/Users/andre/Desktop/Agent_Setup/bin/agent-setup.mjs install path/to/project
# then, in Claude Code inside that project:  /sdlc-init
```

---

## What you get

### Skills — expertise that loads when the work matches

One kit, three groups (`agent-setup list` shows them all):

| Group | Skills | Installed by |
|---|---|---|
| **domain** | `frontend` · `backend` · `api-design` (the middle layer: contracts, BFFs, webhooks, integrations) · `security` · `architecture` · `design-system` · `agent-eval` | every profile that fits the project (default: all seven) |
| **core** | `self-improve` · `sdlc-init` · `gates` · `ship-it` · `handoff` · `enforcement-audit` — the delivery workflow and the learning loop | always |
| **design** | 17 skills for visual design, routed by `frontend-design-workflow` ([below](#the-design-group)) | the `web` and `frontend` profiles, or `--skills @design` |

The domain and core skills are written here around **the mistakes agents actually make** in
each domain — not a textbook — and ship with evals (`evals/evals.json`, `evals/trigger.json`)
so they can be measured and improved without regressions. Most design skills are vendored
from their upstream repositories, verbatim, with provenance and licences
([below](#third-party-skills-and-licences)).

### Subagents — delegate volume, keep judgement

`gate-runner` (runs the gates, returns MERGE-SAFE/BLOCKED), `security-reviewer` and
`architecture-reviewer` (read-only reviews with project memory that improves across sessions),
`docs-keeper` (checks the knowledge base against the tree).

### Guardrails that enforce, not just instruct

| Hook | Does |
|---|---|
| `branch-check` | states the branching contract with live git state at every new context window |
| `guard-git` | denies production writes, branching from production, force-pushing integration, discarding uncommitted work, and hook bypasses — for both the Bash and PowerShell tools — naming the alternative each time |
| `check-gates` | runs the fast check an edit could have broken, right after the edit |
| `learning-signals` | notices corrections ("I told you…", "não faças…"), pending lessons, and a command failing three times |
| `git-guard` *(opt-in, `--git-hooks`)* | the same contract at commit and push time for **every** agent and person |

### An `AGENTS.md` that agents can use

Pre-filled with the commands detected from your manifests, a working agreement, the skills
table, the knowledge-base map, the learning loop and the boundaries — inside a managed block,
so your own content above it is never touched. `CLAUDE.md` imports it; `GEMINI.md` too if you
ask.

## Quick start

```bash
# 1 · See what would happen
node <kit>/bin/agent-setup.mjs install ../my-app --dry-run

# 2 · Install (standard profile: domain + core skills, for Claude Code and every .agents/skills reader)
node <kit>/bin/agent-setup.mjs install ../my-app

# 3 · Restart Claude Code in the project (hooks load at session start), then:
/sdlc-init        # verifies the branch model against CI, adds the real gates, fills AGENTS.md,
                  # writes the knowledge base and the first skill overlays, ranks the gaps
```

Profiles: `standard` (default) · `web` and `frontend` (with the design group) · `service` ·
`ai-app` · `library` · `minimal` · `full`. Add or remove skills and groups with
`--skills @design,brandkit` and `--exclude <skill>`. Other options: `--git-hooks` ·
`--targets claude,agents,gemini` · `--no-hooks`. `agent-setup help` lists everything.

It is safe on an existing project: nothing you own is overwritten. Existing `CLAUDE.md` and
`AGENTS.md` get a managed block appended; a skill or agent with the same name as yours is
skipped (yours wins); a pristine sdlc-kit install is upgraded in place; `settings.json` is
merged, never replaced.

**One copy of every skill.** Skills are installed once, in `.claude/skills/` (Claude Code).
Codex, Cursor, Copilot, Gemini CLI and the other Agent Skills readers see the same folders
through links in `.agents/skills/`. Links are not committed; each clone creates them with
`node .claude/hooks/setup-clone.mjs` (the installer runs it for you).

## The design group

`frontend-design-workflow` is the entry point: it checks what the current agent can do
(shell, image generation, web access, model family), sizes the task, runs the pipeline and
settles conflicts between the other skills. For agents that do not route on skill
descriptions reliably, the project's AGENTS.md skills table already names it.

```
brief ─► 0 environment ─► 1 source of truth ─► 2 build ─────────────► 3 verify ────► 4 audit ─────► 5 report
         shell? images?    DESIGN.md / tokens    one core skill:        agent-browser   web-design-
         web? model?       design-md-library     design-taste-frontend  (playwright-    guidelines
                           taste §0-2 dials      | image-to-code        cli: WebKit,    agent-browser
                           └► stitch-design-     | gpt-taste            tests; MCP      a11y
                              taste writes       + one style layer      without shell)  taste §14
                              DESIGN.md
```

| Skill | Source | Role |
|---|---|---|
| `frontend-design-workflow` | this kit | Entry point: environment, task size, pipeline, conflicts |
| `design-md-library` | this kit + [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 74 brand DESIGN.md systems, adapted into the project rather than cloned |
| `design-taste-frontend` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Default build skill: brief inference, dials, anti-slop rules, pre-flight check |
| `gpt-taste` | taste-skill | Build skill for GPT-family models on motion-heavy briefs |
| `image-to-code` | taste-skill | Build skill when the agent can generate images: comps first, then code |
| `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit` | taste-skill | Images-only deliverables: website comps, app screens, brand boards |
| `redesign-existing-projects` | taste-skill | Audit checklist for improving an existing site |
| `high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui` | taste-skill | Style layers (at most one): soft premium, editorial, Swiss/terminal |
| `stitch-design-taste` | taste-skill | Writes the project's `DESIGN.md` so the system persists across sessions and tools |
| `full-output-enforcement` | taste-skill | Stops truncated output on large generations |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Code audit against Vercel's Web Interface Guidelines (fetched live) |
| `agent-browser` | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Default browser: screenshots, theme emulation, console and axe checks |
| `playwright-cli` | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | WebKit/Firefox, Playwright tests, tracing, user annotation |

The group's 17 descriptions (about 6k characters, roughly 1.5–2k tokens) load into every
session, which is why it is opt-in. In an agent without image generation the four image
skills (`image-to-code`, `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`) can
never run: leave them out with
`--exclude image-to-code,imagegen-frontend-web,imagegen-frontend-mobile,brandkit`. The brand
library adds about 2.3 MB to a repository; the installer says so before it lands.

**Setup the browser skills need:**

```bash
npm i -g agent-browser && agent-browser install
npm i -g @playwright/cli@latest
playwright-cli install-browser webkit     # also: firefox, chromium
```

`web-design-guidelines` needs web access to raw.githubusercontent.com; the image skills need
an agent that can generate images. Each skill declares its requirements in `compatibility`.
**Agents without a shell** (desktop chat apps, some IDE modes) can use the browser as an MCP
server instead. Claude, Cursor and Gemini CLI take this shape (VS Code uses the key
`"servers"`):

```json
{
  "mcpServers": {
    "agent-browser": { "command": "agent-browser", "args": ["mcp", "--tools", "core,mobile,debug"] },
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] }
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.agent-browser]
command = "agent-browser"
args = ["mcp", "--tools", "core,mobile,debug"]
```

## How it stays good

```
correction ──▶ learning-signals ──▶ inbox ──▶ /self-improve retro ──┬──▶ guard rule · gate · overlay · rule · lesson   (this project, now)
                                                                     └──▶ outbox ──▶ agent-setup harvest ──▶ /harvest ──▶ kit skill + eval case
                                                                                                                              │
                                    every project ◀── agent-setup update --all ◀── /release ◀─────────────────────────────────┘
```

- **Project lessons** go to the strongest place that will make them stick — a guard rule beats
  a skill overlay, which beats a document — so the same mistake is caught mechanically next
  time.
- **Universal lessons** become proposals with a regression case; the kit adopts them only after
  triage, and `update` delivers them everywhere.
- **Kit files are never edited in projects.** Each skill reads `.claude/overlays/<skill>.md`, the
  project's own adaptation, which wins where they disagree and survives updates.

Details: [docs/SELF-IMPROVEMENT.md](docs/SELF-IMPROVEMENT.md).

## Everyday commands

| In a project | |
|---|---|
| `agent-setup status <project>` | version, drift, pending merges, links, sdlc config, learnings |
| `agent-setup update <project>` / `--all` | bring projects to the current kit (local changes are kept; the new version lands as `.kit-new`) |
| `agent-setup uninstall <project>` | remove exactly what the kit added |

| In the kit | |
|---|---|
| `agent-setup list` | every skill by group, the agents and the profiles |
| `agent-setup lint` · `npm test` | the kit's gates |
| `agent-setup harvest` | collect proposals from every project's outbox into `inbox/` |
| `agent-setup new-skill <name> --group domain` | scaffold an own skill that passes lint |
| `agent-setup import <github-url>` | vendor a third-party skill, with provenance and licence |
| `agent-setup export <dir>` | self-contained copies of the skills for any other install route (below) |
| `agent-setup vendor status` · `vendor sync` | what changed upstream (GitHub repos and sdlc-kit) · take it in |
| `agent-setup eval-routing` | check which skill a real agent picks for each routing case |

Tip: add an alias — PowerShell `function agent-setup { node C:\Users\andre\Desktop\Agent_Setup\bin\agent-setup.mjs @args }`,
or `npm link` in this folder.

## Other ways to use it

All routes deliver the same skills.

| Where | How |
|---|---|
| **Claude Code, every project** (skills and agents, nothing written to repos) | `claude plugin marketplace add C:/Users/andre/Desktop/Agent_Setup`, then `claude plugin install agent-setup@agent-setup`. Hooks, AGENTS.md and the learning loop stay per project via the CLI; don't install the same skills both ways in one project. |
| **Any agent, one project or every project** (including Windsurf, Roo, Kiro, Goose, which have their own skill folders) | `agent-setup export <dir>` (any folder outside the kit; `--profile`/`--skills` as for install), then `npx skills add <dir> --skill '<names or *>' -a <agents>`; add `-g` for a user-level install that no repository carries |
| **claude.ai / Claude Desktop** | zip one folder from `<dir>/skills/` of an export and upload it under Settings → Capabilities → Skills |
| **No skill support** | point the agent at `kit/skills/<name>/SKILL.md`, or paste it into the conversation |

These routes copy one skill folder at a time, so they take their copies from an **export**, not
from `kit/`: the export puts each third-party skill's LICENSE into its folder (MIT and
Apache-2.0 require the notice to travel with every copy) and removes the frontmatter keys only
Claude Code understands, which claude.ai upload and strict validators reject. `npx skills add`
pointed at `kit/` itself would copy the vendored skills without their licences.

## Third-party skills and licences

Vendored skills are copied verbatim from their upstream repositories by
`agent-setup vendor sync` and never edited by hand; the only local changes are frontmatter
overrides recorded in [kit/vendor.json](kit/vendor.json), each with its reason. The exact
commits are in `kit/vendor.lock.json`, and each upstream licence is kept once, in
[kit/licenses/](kit/licenses/). It travels with every copy: `install` puts the licences a
project's skills need in `.claude/licenses/`, the plugin carries the whole folder, and
`export` bundles each licence into the skill folder it covers.

| Upstream | Skills | Licence |
|---|---|---|
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 12 design skills | MIT |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | the brand library in `design-md-library` | MIT |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | `agent-browser` | Apache-2.0 |
| [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) | `playwright-cli` | Apache-2.0 |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `web-design-guidelines` | none declared upstream (checked 2026-09-26) — fine for personal use; check before redistributing |

Left out on purpose: `taste-skill-v1`, superseded by `design-taste-frontend` (two versions of
one skill compete for the same prompts). The DESIGN.md files describe the publicly visible
styling of their brands; they are not endorsed by those brands, and `design-md-library`
forbids reproducing logos, wordmarks or proprietary fonts.

## Requirements

Node 18+ and git. Windows, macOS and Linux. No npm dependencies.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layout, ownership model, install/update algorithm, vendoring, cross-agent matrix
- [docs/SELF-IMPROVEMENT.md](docs/SELF-IMPROVEMENT.md) — the learning loop end to end
- [docs/AUTHORING.md](docs/AUTHORING.md) — the quality bar for own skills, importing third-party ones, evals and routing tests
- [docs/sdlc-changes.md](docs/sdlc-changes.md) — every improvement over sdlc-kit, with its reason
- [CHANGELOG.md](CHANGELOG.md)

Built on the method of sdlc-kit (see [docs/sdlc-changes.md](docs/sdlc-changes.md)): a written
rule is obeyed until someone is in a hurry — so the kit's job is to make the important rules
mechanical, and to say honestly which ones are not.
