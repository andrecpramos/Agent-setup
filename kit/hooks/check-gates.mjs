#!/usr/bin/env node
// PostToolUse hook for Edit/Write/MultiEdit/NotebookEdit. Surfaces the cheapest
// gate the edit could have broken, immediately, while the change is still in the
// agent's head.
//
// It is SILENT unless a configured path matches, and that silence is the design.
// A hook that comments on every write becomes noise an agent learns to skim,
// which is worse than no hook at all -- it trains the agent to ignore the channel
// the important messages arrive on.
//
// Driven by `postEdit` in .claude/sdlc.config.json. Keep those commands under a
// second: a slow post-edit hook makes every file write feel expensive and gets
// disabled within a week.
//
// Contract with the harness: exit 0 always, print additionalContext or nothing.
// Derived from sdlc-kit/runtime/hooks/check-gates.mjs — see docs/sdlc-changes.md.

import { execSync } from 'node:child_process';
import { relative, isAbsolute } from 'node:path';
import { loadConfig, readPayload, emitContext, matchGlob, logError } from './_config.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

try {
  const payload = await readPayload();
  if (!EDIT_TOOLS.has(payload.tool_name)) process.exit(0);

  const target = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path ?? '';
  if (!target) process.exit(0);

  const cfg = loadConfig();
  if (!cfg.postEdit.length) process.exit(0);

  // Match against a repo-relative POSIX path, so config globs are written the way
  // they appear in the repo rather than the way this machine spells them.
  const rel = (isAbsolute(target) ? relative(cfg.root, target) : target).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) process.exit(0);

  const notes = [];

  for (const entry of cfg.postEdit) {
    const paths = Array.isArray(entry?.paths) ? entry.paths : [];
    if (!paths.some((p) => matchGlob(p, rel))) continue;

    if (entry.remind) notes.push(entry.remind);

    if (entry.run) {
      try {
        execSync(entry.run, {
          cwd: cfg.root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: entry.timeoutMs ?? 5000,
          windowsHide: true,
        });
        // Passing is the expected case and says nothing. Only failure is news.
      } catch (err) {
        const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
        const head = out.split('\n').slice(0, 12).join('\n');
        const timedOut = err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
        notes.push(
          (timedOut
            ? `POST-EDIT CHECK TIMED OUT after editing ${rel} (${entry.timeoutMs ?? 5000}ms)\n` +
              `  $ ${entry.run}\nA post-edit check this slow will get disabled; move it to a gate.`
            : `GATE FAILED after editing ${rel}\n` +
              `  $ ${entry.run}\n` +
              (head ? `${head}\n` : '') +
              `Fix this before continuing — it is cheaper now than in CI.`),
        );
      }
    }
  }

  if (!notes.length) process.exit(0);
  emitContext('PostToolUse', notes.join('\n\n'));
} catch (err) {
  logError('check-gates', err);
  process.exit(0);
}
