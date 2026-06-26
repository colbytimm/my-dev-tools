# Sections: what to include and how to write each

Adapt to the project; a 200-line CLI does not need the structure of a framework.

## Title and tagline

Project name as `#` header (or a logo image if one exists in the repo - never generate or invent one). Directly under it, one sentence: what it does, stated as a capability, not a mission. Optionally a second sentence for who it's for or what makes it different, as a fact.

Good: "A general-purpose command-line fuzzy finder."
Bad: "Empowering developers to find anything, effortlessly."

## Badges

Two to five, on one line, immediately under the tagline. Only badges backed by something real: CI status (workflow exists), package version (actually published), license (file exists), coverage (actually measured). A wall of badges, or badges for things like "PRs welcome", is noise. If unsure whether infrastructure exists, add a `<!-- TODO -->` instead of a possibly-dead badge URL.

## Demo

The highest-value real estate. Pick whichever the project supports:

- CLI tool: a fenced terminal block with a real command and its real (possibly truncated) output.
- Library: the shortest complete code sample that does something useful, with the result shown in a comment.
- UI project: reference a screenshot/GIF that exists in the repo; otherwise `<!-- TODO: add screenshot -->`.

A reader should understand the project from the demo alone.

## Quick start

The shortest honest path from nothing to working. Rules:

- One install path here (the recommended one); alternatives go in an Installation section or docs link.
- Commands must work in sequence on a clean machine. Include prerequisite versions only when they actually bite (e.g., "Node 20+", because the code uses `--experimental` flags).
- If setup requires secrets/config, show a minimal real example file, not a description of one.
- Stop at the first success moment (server responds, command prints output). Everything after that is Usage.

## Usage

The 2-4 tasks most users actually came for, each with a runnable example. Order by frequency of need, not by code structure. Link out to full docs for the long tail rather than enumerating every flag. If the project has a `--help` worth showing, a trimmed version of its real output beats hand-written option tables that will drift.

## Configuration

Table or list of the options people actually change, with defaults and one-line effects. Full reference belongs in docs. Show one realistic config file rather than describing fields abstractly.

## How it works / Architecture

Include only when the design is part of the value (a sync engine, a clever algorithm, a security model) or when contributors need a mental model. A short prose explanation plus one diagram (Mermaid, or an image checked into the repo) beats prose alone. Skip this section for straightforward apps - explaining a CRUD app's architecture is padding.

## Limitations / Non-goals

Strongly encouraged when real ones exist; this is the section that makes maintainers sound human and saves users time. State them flatly: "Does not support Windows.", "Not safe for concurrent writers.", "If you need X, use [other tool]." Never write this section as a roadmap apology.

## Pointers (bottom of file)

- Documentation: when the repo has a `docs/` folder or docs site, link it near the top of the README (beside the badges or in the opening paragraph), not only at the bottom. Use the deployed site URL when one exists; fall back to the relative `docs/` path otherwise. Deep-link specific pages from the sections they extend (Usage -> the relevant guide, Configuration -> the reference page).
- Contributing: one line linking to `CONTRIBUTING.md` (or "Issues and PRs welcome" if no file exists - and suggest creating one only if the user asks).
- License: one line, e.g. "MIT - see [LICENSE](LICENSE)." Match the actual license file; if none exists, flag it as a TODO rather than asserting a license.
- Acknowledgments/credits only when there's a real upstream project or prior art to credit.

## Sections to leave out

- Full license text, contribution guidelines, changelogs, codes of conduct (dedicated files).
- "Project structure" file trees, unless the project is a template/scaffold where the tree is the product.
- Roadmaps, unless the maintainer supplies one. Don't invent future plans.
- "Built with" logo walls. The manifest already says this; mention the stack in one sentence only if a user would choose the tool because of it.
- FAQ, unless migrating real questions from issues. Don't invent questions.

## Length calibration

- Small utility / script: 30-80 lines. Title, demo, quick start, usage, license line.
- Typical library or CLI: 100-250 lines.
- Framework / platform with external docs site: keep the README a front door (under ~300 lines) and push depth to the docs site.

When updating, respect the existing length class; don't triple a README's size because sections "could" be added.
