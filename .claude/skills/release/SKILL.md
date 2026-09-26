---
name: release
description: >
  Cut a new version of the Agent_Setup kit — check that lint and tests pass, choose the semver
  bump from the Unreleased changelog, update package.json, kit/.claude-plugin/plugin.json and
  CHANGELOG.md together, preview the impact on registered projects with a dry-run update, and
  roll out when asked. Use in the Agent_Setup repository when the user says "release",
  "cut a version", "ship the kit" or "update all my projects".
---

# Release the kit

## 1 · Gate

```bash
npm run check                               # lint (0 errors) + every test
node bin/agent-setup.mjs vendor status      # did sdlc-kit or a vendored repo move? (exit 1 if so)
```

Stop on any failure of the first. If something upstream moved, report it — porting sdlc-kit
changes or taking a `vendor sync` is a separate decision, never part of a release.

## 2 · Choose the version

From `CHANGELOG.md` → **Unreleased**:

| Change | Bump |
|---|---|
| wording, examples, new eval cases, bug fixes that keep behaviour | patch |
| new guidance, new skill, new CLI option, new hook behaviour behind a default-on setting | minor |
| changed manifest/settings format, removed skill, renamed files, anything that needs a manual step in projects | major |

## 3 · Bump everything together

- `package.json` `version`
- `kit/.claude-plugin/plugin.json` `version` (lint fails if the two differ)
- `CHANGELOG.md`: rename **Unreleased** to `## x.y.z — YYYY-MM-DD`, start a new empty
  Unreleased section.

Run `npm run check` again.

## 4 · Preview the rollout

```bash
node bin/agent-setup.mjs status --all
node bin/agent-setup.mjs update --all --dry-run
```

Report per project: files that will change, and **conflicts** — kit files a project modified
locally (they will get `.kit-new` files instead of updates).

## 5 · Roll out — only when the user says so

```bash
node bin/agent-setup.mjs update --all
```

Then list the projects with `.kit-new` files to merge. Committing in each project is that
project's business — do not commit there unless asked.

If this repository is under git, commit the release (`chore(release): x.y.z`) and tag it only
when the user asks.
