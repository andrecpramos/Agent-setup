// Rendering the project-facing documents from kit/templates.

import { join } from 'node:path';
import { TEMPLATES, kitVersion } from './paths.mjs';
import { readText, today } from './util.mjs';
import { skillSummary } from './catalog.mjs';

export const template = (name) => {
  const t = readText(join(TEMPLATES, name));
  if (t === null) throw new Error(`missing template kit/templates/${name}`);
  return t;
};

/** Replace {{KEY}} placeholders that have a value; leave the rest visible. */
export function render(text, vars) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

const WORKFLOW_ORDER = ['sdlc-init', 'gates', 'ship-it', 'handoff', 'self-improve', 'enforcement-audit'];

export function buildVars({ detection, selection, catalog, agentSummaries, targets = ['claude'], gitHooks = false, hooks = true }) {
  // Catalog order (front, back, middle, …) reads better than alphabetical.
  const order = Object.keys(catalog.skills ?? {});
  const skills = [...selection.skills].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const names = new Set(skills.map((s) => s.name));
  const domain = skills.filter((s) => s.group !== 'core' && s.group !== 'design');
  const design = skills.filter((s) => s.group === 'design');
  const workflow = WORKFLOW_ORDER.filter((n) => names.has(n));
  // The design group is one row: AGENTS.md loads into every session, and the router
  // (frontend-design-workflow) is what decides which of its skills runs.
  const designEntry = names.has('frontend-design-workflow') ? 'frontend-design-workflow' : design[0]?.name;

  const rows = domain.map((s) => `| \`${s.name}\` | ${skillSummary(catalog, s.name)} |`);
  if (design.length) {
    rows.push(
      `| \`${designEntry}\`${design.length > 1 ? ` and ${design.length - 1} more design skills` : ''} | Visual design: direction, brand references, build, real-browser verification — start with \`${designEntry}\`; it sequences the rest |`,
    );
  }
  if (workflow.length) rows.push(`| ${workflow.map((n) => `\`${n}\``).join(' · ')} | The delivery workflow: set up the contract, run gates, ship, hand off, learn, audit |`);
  const skillsTable = rows.length ? ['| Skill | Use it for |', '|---|---|', ...rows].join('\n') : '_No skills installed._';

  const commands = detection.commands.length
    ? [
        '| Task | Command |',
        '|---|---|',
        ...detection.commands.map(([task, cmd]) => `| ${task} | \`${cmd}\` |`),
        '| Single test | TODO(sdlc-init) |',
        '',
        '> Detected from manifests at install time. `/sdlc-init` checks each one against what CI',
        '> actually runs — a command that differs from CI is worse than no command.',
      ].join('\n')
    : 'TODO(sdlc-init): no build manifest was detected — record the exact install, build, test (including a single test), lint and typecheck commands here.';

  const agentLines = selection.agents.map((a) => `\`${a.name}\` — ${agentSummaries[a.name] ?? 'see .claude/agents/'}`);
  const claudeAgents = agentLines.length
    ? `- **Delegate volume, not judgement.** Subagents keep noisy work out of this conversation:\n${agentLines.map((l) => `  ${l}`).join('\n')}`
    : '';

  const invocable = [...workflow, ...domain.map((s) => s.name), ...(designEntry ? [designEntry] : [])].map((n) => `\`/${n}\``);

  const skillsLocation = targets.includes('agents')
    ? 'Each domain has a playbook in `.claude/skills/<name>/SKILL.md`. Agents that read `.agents/skills/` (Codex, Cursor, Copilot, Gemini CLI…) see the same files there through links — one copy, linked per clone by `node .claude/hooks/setup-clone.mjs`.'
    : 'Each domain has a playbook in `.claude/skills/<name>/SKILL.md`.';
  const enforcementNote = !hooks
    ? 'Nothing mechanical enforces this here — follow it exactly.'
    : gitHooks
      ? 'Git hooks enforce it for every agent and person in each clone where `node .claude/hooks/setup-clone.mjs` has run, and Claude Code hooks deny it even earlier.'
      : 'Claude Code hooks enforce it in Claude Code sessions; other agents are held to it by these instructions alone (`agent-setup update --git-hooks` enforces it for every agent).';

  return {
    SKILLS_LOCATION: skillsLocation,
    ENFORCEMENT_NOTE: enforcementNote,
    PROJECT_NAME: detection.name,
    KIT_VERSION: kitVersion(),
    DATE: today(),
    STACK: detection.stack.length ? detection.stack.join(', ') : 'nothing detected — fill in by hand',
    COMMANDS: commands,
    SKILLS_TABLE: skillsTable,
    CLAUDE_AGENTS: claudeAgents,
    CLAUDE_COMMANDS: invocable.length ? invocable.join(' · ') : '—',
  };
}

/** A provisional sdlc.config.json from what git and the manifests showed. */
export function provisionalConfig(detection) {
  const twoTrunk = Boolean(detection.integration);
  return {
    $schema: './skills/sdlc-init/assets/sdlc.config.schema.json',
    version: 1,
    _provisional: true,
    _comment:
      'Written by agent-setup install from what git showed — NOT verified, and no gates yet. Run /sdlc-init to survey the repo, confirm the branch model, and add the gates CI actually runs. Delete _provisional when done.',
    project: {
      name: detection.name,
      ...(detection.stack.length ? { stack: detection.stack } : {}),
      ...(detection.packageManager ? { packageManager: detection.packageManager } : {}),
    },
    branching: twoTrunk
      ? { model: 'two-trunk', production: detection.production ?? 'main', integration: detection.integration, featurePrefix: 'feature/', releaseOnRequestOnly: true }
      : { model: 'trunk', production: detection.production ?? 'main', featurePrefix: 'feature/', releaseOnRequestOnly: true },
    sharedTree: false,
    gates: [],
  };
}
