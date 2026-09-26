// Unit tests for the pure parts of lib/: routing verdicts and the Agent Skills spec checks
// used by vendoring.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activations, verdict, resolveScope } from '../lib/routing.mjs';
import { frontmatterValue, specProblems } from '../lib/vendor.mjs';
import { resolveSelection, loadCatalog } from '../lib/catalog.mjs';

// ---------------------------------------------------------------------------
describe('routing: which skills an agent activated', () => {
  const known = new Set(['frontend-design-workflow', 'design-md-library', 'brandkit', 'backend']);
  const line = (o) => JSON.stringify(o);

  test('counts a Skill tool call and an opened SKILL.md, in order', () => {
    const stream = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'agent-setup:frontend-design-workflow' } }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/kit/skills/design-md-library/SKILL.md' } }] } }),
    ].join('\n');
    assert.deepEqual(activations(stream, known), ['frontend-design-workflow', 'design-md-library']);
  });

  test('ignores skills merely mentioned in tool results', () => {
    const stream = line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'see ../brandkit/SKILL.md and ../backend/SKILL.md' }] } });
    assert.deepEqual(activations(stream, known), []);
  });

  test('ignores unknown names and non-JSON lines', () => {
    const stream = ['not json', line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'other' } }] } })].join('\n');
    assert.deepEqual(activations(stream, known), []);
  });
});

describe('routing: verdicts judge only the suite scope', () => {
  const scope = new Set(['a', 'b', 'c']);

  test('the first scoped skill must be one of `first`; out-of-scope skills are ignored', () => {
    assert.equal(verdict({ first: ['a'] }, ['backend', 'a', 'b'], scope), null);
    assert.match(verdict({ first: ['a'] }, ['b', 'a'], scope), /first skill b, expected one of a/);
    assert.equal(verdict({ first: ['a'] }, [], scope), 'no scoped skill activated');
  });

  test('`none` allows only out-of-scope skills; `forbid` names skills that must not fire', () => {
    assert.equal(verdict({ none: true }, ['backend'], scope), null);
    assert.match(verdict({ none: true }, ['c'], scope), /expected no scoped skill, got c/);
    assert.match(verdict({ first: ['a'], forbid: ['c'] }, ['a', 'c'], scope), /forbidden skill activated: c/);
  });

  test('@group scopes expand from the catalog', () => {
    const design = resolveScope(['@design']);
    assert.ok(design.has('frontend-design-workflow'));
    assert.ok(design.has('brandkit'));
    assert.equal(design.has('backend'), false);
  });
});

// ---------------------------------------------------------------------------
describe('vendoring: frontmatter and the Agent Skills spec', () => {
  const skill = (fm) => `---\n${fm}\n---\n\n# body\n`;

  test('reads plain, quoted and folded values', () => {
    const text = skill('name: demo-skill\ndescription: >\n  Does one thing.\n  Use when testing.\nlicense: "MIT (see ../../licenses/x.txt)"');
    assert.equal(frontmatterValue(text, 'name'), 'demo-skill');
    assert.equal(frontmatterValue(text, 'description'), 'Does one thing. Use when testing.');
    assert.equal(frontmatterValue(text, 'license'), 'MIT (see ../../licenses/x.txt)');
    assert.equal(frontmatterValue(text, 'compatibility'), null);
  });

  test('a valid skill has no problems', () => {
    assert.deepEqual(specProblems(skill('name: demo-skill\ndescription: Does one thing. Use when testing.'), 'demo-skill'), []);
  });

  test('flags a name that differs from its folder, a Claude-only key and an over-long description', () => {
    const problems = specProblems(skill(`name: demo-skill\ndescription: ${'x'.repeat(1100)}\ncontext: fork`), 'other-name');
    assert.ok(problems.some((p) => /must equal its folder/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /description must be 1-1024 chars \(is 1100\)/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /"context" is not in the Agent Skills spec/.test(p)), problems.join('\n'));
  });
});

// ---------------------------------------------------------------------------
describe('selection: profiles and groups', () => {
  const catalog = loadCatalog();
  const names = (sel) => sel.skills.map((s) => s.name);

  test('the default profile is standard: domain and core, no design', () => {
    const sel = resolveSelection(catalog, {});
    assert.equal(sel.profile, 'standard');
    assert.ok(names(sel).includes('backend'));
    assert.ok(names(sel).includes('self-improve'));
    assert.equal(names(sel).includes('frontend-design-workflow'), false);
  });

  test('@design adds the group, a pack prefix left from 1.0 is accepted, exclude wins', () => {
    const sel = resolveSelection(catalog, { profile: 'minimal', skills: ['@design', 'frontend-kit:brandkit'], exclude: ['gpt-taste'] });
    assert.ok(names(sel).includes('frontend-design-workflow'));
    assert.ok(names(sel).includes('brandkit'));
    assert.equal(names(sel).includes('gpt-taste'), false);
    assert.equal(sel.skills.find((s) => s.name === 'brandkit').group, 'design');
  });

  test('agents come only with the skills they require', () => {
    const minimal = resolveSelection(catalog, { profile: 'minimal' });
    assert.deepEqual(minimal.agents.map((a) => a.name).sort(), ['docs-keeper', 'gate-runner']);
  });
});
