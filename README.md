# my-dev-tools

## Agents

Tooling for AI coding agents.

### Skills

Portable [agent skills](https://agentskills.io). Each is a self-contained folder with a `SKILL.md` and supporting scripts that an agent can discover and run.

Skills live under `agents/skills/` in four folders, grouped by what the skill is for:

| Folder | Purpose | Examples |
| --- | --- | --- |
| `core` | Generate a standard artifact | `readme-writer`, `agents-md-writer`, `docs-writer`, `d2-diagram` |
| `flow` | Run a multi-step workflow | spec-driven dev, release process, agent-spawn orchestration |
| `env` | Configure or extend the harness/environment | `statusline` |
| `domain` | Encode project- or stack-specific knowledge | `cosmosdb-datamodeling`, `cosmosdb-inspect` |

The folder is purely organizational. Skills are installed by name (below), so the path doesn't appear in install commands.

#### Installing

Install any skill with the [`gh skill`](https://cli.github.com/manual/gh_skill) command. Requires [GitHub CLI](https://cli.github.com) 2.90.0 or later (`gh skill` is in public preview).

Preview a skill before installing it:

```sh
gh skill preview colbytimm/my-dev-tools d2-diagram
```

##### GitHub Copilot, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, Warp, Antigravity

At project scope these agents all read the shared `.agents/skills/` directory, so a single install covers all of them for the current repo:

```sh
# Project scope (this repo only) - installs to .agents/skills/
gh skill install colbytimm/my-dev-tools d2-diagram --agent github-copilot --scope project

# User scope (all repos, Copilot) - installs to ~/.copilot/skills/
gh skill install colbytimm/my-dev-tools d2-diagram --agent github-copilot --scope user
```

User-scope directories are per-agent. For a non-Copilot agent at user scope, pass its own `--agent` slug; running `gh skill install colbytimm/my-dev-tools` with no skill name opens an interactive picker that lists every supported agent.

##### Claude Code

Claude Code reads its own directories (`.claude/skills/` at project scope, `~/.claude/skills/` at user scope):

```sh
# Project scope (this repo only)
gh skill install colbytimm/my-dev-tools d2-diagram --agent claude-code --scope project

# User scope (all repos)
gh skill install colbytimm/my-dev-tools d2-diagram --agent claude-code --scope user
```

##### Pinning a version

Unpinned installs resolve to the latest tagged release, falling back to the default branch when no release exists (this repo has no tagged release yet). Pin to a git tag or commit SHA to stay put:

```sh
gh skill install colbytimm/my-dev-tools d2-diagram --pin <tag-or-commit-sha>
```

Pinned skills are skipped by `gh skill update`. To check for upstream changes across everything installed:

```sh
gh skill update --dry-run
```

#### core

Generate a standard artifact.

##### [readme-writer](agents/skills/core/readme-writer/SKILL.md)

Create or update README files that read like a maintainer wrote them. Encodes the structure of strong READMEs (lead with what it is, quick start early, demo with real output) plus a catalog of generated-sounding patterns to strip: marketing adjectives, AI vocabulary, emoji headers, rule-of-threes padding. Ships `lint_voice.mjs`, which runs markdownlint for mechanics and a set of custom markdownlint rules for voice (banned vocabulary, em dashes, summary openers, dead relative links).

##### [docs-writer](agents/skills/core/docs-writer/SKILL.md)

Write, update, or audit project documentation past the front page: tutorials, how-to guides, references, and explanation pages, each page written as exactly one of those four types. Inventories existing docs, diffs them against the code to catch stale commands and dead links, and proposes a page plan before writing. Adds docs-specific voice checks on top of the shared rules: condescension words, future-tense steps, second person.

##### [agents-md-writer](agents/skills/core/agents-md-writer/SKILL.md)

Author or improve an `AGENTS.md` file (also `CLAUDE.md`/`AGENT.md`), the Markdown config that tells coding agents how to build, test, and follow conventions in a repo. Optimizes for signal per token, since a bloated file measurably degrades agent output, and trims generated `/init`-style boilerplate that restates what the agent could read from the code.

**Used together**: `readme-writer` owns the repo front page; `docs-writer` covers everything past it; `agents-md-writer` writes the file agents read instead of the README. The two doc skills ship the same voice lint config (plain markdownlint rules), so a repo can adopt one setup in CI for all its markdown.

##### [d2-diagram](agents/skills/core/d2-diagram/SKILL.md)

Author software- and cloud-architecture diagrams as code with [d2](https://d2lang.com), render them to SVG/PNG/PDF, and embed them into markdown. Ships a lookup for the correct AWS/GCP/Azure service icons (whose hosted URLs are URL-encoded and impossible to guess), shared style/theme presets, and a renderer that degrades gracefully when raster export or the icon host is unavailable, falling back to SVG, or to remote icon references, instead of failing. Pure-stdlib scripts; requires the `d2` CLI.

| Cloud architecture (with provider icons) | Software architecture |
| --- | --- |
| ![Azure cloud architecture diagram with service icons, a VNet and subnet boxes, and titled header pills](docs/images/d2-cloud-architecture.png) | ![Three-tier software architecture diagram with titled tier boxes, a SQL table, and header pills](docs/images/d2-software-architecture.png) |

##### [image-compose](agents/skills/core/image-compose/SKILL.md)

Combine multiple images (e.g. web screenshots) into a side-by-side, stacked, or grid layout for visual comparison. Adds optional per-panel title bars and emits a JSON manifest of panel positions for downstream annotation.

| Side-by-side with labels | Grid layout |
| --- | --- |
| ![Two screenshots composed side by side with title bars](docs/images/compose-sidebyside.png) | ![Four screenshots in a 2x2 grid with title bars](docs/images/compose-grid.png) |

##### [image-annotate](agents/skills/core/image-annotate/SKILL.md)

Draw annotations on an image (boxes, ellipses, arrows, labeled connectors, callout bubbles, text, highlights, and blur/blackout redaction) from a JSON spec. Coordinates can be absolute or panel-relative via an image-compose manifest, and a `--caption` bar keeps page/source labels off the content.

![A screenshot marked up with a highlight, a box, a blurred redaction, a callout, and a caption bar](docs/images/annotate-profile.png)

**Used together**: `image-compose` lays out a comparison and emits a manifest; `image-annotate` reads that manifest to draw on each panel with `"panel": N`, so coordinates measured in the original screenshots map straight through. Here two calculations are composed, then boxed and connected to show which values match and which differ.

![Two calculations composed side by side, with green boxes and a "match" connector on equal values and red boxes with a "differs" connector on the divergent rows](docs/images/compose-annotate-comparison.png)

#### flow

Run a multi-step workflow. _No skills yet._

#### env

Configure or extend the harness/environment.

##### [statusline](agents/skills/env/statusline/SKILL.md)

Install and configure a Powerlevel10k-styled status line for coding agents that support a command-backed statusline (Claude Code and GitHub Copilot CLI). Ships a portable Node renderer (`statusline.js`, no `jq`/`bc`) that reads the host agent's session JSON on stdin and prints a powerline bar: agent + model, git branch, context-window usage, a fill gauge, elapsed time, and line changes. Works the same on macOS, Linux, and Windows; auto-detects the agent and falls back to a generic adapter. Codex CLI and Gemini CLI render their status lines internally and can't be driven by it.

#### domain

Encode project- or stack-specific knowledge.

##### [cosmosdb-datamodeling](agents/skills/domain/cosmosdb-datamodeling/SKILL.md)

An interactive, requirements-driven workflow for designing an Azure Cosmos DB for NoSQL data model. It captures access patterns, decides embed-vs-reference and partition keys, applies scaling patterns (hierarchical/synthetic keys, write sharding, data binning, TTL), and produces two artifacts (a requirements scratchpad and a final data model) grounded in current Microsoft Learn guidance. Ships stdlib-only helper scripts for RU/cost estimation and for linting a model against documented service limits.

##### [cosmosdb-inspect](agents/skills/domain/cosmosdb-inspect/SKILL.md)

Inspect a live Azure Cosmos DB for NoSQL account (read-only, via the Azure CLI) and emit an "observed model" plus optimization signals. It collects container configuration (partition keys, indexing, TTL, throughput) and Azure Monitor metrics (normalized RU consumption for hot-partition detection, 429 throttling, storage, document count), writing JSON in the same shape `cosmosdb-datamodeling` consumes. Requires `az` and `az login`; pure transform logic is unit-tested offline.

**Used together**: `cosmosdb-inspect` reverse-engineers a live account into an observed model and surfaces runtime signals (hot partitions, throttling, over-provisioning); `cosmosdb-datamodeling` lints that model against service limits, costs it, and drives a redesign. The two move you from "what does my account look like and where does it hurt" to "design and cost the fix."

## License

MIT - see [LICENSE](LICENSE).
