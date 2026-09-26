# Routing examples

Each example: the inbox entry, where it goes, and the exact change.

## 1 · A command that must never run → guard rule

> **Lesson:** never run `pnpm registry:build:finance` — it overwrites the shared registry every
> domain reads. Use `pnpm registry:build`.

`.claude/sdlc.config.json` (protected — propose to the user):

```json
"guard": {
  "extraDeny": [
    {
      "pattern": "pnpm\\s+registry:build:[a-z]+",
      "reason": "Per-domain registry builds overwrite the shared registry every domain reads.",
      "instead": "pnpm registry:build"
    }
  ]
}
```

In Claude Code the guard hook now denies it at the moment of temptation, with the alternative
in the denial.

## 2 · A check after editing certain files → postEdit

> **Lesson:** after editing `prisma/schema.prisma`, the client must be regenerated or types are stale.

```json
"postEdit": [
  { "paths": ["prisma/schema.prisma"], "remind": "Schema changed — run `pnpm db:generate` before typecheck/tests, and add a migration." }
]
```

Use `run` instead of `remind` only for commands well under a second.

## 3 · Something CI should catch → a gate

> **Lesson:** two PRs this month imported `src/infra` from `src/domain`.

Add a boundary check (dependency-cruiser, import-linter, ArchUnit…), wire it as a gate:

```json
{ "id": "boundaries", "title": "Rule 1 — domain never imports infra", "command": "npx depcruise src --config .dependency-cruiser.cjs", "blocking": true, "rule": "1", "fix": "Depend on a port in src/domain; implement it in src/infra." }
```

Then break it on purpose once (a scratch import), confirm the gate fails, revert, and record
the date in `.claude/docs/critical-infrastructure.md`.

## 4 · How a kit skill should work here → overlay

> **Lesson:** this repo's forms use Formik + yup, not React Hook Form; field errors come from
> `mapApiErrors()` in `src/lib/forms.ts`.

`.claude/overlays/frontend.md`:

```markdown
## Forms
- Formik + yup (not React Hook Form). Map API 422 errors with `mapApiErrors()` from `src/lib/forms.ts`.
```

## 5 · Context for certain files → path-scoped rule

> **Lesson:** SQL in `db/migrations/` must be idempotent and carry a `-- module:` header.

`.claude/rules/migrations.md`:

```markdown
---
paths:
  - "db/migrations/**/*.sql"
---
# Migration rules
- Every migration starts with `-- module: <name>`.
- Statements are idempotent (`IF NOT EXISTS`, guarded `DO $$ … $$`).
```

(Claude Code loads it when those files are read; other agents get the same content if you also
reference it from the overlay of the relevant skill.)

## 6 · A dated incident → lessons.md

> **Lesson:** the staging database is restored from production every Sunday 02:00 UTC — data
> written to staging on Saturdays disappears.

`.claude/docs/lessons.md`:

```markdown
### 2026-09-26 — Staging is overwritten weekly
Staging is restored from a production snapshot every Sunday 02:00 UTC. Don't leave test fixtures there across a weekend; seed them in the test.
```

## 7 · Universal → export to the kit

> **Lesson:** agents write `useEffect` fetches for search inputs and ship the stale-response race.

That is not specific to this repository; it belongs in the `frontend` skill. Write
`.claude/learnings/outbox/2026-09-26-frontend-search-race.md` in the proposal format, with a
regression case (prompt + expectations). Meanwhile, add a one-line reminder to
`.claude/overlays/frontend.md` so this project benefits before the kit ships the change.

## 8 · Personal → ask

> **Lesson:** the user prefers answers in European Portuguese and short status updates.

Not a property of the code. Offer: "Shall I save this to your personal memory
(auto memory / `~/.claude/CLAUDE.md`)?" — and write only if they agree.
