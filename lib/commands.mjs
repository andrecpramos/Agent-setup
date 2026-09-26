// status · uninstall · harvest · list · new-skill
// (vendor sync / status / record and import live in vendor.mjs; eval-routing in routing.mjs)

import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve, relative } from 'node:path';
import { INBOX_DIR, KIT_DIR, KIT_ROOT, MANIFEST_REL, kitVersion } from './paths.mjs';
import {
  CliError,
  c,
  exists,
  git,
  hashFile,
  hashText,
  isDir,
  listFiles,
  pruneEmptyDirs,
  readJsonFile,
  readText,
  say,
  toPosix,
  today,
  writeJson,
  writeText,
} from './util.mjs';
import { MD, HASH, removeBlock } from './blocks.mjs';
import { unmergeSettings, wiredScripts } from './settings.mjs';
import { readManifest, listProjects, unregisterProject } from './state.mjs';
import { loadCatalog, skillDirs, agentFiles, skillSummary, groupSkills } from './catalog.mjs';
import { vendoredSkills } from './vendor.mjs';

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export function status(targetArg, { quiet = false } = {}) {
  const target = resolve(targetArg ?? '.');
  const m = readManifest(target);
  if (!m) {
    if (!quiet) say(`${c.yellow('not installed')}  ${target}`);
    return { ok: false, installed: false };
  }
  const problems = [];
  const warnings = [];
  const modified = [];
  const missing = [];
  for (const [rel, h] of Object.entries(m.files ?? {})) {
    const cur = hashFile(join(target, rel));
    if (cur === null) missing.push(rel);
    else if (cur !== h) modified.push(rel);
  }
  if (missing.length) problems.push(`${missing.length} kit file(s) missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''} — run update to restore`);
  if (modified.length) warnings.push(`${modified.length} kit file(s) modified locally: ${modified.slice(0, 5).join(', ')}${modified.length > 5 ? ' …' : ''} — move project-specific changes to .claude/overlays/, or export universal ones with /self-improve`);

  const kitNew = listFiles(join(target, '.claude')).filter((f) => f.endsWith('.kit-new'));
  if (kitNew.length) warnings.push(`${kitNew.length} pending .kit-new file(s) to merge: ${kitNew.slice(0, 5).map((f) => `.claude/${f}`).join(', ')}`);

  const links = Object.keys(m.links ?? {});
  const missingLinks = links.filter((rel) => !isLink(join(target, rel)) || !existsSync(join(target, rel)));
  if (missingLinks.length) warnings.push(`${missingLinks.length} of ${links.length} .agents/ link(s) missing in this clone — run: node .claude/hooks/setup-clone.mjs`);

  const sj = readJsonFile(join(target, '.claude', 'settings.json'));
  if (sj.error) problems.push(`.claude/settings.json is not valid JSON: ${sj.error}`);
  else if (m.selection?.hooks !== false) {
    const wired = wiredScripts(sj.value ?? {});
    for (const s of ['branch-check.mjs', 'guard-git.mjs', 'check-gates.mjs', 'learning-signals.mjs']) {
      if (!wired.has(s)) warnings.push(`hook ${s} is not wired in .claude/settings.json${(m.settings?.removedByUser ?? []).length ? ' (removed on purpose?)' : ''}`);
    }
  }

  const major = Number.parseInt(process.versions.node, 10);
  if (major < 18) problems.push(`Node ${process.versions.node} is too old for the hooks (need 18+)`);

  const cfgPath = [join(target, '.claude', 'sdlc.config.json'), join(target, '.ai', 'sdlc.config.json')].find(existsSync);
  const cfg = cfgPath ? readJsonFile(cfgPath) : null;
  let sdlc = 'missing — run /sdlc-init';
  if (cfg?.error) problems.push(`sdlc.config.json is not valid JSON: ${cfg.error}`);
  else if (cfg?.value) {
    const gates = Array.isArray(cfg.value.gates) ? cfg.value.gates.length : 0;
    sdlc = `${cfg.value._provisional ? c.yellow('provisional') : 'verified'} · ${cfg.value.branching?.model ?? '?'} (${[cfg.value.branching?.production, cfg.value.branching?.integration].filter(Boolean).join('/')}) · ${gates} gate(s)`;
    if (cfg.value._provisional) warnings.push('sdlc.config.json is provisional — run /sdlc-init');
  }

  const inbox = (readText(join(target, '.claude', 'learnings', 'inbox.md')) ?? '').match(/^## \d{4}-\d{2}-\d{2}/gm)?.length ?? 0;
  let outbox = 0;
  try {
    outbox = readdirSync(join(target, '.claude', 'learnings', 'outbox')).filter((f) => f.endsWith('.md')).length;
  } catch {
    // none
  }
  let overlays = [];
  try {
    overlays = readdirSync(join(target, '.claude', 'overlays')).filter((f) => f.endsWith('.md') && f !== 'README.md');
  } catch {
    // none
  }

  const hooksPath = git(target, 'config', '--get', 'core.hooksPath');
  const gitHooksActive = hooksPath && /\/agent-setup\/hooks\/?$/.test(hooksPath.replace(/\\/g, '/'));
  if (m.selection?.gitHooks && !gitHooksActive) warnings.push('git hooks are selected but not active in this clone — run: node .claude/hooks/setup-clone.mjs');

  const outdated = m.kit?.version !== kitVersion();
  if (!quiet) {
    say('', `${c.bold('agent-setup status')}  ${c.dim(target)}`);
    say(`  version     ${m.kit?.version}${outdated ? c.yellow(`  (kit is ${kitVersion()} — run update)`) : c.green('  (current)')}`);
    say(`  selection   profile ${m.selection?.profile}${(m.selection?.skills ?? []).length ? ` + ${m.selection.skills.join(', ')}` : ''} · ${Object.keys(m.files ?? {}).length} kit files · ${links.length} link(s) for other agents`);
    say(`  sdlc        ${sdlc}`);
    say(`  learnings   ${inbox} in inbox · ${outbox} proposal(s) in outbox${outbox ? ' — run `agent-setup harvest`' : ''}`);
    say(
      `  enforcement Claude Code hooks: ${m.selection?.hooks === false ? 'off' : 'on'} · git hooks: ${
        m.selection?.gitHooks ? (gitHooksActive ? 'on in this clone (every agent and person)' : 'selected, not active in this clone') : 'off — agents other than Claude Code are bound by instructions only'
      }`,
    );
    say(`  overlays    ${overlays.join(', ') || '—'}`);
    for (const p of problems) say(`  ${c.red('problem')}     ${p}`);
    for (const w of warnings) say(`  ${c.yellow('warning')}     ${w}`);
    if (!problems.length && !warnings.length) say(`  ${c.green('healthy')}`);
    say('');
  }
  return { ok: problems.length === 0, installed: true, outdated, problems, warnings, inbox, outbox };
}

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------

export function uninstall(targetArg, { dryRun = false } = {}) {
  const target = resolve(targetArg ?? '.');
  const m = readManifest(target);
  if (!m) throw new CliError(`agent-setup is not installed in ${target}`);
  const removed = [];
  const kept = [];
  const act = (fn) => {
    if (!dryRun) fn();
  };

  // Links and git hooks are per clone; remove them while the setup script still exists.
  const setupClone = join(target, '.claude', 'hooks', 'setup-clone.mjs');
  if (existsSync(setupClone)) {
    act(() => spawnSync(process.execPath, [setupClone, '--uninstall', '--quiet'], { cwd: target }));
    removed.push('per-clone links and git hooks');
  }

  for (const [rel, h] of Object.entries(m.files ?? {})) {
    const abs = join(target, rel);
    const cur = hashFile(abs);
    if (cur === null) continue;
    if (cur === h) {
      act(() => {
        rmSync(abs, { force: true });
        pruneEmptyDirs(join(abs, '..'), target);
      });
      removed.push(rel);
    } else kept.push(rel);
  }

  for (const rel of m.blocks ?? []) {
    const abs = join(target, rel);
    const text = readText(abs);
    if (text === null) continue;
    const markers = rel === '.gitignore' ? HASH : MD;
    const next = removeBlock(text, markers);
    const createdHash = m.created?.[rel];
    if (createdHash && hashText(text) === createdHash) {
      act(() => rmSync(abs, { force: true }));
      removed.push(rel);
    } else if (next !== text) {
      act(() => (next.trim() ? writeText(abs, next) : rmSync(abs, { force: true })));
      removed.push(`${rel} (managed block)`);
    }
  }

  const settingsAbs = join(target, '.claude', 'settings.json');
  const sj = readJsonFile(settingsAbs);
  if (sj.value) {
    const next = unmergeSettings(sj.value, m.settings?.added);
    const keys = Object.keys(next).filter((k) => k !== '$schema');
    act(() => (keys.length ? writeJson(settingsAbs, next) : rmSync(settingsAbs, { force: true })));
    removed.push('.claude/settings.json (kit hooks and permissions)');
  }

  act(() => {
    rmSync(join(target, MANIFEST_REL), { force: true });
    unregisterProject(target);
  });

  say('', `${c.bold('agent-setup uninstall')}  ${c.dim(target)}${dryRun ? c.yellow('  (dry run)') : ''}`);
  say(`  ${c.green('removed')}  ${removed.length} item(s)`);
  for (const k of kept) say(`  ${c.yellow('kept')}     ${k} — modified locally`);
  say(`  ${c.dim('left')}     project-owned: .claude/learnings/, .claude/overlays/*.md, .claude/sdlc.config.json, .claude/docs/ — delete by hand if unwanted`, '');
  return { removed, kept };
}

// ---------------------------------------------------------------------------
// harvest — pull kit-improvement proposals out of project outboxes
// ---------------------------------------------------------------------------

export function harvest({ from = [], dryRun = false } = {}) {
  const projects = from.length ? from.map((p) => ({ path: toPosix(resolve(p)) })) : listProjects();
  if (!projects.length) {
    say('No registered projects. Install into one first, or pass --from <project>.');
    return { harvested: 0 };
  }
  let harvested = 0;
  mkdirSync(INBOX_DIR, { recursive: true });
  for (const p of projects) {
    const outbox = join(p.path, '.claude', 'learnings', 'outbox');
    if (!isDir(outbox)) continue;
    const files = readdirSync(outbox).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
    if (!files.length) continue;
    const project = basename(p.path);
    for (const f of files) {
      const dest = join(INBOX_DIR, `${today()}--${project}--${f}`);
      if (!dryRun) {
        const text = readText(join(outbox, f)) ?? '';
        writeText(dest, `<!-- harvested ${new Date().toISOString()} from ${p.path} -->\n${text}`);
        mkdirSync(join(outbox, 'harvested'), { recursive: true });
        renameSync(join(outbox, f), join(outbox, 'harvested', f));
      }
      harvested++;
      say(`  ${c.green('+')} ${project}: ${f}`);
    }
  }
  say('', harvested ? `${harvested} proposal(s) now in ${toPosix(relative(process.cwd(), INBOX_DIR)) || 'inbox'}/. Open Claude Code in the kit and run /harvest to triage them.` : 'Nothing to harvest — every outbox is empty.', '');
  return { harvested };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function list() {
  const catalog = loadCatalog();
  const vendored = vendoredSkills();
  const present = new Set(skillDirs());
  say('', c.bold(`agent-setup ${kitVersion()}`), '');
  for (const [group, description] of Object.entries(catalog.groups ?? {})) {
    say(`${c.bold(`@${group}`)}  ${c.dim(description)}`);
    for (const s of groupSkills(catalog, group).filter((n) => present.has(n))) {
      say(`  ${s.padEnd(27)} ${vendored.has(s) ? c.dim('vendored') : c.dim('own     ')} ${skillSummary(catalog, s)}`);
    }
    say('');
  }
  say(c.bold('Agents'));
  for (const a of agentFiles()) say(`  ${a.padEnd(27)} ${catalog.agents?.[a]?.summary ?? ''}`);
  say('', `${c.bold('Profiles')}  ${c.dim(`(default: ${catalog.defaultProfile}; @core is always included)`)}`);
  for (const [name, p] of Object.entries(catalog.profiles ?? {})) {
    say(`  ${name.padEnd(10)} ${p.description}  ${c.dim(p.skills === '*' ? 'everything' : p.skills.join(', ') || 'core only')}`);
  }
  say('');
}

// ---------------------------------------------------------------------------
// new-skill — scaffold a skill that already meets the lint rules
// ---------------------------------------------------------------------------

export function newSkill(name, { group = 'domain', summary } = {}) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '')) throw new CliError('skill names are lowercase-kebab-case, e.g. `data-pipelines`');
  const catalog = loadCatalog();
  if (!catalog.groups?.[group]) throw new CliError(`unknown group "${group}". Groups: ${Object.keys(catalog.groups ?? {}).join(', ')}`);
  const dir = join(KIT_DIR, 'skills', name);
  if (exists(dir)) throw new CliError(`${toPosix(relative(KIT_ROOT, dir))} already exists`);

  writeText(
    join(dir, 'SKILL.md'),
    `---
name: ${name}
description: >
  TODO — what this skill does AND the situations that should trigger it, in the words a user
  would type. Name the file types, errors and phrasings. End with the near-misses it should
  NOT handle and which skill handles them instead. Use when … — this field is the only thing
  that decides whether the skill loads.
---

# ${name}

TODO: one paragraph — the job, and the boundary (what this skill will not do).

## Before you start

- Read \`.claude/overlays/${name}.md\` if it exists — this project's adaptation of the skill. It
  wins where the two disagree.

## The procedure

1. TODO — steps in the correct order. Name the real commands.

## The mistakes that matter

- **TODO — the mistake an agent actually makes here.** Why it is wrong, how to detect it, and
  what to do instead. This section is the reason the skill exists; if it is empty, the skill
  is restating the obvious and should be deleted.

## Done means

- TODO — checkable evidence, not "it looks right".
`,
  );
  writeJson(join(dir, 'evals', 'evals.json'), {
    skill_name: name,
    evals: [
      {
        id: 1,
        prompt: 'TODO: a realistic request that needs this skill',
        expected_output: 'TODO: what a good result contains',
        files: [],
        expectations: ['TODO: an objectively checkable statement about a good result'],
      },
    ],
  });
  writeJson(join(dir, 'evals', 'trigger.json'), [
    { query: 'TODO: a realistic request that SHOULD load this skill', should_trigger: true },
    { query: 'TODO: a near-miss that shares keywords but needs a different skill', should_trigger: false },
  ]);

  catalog.skills[name] = { group, summary: summary ?? 'TODO: one line for the AGENTS.md skills table' };
  writeJson(join(KIT_DIR, 'catalog.json'), catalog);
  say(`${c.green('created')} ${toPosix(relative(KIT_ROOT, dir))}/  (SKILL.md, evals/evals.json, evals/trigger.json) and its catalog entry (@${group})`);
  say('Fill in the TODOs, add it to the right profiles in kit/catalog.json, then run `agent-setup lint`. Guide: docs/AUTHORING.md');
}
