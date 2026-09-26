# Skill overlays

A kit skill in `.claude/skills/<name>/` is shared by every project that installs Agent_Setup,
and `agent-setup update` replaces it. This folder is where **this** project adapts a skill
without forking it.

Each skill written for the kit reads `.claude/overlays/<skill-name>.md` before it starts, and
the overlay wins where the two disagree. The third-party design skills are copied verbatim
from their authors and read no overlay: adapt them through
`.claude/overlays/frontend-design-workflow.md`, which decides when each of them runs.

Write only what is specific to this repo and what a competent agent would otherwise get wrong:

```markdown
# frontend — overlay
- Components live in `src/ui/<feature>/`; shared primitives in `src/ui/kit/`. Never create a
  second primitive — widen the existing one.
- Server state is TanStack Query only; query keys come from `src/api/keys.ts`.
- Single test: `pnpm vitest run <file>` · e2e: `pnpm playwright test <spec>`.
```

`/sdlc-init` writes the first overlays from its survey; `/self-improve` adds to them as the
project teaches its agents. If an overlay line would help *every* project, it belongs in the
kit instead: capture it with `/self-improve`, and it will be exported upstream.
