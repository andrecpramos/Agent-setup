#!/usr/bin/env node
// agent-setup — install, update and improve a portable agent setup in any project.
// Zero dependencies; Node 18+. Run `agent-setup help` for usage.

import { resolve } from 'node:path';
import { CliError, c, listFlag, parseArgs, say } from '../lib/util.mjs';
import { kitVersion, KIT_ROOT } from '../lib/paths.mjs';
import { sync } from '../lib/sync.mjs';
import { status, uninstall, harvest, list, newSkill } from '../lib/commands.mjs';
import { vendorSync, vendorStatus, recordDerived, importSkill } from '../lib/vendor.mjs';
import { evalRouting } from '../lib/routing.mjs';
import { exportSkills } from '../lib/export.mjs';
import { lint } from '../lib/lint.mjs';
import { listProjects } from '../lib/state.mjs';

const HELP = `
${c.bold('agent-setup')} ${kitVersion()} — a portable, self-improving agent setup for any repository

${c.bold('Project commands')}
  install <project>   Install the kit: skills, agents, hooks, AGENTS.md + CLAUDE.md, learning loop
      --profile <p>     standard (default) | web | frontend | service | ai-app | library | minimal | full
      --skills a,b      add skills or whole groups on top of the profile (e.g. @design, brandkit)
      --exclude a,b     leave these skills, groups or agents out
      --targets t       claude,agents (default) — skills live once in .claude/skills (Claude Code);
                        .agents/skills links to them for Codex, Cursor, Copilot, Gemini CLI and other
                        Agent Skills readers; add gemini to write GEMINI.md; "claude" alone: no links
      --git-hooks       also enforce the branching contract with git pre-commit/pre-push hooks,
                        for every agent and human (installed per clone, existing hooks chained)
      --no-hooks        skip the Claude Code hooks and their settings
      --no-sdlc-config  don't write a provisional .claude/sdlc.config.json
      --dry-run         show what would change, write nothing
  update [project]    Bring a project to this kit version (never overwrites local changes)
      --all             every registered project
      --reset-hooks     re-add hook handlers you removed from settings.json
      (selection flags above change what is installed)
  status [project]    Health: version, drift, pending merges, links, sdlc config, learnings  (--all)
  uninstall <project> Remove exactly what the kit added; keep anything modified or project-owned

${c.bold('Kit commands')}  (run in the kit)
  list                Skills by group, agents and profiles
  lint [path]         Validate skills, agents, hooks, catalog, vendoring, licences, duplicates — the gate
  new-skill <name>    Scaffold an own skill that already meets the lint rules  (--group, --summary)
  harvest             Collect kit-improvement proposals from every project's learnings outbox
      --from <path>     only this project (repeatable)
  export <dir>        Self-contained copies of the skills for routes that copy one folder at a time
                      (npx skills add, claude.ai upload): licences bundled, Claude-only keys removed
      --profile, --skills, --exclude as for install; --force replaces an earlier export
  import <github-url> Vendor a third-party skill: adds it to kit/vendor.json and syncs it  (--name)
  vendor sync         Rebuild every vendored skill from upstream; fails on Agent Skills spec violations
      --locked          use the commits in kit/vendor.lock.json instead of the upstream heads
      --source k=dir    use a local checkout for repo k (repeatable)
  vendor status       What changed upstream: GitHub heads and derived sources (sdlc-kit)  (--offline)
  vendor record <n>   Re-record a derived source's fingerprints after porting its changes  (--source)
  eval-routing        Run the routing suites (kit/skills/*/evals/routing.json) in a real agent
      --skill <s>       one suite   --only id,id   --jobs 4   --timeout 300 (seconds per case)
      --cmd '[...]'     agent command as a JSON array; {prompt} and {kit} are substituted
      --assume caps     capabilities the agent has (e.g. gpt-model,image-generation)

Docs: ${resolve(KIT_ROOT, 'README.md')}
`;

const number = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

async function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positionals } = parseArgs(rest, { booleans: ['dry-run', 'all', 'force', 'reset-hooks', 'json', 'quiet', 'git-hooks', 'locked', 'offline'] });
  if (flags.packs !== undefined) {
    throw new CliError('--packs is gone: the design pack merged into the kit. Use --skills @design, or --profile web / frontend.');
  }
  const selection = {
    profile: typeof flags.profile === 'string' ? flags.profile : undefined,
    skills: listFlag(flags.skills),
    exclude: listFlag(flags.exclude),
    targets: listFlag(flags.targets),
    hooks: flags.hooks === false ? false : flags.hooks === true ? true : undefined,
    gitHooks: flags['git-hooks'] === false ? false : flags['git-hooks'] === true ? true : undefined,
    sdlcConfig: flags['sdlc-config'] === false ? false : undefined,
    resetHooks: Boolean(flags['reset-hooks']),
    dryRun: Boolean(flags['dry-run']),
    force: Boolean(flags.force),
  };

  switch (cmd) {
    case 'install':
      if (!positionals[0]) throw new CliError('usage: agent-setup install <project> [options]');
      sync(positionals[0], { mode: 'install', ...selection });
      return 0;

    case 'update': {
      const targets = flags.all ? listProjects().map((p) => p.path) : [positionals[0] ?? '.'];
      if (!targets.length) throw new CliError('no registered projects');
      let failed = 0;
      for (const t of targets) {
        try {
          sync(t, { mode: 'update', ...selection });
        } catch (err) {
          failed++;
          say(`${c.red('✖')} ${t}: ${err.message}`);
        }
      }
      return failed ? 1 : 0;
    }

    case 'status':
    case 'doctor': {
      const targets = flags.all ? listProjects().map((p) => p.path) : [positionals[0] ?? '.'];
      let ok = true;
      for (const t of targets) ok = status(t).ok && ok;
      return ok ? 0 : 1;
    }

    case 'uninstall':
      if (!positionals[0]) throw new CliError('usage: agent-setup uninstall <project>');
      uninstall(positionals[0], { dryRun: selection.dryRun });
      return 0;

    case 'harvest':
      harvest({ from: listFlag(flags.from), dryRun: selection.dryRun });
      return 0;

    case 'lint':
      return lint({ paths: positionals }).errors ? 1 : 0;

    case 'list':
      list();
      return 0;

    case 'new-skill':
      if (flags.pack !== undefined) throw new CliError('--pack is gone: there is one kit. Use --group domain|core|design.');
      newSkill(positionals[0], { group: flags.group ?? 'domain', summary: flags.summary });
      return 0;

    case 'export':
      exportSkills(positionals[0], { profile: selection.profile, skills: selection.skills, exclude: selection.exclude, force: selection.force });
      return 0;

    case 'import':
      importSkill(positionals[0], { name: flags.name, license: flags.license });
      return 0;

    case 'vendor': {
      const [sub, arg] = positionals;
      if (sub === 'sync') {
        const sources = {};
        for (const s of flags.source === undefined ? [] : [].concat(flags.source)) {
          const eq = String(s).indexOf('=');
          if (eq < 1) throw new CliError(`--source expects repo=dir, got "${s}"`);
          sources[String(s).slice(0, eq)] = String(s).slice(eq + 1);
        }
        vendorSync({ sources, locked: Boolean(flags.locked) });
        return 0;
      }
      if (sub === 'status') return vendorStatus({ offline: Boolean(flags.offline) }).changes ? 1 : 0;
      if (sub === 'record') {
        recordDerived(arg ?? 'sdlc-kit', { source: typeof flags.source === 'string' ? flags.source : undefined });
        return 0;
      }
      throw new CliError('usage: agent-setup vendor sync|status|record');
    }

    case 'eval-routing':
      return evalRouting({
        skill: typeof flags.skill === 'string' ? flags.skill : undefined,
        only: listFlag(flags.only),
        cmd: typeof flags.cmd === 'string' ? flags.cmd : undefined,
        assume: typeof flags.assume === 'string' ? flags.assume : undefined,
        jobs: number(flags.jobs, 4),
        timeout: number(flags.timeout, 300),
      });

    case 'upstream':
      throw new CliError('`upstream` is now `vendor status` (compare) and `vendor record sdlc-kit` (after porting).');

    case 'version':
    case '--version':
    case '-v':
      say(kitVersion());
      return 0;

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      say(HELP);
      return 0;

    default:
      throw new CliError(`unknown command "${cmd}". Run: agent-setup help`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CliError) {
    say(`${c.red('error')} ${err.message}`);
    process.exitCode = err.exitCode;
  } else {
    console.error(err);
    process.exitCode = 1;
  }
}
