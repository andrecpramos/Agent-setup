# SDLC — CI/CD

> **Audited against the tree:** {{DATE}}
> Provider: {{GitHub Actions / GitLab CI / …}} · Config: `{{path}}`
> Gate definitions: `.claude/sdlc.config.json`

## The contract

**Every gate in `sdlc.config.json` runs in CI, with the same command, and
`/gates` runs the same list locally.** One list, three consumers. When a local
gate and its CI job diverge, people stop running the local one — and they are
right to, because it stopped predicting the outcome.

## Jobs

| Job | Runs | Blocks merge | Rule | Typical duration |
|---|---|---|---|---|
| `{{gate id}}` | `{{command}}` | yes / no | Rule {{N}} | {{...}} |

Ordered cheapest-first so a failing run fails fast. A gate set that puts a
{{90-second}} suite ahead of a {{75ms}} boundary check wastes a minute on every
failed run, and those minutes are what makes people stop pushing small commits.

## The production guard

{{Keep if `branching.releaseOnRequestOnly` is true.}}

A job that **fails any PR into `{{PRODUCTION}}` whose head is not
`{{INTEGRATION}}`**. This is the repository-level layer of the branching contract
— the one that does not depend on an agent having read anything.

```yaml
# {{provider}} — the shape, not the whole file
{{job name}}:
  if: {{PR target is production}}
  steps:
    - name: Refuse a non-release PR into production
      run: |
        test "${{ '{{' }} head_ref {{ '}}' }}" = "{{INTEGRATION}}" \
          || { echo "PRs into {{PRODUCTION}} come from {{INTEGRATION}} only."; exit 1; }
```

It does not catch a **local push** to production. Nothing server-side does, unless
branch protection is enabled. `guard-git.mjs` is the only layer that covers that
case, and it covers it only for agents.

## Caching

{{What is cached, keyed on what, and what invalidates it.}}

A stale cache produces the worst class of CI failure: green locally, red in CI,
for reasons in neither diff. When debugging an inexplicable CI result, clearing
the cache is the second thing to try, right after re-reading the job's actual
steps.

## Artefacts

{{What each run publishes and how long it is kept — test reports, coverage,
scorecards, build outputs. Anything needed to answer "what changed?" three months
later belongs here.}}

## Secrets in CI

- Referenced by name, never echoed, never in a step that runs on a fork PR.
- {{Which secrets exist, what each is for, who rotates them.}}
- A job that needs a secret does not run on PRs from forks. Design for that rather
  than discovering it.

## Deployment

{{Trigger, target, approval, rollback. If there is no automated deployment, say
so plainly — "deploys are manual, run by {{who}}, documented in
[deployment.md](deployment.md)" is a complete and honest answer.}}

## Adding a gate

1. Add it to `.claude/sdlc.config.json` — `id`, `command`, `blocking`, `rule`, `fix`
2. Add the CI job with the **identical** command
3. **Make it fail on purpose once.** A gate nobody has seen fail is a gate nobody
   knows works — this is the step that separates a real gate from a decorative one
4. Record that deliberate failure in
   [critical-infrastructure.md](../docs/critical-infrastructure.md)
5. Update the rule's row in [rules.md](../docs/rules.md) from `convention` to the gate

Step 3 is skipped constantly, and it is why vacuous gates survive. The worked
example: a job named "generated artefacts are current" that diffed a directory the
build never wrote to, green for weeks, checking nothing.

## When CI is red and local is green

In order of likelihood:

1. The commands differ. Compare them character by character, not by intent.
2. Something is uncommitted locally — generated files, a lockfile.
3. Cache state.
4. Environment: version, platform, locale, timezone, path separators, line endings.
5. Ordering or concurrency — a test that passes alone and fails in a suite.

Fix the cause, not the symptom. Adding a retry to (5) converts a real bug into
invisible noise that resurfaces in production.
