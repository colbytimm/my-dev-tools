---
name: docs-writer
description: Write, update, or audit project documentation (docs/ folders, guides, tutorials, how-tos, API references, architecture docs) that matches the quality of the best open source documentation and reads like a maintainer wrote it, not an AI. Use this skill whenever the user asks to document a project, write docs, create a getting-started guide or tutorial, document an API, explain how something works, fix stale docs, or check documentation quality - even if they just say "this needs docs" or "the docs are out of date". For the repo front page specifically, use the readme-writer skill; this skill covers everything past the front door.
license: MIT
---

# Docs Writer

Documentation fails in two ways this skill prevents: pages that mix purposes (a tutorial that detours into reference tables, a how-to that stops to teach theory), and prose that reads generated. The fix for the first is picking exactly one document type per page and writing to its rules. The fix for the second is the voice guide.

Read `references/doc-types.md` before planning any page - it defines the four types and their rules. Read `references/voice.md` before writing prose. Both are required, not optional context.

## Three modes

Figure out which one the user needs:

- **Create**: new docs for an undocumented or under-documented project.
- **Update**: bring existing docs in line with the code. The most common real-world case.
- **Audit**: report on gaps, staleness, and quality without writing yet. Offer this when the user says "are my docs any good" or before a large update so the user can choose scope.

## Workflow

### 1. Inventory what exists

Before writing, map the territory:

- List everything under `docs/`, plus README, CONTRIBUTING, wiki exports, doc comments, and any docs site config (`mkdocs.yml`, `docusaurus.config.js`, `conf.py`, `astro.config.mjs`). Match the existing toolchain and format; don't introduce a new one unless asked.
- Classify each existing page by document type (tutorial, how-to, reference, explanation). Pages that are none of them, or several at once, are the first candidates for rework.
- Diff docs against code: do documented commands, flags, endpoints, config keys, and file paths still exist? Stale docs are worse than missing docs because readers trust them.

### 2. Decide what to write, with the user

Don't generate a docs site wholesale. Propose a short plan: which pages, what type each one is, and what each covers in one line. Get agreement before writing. Most projects need, in priority order:

1. A getting-started tutorial (one path, ends in working software)
2. How-to guides for the 3-6 tasks users actually hit (mine the issue tracker and discussions for what people ask)
3. Reference for whatever users look up while working (CLI flags, config, API)
4. One explanation page only if the design genuinely needs it (architecture, security model, "why X works this way")

Small projects may need only items 1 and 3. Don't pad a 500-line tool with an eight-page docs site.

### 3. Write each page as exactly one type

Apply the per-type rules in `references/doc-types.md`. The discipline that matters most: when material belonging to another type comes up, link to it instead of inlining it. A tutorial that needs a concept explained gets one sentence and a link to the explanation page.

### 4. Code examples are the product

The best documentation in open source treats examples as tested artifacts, not illustrations:

- Every example must be complete enough to run as shown, against the current version of the code. Verify by reading the actual signatures/flags, or by running it when the environment allows.
- Show real output. A reader should be able to confirm they're on track at each step.
- Prefer one realistic example over three toy ones.
- When code changes would break an example, that's the page the update mode rewrites first.

### 5. Voice pass

Run the de-AI checklist in `references/voice.md` over every page. Documentation-specific additions on top of the shared rules: second person ("you"), present tense ("the command prints", not "will print"), active voice, and no condescension words ("simply", "just", "obviously", "easy").

### 6. Lint

One command runs everything (file or directory):

```sh
node scripts/lint_voice.mjs docs/
```

It orchestrates three passes. Mechanics: markdownlint-cli2, using the repo's own `.markdownlint*` config when one exists (never override a maintainer's rules) and the bundled `assets/markdownlint.json` otherwise. Voice: markdownlint-cli2 with `assets/voice.markdownlint-cli2.jsonc`, where banned vocabulary, emoji policy, em dashes, summary openers, condescension words, future-tense steps, and dead-link checks live as standard markdownlint custom rules. All checks, including the stateful term-bullet and rule-of-threes ones, are markdownlint rules (the stateful pair live in `assets/stateful-rules.cjs`). Fix all errors; warnings are fix-by-default. `--strict` fails on warnings for CI; `--voice-only` skips mechanics when the repo's CI already runs markdownlint.

The voice config is plain markdownlint configuration, so a repo can adopt it in CI without this script: commit the jsonc plus `stateful-rules.cjs`, and add `markdownlint-rule-search-replace` and `markdownlint-rule-relative-links` as devDependencies. Offer that only if the user wants it. If Node/npx is unavailable, skip the script and cover markdownlint's core concerns by hand.

### 7. Reader test

Before declaring done, test each page against its purpose with fresh eyes (a subagent with no conversation context where available, otherwise self-simulate strictly from the page text alone):

- Tutorial: can a newcomer reach the end state using only the page? Note every point where required knowledge is assumed.
- How-to: does following the steps accomplish the goal? Are prerequisites stated?
- Reference: can you answer 5 realistic lookup questions from it?
- Explanation: could a reader now justify the design decision to someone else?

Fix what the test surfaces, then stop. Don't iterate past the point of real improvement.

## Update mode specifics

- Preserve the existing voice, structure, and toolchain. Produce the diff the maintainer would have written.
- Fix correctness first (stale commands, renamed APIs, dead links), structure second (mixed-type pages), polish last.
- When renaming or moving pages, search the repo for links to the old paths and anchors, and update nav config.
- Never delete content silently; list removals in the summary so the maintainer can veto.

## Output

Write pages into the project's existing docs location, matching its format. Summarize: pages created/changed, type assigned to each, anything removed, and remaining `<!-- TODO -->` markers that need maintainer input (screenshots, version numbers, decisions only they can make).
