// `agent-setup eval-routing` — does a real agent pick the right skill for a prompt?
//
// Cases live beside the skill they test: kit/skills/<skill>/evals/routing.json.
// Each file declares a `scope` — the skills its cases are about (names or @group).
// Only scoped skills count: `first` is the first scoped skill the agent activates,
// `none` means no scoped skill may activate, `forbid` lists scoped skills that must
// not activate at all. Other kit skills may legitimately fire alongside (a backend
// prompt should trigger `backend`), and are reported but never judged.
//
// Each case runs headless in a scratch folder holding a small index.html. The runner
// reads the agent's JSON event stream and records which skills were activated, in
// order: a skill counts when the agent invokes it by name or opens its SKILL.md.
// Only tool-call INPUTS are inspected, never tool results — a router's body links to
// every other skill, so scanning results would report skills merely mentioned.
//
// Ported from frontend-kit/scripts/route-test.mjs when the design pack merged into
// the kit. Default agent: Claude Code with the kit loaded as a plugin directory.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT_DIR } from './paths.mjs';
import { CliError, c, say } from './util.mjs';
import { loadCatalog } from './catalog.mjs';

const SKILLS = join(KIT_DIR, 'skills');

/** All routing suites in the kit, or one skill's. */
export function loadRoutingSuites(skill) {
  const names = skill ? [skill] : readdirSync(SKILLS);
  const suites = [];
  for (const name of names) {
    const file = join(SKILLS, name, 'evals', 'routing.json');
    if (!existsSync(file)) {
      if (skill) throw new CliError(`kit/skills/${skill}/evals/routing.json does not exist`);
      continue;
    }
    const data = JSON.parse(readFileSync(file, 'utf8'));
    suites.push({ skill: name, file, scope: resolveScope(data.scope), cases: data.cases ?? [] });
  }
  return suites;
}

/** Expand ["@design", "frontend"] into skill names using the catalog groups. */
export function resolveScope(scope) {
  const all = readdirSync(SKILLS).filter((n) => existsSync(join(SKILLS, n, 'SKILL.md')));
  if (!Array.isArray(scope) || !scope.length) return new Set(all);
  const catalog = loadCatalog();
  const out = new Set();
  for (const s of scope) {
    if (s.startsWith('@')) {
      const group = s.slice(1);
      for (const [name, meta] of Object.entries(catalog.skills ?? {})) if (meta.group === group) out.add(name);
    } else out.add(s);
  }
  return out;
}

/** Kit skills activated, in order, found in tool-call inputs of the event stream. */
export function activations(stdout, known) {
  const found = [];
  const note = (name) => {
    if (known.has(name) && found.at(-1) !== name) found.push(name);
  };
  const scanString = (s) => {
    for (const m of s.matchAll(/(?:^|[\\/:\s"'])([a-z0-9]+(?:-[a-z0-9]+)*)[\\/]SKILL\.md/g)) note(m[1]);
  };
  // Keys that carry what the agent asked a tool to do, across agent formats.
  const INPUT_KEYS = new Set(['input', 'arguments', 'args', 'command', 'cmd', 'file_path', 'path', 'params']);
  const walk = (node, inInput) => {
    if (typeof node === 'string') {
      if (inInput) scanString(node);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, inInput);
      return;
    }
    // Claude Code's Skill tool: {"type":"tool_use","name":"Skill","input":{"skill":"agent-setup:x"}}
    if (node.type === 'tool_use' && node.name === 'Skill' && typeof node.input?.skill === 'string') {
      note(node.input.skill.split(':').pop());
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (['content', 'output', 'result', 'stdout', 'aggregated_output', 'text'].includes(k) && !inInput) {
        // Assistant message content still holds tool_use blocks; results do not.
        if (k === 'content' && Array.isArray(v)) for (const block of v) if (block?.type === 'tool_use') walk(block, false);
        continue;
      }
      walk(v, inInput || INPUT_KEYS.has(k));
    }
  };
  for (const line of String(stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try {
      walk(JSON.parse(t), false);
    } catch {
      /* not a JSON line */
    }
  }
  return found;
}

/** Judge one case against the activations, counting only scoped skills. */
export function verdict(kase, got, scope) {
  const scoped = got.filter((s) => scope.has(s));
  if (kase.none) return scoped.length ? `expected no ${[...scope].length > 1 ? 'scoped ' : ''}skill, got ${scoped.join(' → ')}` : null;
  if (!scoped.length) return 'no scoped skill activated';
  if (kase.first && !kase.first.includes(scoped[0])) return `first skill ${scoped[0]}, expected one of ${kase.first.join(' | ')}`;
  const bad = (kase.forbid ?? []).filter((f) => scoped.includes(f));
  return bad.length ? `forbidden skill activated: ${bad.join(', ')}` : null;
}

/**
 * How to start argv[0]. Native executables spawn directly. On Windows, npm-installed
 * CLIs are .cmd shims, which only run through cmd.exe; each argument is then quoted by
 * hand, because Node's shell:true concatenates arguments unescaped.
 */
function launcher(argv) {
  if (process.platform !== 'win32') return [argv[0], argv.slice(1)];
  let resolved = argv[0];
  try {
    resolved =
      execFileSync('where', [argv[0]], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((p) => /\.(exe|cmd|bat)$/i.test(p)) ?? argv[0];
  } catch {
    /* not on PATH: let spawn report it */
  }
  if (!/\.(cmd|bat)$/i.test(resolved)) return [resolved, argv.slice(1)];
  const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;
  return ['cmd.exe', ['/d', '/s', '/c', `"${[resolved, ...argv.slice(1)].map(quote).join(' ')}"`]];
}

export async function evalRouting({ skill, only = [], cmd, assume, jobs = 4, timeout = 300 } = {}) {
  const suites = loadRoutingSuites(skill);
  if (!suites.length) throw new CliError('no routing suites found (kit/skills/*/evals/routing.json)');
  const known = new Set(readdirSync(SKILLS));
  const command = cmd
    ? JSON.parse(cmd)
    : ['claude', '-p', '{prompt}', '--plugin-dir', '{kit}', '--max-turns', '3', '--output-format', 'stream-json', '--verbose'];
  const caps = new Set((assume ?? (cmd ? '' : 'non-gpt-model,no-image-generation')).split(',').filter(Boolean));
  const runnable = (k) => !k.when || caps.has(k.when);

  const work = mkdtempSync(join(tmpdir(), 'agent-setup-routing-'));
  const all = suites.flatMap((s) => s.cases.map((k) => ({ ...k, suite: s })));
  const selected = all.filter((k) => (!only.length || only.includes(k.id)) && runnable(k));
  const skipped = all.filter((k) => (!only.length || only.includes(k.id)) && !runnable(k));

  const run = (k) => {
    const dir = mkdtempSync(join(work, `${k.id}-`));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><body><h1>Shop</h1><img src="a.png"><button>Buy</button></body></html>\n');
    const argv = command.map((a) => a.replaceAll('{prompt}', k.prompt).replaceAll('{kit}', KIT_DIR));
    const [file, fileArgs] = launcher(argv);
    return new Promise((done) => {
      const child = spawn(file, fileArgs, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: file === 'cmd.exe' });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      const timer = setTimeout(() => child.kill(), timeout * 1000);
      child.on('close', () => {
        clearTimeout(timer);
        const got = activations(out, known);
        done({ k, got, problem: verdict(k, got, k.suite.scope) });
      });
    });
  };

  const results = [];
  const queue = [...selected];
  try {
    await Promise.all(
      Array.from({ length: Math.min(jobs, queue.length) }, async () => {
        while (queue.length) results.push(await run(queue.shift()));
      }),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  results.sort((a, b) => selected.indexOf(a.k) - selected.indexOf(b.k));
  let failed = 0;
  for (const { k, got, problem } of results) {
    if (problem) failed++;
    say(`${problem ? c.red('FAIL') : c.green('pass')}  ${k.suite.skill}/${k.id.padEnd(22)} ${got.join(' → ') || '(none)'}${problem ? `\n      ${problem}` : ''}`);
  }
  for (const k of skipped) say(`${c.dim('skip')}  ${k.suite.skill}/${k.id.padEnd(22)} (assumes ${k.when})`);
  say('', `${results.length - failed}/${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
  return failed ? 1 : 0;
}
