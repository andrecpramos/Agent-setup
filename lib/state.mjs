// Per-project manifest (.claude/agent-setup.json) and the machine-local registry
// of projects the kit is installed in (.state/projects.json, gitignored).

import { join, resolve } from 'node:path';
import { MANIFEST_REL, STATE_DIR } from './paths.mjs';
import { readJsonFile, toPosix, writeJson } from './util.mjs';

export function readManifest(target) {
  const r = readJsonFile(join(target, MANIFEST_REL));
  return r.value;
}

export function writeManifest(target, manifest) {
  const files = Object.fromEntries(Object.entries(manifest.files ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  writeJson(join(target, MANIFEST_REL), { ...manifest, files });
}

const REGISTRY = () => join(STATE_DIR, 'projects.json');

export function listProjects() {
  const v = readJsonFile(REGISTRY()).value;
  return Array.isArray(v?.projects) ? v.projects : [];
}

export function registerProject(target, info) {
  const path = toPosix(resolve(target));
  const projects = listProjects().filter((p) => p.path.toLowerCase() !== path.toLowerCase());
  projects.push({ path, ...info });
  projects.sort((a, b) => a.path.localeCompare(b.path));
  writeJson(REGISTRY(), { $comment: 'Projects this kit is installed in, on this machine. Used by `update --all`, `status --all` and `harvest`.', projects });
}

export function unregisterProject(target) {
  const path = toPosix(resolve(target)).toLowerCase();
  const projects = listProjects().filter((p) => p.path.toLowerCase() !== path);
  writeJson(REGISTRY(), { $comment: 'Projects this kit is installed in, on this machine.', projects });
}
