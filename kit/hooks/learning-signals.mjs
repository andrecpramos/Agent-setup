#!/usr/bin/env node
// The sensing half of the self-improvement loop. One hook, three events:
//
//   SessionStart        — if lessons are waiting in .claude/learnings/, say so
//                         once, so they get routed instead of rotting.
//   UserPromptSubmit    — if the user's message reads like a correction or a
//                         standing instruction ("I told you…", "from now on…",
//                         "não faças isso…"), nudge the agent to capture it.
//   PostToolUseFailure  — keep a small, redacted friction log, and when the same
//                         call has failed three times in a session, tell the
//                         agent to stop retrying and diagnose.
//
// Why a hook: a lesson is cheapest to capture at the moment it happens, and the
// moment it happens is exactly when the agent is busiest fixing the mistake.
// A line in AGENTS.md saying "record your lessons" is read at session start and
// forgotten by the first correction.
//
// Design rules, same as every hook in this kit: silent unless it has something
// specific to say; never throws; always exits 0; never writes outside
// .claude/learnings/, and only when that directory already exists (so the hook
// is inert in a repo the kit was not installed into).

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPayload, emitContext, repoRoot, readJson, logError } from './_config.mjs';

// The entry point is at the BOTTOM of this file. With top-level await, code
// placed here would resume before the constants below are initialised, hit the
// temporal dead zone, and — because a hook must fail open — be swallowed
// silently. That happened; the test suite now fails on any stderr output.

async function run() {
  const payload = await readPayload();
  const root = process.env.CLAUDE_PROJECT_DIR || repoRoot();
  const dir = join(root, '.claude', 'learnings');
  if (!existsSync(dir)) return;

  switch (payload.hook_event_name) {
    case 'SessionStart':
      onSessionStart(root, dir);
      break;
    case 'UserPromptSubmit':
      onPrompt(payload);
      break;
    case 'PostToolUseFailure':
      onFailure(payload, dir);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------

function onSessionStart(root, dir) {
  const inbox = countInbox(join(dir, 'inbox.md'));
  const outbox = countFiles(join(dir, 'outbox'));
  if (!inbox && !outbox) return;

  const lines = [];
  if (inbox) {
    lines.push(
      `LEARNINGS: ${inbox} unprocessed lesson(s) in .claude/learnings/inbox.md.`,
      `Don't interrupt the user's request for them. When the current task is done — or if the user`,
      `asks for a retro — run the self-improve skill (\`/self-improve retro\`) to route each one to`,
      `where it will actually be enforced.`,
    );
  }
  if (outbox) {
    const manifest = readJson(join(root, '.claude', 'agent-setup.json'));
    const kit = manifest?.kit?.source;
    lines.push(
      `${outbox} kit improvement proposal(s) wait in .claude/learnings/outbox/. Mention once, at a natural`,
      `pause, that they can be harvested into the Agent_Setup kit with:`,
      `  node "${kit ? `${kit}/bin/agent-setup.mjs` : '<Agent_Setup>/bin/agent-setup.mjs'}" harvest`,
    );
  }
  emitContext('SessionStart', lines.join('\n'));
}

function countInbox(path) {
  try {
    const text = readFileSync(path, 'utf8');
    // Entries are level-2 headings that start with a date: "## 2026-09-26 — title".
    return (text.match(/^## \d{4}-\d{2}-\d{2}/gm) ?? []).length;
  } catch {
    return 0;
  }
}

function countFiles(path) {
  try {
    return readdirSync(path).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Correction detection. Deliberately narrow: a false positive costs a few lines
// of context; a noisy detector trains the agent to ignore the channel. Only the
// start of the message is scanned — corrections lead, and long prompts are
// usually pasted material that quotes other people.
// ---------------------------------------------------------------------------

const VERBS_EN =
  'do|doing|use|using|add|adding|create|creating|touch|touching|change|changing|call|calling|write|writing|' +
  'run|running|commit|committing|push|pushing|delete|deleting|remove|removing|edit|editing|modify|modifying|' +
  'install|installing|mock|mocking|rename|renaming|refactor|refactoring|guess|guessing|assume|assuming';

const CORRECTION = [
  // English
  /\b(i|we) (already )?(told|asked) you\b/i,
  /\bi (already |just )?said\b/i,
  /\bnot what i (asked|wanted|meant|said)\b/i,
  /\bthat'?s (not (right|correct|what i)|wrong|incorrect)\b/i,
  /\bthat is (not (right|correct)|wrong|incorrect)\b/i,
  /\byou (forgot|missed|ignored|broke|deleted|removed|overwrote|skipped|keep)\b/i,
  /\bwhy (did|would) you\b/i,
  new RegExp(`\\b(don'?t|do not|never|stop) (ever )?(${VERBS_EN})\\b`, 'i'),
  /\b(remember|note) (this|that|to)\b/i,
  /\b(from now on|going forward|next time|in the future)\b/i,
  /\bwrong (file|place|approach|branch|way|one|command)\b/i,
  /\b(revert|undo) (that|this|it|your|what you)\b/i,
  // Portuguese (PT-PT and PT-BR)
  /\bj[áa] (te |lhe )?(disse|pedi|falei|expliquei)/i,
  /\beu (j[áa] )?(disse|pedi|falei)\b/i,
  /\bn[ãa]o (era|foi|é) (isso|isto|o que)/i,
  /\b(est[áa]|isso est[áa]|isto est[áa]) (errado|mal)\b/i,
  /\best[áa]s a fazer (isso |isto )?mal\b/i,
  /\bn[ãa]o (fa[çc]as|faz|fa[çc]a|uses|use|usar|mexas|mexa|toques|toque|adiciones|adicione|cries|crie|corras|corra|apagues|apague|alteres|altere|mudes|mude|inventes|invente)\b/i,
  /\bp[áa]ra de\b/i,
  /\besquece(ste|u)\b/i,
  /\bpor ?que (é que )?(fizeste|fez|voc[êe] fez)/i,
  /\b(lembra-te|lembre-se|lembra que|n[ãa]o te esque[çc]as)/i,
  /\b(a partir de agora|da pr[óo]xima vez|nunca mais)\b/i,
];

function onPrompt(payload) {
  const prompt = String(payload.prompt ?? '');
  if (!prompt.trim()) return;
  // Strip fenced code and quoted lines, then look only at the opening.
  const head = prompt
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
    .slice(0, 600);
  if (!CORRECTION.some((rx) => rx.test(head))) return;

  emitContext(
    'UserPromptSubmit',
    'LEARNING SIGNAL — this message reads like a correction or a standing instruction.\n' +
      'Do what the user asked first. Then, if it teaches something a future session would\n' +
      'otherwise get wrong, add ONE entry to .claude/learnings/inbox.md (format in\n' +
      '.claude/learnings/README.md). If the user said "remember" / "from now on", it is a\n' +
      'standing rule: route it now with the self-improve skill. No need to comment on this note.',
  );
}

// ---------------------------------------------------------------------------
// Friction log.
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  /(authorization:\s*(bearer|basic|token)\s+)[^\s"']+/gi,
  /((?:api[_-]?key|token|secret|password|passwd|pwd|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"'&]+/gi,
  /(--?(?:password|token|secret|api-key)[= ])[^\s"']+/gi,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
];

function redact(text) {
  let out = String(text ?? '');
  for (const rx of SECRET_PATTERNS) {
    out = out.replace(rx, (m, keep) => (typeof keep === 'string' && m.startsWith(keep) ? `${keep}***` : '***'));
  }
  return out;
}

function summarizeInput(tool, input) {
  if (!input || typeof input !== 'object') return '';
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.notebook_path === 'string') return input.notebook_path;
  if (typeof input.url === 'string') return input.url;
  if (typeof input.pattern === 'string') return `${tool} ${input.pattern}`;
  try {
    return JSON.stringify(input);
  } catch {
    return '';
  }
}

function onFailure(payload, dir) {
  const tool = String(payload.tool_name ?? 'unknown');
  const input = redact(summarizeInput(tool, payload.tool_input)).replace(/\s+/g, ' ').slice(0, 240);
  const errorText = typeof payload.tool_error === 'string' ? payload.tool_error : JSON.stringify(payload.tool_error ?? payload.tool_response ?? '');
  const error = redact(errorText).replace(/\s+/g, ' ').slice(0, 300);
  const session = String(payload.session_id ?? '');
  const key = `${tool}:${input.slice(0, 80)}`;

  const file = join(dir, 'signals.jsonl');
  appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), session, tool, key, input, error })}\n`);

  // Keep the log bounded: it is a sensor, not an archive.
  let lines = [];
  try {
    if (statSync(file).size > 200_000) {
      lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writeFileSync(file, `${lines.slice(-800).join('\n')}\n`);
    }
  } catch {
    // ignore
  }

  // Three identical failures in one session: the agent is looping.
  try {
    if (!lines.length) lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-60);
    const same = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.session === session && r.key === key).length;
    if (same === 3) {
      emitContext(
        'PostToolUseFailure',
        `FRICTION — this ${tool} call has now failed 3 times in this session (${input.slice(0, 80)}).\n` +
          'Stop retrying variations. Read the error, find the cause (wrong cwd? missing tool? wrong\n' +
          'assumption about the project?), and fix that. Once solved, capture the lesson in\n' +
          '.claude/learnings/inbox.md so the next session does not pay for it again.',
      );
    }
  } catch (err) {
    logError('learning-signals', err);
  }
}

// ---------------------------------------------------------------------------
// Entry point — last, so every constant above is initialised.
// ---------------------------------------------------------------------------

try {
  await run();
} catch (err) {
  logError('learning-signals', err); // fail open, but leave a trace in `claude --debug`
}
process.exit(0);
