// Where things are. The kit root is the folder that contains bin/, lib/ and kit/.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, toPosix } from './util.mjs';

export const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const KIT_DIR = join(KIT_ROOT, 'kit');
export const TEMPLATES = join(KIT_DIR, 'templates');
export const INBOX_DIR = process.env.AGENT_SETUP_INBOX_DIR ? resolve(process.env.AGENT_SETUP_INBOX_DIR) : join(KIT_ROOT, 'inbox');

/** Machine-local state (the project registry). Overridable for tests. */
export const STATE_DIR = process.env.AGENT_SETUP_STATE_DIR ? resolve(process.env.AGENT_SETUP_STATE_DIR) : join(KIT_ROOT, '.state');

export const MANIFEST_REL = '.claude/agent-setup.json';

let cachedVersion = null;
export function kitVersion() {
  if (cachedVersion) return cachedVersion;
  cachedVersion = readJsonFile(join(KIT_ROOT, 'package.json')).value?.version ?? '0.0.0';
  return cachedVersion;
}

/** The kit's own location, POSIX-style, as recorded in project manifests. */
export const kitSource = () => toPosix(KIT_ROOT);
