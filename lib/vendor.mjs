// Everything in the kit that comes from somewhere else, in one place.
//
//   kit/vendor.json       what is taken from where, and every local patch with its `why`
//   kit/vendor.lock.json  the exact commits (vendored) and file fingerprints (derived)
//   kit/licenses/         one licence text per upstream source
//
// Two kinds of source:
//   vendored — third-party skills copied verbatim from GitHub into kit/skills/<name>/
//              and rebuilt by `agent-setup vendor sync` (never hand-edited: the next
//              sync overwrites them; local changes live in vendor.json as overrides).
//   derived  — sources the kit improved on and no longer mirrors (sdlc-kit). Only
//              their fingerprints are kept, so `vendor status` can report upstream
//              changes and the installer can recognise a pristine install to upgrade.
//              The source folder itself is only ever read.
//
// Ported from frontend-kit/scripts/sync-vendor.mjs (merged into the kit). Changes:
// licences are written once per source instead of once per skill (the per-skill
// copies were twelve identical files), the lock keeps the derived section, and
// `--locked` rebuilds from the recorded commits instead of the upstream heads.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { KIT_DIR } from './paths.mjs';
import { CliError, c, hashFile, listFiles, readJsonFile, say, toPosix } from './util.mjs';

export const VENDOR_FILE = join(KIT_DIR, 'vendor.json');
export const LOCK_FILE = process.env.AGENT_SETUP_VENDOR_LOCK ? resolve(process.env.AGENT_SETUP_VENDOR_LOCK) : join(KIT_DIR, 'vendor.lock.json');
const SKILLS = join(KIT_DIR, 'skills');
const LICENSES = join(KIT_DIR, 'licenses');

// The Agent Skills spec's frontmatter fields. Anything else is rejected by the
// reference validator (skills-ref) and by claude.ai uploads.
const SPEC_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

export function readVendor() {
  const m = readJsonFile(VENDOR_FILE);
  if (m.error) throw new CliError(`kit/vendor.json is not valid JSON: ${m.error}`);
  const l = readJsonFile(LOCK_FILE);
  if (l.error) throw new CliError(`${toPosix(relative(KIT_DIR, LOCK_FILE))} is not valid JSON: ${l.error}`);
  return {
    manifest: m.value ?? { repos: {}, skills: [], assets: [], derived: {} },
    lock: l.value ?? { repos: {}, skills: [], assets: [], derived: {} },
  };
}

/** Skill folder names that are rebuilt from upstream (never hand-edited). */
export function vendoredSkills() {
  const { manifest } = readVendor();
  return new Set((manifest.skills ?? []).map((s) => s.name));
}

/** Map skill name → licence file (kit-relative) for skills that carry third-party content. */
export function licenseFiles() {
  const { manifest } = readVendor();
  const out = new Map();
  for (const s of manifest.skills ?? []) out.set(s.name, `licenses/${s.repo}.txt`);
  for (const a of manifest.assets ?? []) out.set(a.into.split('/')[0], `licenses/${a.repo}.txt`);
  for (const [name, file] of [...out]) if (!existsSync(join(KIT_DIR, file))) out.delete(name);
  return out;
}

/** Fingerprints of a derived source's files (e.g. sdlc-kit's pristine hooks). */
export function derivedHashes(name = 'sdlc-kit', prefix = '') {
  const { lock } = readVendor();
  const files = lock.derived?.[name]?.files ?? {};
  return new Set(Object.entries(files).filter(([p]) => p.startsWith(prefix)).map(([, h]) => h));
}

const git = (cwd, ...args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- frontmatter

const FRONTMATTER = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

const splitFrontmatter = (text) => {
  const m = text.match(FRONTMATTER);
  if (!m) throw new Error('no frontmatter');
  return { open: m[1], lines: m[2].split(/\r?\n/), close: m[3], body: text.slice(m[0].length), eol: m[1].endsWith('\r\n') ? '\r\n' : '\n' };
};
const joinFrontmatter = (fm) => fm.open + fm.lines.join(fm.eol) + fm.close + fm.body;

/** Index range [start, end) of a top-level key, including its indented continuation lines. */
const keyRange = (lines, key) => {
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  return [start, end];
};

const topLevelKeys = (text) => splitFrontmatter(text).lines.map((l) => l.match(/^([A-Za-z0-9_-]+):/)?.[1]).filter(Boolean);

export const frontmatterValue = (text, key) => {
  const fm = splitFrontmatter(text);
  const r = keyRange(fm.lines, key);
  if (!r) return null;
  // Folded (>) and literal (|) block scalars: the value is the continuation lines, joined
  // without their indentation (which would otherwise count towards the 1024-char limit).
  const raw = fm.lines
    .slice(r[0], r[1])
    .map((l, i) => (i ? l.trim() : l))
    .join(' ')
    .slice(key.length + 1)
    .trim()
    .replace(/^[>|][-+]?\s*/, '');
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through: not a JSON-compatible scalar */
    }
  }
  return raw.replace(/^['"]|['"]$/g, '');
};

// JSON.stringify output is a valid YAML double-quoted scalar, which keeps colons
// and quotes in an override from breaking the frontmatter.
const setKey = (text, key, value, after = 'description') => {
  const fm = splitFrontmatter(text);
  const line = `${key}: ${JSON.stringify(value)}`;
  const r = keyRange(fm.lines, key);
  if (r) fm.lines.splice(r[0], r[1] - r[0], line);
  else {
    const anchor = keyRange(fm.lines, after);
    fm.lines.splice(anchor ? anchor[1] : fm.lines.length, 0, line);
  }
  return joinFrontmatter(fm);
};

const removeKey = (text, key) => {
  const fm = splitFrontmatter(text);
  const r = keyRange(fm.lines, key);
  if (r) fm.lines.splice(r[0], r[1] - r[0]);
  return joinFrontmatter(fm);
};

/** Agent Skills spec checks. Returns a list of problems; empty means valid. */
export const specProblems = (text, folder) => {
  const problems = [];
  const name = frontmatterValue(text, 'name');
  const description = frontmatterValue(text, 'description') ?? '';
  const compatibility = frontmatterValue(text, 'compatibility');
  if (name !== folder) problems.push(`name "${name}" must equal its folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '') || name.length > 64) problems.push(`name "${name}" must be lowercase letters, digits and single hyphens, ≤64 chars`);
  if (!description || description.length > 1024) problems.push(`description must be 1-1024 chars (is ${description.length})`);
  if (compatibility !== null && (compatibility.length < 1 || compatibility.length > 500)) problems.push(`compatibility must be 1-500 chars (is ${compatibility.length})`);
  for (const k of topLevelKeys(text)) if (!SPEC_KEYS.has(k)) problems.push(`frontmatter key "${k}" is not in the Agent Skills spec (add it to removeKeys)`);
  return problems;
};

/** Remove frontmatter keys outside the Agent Skills spec (Claude Code's context, agent, background…). */
export const stripToSpec = (text) => {
  const removed = topLevelKeys(text).filter((k) => !SPEC_KEYS.has(k));
  let out = text;
  for (const k of removed) out = removeKey(out, k);
  return { text: out, removed };
};

// ---------------------------------------------------------------- sync

/**
 * Rebuild the vendored skills and assets from upstream.
 * @param {{ sources?: Record<string,string>, locked?: boolean }} opts
 *   sources: repoKey → local checkout, instead of cloning
 *   locked:  check out the commit recorded in vendor.lock.json instead of the upstream head
 */
export function vendorSync({ sources = {}, locked = false } = {}) {
  const { manifest, lock: previousLock } = readVendor();
  for (const key of Object.keys(sources)) {
    if (!manifest.repos?.[key]) throw new CliError(`--source ${key}: unknown repo; vendor.json repos are ${Object.keys(manifest.repos ?? {}).join(', ')}`);
  }

  let scratch = null;
  const repoDirs = {};
  const lock = { repos: {}, skills: [], assets: [], derived: previousLock.derived ?? {} };
  const usedRepos = new Set([...(manifest.skills ?? []), ...(manifest.assets ?? [])].map((e) => e.repo));

  try {
    for (const key of usedRepos) {
      const repo = manifest.repos[key];
      if (!repo) throw new CliError(`vendor.json references unknown repo "${key}"`);
      if (sources[key]) {
        const dir = resolve(sources[key]);
        if (!existsSync(dir)) throw new CliError(`--source ${key}: ${dir} does not exist`);
        repoDirs[key] = dir;
        lock.repos[key] = { source: `github:${repo.github}`, fetchedFrom: 'local copy', commit: git(dir, 'rev-parse', 'HEAD') ?? 'unknown (not a git checkout)' };
        continue;
      }
      scratch ??= mkdtempSync(join(tmpdir(), 'agent-setup-vendor-'));
      const dir = join(scratch, key);
      say(`cloning ${repo.github} …`);
      try {
        // autocrlf off: a Windows checkout would otherwise rewrite every vendored
        // file to CRLF, so the same sync produces a full-file diff per machine.
        execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--depth', '1', '--quiet', `https://github.com/${repo.github}.git`, dir], { stdio: 'inherit' });
      } catch {
        throw new CliError(`git clone of ${repo.github} failed`);
      }
      const want = previousLock.repos?.[key]?.commit;
      if (locked && want && git(dir, 'rev-parse', 'HEAD') !== want) {
        try {
          execFileSync('git', ['-c', 'core.autocrlf=false', 'fetch', '--depth', '1', '--quiet', 'origin', want], { cwd: dir, stdio: 'inherit' });
          execFileSync('git', ['-c', 'core.autocrlf=false', 'checkout', '--quiet', want], { cwd: dir, stdio: 'inherit' });
        } catch {
          throw new CliError(`${repo.github}: could not check out the locked commit ${want}`);
        }
      }
      repoDirs[key] = dir;
      lock.repos[key] = { source: `github:${repo.github}`, fetchedFrom: 'github', commit: git(dir, 'rev-parse', 'HEAD') };
    }

    // Licences: one file per upstream source, normalised to LF.
    mkdirSync(LICENSES, { recursive: true });
    const licenseText = {};
    for (const key of usedRepos) {
      const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((f) => join(repoDirs[key], f)).find(existsSync);
      if (!file) continue;
      licenseText[key] = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      writeFileSync(join(LICENSES, `${key}.txt`), licenseText[key]);
    }
    for (const f of readdirSync(LICENSES)) {
      if (f.endsWith('.txt') && !usedRepos.has(f.slice(0, -4))) rmSync(join(LICENSES, f));
    }

    // Skills.
    const problems = [];
    for (const entry of manifest.skills ?? []) {
      const src = join(repoDirs[entry.repo], entry.path);
      const skillFile = join(src, 'SKILL.md');
      if (!existsSync(skillFile)) throw new CliError(`${entry.repo}/${entry.path} has no SKILL.md (moved upstream?)`);
      const upstreamName = frontmatterValue(readFileSync(skillFile, 'utf8'), 'name');
      if (upstreamName !== entry.name) {
        throw new CliError(`${entry.repo}/${entry.path} is named "${upstreamName}" upstream, vendor.json expects "${entry.name}". Rename deliberately: other skills refer to it by name.`);
      }

      const dest = join(SKILLS, entry.name);
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      // A licence copied along with the skill that is the repo's licence is a duplicate
      // of kit/licenses/<repo>.txt; a skill-specific licence stays.
      for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
        const p = join(dest, f);
        if (existsSync(p) && readFileSync(p, 'utf8').replace(/\r\n/g, '\n') === licenseText[entry.repo]) rmSync(p);
      }

      const file = join(dest, 'SKILL.md');
      let text = readFileSync(file, 'utf8');
      if (entry.description) text = setKey(text, 'description', entry.description);
      if (entry.compatibility) text = setKey(text, 'compatibility', entry.compatibility);
      const spdx = manifest.repos[entry.repo].license;
      if (spdx && frontmatterValue(text, 'license') === null) {
        text = setKey(text, 'license', licenseText[entry.repo] ? `${spdx} (see ../../licenses/${entry.repo}.txt)` : spdx, 'name');
      }
      for (const k of entry.removeKeys ?? []) text = removeKey(text, k);
      writeFileSync(file, text);

      for (const p of specProblems(text, entry.name)) problems.push(`${entry.name}: ${p}`);
      const patched = Boolean(entry.description || entry.compatibility || entry.removeKeys?.length);
      lock.skills.push({ name: entry.name, repo: entry.repo, path: entry.path, patched });
      say(`  skill  ${entry.name}${patched ? '  (frontmatter patched)' : ''}`);
    }

    // Assets.
    for (const asset of manifest.assets ?? []) {
      const srcRoot = join(repoDirs[asset.repo], asset.path);
      const destRoot = join(SKILLS, asset.into);
      rmSync(destRoot, { recursive: true, force: true });
      mkdirSync(destRoot, { recursive: true });
      const copied = [];
      for (const sub of readdirSync(srcRoot).sort()) {
        const file = join(srcRoot, sub, asset.file);
        if (!statSync(join(srcRoot, sub)).isDirectory() || !existsSync(file)) continue;
        mkdirSync(join(destRoot, sub), { recursive: true });
        cpSync(file, join(destRoot, sub, asset.file));
        copied.push(sub);
      }
      if (asset.index) writeIndex(manifest, repoDirs, asset, copied);
      lock.assets.push({ into: asset.into, repo: asset.repo, count: copied.length });
      say(`  asset  ${asset.into}  (${copied.length} × ${asset.file})`);
    }

    // Orphans: vendored by an earlier sync, no longer listed. Only names from the
    // previous lock are ever deleted, so hand-authored skills are never touched.
    const keepSkills = new Set((manifest.skills ?? []).map((s) => s.name));
    for (const old of previousLock.skills ?? []) {
      if (keepSkills.has(old.name)) continue;
      rmSync(join(SKILLS, old.name), { recursive: true, force: true });
      say(`  removed  ${old.name}  (no longer in vendor.json)`);
    }
    const keepAssets = new Set((manifest.assets ?? []).map((a) => a.into));
    for (const old of previousLock.assets ?? []) {
      if (keepAssets.has(old.into)) continue;
      rmSync(join(SKILLS, old.into), { recursive: true, force: true });
      say(`  removed  ${old.into}  (asset path no longer in vendor.json)`);
    }

    // Upstream watch: new upstream skills that are neither vendored nor excluded.
    const accounted = new Set([...(manifest.skills ?? []), ...(manifest.excluded ?? [])].map((e) => `${e.repo}/${e.path}`));
    for (const [key, repo] of Object.entries(manifest.repos ?? {})) {
      if (!repo.watch || !repoDirs[key]) continue;
      const root = join(repoDirs[key], repo.watch);
      for (const sub of readdirSync(root)) {
        if (!existsSync(join(root, sub, 'SKILL.md')) || accounted.has(`${key}/${repo.watch}/${sub}`)) continue;
        say(c.yellow(`  NEW upstream skill ${repo.github}/${repo.watch}/${sub}: list it in vendor.json "skills" or "excluded"`));
      }
    }

    // No timestamp for vendored repos, so re-running a sync against unchanged upstreams produces no diff.
    writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
    if (problems.length) {
      for (const p of problems) say(c.red(`  spec  ${p}`));
      throw new CliError(`${problems.length} vendored skill(s) violate the Agent Skills spec; fix the overrides in kit/vendor.json`);
    }
    say(c.green('done.'), 'Every vendored skill passes the Agent Skills spec. Review the diff before committing — upstream changes land unreviewed otherwise.');
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Build INDEX.md for the DESIGN.md library from the upstream README's
 * "Collection" section (category + one-line look), falling back to the
 * DESIGN.md frontmatter description for brands the README does not list.
 */
function writeIndex(manifest, repoDirs, asset, folders) {
  const readme = readFileSync(join(repoDirs[asset.repo], asset.index.readme), 'utf8').split(/\r?\n/);
  const rows = new Map();
  let inCollection = false;
  let category = null;
  for (const line of readme) {
    if (/^##\s+Collection/.test(line)) {
      inCollection = true;
      continue;
    }
    if (inCollection && /^##\s/.test(line)) break;
    if (!inCollection) continue;
    const cat = line.match(/^###\s+(.+?)\s*$/);
    if (cat) {
      category = cat[1];
      continue;
    }
    const item = line.match(/^- \[\*\*(.+?)\*\*\]\(https:\/\/getdesign\.md\/([^/]+)\/design-md\)\s*-\s*(.+)$/);
    if (item && folders.includes(item[2])) rows.set(item[2], { category, name: item[1], look: item[3].trim() });
  }
  for (const folder of folders) {
    if (rows.has(folder)) continue;
    const text = readFileSync(join(SKILLS, asset.into, folder, asset.file), 'utf8');
    const desc = String(frontmatterValue(text, 'description') ?? '').split('. ')[0];
    const name = folder.charAt(0).toUpperCase() + folder.slice(1);
    rows.set(folder, { category: 'Other', name, look: desc.length > 160 ? `${desc.slice(0, 157)}...` : desc });
  }

  const byCategory = new Map();
  for (const [folder, row] of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push({ folder, ...row });
  }

  // Links are relative to the index's own folder.
  const indexDir = dirname(asset.index.file);
  const rel = asset.into.startsWith(`${indexDir}/`) ? asset.into.slice(indexDir.length + 1) : asset.into;
  const out = [
    '# DESIGN.md library index',
    '',
    `<!-- Generated by \`agent-setup vendor sync\` from ${manifest.repos[asset.repo].github}. Do not edit: the next sync overwrites it. -->`,
    '',
    `${rows.size} brand design systems. Pick by the look the user described, then read that brand's file.`,
    '',
  ];
  for (const [cat, list] of byCategory) {
    out.push(`## ${cat}`, '', '| Brand | Look | File |', '|---|---|---|');
    for (const r of list) out.push(`| ${r.name} | ${r.look.replace(/\|/g, '\\|')} | [${r.folder}](${rel}/${r.folder}/${asset.file}) |`);
    out.push('');
  }
  writeFileSync(join(SKILLS, asset.index.file), out.join('\n'));
}

// ---------------------------------------------------------------- status

/** Report what changed upstream: derived sources by fingerprint, GitHub repos by head commit. */
export function vendorStatus({ offline = false } = {}) {
  const { manifest, lock } = readVendor();
  let changes = 0;
  say('', c.bold('Derived sources'));
  for (const [name, d] of Object.entries(manifest.derived ?? {})) {
    const recorded = lock.derived?.[name];
    if (!recorded?.files) {
      say(`  ${name}: no fingerprints recorded — run: agent-setup vendor record ${name}`);
      continue;
    }
    if (!existsSync(d.source)) {
      say(c.yellow(`  ${name}: source not reachable (${d.source}) — ${Object.keys(recorded.files).length} fingerprints on record`));
      continue;
    }
    const live = Object.fromEntries(listFiles(d.source).map((f) => [f, hashFile(join(d.source, f))]));
    const changed = Object.keys(live).filter((f) => recorded.files[f] && recorded.files[f] !== live[f]);
    const added = Object.keys(live).filter((f) => !recorded.files[f]);
    const removed = Object.keys(recorded.files).filter((f) => !live[f]);
    if (!changed.length && !added.length && !removed.length) say(c.green(`  ${name}: unchanged since ${String(recorded.recordedAt).slice(0, 10)}`));
    for (const f of changed) say(`  ${name}: ${c.yellow('changed')}  ${f}`);
    for (const f of added) say(`  ${name}: ${c.green('added')}    ${f}`);
    for (const f of removed) say(`  ${name}: ${c.red('removed')}  ${f}`);
    changes += changed.length + added.length + removed.length;
    if (changed.length || added.length || removed.length) {
      say(`  Port what applies into kit/ (compare with ${d.into?.join(', ') ?? 'kit/'}), then: agent-setup vendor record ${name}`);
    }
  }

  say('', c.bold('Vendored repositories'));
  for (const [key, repo] of Object.entries(manifest.repos ?? {})) {
    const lockedAt = lock.repos?.[key]?.commit ?? 'not synced';
    if (offline) {
      say(`  ${key.padEnd(20)} locked ${String(lockedAt).slice(0, 12)}`);
      continue;
    }
    const head = git(process.cwd(), 'ls-remote', `https://github.com/${repo.github}.git`, 'HEAD')?.split(/\s+/)[0];
    if (!head) say(c.yellow(`  ${key.padEnd(20)} could not reach github.com/${repo.github}`));
    else if (head === lockedAt) say(c.green(`  ${key.padEnd(20)} up to date (${head.slice(0, 12)})`));
    else {
      changes++;
      say(`  ${key.padEnd(20)} ${c.yellow('upstream moved')} ${String(lockedAt).slice(0, 12)} → ${head.slice(0, 12)} — review, then: agent-setup vendor sync`);
    }
  }
  say('');
  return { changes };
}

/** (Re-)record the fingerprints of a derived source after porting its changes. */
export function recordDerived(name = 'sdlc-kit', { source } = {}) {
  const manifest = readJsonFile(VENDOR_FILE).value;
  const d = manifest?.derived?.[name];
  if (!d) throw new CliError(`kit/vendor.json has no derived source "${name}"`);
  const src = source ? resolve(source) : d.source;
  if (!existsSync(src)) throw new CliError(`source not found: ${src}`);
  if (source) {
    d.source = toPosix(src);
    writeFileSync(VENDOR_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const { lock } = readVendor();
  const files = Object.fromEntries(listFiles(src).map((f) => [f, hashFile(join(src, f))]));
  lock.derived = { ...(lock.derived ?? {}), [name]: { recordedAt: new Date().toISOString(), files } };
  writeFileSync(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);
  say(`${c.green('recorded')} ${Object.keys(files).length} fingerprints of ${name} (${toPosix(src)}) — the source was only read`);
}

// ---------------------------------------------------------------- import

/** Add a GitHub skill to vendor.json and sync it into the kit. */
export function importSkill(source, { name, license } = {}) {
  const gh = String(source ?? '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?$/);
  if (!gh) throw new CliError('usage: agent-setup import https://github.com/<owner>/<repo>/tree/<ref>/<path/to/skill> [--name x]');
  const [, owner, repoName, path = ''] = gh;
  const manifest = readJsonFile(VENDOR_FILE).value;
  const key = repoName.toLowerCase();
  manifest.repos ??= {};
  manifest.repos[key] ??= { github: `${owner}/${repoName}`, ...(license ? { license } : {}) };
  const skillName = name ?? basename(path || repoName).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) throw new CliError(`"${skillName}" is not a valid skill name — pass --name`);
  if (existsSync(join(SKILLS, skillName)) && !(manifest.skills ?? []).some((s) => s.name === skillName)) {
    throw new CliError(`kit/skills/${skillName} already exists and is not vendored — choose another --name`);
  }
  manifest.skills = (manifest.skills ?? []).filter((s) => s.name !== skillName);
  manifest.skills.push({ name: skillName, repo: key, path, why: 'Imported with `agent-setup import`; add overrides here with a why.' });
  writeFileSync(VENDOR_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  say(`${c.green('added')} ${skillName} (${owner}/${repoName}/${path}) to kit/vendor.json — syncing…`);
  vendorSync();
  say(
    '',
    `Next: add "${skillName}" to kit/catalog.json (group and profiles), review every script it ships,`,
    'and run `agent-setup lint`. Vendored skills are never edited by hand — overrides go in kit/vendor.json.',
  );
}
