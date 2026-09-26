// `agent-setup lint` — the kit's own gate.
//
//   skills     Own skills (written here) meet docs/AUTHORING.md: every mechanical rule is an
//              error. Vendored skills (listed in kit/vendor.json) are rebuilt from upstream
//              and never hand-edited, so they are held to the Agent Skills spec only — a
//              style finding in one could not be fixed without forking it.
//   kit        catalog, agents, hooks, settings fragment, templates, routing suites,
//              vendoring record and licences, plugin manifests.
//   repository one place per theme: the tree must match the Layout tables in AGENTS.md;
//              no two files with the same content; no corrupted text (control characters
//              left by shell quoting, U+FFFD, BOMs); no stray or empty files and folders.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { KIT_DIR, KIT_ROOT, TEMPLATES, kitVersion } from './paths.mjs';
import { c, isDir, listFiles, readJsonFile, readText, say, toPosix } from './util.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { SKILLS_DIR, loadCatalog, skillDirs, agentFiles } from './catalog.mjs';
import { readVendor, specProblems } from './vendor.mjs';

const SKILL_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
  'metadata', 'license', 'compatibility',
]);
const PORTABLE_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const AGENT_KEYS = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills', 'mcpServers', 'hooks',
  'memory', 'background', 'omitClaudeMd', 'effort', 'isolation', 'color', 'initialPrompt', 'experimental',
]);
// Names Claude Code already uses for built-in commands or bundled skills; a
// custom skill with one of these names shadows the built-in.
const BUILTIN = new Set([
  'init', 'review', 'security-review', 'code-review', 'simplify', 'loop', 'schedule', 'run', 'help', 'clear', 'compact',
  'config', 'memory', 'hooks', 'agents', 'mcp', 'plugin', 'model', 'status', 'cost', 'doctor', 'login', 'logout',
  'permissions', 'resume', 'export', 'context', 'add-dir', 'bug', 'ide', 'upgrade', 'vim', 'verify', 'update-config',
  'keybindings-help', 'fewer-permission-prompts', 'claude-api', 'import',
]);
const MODELS = /^(sonnet|opus|haiku|fable|inherit|claude-[a-z0-9-]+)$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Machine-local or generated, never part of the layout (all git-ignored).
const LOCAL = new Set(['.git', 'node_modules', '.state', 'CLAUDE.local.md', 'settings.local.json']);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip']);
const STRAY = /(\.kit-new|\.bak|\.orig|\.rej|\.tmp|\.swp|~)$|^(\.DS_Store|Thumbs\.db|desktop\.ini|nul)$/i;
// Invisible characters: a BOM after the start of any text file, and in code also zero-width
// spaces and joiners (prose may use a joiner inside an emoji). A literal one works until an
// editor or a copy drops it, so code spells them as escapes. Built from char codes so this
// file itself contains none.
const CODE = new Set(['.mjs', '.cjs', '.js', '.ts', '.json']);
const INVISIBLE = new RegExp(`[${[0xfeff, 0x200b, 0x200c, 0x200d, 0x2060].map((n) => String.fromCharCode(n)).join('')}]`);
const MID_BOM = new RegExp(String.fromCharCode(0xfeff));

export function lint({ paths = [] } = {}) {
  const findings = [];
  const add = (level, file, msg) => findings.push({ level, file: toPosix(relative(KIT_ROOT, file)) || '.', msg });
  const catalog = loadCatalog();
  const scopes = paths.length ? paths.map((p) => resolve(p).toLowerCase()) : null;
  const inScope = (p) => !scopes || scopes.some((s) => resolve(p).toLowerCase().startsWith(s));
  const covers = (p) => !scopes || scopes.some((s) => resolve(p).toLowerCase().startsWith(s) || resolve(KIT_ROOT).toLowerCase().startsWith(s));

  let vendor = { manifest: {}, lock: {} };
  try {
    vendor = readVendor();
  } catch (err) {
    add('error', join(KIT_DIR, 'vendor.json'), err.message);
  }
  const vendored = new Set((vendor.manifest.skills ?? []).map((s) => s.name));

  const skills = skillDirs();
  for (const e of readdirSafe(SKILLS_DIR)) {
    const dir = join(SKILLS_DIR, e);
    if (!isDir(dir) || !inScope(dir)) continue;
    if (!existsSync(join(dir, 'SKILL.md'))) {
      add('error', dir, 'skill folder has no SKILL.md');
      continue;
    }
    if (vendored.has(e)) lintVendoredSkill({ dir, name: e, add, catalog });
    else lintSkill({ dir, name: e, add, catalog });
    lintRouting({ dir, name: e, add, catalog, skills });
  }
  for (const a of agentFiles()) {
    const file = join(KIT_DIR, 'agents', `${a}.md`);
    if (inScope(file)) lintAgent({ file, name: a, add, skills });
  }

  if (covers(KIT_DIR)) {
    lintCatalog({ catalog, add, skills });
    lintHooks({ add });
    lintVendor({ vendor, add });
    lintPlugins({ add });
  }
  if (!scopes || scopes.some((s) => resolve(KIT_ROOT).toLowerCase().startsWith(s))) lintRepository({ add });

  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of [...byFile].sort()) {
    say(c.bold(file));
    for (const f of list) say(`  ${f.level === 'error' ? c.red('✖ error') : c.yellow('⚠ warn ')}  ${f.msg}`);
  }
  say(
    '',
    `${errors.length ? c.red(`${errors.length} error(s)`) : c.green('0 errors')}, ${warns.length} warning(s) — ${skills.length} skills (${skills.length - vendored.size} own, ${vendored.size} vendored), ${agentFiles().length} agents`,
  );
  return { errors: errors.length, warnings: warns.length, findings };
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- skills

/** Relative links in a skill's own markdown. Templates under assets/ describe a project layout that does not exist here. */
function brokenLinks(dir) {
  const out = [];
  for (const f of listFiles(dir)) {
    if (!f.endsWith('.md') || f.startsWith('assets/') || f.startsWith('evals/')) continue;
    const abs = join(dir, f);
    for (const link of relativeLinks(readText(abs) ?? '')) {
      if (!existsSync(resolve(dirname(abs), decodeURIComponent(link)))) out.push({ abs, link });
    }
  }
  return out;
}

function relativeLinks(markdown) {
  const md = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = m[1].split('#')[0];
    if (!link || /^(https?:|mailto:|#|\/|~|\$|\{|<|\.claude\/|\.agents\/)/.test(link)) continue;
    out.push(link);
  }
  return out;
}

function syntaxErrors(dir, add, level) {
  for (const f of listFiles(dir).filter((x) => /\.(mjs|cjs|js)$/.test(x))) {
    try {
      execFileSync(process.execPath, ['--check', join(dir, f)], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      add(level, join(dir, f), `syntax error: ${String(err.stderr ?? err.message).split('\n').slice(0, 4).join(' ')}`);
    }
  }
}

function lintVendoredSkill({ dir, name, add, catalog }) {
  const skillPath = join(dir, 'SKILL.md');
  const text = readText(skillPath) ?? '';
  let problems;
  try {
    problems = specProblems(text, name);
  } catch (err) {
    problems = [err.message];
  }
  for (const p of problems) add('error', skillPath, `${p} — fix the override in kit/vendor.json and run \`agent-setup vendor sync --locked\``);
  const lic = String(parseFrontmatter(text).data?.license ?? '').match(/\(see ([^)]+)\)/)?.[1];
  if (lic && !existsSync(resolve(dir, lic))) add('error', skillPath, `license points at ${lic}, which does not exist — run \`agent-setup vendor sync --locked\``);
  for (const { abs, link } of brokenLinks(dir)) add('warn', abs, `broken link upstream: ${link} — report it upstream or exclude the skill in kit/vendor.json`);
  syntaxErrors(dir, add, 'error');
  if (!catalog.skills?.[name]) add('error', skillPath, 'vendored skill is missing from kit/catalog.json');
}

function lintSkill({ dir, name, add, catalog }) {
  const skillPath = join(dir, 'SKILL.md');
  const text = readText(skillPath) ?? '';
  const fm = parseFrontmatter(text);
  if (!fm.data) {
    add('error', skillPath, fm.error);
    return;
  }
  if (fm.error) add('error', skillPath, `frontmatter: ${fm.error}`);
  const d = fm.data;

  if (!d.name) add('error', skillPath, 'frontmatter has no `name`');
  else {
    if (d.name !== name) add('error', skillPath, `name "${d.name}" differs from its folder "${name}" — the folder name is what installs`);
    if (!KEBAB.test(d.name) || d.name.length > 64) add('error', skillPath, `name "${d.name}" must be lowercase-kebab-case, ≤64 chars`);
    if (['synced', 'anthropic-skills'].includes(d.name) || String(d.name).startsWith('anthropic-skills')) add('error', skillPath, `"${d.name}" is reserved by Claude Code`);
    if (BUILTIN.has(d.name)) add('error', skillPath, `"${d.name}" shadows a built-in Claude Code command or bundled skill`);
  }

  const desc = String(d.description ?? '');
  if (!desc) add('error', skillPath, 'frontmatter has no `description` — it is the only thing that decides whether the skill loads');
  else {
    const withWhen = desc.length + String(d.when_to_use ?? '').length;
    if (desc.length > 1024) add('error', skillPath, `description is ${desc.length} chars; the Agent Skills spec caps it at 1024`);
    if (withWhen > 1536) add('error', skillPath, `description + when_to_use is ${withWhen} chars; Claude Code truncates at 1536`);
    if (desc.length < 80) add('warn', skillPath, 'description is very short — say what it does AND when to use it, in the words a user types');
    if (!/\b(use (it |this( skill)? )?(when|whenever|for|before|after|to)|trigger)/i.test(`${desc} ${d.when_to_use ?? ''}`)) {
      add('error', skillPath, 'description never says when to use the skill ("Use when/whenever …")');
    }
  }

  for (const k of Object.keys(d)) {
    if (!SKILL_KEYS.has(k)) add('warn', skillPath, `unknown frontmatter key "${k}" — Claude Code ignores it; claude.ai rejects it`);
  }
  const nonPortable = Object.keys(d).filter((k) => SKILL_KEYS.has(k) && !PORTABLE_KEYS.has(k));
  if (nonPortable.length && !/^(sdlc-init|enforcement-audit)$/.test(name)) {
    add('warn', skillPath, `Claude-only frontmatter (${nonPortable.join(', ')}) — other agents ignore it, claude.ai upload rejects it`);
  }

  const bodyLines = fm.body.split(/\r?\n/).length;
  if (bodyLines > 500) add('error', skillPath, `SKILL.md body is ${bodyLines} lines; keep it under 500 and move depth into references/`);
  else if (bodyLines > 400) add('warn', skillPath, `SKILL.md body is ${bodyLines} lines — close to the 500-line budget`);

  if (!text.includes(`.claude/overlays/${name}.md`)) {
    add('error', skillPath, `own skills must read their project overlay (.claude/overlays/${name}.md) before starting`);
  }

  for (const { abs, link } of brokenLinks(dir)) add('error', abs, `broken link: ${link}`);
  for (const f of listFiles(dir)) {
    if (f === 'SKILL.md' || !f.endsWith('.md') || f.startsWith('assets/') || f.startsWith('evals/')) continue;
    const t = readText(join(dir, f)) ?? '';
    if (t.split(/\r?\n/).length > 300 && !/^#+ (contents|table of contents)/im.test(t)) {
      add('warn', join(dir, f), `${t.split(/\r?\n/).length} lines without a "Contents" section — long references need a table of contents`);
    }
  }
  syntaxErrors(dir, add, 'error');

  const evalsPath = join(dir, 'evals', 'evals.json');
  const ev = readJsonFile(evalsPath);
  if (ev.missing) {
    if (catalog.skills?.[name]?.group === 'domain') add('warn', skillPath, 'domain skill has no evals/evals.json — nothing guards it against regressions');
  } else if (ev.error) add('error', evalsPath, `invalid JSON: ${ev.error}`);
  else {
    if (ev.value.skill_name !== name) add('error', evalsPath, `skill_name "${ev.value.skill_name}" ≠ "${name}"`);
    if (!Array.isArray(ev.value.evals) || !ev.value.evals.length) add('error', evalsPath, 'needs a non-empty `evals` array');
    else
      ev.value.evals.forEach((e, i) => {
        if (!e.prompt || !e.expected_output) add('error', evalsPath, `evals[${i}] needs prompt and expected_output`);
        if (e.expectations !== undefined && (!Array.isArray(e.expectations) || e.expectations.some((x) => typeof x !== 'string'))) {
          add('error', evalsPath, `evals[${i}].expectations must be a list of strings (skill-creator format)`);
        }
        if (e.assertions !== undefined) add('warn', evalsPath, `evals[${i}] uses "assertions"; skill-creator reads "expectations" (list of strings)`);
        if (/^TODO/.test(e.prompt ?? '')) add('warn', evalsPath, `evals[${i}] is still a TODO`);
      });
  }
  const trigPath = join(dir, 'evals', 'trigger.json');
  const tr = readJsonFile(trigPath);
  if (!tr.missing) {
    if (tr.error) add('error', trigPath, `invalid JSON: ${tr.error}`);
    else if (!Array.isArray(tr.value) || tr.value.some((q) => typeof q.query !== 'string' || typeof q.should_trigger !== 'boolean')) {
      add('error', trigPath, 'must be an array of {query: string, should_trigger: boolean}');
    } else {
      if (tr.value.length < 8) add('warn', trigPath, `only ${tr.value.length} trigger queries — aim for 16–20`);
      if (!tr.value.some((q) => !q.should_trigger)) add('warn', trigPath, 'no should_trigger:false near-misses — those are the queries that test a description');
    }
  }

  if (!catalog.skills?.[name]) add('error', skillPath, 'skill is missing from kit/catalog.json');
}

/** evals/routing.json: which skill a real agent picks first (agent-setup eval-routing). */
function lintRouting({ dir, name, add, catalog, skills }) {
  const file = join(dir, 'evals', 'routing.json');
  const r = readJsonFile(file);
  if (r.missing) return;
  if (r.error || !r.value) {
    add('error', file, `invalid JSON: ${r.error}`);
    return;
  }
  const known = new Set(skills);
  const scope = new Set();
  const rawScope = r.value.scope;
  if (rawScope !== undefined && (!Array.isArray(rawScope) || !rawScope.length)) add('error', file, '`scope` must be a non-empty list of skill names or @groups');
  for (const s of Array.isArray(rawScope) ? rawScope : [...known]) {
    if (typeof s === 'string' && s.startsWith('@')) {
      if (!catalog.groups?.[s.slice(1)]) add('error', file, `scope names unknown group "${s}"`);
      for (const [n, m] of Object.entries(catalog.skills ?? {})) if (m.group === s.slice(1)) scope.add(n);
    } else if (!known.has(s)) add('error', file, `scope names unknown skill "${s}"`);
    else scope.add(s);
  }
  if (!scope.has(name)) add('error', file, `scope does not include the skill the suite belongs to (${name})`);
  const cases = r.value.cases;
  if (!Array.isArray(cases) || !cases.length) {
    add('error', file, 'needs a non-empty `cases` array');
    return;
  }
  const ids = new Set();
  cases.forEach((k, i) => {
    const at = `cases[${i}]${k?.id ? ` (${k.id})` : ''}`;
    if (!k?.id || !KEBAB.test(k.id)) add('error', file, `${at} needs a kebab-case id`);
    else if (ids.has(k.id)) add('error', file, `${at}: duplicate id`);
    ids.add(k?.id);
    if (typeof k?.prompt !== 'string' || !k.prompt.trim()) add('error', file, `${at} needs a prompt`);
    const hasFirst = Array.isArray(k?.first) && k.first.length > 0;
    if (hasFirst === Boolean(k?.none)) add('error', file, `${at} needs exactly one of \`first\` (non-empty list) or \`none: true\``);
    for (const key of ['first', 'forbid']) {
      if (k?.[key] === undefined) continue;
      if (!Array.isArray(k[key])) add('error', file, `${at}.${key} must be a list`);
      else for (const s of k[key]) if (!scope.has(s)) add('error', file, `${at}.${key} names "${s}", which is not in the suite's scope — it would never be judged`);
    }
    if (k?.when !== undefined && (typeof k.when !== 'string' || !k.when)) add('error', file, `${at}.when must be a capability name`);
  });
}

function lintAgent({ file, name, add, skills }) {
  const fm = parseFrontmatter(readText(file) ?? '');
  if (!fm.data) {
    add('error', file, fm.error);
    return;
  }
  const d = fm.data;
  if (!d.name) add('error', file, 'no `name` — Claude Code treats the file as documentation and skips it');
  else {
    if (d.name !== name) add('error', file, `name "${d.name}" differs from the file name`);
    if (String(d.name).includes(':') || String(d.name).startsWith('-')) add('error', file, 'name cannot contain ":" or start with "-"');
  }
  if (!d.description) add('error', file, 'no `description` — it is how Claude decides when to delegate');
  for (const k of Object.keys(d)) if (!AGENT_KEYS.has(k)) add('warn', file, `unknown frontmatter key "${k}"`);
  if (d.model && !MODELS.test(String(d.model))) add('error', file, `model "${d.model}" is not sonnet|opus|haiku|fable|inherit|claude-*`);
  if (d.memory && !['user', 'project', 'local'].includes(d.memory)) add('error', file, 'memory must be user, project or local');
  const preload = Array.isArray(d.skills) ? d.skills : d.skills ? [d.skills] : [];
  const known = new Set(skills);
  for (const s of preload) if (!known.has(s)) add('error', file, `preloads unknown skill "${s}"`);
}

// ---------------------------------------------------------------- kit

function lintCatalog({ catalog, add, skills }) {
  const file = join(KIT_DIR, 'catalog.json');
  const dirs = new Set(skills);
  const groups = catalog.groups ?? {};
  if (!Object.keys(groups).length) add('error', file, '`groups` is empty — every skill belongs to a group');
  const validItem = (item) => (item.startsWith('@') ? Boolean(groups[item.slice(1)]) : dirs.has(item));

  for (const s of skills) if (!catalog.skills?.[s]) add('error', file, `kit/skills/${s} is not in the catalog`);
  for (const [s, meta] of Object.entries(catalog.skills ?? {})) {
    if (!dirs.has(s)) add('error', file, `catalog lists skill "${s}" but kit/skills/${s}/SKILL.md does not exist`);
    if (!meta.summary) add('error', file, `skill "${s}" has no summary`);
    if (!groups[meta.group]) add('error', file, `skill "${s}" is in unknown group "${meta.group}" (groups: ${Object.keys(groups).join(', ')})`);
  }
  for (const s of catalog.core ?? []) {
    if (!dirs.has(s)) add('error', file, `core list names unknown skill "${s}"`);
    else if (catalog.skills?.[s]?.group !== 'core') add('error', file, `core list names "${s}", which is not in group core`);
  }
  for (const [p, def] of Object.entries(catalog.profiles ?? {})) {
    if (!def.description) add('error', file, `profile "${p}" has no description`);
    if (def.skills === '*') continue;
    if (!Array.isArray(def.skills)) add('error', file, `profile "${p}": skills must be "*" or a list`);
    else for (const s of def.skills) if (!validItem(s)) add('error', file, `profile "${p}" names unknown skill or group "${s}"`);
  }
  if (!catalog.profiles?.[catalog.defaultProfile]) add('error', file, `defaultProfile "${catalog.defaultProfile}" is not a profile`);

  const agents = new Set(agentFiles());
  for (const [a, meta] of Object.entries(catalog.agents ?? {})) {
    if (!agents.has(a)) add('error', file, `catalog lists agent "${a}" but kit/agents/${a}.md does not exist`);
    if (!meta.summary) add('error', file, `agent "${a}" has no summary`);
    for (const r of meta.requires ?? []) if (!dirs.has(r)) add('error', file, `agent "${a}" requires unknown skill "${r}"`);
  }
  for (const a of agents) if (!catalog.agents?.[a]) add('error', file, `agent "${a}" is not in the catalog`);
}

function lintHooks({ add }) {
  const hooksDir = join(KIT_DIR, 'hooks');
  for (const f of listFiles(hooksDir).filter((x) => x.endsWith('.mjs'))) {
    try {
      execFileSync(process.execPath, ['--check', join(hooksDir, f)], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      add('error', join(hooksDir, f), `syntax error: ${String(err.stderr ?? err.message).split('\n')[0]}`);
    }
  }
  const fragPath = join(KIT_DIR, 'settings.fragment.json');
  const frag = readJsonFile(fragPath);
  if (frag.error || !frag.value) add('error', fragPath, `invalid JSON: ${frag.error}`);
  else {
    for (const [event, groups] of Object.entries(frag.value.hooks ?? {})) {
      for (const g of groups) {
        for (const h of g.hooks ?? []) {
          const script = (h.args ?? []).join(' ').match(/\.claude\/hooks\/([\w.-]+)/)?.[1];
          if (!script || !existsSync(join(hooksDir, script))) add('error', fragPath, `${event} handler runs a script that is not in kit/hooks: ${JSON.stringify(h.args)}`);
          if (h.command !== 'node' || !Array.isArray(h.args)) add('warn', fragPath, `${event} handler is not exec form (command: "node", args: [...])`);
        }
      }
    }
  }
  for (const t of ['AGENTS.md', 'agents-block.md', 'claude-block.md', 'gemini-block.md', 'learnings-README.md', 'learnings-inbox.md', 'overlays-README.md', 'gitignore-block.txt']) {
    if (!existsSync(join(TEMPLATES, t))) add('error', join(TEMPLATES, t), 'template missing');
  }
}

/** kit/vendor.json, its lock and kit/licenses agree with each other and with kit/skills. */
function lintVendor({ vendor, add }) {
  const file = join(KIT_DIR, 'vendor.json');
  const { manifest, lock } = vendor;
  const repos = manifest.repos ?? {};
  const used = new Set();
  const names = new Set();
  for (const [i, s] of (manifest.skills ?? []).entries()) {
    const at = `skills[${i}] (${s.name ?? '?'})`;
    if (!s.name || !KEBAB.test(s.name)) add('error', file, `${at}: invalid name`);
    if (names.has(s.name)) add('error', file, `${at}: listed twice`);
    names.add(s.name);
    if (!repos[s.repo]) add('error', file, `${at}: unknown repo "${s.repo}"`);
    used.add(s.repo);
    if ((s.description || s.compatibility || s.removeKeys?.length) && !s.why) add('error', file, `${at}: overrides need a \`why\``);
    if (!existsSync(join(SKILLS_DIR, s.name ?? '', 'SKILL.md'))) add('error', file, `${at}: kit/skills/${s.name} is missing — run \`agent-setup vendor sync --locked\``);
    if (!(lock.skills ?? []).some((l) => l.name === s.name)) add('warn', file, `${at}: not in vendor.lock.json yet — run \`agent-setup vendor sync\``);
  }
  for (const [i, x] of (manifest.excluded ?? []).entries()) if (!x.why) add('error', file, `excluded[${i}] needs a \`why\``);
  for (const [i, a] of (manifest.assets ?? []).entries()) {
    if (!repos[a.repo]) add('error', file, `assets[${i}]: unknown repo "${a.repo}"`);
    used.add(a.repo);
    if (!isDir(join(SKILLS_DIR, a.into ?? ''))) add('error', file, `assets[${i}]: kit/skills/${a.into} is missing — run \`agent-setup vendor sync --locked\``);
  }
  for (const key of used) if (repos[key] && !lock.repos?.[key]?.commit) add('warn', file, `repo "${key}" has no locked commit — run \`agent-setup vendor sync\``);
  for (const key of Object.keys(repos)) if (!used.has(key)) add('warn', file, `repo "${key}" is not used by any skill or asset`);

  // One licence per upstream source, and only for sources in use.
  const licDir = join(KIT_DIR, 'licenses');
  for (const key of used) {
    if (repos[key]?.license && !existsSync(join(licDir, `${key}.txt`))) {
      add('error', file, `repo "${key}" declares ${repos[key].license} but kit/licenses/${key}.txt is missing — run \`agent-setup vendor sync --locked\``);
    }
  }
  for (const f of readdirSafe(licDir)) {
    if (!f.endsWith('.txt') || !used.has(f.slice(0, -4))) add('error', join(licDir, f), 'not the licence of any vendored source — remove it');
  }

  for (const [name, d] of Object.entries(manifest.derived ?? {})) {
    for (const p of d.into ?? []) if (!existsSync(join(KIT_ROOT, p))) add('error', file, `derived.${name}.into names ${p}, which does not exist`);
    if (!Object.keys(lock.derived?.[name]?.files ?? {}).length) add('warn', file, `derived source "${name}" has no fingerprints — run \`agent-setup vendor record ${name}\``);
  }
}

function lintPlugins({ add }) {
  const pluginPath = join(KIT_DIR, '.claude-plugin', 'plugin.json');
  const plugin = readJsonFile(pluginPath);
  if (plugin.error || !plugin.value) add('error', pluginPath, `invalid or missing: ${plugin.error ?? ''}`);
  else if (plugin.value.version !== kitVersion()) add('error', pluginPath, `version ${plugin.value.version} ≠ package.json ${kitVersion()} — bump both together`);

  const mpPath = join(KIT_ROOT, '.claude-plugin', 'marketplace.json');
  const mp = readJsonFile(mpPath);
  if (mp.error || !mp.value) add('error', mpPath, `invalid or missing: ${mp.error ?? ''}`);
  else {
    const list = mp.value.plugins ?? [];
    if (list.length !== 1 || list[0].source !== './kit') add('error', mpPath, 'the marketplace lists exactly one plugin, the kit (source "./kit") — there are no packs');
    else if (plugin.value && list[0].name !== plugin.value.name) add('error', mpPath, `plugin "${list[0].name}" ≠ kit/.claude-plugin/plugin.json name "${plugin.value.name}"`);
  }
}

// ---------------------------------------------------------------- repository

/** Paths named in the first column of the tables under "## Layout" in AGENTS.md. */
function documentedLayout() {
  const text = readText(join(KIT_ROOT, 'AGENTS.md')) ?? '';
  const section = text.split(/^## /m).find((s) => s.startsWith('Layout')) ?? '';
  const out = new Set();
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/`([^`]+)`/g)) out.add(m[1].replace(/\/$/, ''));
  }
  return out;
}

function lintRepository({ add }) {
  // 1 · One place per theme: the tree matches the documented layout, both ways.
  const agentsMd = join(KIT_ROOT, 'AGENTS.md');
  const layout = documentedLayout();
  if (!layout.size) add('error', agentsMd, 'no "## Layout" table — the linter checks the tree against it');
  else {
    const actual = new Set([
      ...readdirSafe(KIT_ROOT).filter((e) => !LOCAL.has(e)),
      ...readdirSafe(KIT_DIR).map((e) => `kit/${e}`),
    ]);
    for (const p of actual) {
      if (!layout.has(p)) add('error', join(KIT_ROOT, p), 'not in the Layout tables of AGENTS.md — put it where its theme already lives, or document the new place on purpose');
    }
    for (const p of layout) if (!actual.has(p)) add('error', agentsMd, `Layout names \`${p}\`, which does not exist`);
  }

  // 2 · Every file once; no corrupted, stray or empty files; no empty folders.
  const byHash = new Map();
  const walk = (dir) => {
    const entries = readdirSafe(dir).filter((e) => !LOCAL.has(e) && !e.endsWith('-workspace'));
    if (!entries.length && dir !== KIT_ROOT) add('warn', dir, 'empty folder — remove it');
    for (const e of entries) {
      const abs = join(dir, e);
      if (isDir(abs)) {
        walk(abs);
        continue;
      }
      if (STRAY.test(e)) add('error', abs, 'stray file (backup, merge leftover or OS metadata) — remove it');
      const buf = readFileSync(abs);
      if (!buf.length) {
        if (e !== '.gitkeep') add('warn', abs, 'empty file');
        continue;
      }
      let data = buf;
      if (!BINARY.has(extname(e).toLowerCase()) && !buf.includes(0)) {
        const s = buf.toString('utf8');
        if (s.charCodeAt(0) === 0xfeff) add('error', abs, 'starts with a BOM — frontmatter and JSON parsers in some agents choke on it');
        const bad = s.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
        if (bad) {
          const line = s.slice(0, bad.index).split('\n').length;
          add('error', abs, `control character 0x${bad[0].charCodeAt(0).toString(16).padStart(2, '0')} on line ${line} — usually a backtick escape eaten by a shell (\`a → BEL, \`b → BS, \`f → FF); write files with an editor or a quoted heredoc`);
        }
        const hidden = s.slice(1).match(CODE.has(extname(e).toLowerCase()) ? INVISIBLE : MID_BOM);
        if (hidden) {
          const code = hidden[0].charCodeAt(0).toString(16).toUpperCase();
          add('error', abs, `invisible character U+${code} on line ${s.slice(0, hidden.index + 1).split('\n').length} — write it as an escape sequence (backslash, u, ${code})`);
        }
        if (s.includes('\uFFFD')) add('error', abs, 'contains U+FFFD (a character lost in an encoding conversion)');
        data = Buffer.from(s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
      }
      const h = createHash('sha256').update(data).digest('hex');
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(abs);
    }
  };
  walk(KIT_ROOT);
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group.map((p) => toPosix(relative(KIT_ROOT, p)));
    for (const p of rest) add('error', join(KIT_ROOT, p), `identical to ${first} — keep one copy and link or reference it`);
  }

  // 3 · Links in the repository's own docs (skills are checked above).
  const docs = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CHANGELOG.md', ...listFiles(join(KIT_ROOT, 'docs')).map((f) => `docs/${f}`), ...listFiles(join(KIT_ROOT, '.claude')).map((f) => `.claude/${f}`), ...listFiles(join(KIT_ROOT, 'inbox')).map((f) => `inbox/${f}`)];
  for (const rel of docs.filter((f) => f.endsWith('.md'))) {
    const abs = join(KIT_ROOT, rel);
    for (const link of relativeLinks(readText(abs) ?? '')) {
      if (!existsSync(resolve(dirname(abs), decodeURIComponent(link)))) add('error', abs, `broken link: ${link}`);
    }
  }
}
