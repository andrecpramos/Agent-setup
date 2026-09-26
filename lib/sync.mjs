// install and update are one operation: make the project match the kit's desired
// state for its selection, without ever destroying something the project owns.
//
// Ownership model (docs/ARCHITECTURE.md):
//   kit-owned      skills, agents, hooks, licences, the learnings/overlays READMEs.
//                  Tracked by hash in .claude/agent-setup.json; replaced on update only
//                  while unmodified. A locally modified file is never overwritten — the
//                  new version is written beside it as <file>.kit-new.
//   project-owned  AGENTS.md, CLAUDE.md, GEMINI.md, .gitignore, sdlc.config.json,
//                  inbox.md, overlays, docs. Created once from templates if absent;
//                  after that the kit only rewrites its own managed block inside them.
//   per clone      .agents/ links and git hooks — not in git at all; recorded in the
//                  manifest and created by .claude/hooks/setup-clone.mjs.
//
// One copy of everything: skills and licences live in .claude/ only; other agents read
// them through links in .agents/ (skills/<name>, licenses), never through a second copy.

import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { KIT_DIR, kitSource, kitVersion } from './paths.mjs';
import {
  CliError,
  c,
  copyFile,
  exists,
  hashFile,
  hashText,
  isDir,
  isSymlink,
  listFiles,
  pruneEmptyDirs,
  readJsonFile,
  readText,
  say,
  writeText,
} from './util.mjs';
import { detectProject, suggestProfile } from './detect.mjs';
import { loadCatalog, resolveSelection } from './catalog.mjs';
import { mergeSettings, unmergeSettings, signature } from './settings.mjs';
import { MD, HASH, removeBlock, upsertBlock } from './blocks.mjs';
import { buildVars, provisionalConfig, render, template } from './render.mjs';
import { readManifest, registerProject, writeManifest } from './state.mjs';
import { derivedHashes, licenseFiles } from './vendor.mjs';

const HOOK_DIR_REL = '.claude/hooks';
const TARGETS = ['claude', 'agents', 'gemini'];
// Skill supporting files that stay in the kit: evals are for improving a skill, not
// for running it, and workspaces are scratch.
const SKILL_EXCLUDE = (rel) => rel.startsWith('evals/') || rel.includes('-workspace/');

function desiredFiles(selection, skipped, { hooks, gitHooks }) {
  const out = new Map();
  const licenses = licenseFiles();
  for (const s of selection.skills) {
    if (skipped.has(s.name)) continue;
    for (const f of listFiles(s.dir)) {
      if (SKILL_EXCLUDE(f)) continue;
      out.set(`.claude/skills/${s.name}/${f}`, { src: join(s.dir, f), kind: 'skill', unit: s.name });
    }
    // Third-party content travels with its licence; one file per source, shared by its skills.
    const lic = licenses.get(s.name);
    if (lic) out.set(`.claude/${lic}`, { src: join(KIT_DIR, lic), kind: 'license' });
  }
  for (const a of selection.agents) {
    if (!skipped.has(a.name)) out.set(`.claude/agents/${a.name}.md`, { src: a.file, kind: 'agent', unit: a.name });
  }
  for (const f of listFiles(join(KIT_DIR, 'hooks'))) {
    if (!f.endsWith('.mjs')) continue;
    // setup-clone is always installed: it is the per-clone entry point for links and
    // git hooks. The git guard needs _config; the Claude Code hooks need all of them.
    const needed = hooks || f === 'setup-clone.mjs' || (gitHooks && (f === '_config.mjs' || f === 'git-guard.mjs'));
    if (needed) out.set(`${HOOK_DIR_REL}/${f}`, { src: join(KIT_DIR, 'hooks', f), kind: 'hook', unit: f });
  }
  out.set('.claude/learnings/README.md', { src: join(KIT_DIR, 'templates', 'learnings-README.md'), kind: 'support' });
  out.set('.claude/overlays/README.md', { src: join(KIT_DIR, 'templates', 'overlays-README.md'), kind: 'support' });
  return out;
}

class Plan {
  constructor(target, dryRun) {
    this.target = target;
    this.dryRun = dryRun;
    this.log = { added: [], updated: [], restored: [], adopted: [], upgraded: [], removed: [], conflicts: [], kept: [], notes: [] };
  }
  abs(rel) {
    return join(this.target, rel);
  }
  copy(rel, src) {
    if (!this.dryRun) copyFile(src, this.abs(rel));
  }
  write(rel, text) {
    if (!this.dryRun) writeText(this.abs(rel), text);
  }
  remove(rel) {
    if (this.dryRun) return;
    rmSync(this.abs(rel), { force: true });
    pruneEmptyDirs(dirname(this.abs(rel)), this.target);
  }
}

export function sync(targetArg, opts) {
  const target = resolve(targetArg ?? '.');
  if (!isDir(target)) throw new CliError(`target is not a directory: ${target}`);
  if (resolve(target).toLowerCase() === resolve(join(KIT_DIR, '..')).toLowerCase()) {
    throw new CliError('refusing to install the kit into itself.');
  }

  const prev = readManifest(target);
  if (opts.mode === 'install' && prev && !opts.force) {
    throw new CliError(`already installed here (v${prev.kit?.version}). Use: agent-setup update "${target}"`);
  }
  if (opts.mode === 'update' && !prev) throw new CliError(`agent-setup is not installed in ${target}. Use: agent-setup install "${target}"`);

  const catalog = loadCatalog();
  const was = prev?.selection ?? {};
  const selOpts = {
    profile: opts.profile ?? was.profile ?? catalog.defaultProfile ?? 'standard',
    // A manifest from before the packs merged into the kit may list the design pack.
    skills: opts.skills?.length ? opts.skills : [...(was.skills ?? []), ...((was.packs ?? []).includes('frontend-kit') ? ['@design'] : [])],
    exclude: opts.exclude?.length ? opts.exclude : (was.exclude ?? []),
    targets: [...(opts.targets?.length ? opts.targets : (was.targets ?? ['claude', 'agents']))],
    hooks: opts.hooks ?? was.hooks ?? true,
    gitHooks: opts.gitHooks ?? was.gitHooks ?? false,
  };
  for (const t of selOpts.targets) if (!TARGETS.includes(t)) throw new CliError(`unknown target "${t}" (use ${TARGETS.join(', ')})`);
  if (!selOpts.targets.includes('claude')) selOpts.targets.unshift('claude'); // .claude/ holds the one real copy

  const detection = detectProject(target);
  const selection = resolveSelection(catalog, selOpts);
  const plan = new Plan(target, Boolean(opts.dryRun));
  const L = plan.log;
  const prevFiles = prev?.files ?? {};
  const nextFiles = {};

  // --- Collisions: a skill or agent of the same name that the project owns ---
  const skipped = { skills: [], agents: [] };
  for (const s of selection.skills) {
    const rel = `.claude/skills/${s.name}/SKILL.md`;
    if (exists(plan.abs(rel)) && !(rel in prevFiles) && hashFile(plan.abs(rel)) !== hashFile(join(s.dir, 'SKILL.md'))) skipped.skills.push(s.name);
  }
  for (const a of selection.agents) {
    const rel = `.claude/agents/${a.name}.md`;
    if (exists(plan.abs(rel)) && !(rel in prevFiles) && hashFile(plan.abs(rel)) !== hashFile(a.file)) skipped.agents.push(a.name);
  }
  const skippedSet = new Set([...skipped.skills, ...skipped.agents]);

  // --- Hooks: a locally modified _config.mjs would break every other hook ---
  const pristineUpstream = derivedHashes('sdlc-kit', 'runtime/hooks/');
  const desired = desiredFiles(selection, skippedSet, selOpts);
  let hooksBlocked = false;
  if (selOpts.hooks || selOpts.gitHooks) {
    const rel = `${HOOK_DIR_REL}/_config.mjs`;
    const cur = hashFile(plan.abs(rel));
    const want = hashFile(join(KIT_DIR, 'hooks', '_config.mjs'));
    const recorded = prevFiles[rel];
    const ours = cur === null || cur === want || cur === recorded || (recorded === undefined && pristineUpstream.has(cur));
    if (!ours) {
      hooksBlocked = true;
      L.notes.push(`${rel} has local changes, so no hook was installed or updated (they all import it). Merge the .kit-new files, then run update again.`);
    }
  }

  // --- Kit-owned files ---
  for (const [rel, item] of desired) {
    const dest = plan.abs(rel);
    const cur = hashFile(dest);
    const want = hashFile(item.src);
    const recorded = prevFiles[rel];

    if (item.kind === 'hook' && hooksBlocked && item.unit !== 'setup-clone.mjs') {
      if (cur !== want) {
        plan.copy(`${rel}.kit-new`, item.src);
        L.conflicts.push(rel);
      }
      if (recorded !== undefined) nextFiles[rel] = recorded;
      continue;
    }

    if (recorded !== undefined) {
      if (cur === null) {
        plan.copy(rel, item.src);
        L.restored.push(rel);
        nextFiles[rel] = want;
      } else if (cur === recorded) {
        if (want !== cur) {
          plan.copy(rel, item.src);
          L.updated.push(rel);
        }
        nextFiles[rel] = want;
      } else if (cur === want) {
        L.adopted.push(rel);
        nextFiles[rel] = want;
      } else {
        plan.copy(`${rel}.kit-new`, item.src);
        L.conflicts.push(rel);
        nextFiles[rel] = recorded;
      }
      continue;
    }

    if (cur === null) {
      plan.copy(rel, item.src);
      L.added.push(rel);
      nextFiles[rel] = want;
    } else if (cur === want) {
      L.adopted.push(rel);
      nextFiles[rel] = want;
    } else if (item.kind === 'hook' && pristineUpstream.has(cur)) {
      plan.copy(rel, item.src);
      L.upgraded.push(rel);
      nextFiles[rel] = want;
    } else {
      plan.copy(`${rel}.kit-new`, item.src);
      L.conflicts.push(rel);
    }
  }

  // --- Files the kit no longer wants (including an old .agents/skills copy) ---
  for (const [rel, recorded] of Object.entries(prevFiles)) {
    if (desired.has(rel) || nextFiles[rel] !== undefined) continue;
    const cur = hashFile(plan.abs(rel));
    if (cur === null) continue;
    if (cur === recorded) {
      plan.remove(rel);
      L.removed.push(rel);
    } else L.kept.push(rel);
  }

  // Large selections (the design group's brand library) — say so before it lands in a repo.
  let bytes = 0;
  for (const [rel, item] of desired) {
    if (!rel.startsWith('.claude/skills/')) continue;
    try {
      bytes += statSync(item.src).size;
    } catch {
      // ignore
    }
  }
  if (bytes > 1_000_000) {
    L.notes.push(
      `the selected skills add ${(bytes / 1_048_576).toFixed(1)} MB to this repository (mostly the design group's brand library) — ` +
        'to use them without committing them, install them per user instead: the Claude Code plugin, or `agent-setup export <dir>` then `npx skills add <dir> -g` for any agent (see README)',
    );
  }

  // --- Links for other agents (one copy of every skill; recorded, created per clone) ---
  // The licences folder is linked too: vendored skills name their licence as
  // ../../licenses/<source>.txt, which must resolve from .agents/skills/<name> as well.
  const links = {};
  if (selOpts.targets.includes('agents')) {
    for (const s of selection.skills) if (!skippedSet.has(s.name)) links[`.agents/skills/${s.name}`] = `.claude/skills/${s.name}`;
    if ([...desired.values()].some((d) => d.kind === 'license')) links['.agents/licenses'] = '.claude/licenses';
  }

  // --- settings.json ---
  const settingsRel = '.claude/settings.json';
  const sj = readJsonFile(plan.abs(settingsRel));
  if (sj.error) throw new CliError(`${settingsRel} is not valid JSON (${sj.error}). Fix it first — refusing to rewrite it.`);
  const fragment = readJsonFile(join(KIT_DIR, 'settings.fragment.json')).value;
  delete fragment.$comment;
  if (!selOpts.hooks || hooksBlocked) fragment.hooks = {};
  const current = sj.value ?? {};
  const prevAdded = prev?.settings?.added ?? { hooks: [], permissions: {} };
  // A handler we added that is no longer in settings was removed on purpose: respect it.
  // Keyed per event: the same script (learning-signals) serves several events, and
  // removing it from one must not be masked by its presence in another.
  const eventKey = (event, sig) => `${event}|${sig}`;
  const presentSigs = new Set(
    Object.entries(current.hooks ?? {}).flatMap(([event, groups]) =>
      (Array.isArray(groups) ? groups : []).flatMap((g) => (g?.hooks ?? []).map((h) => eventKey(event, signature(h)))),
    ),
  );
  const removedByUser = new Set(opts.resetHooks ? [] : (prev?.settings?.removedByUser ?? []));
  if (!opts.resetHooks) {
    for (const h of prevAdded.hooks ?? []) if (!presentSigs.has(eventKey(h.event, h.signature))) removedByUser.add(eventKey(h.event, h.signature));
  }
  const base = unmergeSettings(current, prevAdded);
  for (const [event, groups] of Object.entries(fragment.hooks ?? {})) {
    for (const g of groups) g.hooks = (g.hooks ?? []).filter((h) => !removedByUser.has(eventKey(event, signature(h))));
  }
  const merged = mergeSettings(base, fragment);
  L.notes.push(...merged.notes);
  const settingsText = `${JSON.stringify(merged.settings, null, 2)}\n`;
  if (settingsText !== (readText(plan.abs(settingsRel)) ?? '')) {
    plan.write(settingsRel, settingsText);
    L.notes.push(`${settingsRel}: ${merged.added.hooks.length} hook handler(s) and ${Object.values(merged.added.permissions).flat().length} permission rule(s) managed by the kit`);
  }

  // --- Project-owned documents: create once, then only the managed block ---
  const agentSummaries = Object.fromEntries(Object.entries(catalog.agents ?? {}).map(([k, v]) => [k, v.summary]));
  const vars = buildVars({
    detection,
    selection: {
      ...selection,
      skills: selection.skills.filter((s) => !skippedSet.has(s.name)),
      agents: selection.agents.filter((a) => !skippedSet.has(a.name)),
    },
    catalog,
    agentSummaries,
    targets: selOpts.targets,
    gitHooks: selOpts.gitHooks && !hooksBlocked,
    hooks: selOpts.hooks && !hooksBlocked,
  });
  const created = { ...(prev?.created ?? {}) };
  const blocks = new Set(prev?.blocks ?? []);

  const agentsBlock = render(template('agents-block.md'), vars);
  const agentsText = readText(plan.abs('AGENTS.md'));
  if (agentsText === null) {
    const full = render(template('AGENTS.md'), { ...vars, KIT_BLOCK: agentsBlock.trimEnd() });
    plan.write('AGENTS.md', full);
    created['AGENTS.md'] = hashText(full);
    L.added.push('AGENTS.md');
  } else {
    const next = upsertBlock(agentsText, agentsBlock, MD);
    if (next !== agentsText) {
      plan.write('AGENTS.md', next);
      L.updated.push('AGENTS.md (managed block)');
    }
  }
  blocks.add('AGENTS.md');

  const claudeRel = exists(plan.abs('CLAUDE.md')) || !exists(plan.abs('.claude/CLAUDE.md')) ? 'CLAUDE.md' : '.claude/CLAUDE.md';
  if (isSymlink(plan.abs(claudeRel))) {
    L.notes.push(`${claudeRel} is a symlink — left untouched (it already resolves to shared instructions).`);
  } else {
    const claudeText = readText(plan.abs(claudeRel));
    const outside = claudeText ? removeBlock(claudeText, MD) : '';
    if (agentsText === null && outside.trim()) {
      L.notes.push(
        `${claudeRel} already holds project instructions that only Claude Code reads — /sdlc-init moves the tool-agnostic parts into AGENTS.md so every agent sees them`,
      );
    }
    const importLine = claudeRel === 'CLAUDE.md' ? '@AGENTS.md' : '@../AGENTS.md';
    const alreadyImports = /^\s*@(\.\.\/)?AGENTS\.md\s*$/m.test(outside);
    const block = render(template('claude-block.md'), { ...vars, AGENTS_IMPORT: alreadyImports ? '' : importLine }).replace(/\n{3,}/g, '\n\n');
    if (claudeText === null) {
      const text = `${block.trimEnd()}\n`;
      plan.write(claudeRel, text);
      created[claudeRel] = hashText(text);
      L.added.push(claudeRel);
    } else {
      const next = upsertBlock(claudeText, block, MD);
      if (next !== claudeText) {
        plan.write(claudeRel, next);
        L.updated.push(`${claudeRel} (managed block)`);
      }
    }
    blocks.add(claudeRel);
  }

  if (selOpts.targets.includes('gemini')) {
    const geminiBlock = render(template('gemini-block.md'), vars);
    const geminiText = readText(plan.abs('GEMINI.md'));
    if (geminiText === null) {
      const text = `${geminiBlock.trimEnd()}\n`;
      plan.write('GEMINI.md', text);
      created['GEMINI.md'] = hashText(text);
      L.added.push('GEMINI.md');
    } else if (!/^\s*@(\.\/)?AGENTS\.md\s*$/m.test(removeBlock(geminiText, MD)) || geminiText.includes(MD.begin)) {
      const next = upsertBlock(geminiText, geminiBlock, MD);
      if (next !== geminiText) {
        plan.write('GEMINI.md', next);
        L.updated.push('GEMINI.md (managed block)');
      }
    }
    blocks.add('GEMINI.md');
  }

  if (detection.isGit) {
    const linkLines = Object.keys(links).length
      ? ['# Links into .claude/ for other agents — per clone (node .claude/hooks/setup-clone.mjs), never committed', ...Object.keys(links)].join('\n')
      : '';
    const gitignoreBlock = render(template('gitignore-block.txt'), { AGENT_LINKS: linkLines }).replace(/\n{2,}(# agent-setup:end)/, '\n$1');
    const gi = readText(plan.abs('.gitignore')) ?? '';
    const next = upsertBlock(gi, gitignoreBlock, HASH);
    if (next !== gi) {
      plan.write('.gitignore', next);
      L.updated.push('.gitignore (managed block)');
    }
    blocks.add('.gitignore');
  }

  if (!exists(plan.abs('.claude/learnings/inbox.md'))) {
    plan.write('.claude/learnings/inbox.md', template('learnings-inbox.md'));
    L.added.push('.claude/learnings/inbox.md');
  }

  const hasSdlcConfig = exists(plan.abs('.claude/sdlc.config.json')) || exists(plan.abs('.ai/sdlc.config.json'));
  if (!hasSdlcConfig && detection.isGit && selOpts.hooks && opts.sdlcConfig !== false) {
    plan.write('.claude/sdlc.config.json', `${JSON.stringify(provisionalConfig(detection), null, 2)}\n`);
    L.added.push('.claude/sdlc.config.json (provisional)');
  }
  if (selOpts.gitHooks && !detection.isGit) L.notes.push('git hooks: skipped — not a git repository');

  // --- Manifest, registry, and the per-clone setup (links, git hooks) ---
  const now = new Date().toISOString();
  const manifest = {
    $comment:
      'Written by agent-setup. Lists the kit-owned files (by content hash) so `agent-setup update` and `uninstall` never touch anything this project changed or owns; `links` and `selection.gitHooks` drive .claude/hooks/setup-clone.mjs. Do not edit by hand.',
    kit: { name: 'agent-setup', version: kitVersion(), source: kitSource() },
    installedAt: prev?.installedAt ?? now,
    updatedAt: now,
    selection: selOpts,
    files: nextFiles,
    links,
    skipped,
    created,
    blocks: [...blocks],
    settings: { added: merged.added, removedByUser: [...removedByUser] },
  };
  if (!plan.dryRun) {
    writeManifest(target, manifest);
    registerProject(target, { version: kitVersion(), updatedAt: now });
    const r = spawnSync(process.execPath, [join(target, HOOK_DIR_REL, 'setup-clone.mjs')], { cwd: target, encoding: 'utf8' });
    for (const line of `${r.stdout ?? ''}${r.stderr ?? ''}`.split(/\r?\n/).filter(Boolean)) L.notes.push(line.replace(/^agent-setup: /, ''));
  } else if (Object.keys(links).length || selOpts.gitHooks) {
    L.notes.push(`per clone: would create ${Object.keys(links).length} link(s) in .agents/${selOpts.gitHooks ? ' and install the git hooks' : ''}`);
  }

  report({ target, opts, prev, detection, selection, skipped, plan, selOpts, catalog });
  return { manifest, log: L };
}

function report({ target, opts, prev, detection, selection, skipped, plan, selOpts, catalog }) {
  const L = plan.log;
  const verb = opts.mode === 'install' ? 'install' : `update ${prev?.kit?.version ?? '?'} →`;
  say('', `${c.bold(`agent-setup ${verb} ${kitVersion()}`)}  ${c.dim(target)}${plan.dryRun ? c.yellow('  (dry run — nothing written)') : ''}`, '');

  const git = detection.isGit ? `git (${[detection.production, detection.integration].filter(Boolean).join(' / ')})` : 'not a git repo';
  say(`  ${c.dim('Detected')}   ${detection.stack.join(', ') || 'no manifests'} · ${git}${detection.ci.length ? ` · CI: ${detection.ci.join(', ')}` : ' · no CI found'}`);
  const suggestion = suggestProfile(detection);
  say(
    `  ${c.dim('Selection')}  profile ${c.bold(selOpts.profile)}${suggestion !== selOpts.profile ? c.dim(` (detected fit: ${suggestion})`) : ''} · targets: ${selOpts.targets.join(', ')} · hooks: ${selOpts.hooks ? 'on' : 'off'}${selOpts.gitHooks ? ' · git hooks: on' : ''}`,
    '',
  );

  const installed = new Set(selection.skills.filter((s) => !skipped.skills.includes(s.name)).map((s) => s.name));
  for (const [group] of Object.entries(catalog.groups ?? {})) {
    const names = Object.keys(catalog.skills ?? {}).filter((n) => installed.has(n) && catalog.skills[n].group === group);
    if (names.length) say(`  ${c.green(group.padEnd(10))} ${group === 'design' && names.length > 4 ? `${names.length} skills, entry point frontend-design-workflow` : names.join(', ')}`);
  }
  const installedAgents = selection.agents.map((a) => a.name).filter((n) => !skipped.agents.includes(n));
  say(`  ${c.green('agents'.padEnd(10))} ${installedAgents.join(', ') || '—'}`);
  if (selOpts.hooks) say(`  ${c.green('hooks'.padEnd(10))} branch-check, guard-git, check-gates, learning-signals`);

  const line = (label, list, color = c.dim) => {
    if (list.length) say(`  ${color(label.padEnd(10))} ${list.length > 8 ? `${list.slice(0, 8).join(', ')} … (+${list.length - 8})` : list.join(', ')}`);
  };
  line('added', L.added.filter((r) => !r.startsWith('.claude/skills/')));
  line('updated', L.updated);
  line('restored', L.restored, c.yellow);
  line('upgraded', L.upgraded, c.cyan);
  line('removed', L.removed);
  for (const s of skipped.skills) say(`  ${c.yellow('skipped'.padEnd(10))} skill ${s} — the project already has its own .claude/skills/${s}; yours was kept`);
  for (const a of skipped.agents) say(`  ${c.yellow('skipped'.padEnd(10))} agent ${a} — the project already has .claude/agents/${a}.md; yours was kept`);
  for (const r of L.conflicts) say(`  ${c.red('conflict'.padEnd(10))} ${r} has local changes — kept; the kit's version is beside it as ${r.split('/').pop()}.kit-new`);
  for (const r of L.kept) say(`  ${c.yellow('kept'.padEnd(10))} ${r} — no longer part of the kit, but modified locally, so left in place`);
  for (const n of L.notes) say(`  ${c.dim('note'.padEnd(10))} ${n}`);

  say('');
  if (opts.mode === 'install') {
    say(c.bold('Next'));
    say('  1. Restart Claude Code in the project (or open /hooks once) so the hooks load.');
    say('  2. Run /sdlc-init — it verifies the provisional config against CI, fills in AGENTS.md,');
    say('     writes the knowledge base and the first skill overlays, and ranks enforcement gaps.');
    say('  3. Teammates run `node .claude/hooks/setup-clone.mjs` once in their clone (.agents/ links, git hooks).');
    if (skipped.skills.length) say('  4. For skipped skills: move the repo-specific parts of your own skill into .claude/overlays/<skill>.md, delete it, and run update to get the kit version.');
  } else if (L.conflicts.length) {
    say(c.bold('Next'), '  Merge each .kit-new file into its original (or delete the original to take the kit version), delete the .kit-new, and run update again.');
  }
  say('');
}
