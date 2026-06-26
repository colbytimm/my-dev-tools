---
name: agents-md-writer
description: "Author or improve an AGENTS.md file — the open-standard Markdown config that guides AI coding agents (Codex, Copilot, Cursor, Claude Code, Aider, etc.) in a repo. Use whenever the user wants to create, write, review, trim, or fix an AGENTS.md (or CLAUDE.md/AGENT.md), set up agent instructions for a project or monorepo package, or asks why their existing agent file isn't helping. The discipline is token efficiency: every line must earn its place, because a bloated file measurably degrades agent output — worse than no file at all."
license: MIT
---

# Authoring AGENTS.md

A README for agents: a predictable file agents auto-load to learn how to build, test, and follow conventions. Plain Markdown, no required schema. The dominant failure mode is **too much context**, not too little — optimize for signal per token.

## Rules

- **Compose each line deliberately; don't ship `/init` output.** A generator can be a starting point, but draft and trim it yourself — generated files restate what the agent could find by reading the code, then pad with rules that don't apply to this repo.
- **Cut anything the agent could discover or already knows.** Drop what's greppable in the repo (package manager, folder layout) and what a competent model does by default — "write clean code", "use descriptive names", "follow best practices", "handle errors properly".
- **Target ~100–150 lines** for a module file (shorter for a small root). Past that, agent performance drops.
- **Pair every "don't" with a "do".** Bare prohibitions push the agent into cautious over-exploration; ~15+ unpaired "don'ts" measurably reduce work completed. Write `Don't instantiate HTTP clients directly → use the shared apiClient from lib/http`.
- **Progressive disclosure.** Keep common cases inline; push depth into reference files, naming *what* each contains so the agent loads it only when needed. Cap references at ~15.
- **Prefer module-scoped files over one big root file.** Agents read the nearest AGENTS.md and the closest wins; the root holds only genuinely global rules.

## What helps, by leverage

- **Setup/build/test commands** — highest value. List exact commands; agents run listed test/lint commands and fix failures before finishing. Nearly every file needs this.
- **Procedural workflows** — a numbered checklist for multi-step tasks (wiring a new feature) can take an agent from *can't finish* to *first-try correct*.
- **Decision tables** when 2–3 valid approaches exist — the most direct lever on convention adherence:

  | Question | → React Query | → Zustand |
  |---|---|---|
  | Server is the only data source? | ✓ | |
  | Multiple paths mutate this state? | | ✓ |

- **Real code snippets, 3–10 lines, copied from the codebase** — stops the agent inventing its own pattern. A few, non-duplicative.
- **Specific, enforceable gotchas** — `Use Decimal, never float, for money.` Loses value stacked into dozens.

## What backfires

- **Architecture tours.** A full topology with rationale pulls the agent into reading docs before a small change. Describe boundaries and *what*, not *why*; keep it short.
- **Documenting patterns that don't exist yet.** For net-new architecture the file steers toward the old pattern — use spec-driven development instead.
- **A lean file drowning in doc sprawl.** Agents grep too (~half of doc reads bypass AGENTS.md). 150 tight lines won't save the agent from 500K of surrounding specs — audit the environment, not just the file.

## Conventional headings

Use what fits, omit the rest: Project overview (1–3 sentences) · Setup commands · Testing · Code style/conventions (project-specific only) · Decision tables · PR/commit instructions · References. Claude Code reads `CLAUDE.md`; `ln -s AGENTS.md CLAUDE.md` keeps tools in parity.

## Workflow

1. Inspect the repo (build files, test config, layout). Pull *real* commands and snippets, don't invent them.
2. Draft the smallest file covering commands plus genuinely project-specific conventions and gotchas.
3. Apply the Rules as a checklist; cut generic advice.
4. If depth is needed, add reference files and point to them — don't inline.
5. Validate: `python scripts/validate_agents_md.py <path>` checks the countable rules (line count, references, snippet length, commands present). Fix FAILs, weigh WARNs. Then judge the rest yourself — filler, don't/do pairing, architecture tours — since those need reading, not counting. Report line count and any borderline keeps.

## Validator

`scripts/validate_agents_md.py` checks only what a script counts reliably — line count, local-reference count, longest code block, and whether a commands section exists — and exits non-zero on FAIL (CI-gateable). It deliberately does *not* judge content quality (filler, don't/do pairing, architecture tours); those need reading, and a regex guessing at them gives false confidence, so they stay the author's call. Flags: `--json`, `--strict` (WARN fails too), `--max-lines N`.
