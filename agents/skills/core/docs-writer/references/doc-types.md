# Document types: the four kinds and their rules

Every documentation page serves one of four reader needs. The needs differ on two axes: is the reader learning or working, and do they need steps or knowledge?

| | Serves study | Serves work |
|---|---|---|
| **Action (steps)** | Tutorial | How-to guide |
| **Knowledge (facts)** | Explanation | Reference |

Pick the type before writing a word. The reader's question tells you which:

- "I'm new, show me" -> tutorial
- "How do I do X?" -> how-to
- "What are the options for Y?" -> reference
- "Why does it work this way?" -> explanation

## Tutorial (learning-oriented)

A lesson. The reader is on rails toward a destination you chose, and you are responsible for them arriving. A quickstart is a tutorial.

Rules:
- One path, no branches. Choices belong in how-tos. Don't offer alternatives ("you could also use Docker") - pick one and go.
- Start from a stated, minimal baseline ("a machine with Python 3.11") and never assume anything past it without saying so.
- Every step shows the command and the expected result, so the reader can confirm they're on track. Anticipate the most common failure at fragile steps and say what it looks like.
- Explain almost nothing. One clause of why ("we use HTTPS here because the API rejects plain HTTP") and a link to the explanation page. Teaching theory mid-tutorial is the most common way tutorials die.
- It must work, start to finish, exactly as written, on a clean environment. Walk through it yourself before shipping it.
- End at a real success state, then point to the how-tos for next steps.

## How-to guide (goal-oriented)

A recipe for a reader who knows the basics and has a specific job: "deploy behind nginx", "add a custom output format", "migrate from v1". Mine issue trackers and discussions for the real list; the questions people actually ask are the how-tos worth writing.

Rules:
- Title names the goal ("Configure TLS termination"), not the feature ("TLS options" - that's reference).
- State prerequisites up front in one or two lines, with links. Then assume them; no teaching.
- Numbered steps, each one action. Sub-steps are a sign the step should split or the guide should narrow.
- Cover the realistic variations of the goal briefly (a note or a short branch), not every theoretical one.
- It's fine for a how-to to be short. Five steps that work beat twenty that hedge.

## Reference (information-oriented)

A map. Consulted while working, never read through. CLI flags, configuration keys, API endpoints, environment variables, error codes.

Rules:
- Structure mirrors the code's structure, so a reader who knows the code can predict where things are.
- Uniform format per entry. For an API: signature, parameters with types and defaults, return value, errors raised, one minimal example. For config: key, type, default, effect. Pick the schema once and never deviate; consistency is what makes reference scannable.
- Austere and neutral. No persuasion, no usage advice beyond a single example - guidance lives in how-tos, linked.
- Complete within its declared scope. A reference that covers 80% of the flags makes readers distrust the other entries too.
- Generate from code (docstrings, `--help` output, OpenAPI) wherever the toolchain allows, so it can't drift. Hand-written reference is the first thing to go stale.

## Explanation (understanding-oriented)

Background read away from the keyboard: architecture, design rationale, trade-offs, how the pieces relate, why the obvious alternative wasn't used.

Rules:
- No instructions, no steps. The reader isn't doing anything.
- This is the one place opinions and context belong: constraints, history, rejected alternatives, known weaknesses. Maintainer judgment is the content.
- A diagram (Mermaid or a committed image) plus prose beats prose alone for any architecture topic.
- Scope each page to one question ("Why a single binary?", "How sync resolves conflicts"). "Architecture" as one giant page is usually three explanation pages wearing a trenchcoat.

## Mixing failures to catch in audits

- Tutorial that detours into option tables -> move tables to reference, link.
- How-to that opens with three paragraphs of concept -> one prerequisite line plus a link to the explanation.
- Reference entries with paragraphs of advice -> extract to a how-to.
- Explanation with numbered setup steps -> it's actually a tutorial or how-to; retype it.
- A page that answers no reader question at all (changelog prose, team history, aspirations) -> usually belongs outside docs or nowhere.

## Layout

When a project has no docs structure yet, default to directories named for the types readers experience, not the theory:

```text
docs/
  getting-started.md        (tutorial)
  guides/                   (how-tos, one goal per file)
  reference/                (cli.md, configuration.md, api/)
  concepts/  or  architecture/   (explanations)
```

Match an existing structure when there is one. Navigation order follows the reader's journey: getting started first, guides next, reference and concepts last.
