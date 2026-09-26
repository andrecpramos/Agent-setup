---
name: frontend-design-workflow
description: Entry point for visual design work on websites and web apps. Use when building a landing page, marketing site, portfolio or new UI from a brief; restyling or redesigning an existing site; matching a brand look ("make it feel like Linear / Stripe"); producing website or app mockups; or raising a UI to premium, non-templated quality. Sequences the kit's design skills (design direction, build, real-browser verification, guidelines audit), adapts to what the current agent can do, and settles conflicts between skills. Not for backend work or UI engineering without a visual change (state, data fetching, tests).
---

# Frontend design workflow

The kit's design skills each do one job. This skill says which to use, in what
order, and who wins when they disagree. It works in any agent that reads Agent
Skills: Claude Code, Codex, Cursor, Copilot, Gemini CLI, OpenCode and others.

**Opening a skill.** The skills are sibling folders. If your agent loads skills
by name, use the name. Otherwise open the linked `SKILL.md` and follow it. If a
linked skill is not installed, say so and continue with the rest.

**Project overlay.** Read `.claude/overlays/frontend-design-workflow.md` if it
exists: this project's adaptation of the workflow (house style, banned fonts,
target browsers, skills it never uses). It wins where the two disagree.

| Job | Skill |
|---|---|
| Find the design direction | [design-md-library](../design-md-library/SKILL.md) (brand references), [design-taste-frontend](../design-taste-frontend/SKILL.md) §0-§2 (brief inference and dials) |
| Lock it for later sessions | [stitch-design-taste](../stitch-design-taste/SKILL.md) (writes the project's `DESIGN.md`) |
| Build (pick one core skill) | [design-taste-frontend](../design-taste-frontend/SKILL.md) (default) · [gpt-taste](../gpt-taste/SKILL.md) · [image-to-code](../image-to-code/SKILL.md) |
| Improve an existing site | [redesign-existing-projects](../redesign-existing-projects/SKILL.md) (audit checklist) |
| Aesthetic layer (at most one) | [high-end-visual-design](../high-end-visual-design/SKILL.md) · [minimalist-ui](../minimalist-ui/SKILL.md) · [industrial-brutalist-ui](../industrial-brutalist-ui/SKILL.md) |
| Images only (no code) | [imagegen-frontend-web](../imagegen-frontend-web/SKILL.md) · [imagegen-frontend-mobile](../imagegen-frontend-mobile/SKILL.md) · [brandkit](../brandkit/SKILL.md) |
| Complete output on big generations | [full-output-enforcement](../full-output-enforcement/SKILL.md) |
| See the result | [agent-browser](../agent-browser/SKILL.md) (default) · [playwright-cli](../playwright-cli/SKILL.md) (other engines, tests) |
| Audit | [web-design-guidelines](../web-design-guidelines/SKILL.md) (code) + `agent-browser a11y` (rendered page) |

## 0 · Check what this agent can do

The right route depends on the environment, not on which agent you are. Check
once at the start:

| Capability | How to tell | Consequence |
|---|---|---|
| **Shell** | You can run commands | Required for the browser CLIs. Without one, see "No shell" in step 3. |
| **Browser CLIs** | `agent-browser --version`, `playwright-cli --version` | Missing → install (§5) if allowed, otherwise use the fallbacks in step 3. |
| **Image generation** | You have a tool that creates images | Unlocks the image-first build and the images-only skills. Without it, never pick them. |
| **Web fetch** | You can fetch a URL | web-design-guidelines downloads its rules. Without it, audit from your own knowledge of those guidelines and say so. |
| **Model family** | You know which model you are | gpt-taste is written for GPT-family models. Everyone else uses design-taste-frontend. |
| **Viewing images** | You can open a PNG | Needed to judge screenshots. If you cannot, report the screenshot paths for the user to check. |

## 1 · Size the task first

Loading the whole stack for a button colour wastes context:
design-taste-frontend alone is ~1,200 lines. Pick the smallest row that fits.

| Task | Do |
|---|---|
| **Micro**: copy edit, one colour or spacing fix, one component bug | Follow the existing `DESIGN.md` or tokens. Skip steps 1-2. One browser check of the affected view. |
| **Section / component**: new section or component on an existing site | Step 1 (read the source of truth only) → build with the matching sections of the core skill → steps 3-4 on the changed view and files. |
| **Page / site**: greenfield landing, portfolio, redesign, multi-page | Full pipeline, steps 1-5. |
| **Product UI**: dashboard, admin, data tables, multi-step forms, editors | design-taste-frontend is out of scope here (its §13). Use the project's design system, or an official one from its §2.A, plus steps 3-4. Style layers only on marketing surfaces. |
| **Images only**: website comps, app screens, brand boards | imagegen-frontend-web, imagegen-frontend-mobile or brandkit. Needs image generation. Take the Design Read from step 1 first so the images follow a direction. |
| **Review only**: "review my UI", "audit this page" | Steps 3-4 and report. Change nothing unless asked. |

## 2 · The pipeline

### Step 1: Establish one design source of truth

Check in this order and stop at the first hit:

1. **`DESIGN.md` at the repo root**, or wherever AGENTS.md / CLAUDE.md points.
   Binding. Read it before writing any UI.
2. **Existing tokens**: Tailwind theme, CSS custom properties, a theme file, an
   installed design-system package. Binding for any redesign in "preserve" mode.
3. **The user named a brand or product look** → design-md-library.
4. **None of the above** → design-taste-frontend §0-§2: state the one-line
   Design Read, set the three dials, pick a real design system or an honest
   aesthetic.

For page/site work, **persist the result**: if the project had no `DESIGN.md`,
write one at the root with stitch-design-taste, following the section order of
the design-md-library brand files and including the dials in a `Configuration`
section. Later sessions and other agents, in any tool, then inherit the system
instead of re-inventing it. Mention the new file in your report.

### Step 2: Build

**Pick exactly one core build skill.** They contradict each other if combined.

| Core skill | Use when |
|---|---|
| design-taste-frontend | Default, on every model. |
| image-to-code | Image generation is available, the task is a page or site, and the user supplied no designs. It generates section comps, analyses them and builds to match. Its "Codex" rules apply to any agent that can generate images. |
| gpt-taste | You are a GPT-family model **and** the brief is a motion-rich marketing or Awwwards-style page (MOTION_INTENSITY 7+). It forbids static interfaces, so it is wrong for calm, trust-first or public-sector briefs, whatever the model. |

Whichever core skill builds, design-taste-frontend's §0 Design Read, its §11
redesign rules and its §14 pre-flight check still apply.

Then:
- **Existing site** → design-taste-frontend §11 decides the mode (preserve /
  overhaul / greenfield) and its preservation rules (§11.C, §11.F) are binding.
  redesign-existing-projects supplies the audit checklist and the fix order.
- **Direction already chosen** → add exactly one style layer:
  - high-end-visual-design: soft, calm, premium, agency polish
  - minimalist-ui: editorial, Notion / Linear-like, monochrome
  - industrial-brutalist-ui: Swiss, terminal, raw, data-heavy

  Two style layers contradict each other on every axis. Never combine them.
- **Many files or long components in one go**, where output tends to get
  truncated → also apply full-output-enforcement.

### Step 3: Verify in a real browser

Never skip this for visual work. Code review cannot see an overflowing hero, a
wrapped CTA or a section that flips theme.

1. Start the project's dev server in the background with its own script. For
   static files, serve them (`npx -y serve -l 4599 <dir>`). Do not use
   `file://` URLs: playwright-cli blocks them outright.
2. **Use a named session on every command.** The default agent-browser session
   is one browser shared by every agent on the machine, so another session can
   navigate it away mid-check. Shell variables may not persist between commands,
   so pass the flag each time.
3. **Set the colour scheme explicitly, including for light.** A headless
   browser inherits the OS theme, so on a machine in dark mode an "unstyled"
   screenshot is already the dark theme. Without `set media light` you never
   see the light page.
   ```bash
   agent-browser --session fe-<task> open http://localhost:3000
   agent-browser --session fe-<task> set media light
   agent-browser --session fe-<task> set viewport 375 812
   agent-browser --session fe-<task> screenshot --full shots/375.png
   agent-browser --session fe-<task> set viewport 1440 900
   agent-browser --session fe-<task> screenshot --full shots/1440.png
   agent-browser --session fe-<task> set media dark
   agent-browser --session fe-<task> screenshot --full shots/1440-dark.png
   agent-browser --session fe-<task> set media light reduced-motion
   agent-browser --session fe-<task> errors
   agent-browser --session fe-<task> console
   agent-browser --session fe-<task> close
   ```
   `errors` lists uncaught exceptions only. Logged errors appear under `console`.
   Widths: 375, 768, 1280 and 1440. Add 1280x720 for "hero fits a small
   laptop". The first time in a session, run `agent-browser skills get core` for
   the version-matched command guide.
4. **Open every screenshot and look at it.** Check what only a render shows:
   hero within the viewport, nav on one line, no CTA wrapping, one theme for the
   whole page, contrast, broken images, horizontal scroll at 375.
5. Fix, then re-capture with `screenshot --if-changed` until clean.

Use **playwright-cli** instead when the check needs something agent-browser
lacks. Always pass `-s=<name>` and `--browser=webkit|firefox|chromium` on
`open`: without `--browser` it looks for an installed Google Chrome and fails
where there is none. Use `set-color-scheme light|dark` for the theme.
playwright-cli is needed for:
- **WebKit** (Safari's engine) or **Firefox**. Do one WebKit pass before calling
  a production site done, because Safari is where viewport-height and
  `backdrop-filter` bugs surface.
- forced-colors or high-contrast emulation
- writing or running Playwright regression tests
- traces or video
- `show --annotate`, to let the user mark up the live page with feedback

On Windows, quote URLs containing `&` for playwright-cli (see its skill). Do not
run both tools for the same check.

**No shell, or the CLIs cannot be installed.** In order of preference:
1. A browser MCP server, if one is configured: `agent-browser mcp`, or
   Playwright's MCP server. Same checks, called as tools.
2. The agent's own built-in browser, if it has one. Same checks, by hand.
3. None. Tell the user verification was not done, and list exactly what to
   check (the items in point 4) instead of implying the page works.

### Step 4: Audit

1. **web-design-guidelines** on the changed UI files. It fetches its rules live
   from raw.githubusercontent.com, so it needs web access.
2. **`agent-browser --session fe-<task> a11y`** on each changed page: an axe-core
   audit of the rendered DOM, catching what static review misses (computed
   contrast, focus order, ARIA wiring).
3. For marketing pages, the **design-taste-frontend §14** pre-flight check.

Fix in this order: accessibility, then interaction correctness, then polish.
Re-run step 3 after fixing.

### Step 5: Report

Include:
- the Design Read and dials
- the source of truth used (and whether you created `DESIGN.md`)
- the skills applied
- the screenshot paths
- audit findings, both fixed and remaining
- every placeholder image slot that needs a real asset
- any step skipped because the environment lacked a capability (§0)

## 3 · When skills disagree

Before applying precedence, **look for an option that satisfies both skills.**
For example, pick a font from the style layer's list that design-taste-frontend
does not flag. When no such option exists, the higher level wins:

1. The user's explicit instruction in this conversation.
2. The project's own source of truth (`DESIGN.md`, existing tokens, brand
   assets) and design-taste-frontend's preservation rules (§11.C, §11.F).
3. Accessibility and correctness: web-design-guidelines, WCAG AA contrast,
   reduced motion, keyboard and focus. No aesthetic rule overrides these.
4. The one chosen style layer, or the design-md-library reference.
5. The core build skill's defaults and bans.
6. stitch-design-taste, redesign-existing-projects, and any other design
   database installed (for example ui-ux-pro-max). These are older or generic
   lists.

### Known conflicts, already resolved

| Conflict | Resolution |
|---|---|
| **Inter**: banned as a default by design-taste-frontend, gpt-taste, high-end-visual-design, minimalist-ui and stitch-design-taste. Recommended by industrial-brutalist-ui. Used by many brand DESIGN.md files. | Allowed when the project DESIGN.md, a brand reference or the brutalist layer specifies it. Never as an unexamined default. With Inter body text, give headings a face with character. |
| **Fraunces / Instrument Serif**: recommended by stitch-design-taste and minimalist-ui, flagged as overused by design-taste-frontend §14 | Pick another serif from the same lists unless the brand requires one of them: Newsreader (open license) or Gambarino (free via Fontshare); Lyon Text and Editorial New only if the project licenses them. |
| **Motion**: gpt-taste forbids static interfaces and mandates GSAP | The dials win. At MOTION_INTENSITY 6 or below, build with design-taste-frontend even on a GPT model. |
| **Image eagerness**: image-to-code wants to generate images for every visual task | Page or site work only, and only with image generation available. Micro and section tasks never generate images. |
| **Stack**: the core skills default to Next.js / React + Tailwind + Motion or GSAP | Only for greenfield work with no stack chosen. The existing stack always wins; check `package.json` first (design-taste-frontend §3.F). |
| **Icons**: Lucide discouraged by design-taste-frontend, minimalist-ui and high-end-visual-design | An existing project dependency wins. New projects: Phosphor. One family per project. |
| **Imagery**: design-taste-frontend says "image-generation tool first" | Only if image generation is available (§0). Otherwise use Picsum seeds or labelled placeholder slots, and list them in the report. Never div-built fake screenshots. |
| **Proprietary brand fonts** in design-md-library files | Substitute per design-md-library's typeface table. Never ship an unlicensed font. |
| **Em-dash ban** (design-taste-frontend §9.G) | Applies to rendered page copy: headings, body, buttons, alt text, meta. Not to code, comments or docs. |
| **Dashboards**: design-taste-frontend excludes them; stitch-design-taste has dashboard font rules | Use the project's or an official design system (§2.A). Take stitch-design-taste's dashboard typography only if no system dictates it. |
| **Browser tools overlap** | agent-browser by default; playwright-cli only for the cases listed in step 3. |

## 4 · Neighbouring skills

- **[frontend](../frontend/SKILL.md)** (same kit): UI engineering (state, data
  fetching, performance, tests). Use it alongside this workflow; this workflow
  owns the visual direction.
- **[design-system](../design-system/SKILL.md)** (same kit): implementing tokens,
  theming and component APIs. The `DESIGN.md` from step 1 is its input.
- **Other design databases** (for example ui-ux-pro-max): lookups for palettes,
  font pairings and chart types, at precedence level 6. Do not run their full
  workflows in parallel with this one.

## 5 · Setup this workflow assumes

- `agent-browser` on PATH: `npm i -g agent-browser && agent-browser install`
- `playwright-cli` on PATH: `npm i -g @playwright/cli@latest`, then
  `playwright-cli install-browser webkit` (likewise `firefox`, `chromium`).
- Web access to raw.githubusercontent.com (web-design-guidelines).

If a tool is missing, say so in the report and do the rest. Do not silently skip
verification.
