// The kit's catalog: every skill (with its group), every agent, and the install
// profiles. One kit, one skills folder — there are no packs.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_DIR } from './paths.mjs';
import { CliError, readJsonFile, readText } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

export const SKILLS_DIR = join(KIT_DIR, 'skills');
export const AGENTS_DIR = join(KIT_DIR, 'agents');

export function loadCatalog() {
  const r = readJsonFile(join(KIT_DIR, 'catalog.json'));
  if (!r.value) throw new CliError(`kit/catalog.json is unreadable: ${r.error ?? 'missing'}`);
  return r.value;
}

/** Skill folders that contain a SKILL.md, sorted. */
export function skillDirs() {
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function agentFiles() {
  try {
    return readdirSync(AGENTS_DIR)
      .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/** One line describing a skill, for tables. */
export function skillSummary(catalog, name) {
  if (catalog.skills?.[name]?.summary) return catalog.skills[name].summary;
  const fm = parseFrontmatter(readText(join(SKILLS_DIR, name, 'SKILL.md')) ?? '').data;
  const desc = String(fm?.description ?? '').replace(/\s+/g, ' ').trim();
  const first = desc.split(/(?<=\.)\s/)[0] ?? desc;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

/** Skills of one group, in catalog order. */
export const groupSkills = (catalog, group) => Object.entries(catalog.skills ?? {}).filter(([, m]) => m.group === group).map(([n]) => n);

/**
 * Expand a list of skill names and @group references. A `pack:skill` prefix left
 * over from before the packs were merged is accepted and stripped.
 */
function expand(catalog, list, available) {
  const out = [];
  for (const raw of list) {
    const item = raw.includes(':') ? raw.split(':').pop() : raw;
    if (item.startsWith('@')) {
      const g = item.slice(1);
      if (!catalog.groups?.[g]) {
        throw new CliError(`unknown group "@${g}". Groups: ${Object.keys(catalog.groups ?? {}).map((x) => `@${x}`).join(', ')}`);
      }
      out.push(...groupSkills(catalog, g).filter((n) => available.has(n)));
    } else {
      if (!available.has(item)) throw new CliError(`unknown skill "${item}". Run \`agent-setup list\` for the skills and groups.`);
      out.push(item);
    }
  }
  return out;
}

/** Turn a profile plus include/exclude lists into concrete skills and agents. */
export function resolveSelection(catalog, { profile, skills = [], exclude = [] } = {}) {
  const profileName = profile ?? catalog.defaultProfile ?? 'standard';
  const prof = catalog.profiles?.[profileName];
  if (!prof) throw new CliError(`unknown profile "${profileName}". Available: ${Object.keys(catalog.profiles ?? {}).join(', ')}`);

  const available = new Set(skillDirs());
  const excluded = new Set(expand(catalog, exclude.filter((x) => !agentFiles().includes(x.split(':').pop())), available));
  const excludedAgents = new Set(exclude.map((x) => x.split(':').pop()).filter((x) => agentFiles().includes(x)));

  const base = prof.skills === '*' ? [...available] : expand(catalog, prof.skills ?? [], available);
  const core = (catalog.core ?? []).filter((n) => available.has(n));
  const chosen = new Set([...base, ...core, ...expand(catalog, skills, available)].filter((n) => !excluded.has(n)));

  const agents = agentFiles().filter((a) => !excludedAgents.has(a) && (catalog.agents?.[a]?.requires ?? []).every((r) => chosen.has(r)));
  return {
    profile: profileName,
    skills: [...chosen].sort().map((name) => ({ name, dir: join(SKILLS_DIR, name), group: catalog.skills?.[name]?.group ?? 'other' })),
    agents: agents.map((name) => ({ name, file: join(AGENTS_DIR, `${name}.md`) })),
  };
}
