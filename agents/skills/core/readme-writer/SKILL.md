---
name: readme-writer
description: Create or update README.md files that match the quality of the best open source projects and read like a maintainer wrote them, not an AI. Use this skill whenever the user asks to write, generate, improve, rewrite, review, or update a README, project documentation landing page, or repo front page - even if they just say "document this project", "make this repo presentable", or "my README sucks". Also use it to audit an existing README for AI-sounding writing.
license: MIT
---

# README Writer

Write READMEs the way the best maintainers do: lead with what the thing is, get the reader running it fast, show real output, and stop. The two failure modes this skill exists to prevent are (1) structurally weak READMEs that bury the quick start, and (2) READMEs that are structurally fine but *sound generated* - emoji-studded headers, marketing adjectives, hollow feature bullets. Both make readers trust the project less.

Read `references/voice.md` before writing any prose. It defines what "sounds AI" means and is non-negotiable. Read `references/sections.md` when deciding which sections to include and how to write each one.

## Workflow

### 1. Understand the project before writing a word

A README written from the file tree alone will be generic. Gather real facts:

- Read the manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `.csproj`, etc.) for the actual name, description, version, license, and dependencies.
- Read the entry point and main modules enough to describe what the project actually does and how it's invoked.
- Read existing docs: current README, `CONTRIBUTING.md`, `docs/`, `CHANGELOG.md`, comments in config files. Don't duplicate them; link to them.
- Detect a docs presence specifically: a `docs/` folder, a docs-site config (`mkdocs.yml`, `docusaurus.config.js`, `conf.py`, `astro.config.mjs`), or a documentation URL in the manifest (`homepage`, `documentation` fields). When docs exist, the README must link to them - prominently near the top (a "Documentation" link beside the badges or in the first paragraph), and again from any section the docs cover in more depth (Usage links to the relevant guide, Configuration links to the reference). A repo with docs that the README never mentions is a structural bug; fix it in both create and update mode.
- Run `--help` or look at CLI/arg definitions to get real commands and flags.
- Note the install path that actually works (is it published to npm/PyPI/crates.io, or clone-and-build only?). Never invent a `pip install x` for an unpublished package.

Every command, flag, file path, and code sample in the README must be verifiable from the repo. If something can't be verified (e.g., a registry name, a badge URL, a screenshot), insert a clearly marked `<!-- TODO: ... -->` comment rather than guessing.

### 2. Identify the audience and pick a structure

A README serves three readers in order: someone deciding whether to use this, someone trying to run it, and someone wanting to contribute. Structure for that order (inverted pyramid - most people only read the top).

Default skeleton, adapted per project (see `references/sections.md` for when to cut or add):

1. Title + one-line description of what it does and who it's for
2. A small set of meaningful badges (CI, version, license) - only ones backed by real infrastructure
3. Demo: screenshot, GIF, or a short code/terminal example showing real input and output
4. Quick start: the shortest honest path from zero to working
5. Usage: the 2-4 most common tasks, with real examples
6. Configuration / API reference (or a link to fuller docs)
7. How it works / architecture, only if the design is the point
8. Pointers: contributing, license (one line each, linking to dedicated files)

Do NOT write full License, Contributing, Changelog, or Code of Conduct sections in the README. Those live in dedicated files; the README links to them.

### 3. Updating an existing README

When updating rather than creating:

- Preserve the maintainer's voice, section order, and formatting conventions unless they're the problem. The goal is a diff the maintainer would have written, not a rewrite.
- Fix what's stale first: dead commands, renamed flags, removed features, broken links. Verify against the code.
- Add missing high-value sections (usually quick start or usage examples) before polishing anything cosmetic.
- If the existing README has AI-smell patterns (see `references/voice.md`), strip them as part of the edit, but don't churn lines that are already fine.
- Anchors matter: if you rename a header, check the repo and docs for links to the old anchor.

### 4. Write, then run the de-AI pass

Write the draft following `references/voice.md`. Then do a dedicated revision pass with the checklist at the bottom of that file. This pass is mandatory and catches things the drafting pass misses, because the patterns are habits, not choices.

### 5. Final mechanical checks

One command runs everything:

```sh
node scripts/lint_voice.mjs README.md
```

It orchestrates three passes. Mechanics: markdownlint-cli2, using the repo's own `.markdownlint*` config when one exists (never override a maintainer's rules) and the bundled `assets/markdownlint.json` otherwise. Voice: markdownlint-cli2 again with `assets/voice.markdownlint-cli2.jsonc`, where the banned vocabulary, emoji policy, em dashes, summary openers, and dead-link checks live as standard markdownlint custom rules. All checks, including the stateful term-bullet and rule-of-threes ones, are markdownlint rules (the stateful pair live in `assets/stateful-rules.cjs`). Fix all errors; treat warnings (soft words, condescension, negative parallelism) as fix-by-default with override only for a reason. `--strict` fails on warnings; `--voice-only` skips mechanics when the repo's CI already runs markdownlint.

The voice config is plain markdownlint configuration, so a repo can adopt it directly in CI without this script: commit the jsonc plus `stateful-rules.cjs`, and add `markdownlint-rule-search-replace` and `markdownlint-rule-relative-links` as devDependencies. Offer that only if the user wants it. If Node/npx is unavailable, skip the script and cover markdownlint's core concerns by hand (heading increments, fence language tags, one h1).

Then verify what no linter can:

- Commands actually run in order (a fresh reader executes top to bottom).
- GFM only. Use GitHub admonitions (`> [!NOTE]`, `> [!WARNING]`) sparingly - one or two per README, where the reader would otherwise get burned.
- Table of contents only if the README exceeds roughly 4-5 screens; GitHub auto-generates an outline from headers, so a manual ToC must earn its place.

## Emoji policy (short version)

Emojis are allowed only when they carry meaning a word would otherwise carry: status indicators in a table (yes/no, supported/unsupported), warning markers, a legend the README defines. Emojis are never decoration: no emoji in headers, no rocket/sparkle bullets, no emoji-prefixed feature lists. One decorated header makes the whole document read as generated. When unsure, leave it out.

## Output

Write the result to `README.md` at the repo root (or the path the user specifies). For updates, make targeted edits rather than regenerating the whole file. Summarize what changed and list any `TODO` markers that need the maintainer's input.
