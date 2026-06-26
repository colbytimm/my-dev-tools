# Voice: writing that doesn't sound generated

"Sounds AI" is not a vibe; it's a catalog of specific, recognizable patterns that readers have internalized. Documentation that triggers them costs the project credibility before the reader evaluates the content. This file defines the patterns and how to write instead.

## Documentation-specific rules (apply first)

- **Second person, present tense, active voice.** "You configure the timeout in `config.toml`. The server reloads it on SIGHUP." Not "the timeout can be configured" or "the server will reload".
- **No condescension words**: simply, just, easily, obviously, of course, straightforward. If it were simple the reader wouldn't be on this page; when the step is genuinely hard, say so and say why.
- **One idea per sentence in procedures.** A numbered step is one action. Conditions come before the action they govern ("If you use Docker, skip to step 4"), never after the reader has already done the wrong thing.
- **Define a term once, link after.** Don't re-explain a concept on every page; that's a sign the concept needs its own explanation page.
- **Consistent terminology.** Pick one name per thing (config file vs settings file vs configuration) and use it everywhere, even when repetition feels awkward. Synonym variation reads as polish in essays and as ambiguity in docs.

The underlying principle: the best documentation is written by someone who built the thing, knows exactly what it does, and respects the reader's time. Generated-sounding text fails on all three - it praises instead of describes, decorates instead of informs, and pads instead of stopping.

## Banned patterns

### 1. Marketing adjectives in place of facts

Never describe the project as: blazingly fast, powerful, robust, seamless, comprehensive, cutting-edge, state-of-the-art, elegant, intuitive, lightweight (unless you give the number), production-ready, enterprise-grade, next-generation, game-changing, supercharged.

These words make claims the reader can't check and signal that the author couldn't either. Replace each with the fact that would justify it:

- Bad: "A blazingly fast JSON parser"
- Good: "Parses 2 GB/s on an M1 (benchmarks below)"
- Bad: "Robust error handling"
- Good: "Retries failed uploads with exponential backoff and resumes from the last acknowledged chunk"

If no concrete fact backs the adjective, the claim doesn't belong in the docs.

### 2. AI vocabulary

Avoid the words that LLMs reach for and humans now flinch at: delve, leverage (as a verb), utilize, streamline, empower, foster, enhance, elevate, harness, unlock, effortless, journey, landscape, ecosystem (for anything that isn't literally one), pivotal, crucial, vital, testament, tapestry, intricate, holistic, robust, seamlessly, "plays a significant role". Plain replacements: use, build, run, lets you, handles.

### 3. Negative parallelism and false ranges

- "It's not just a linter - it's a code quality platform." Cut the construction; say what it is.
- "From small scripts to large enterprise systems" - a fake spectrum implying comprehensiveness. Name the actual supported cases instead.

### 4. Rule-of-threes padding

LLMs default to triplets: "fast, flexible, and reliable", three bullets per section, three adjectives per noun. When every list has exactly three items, it reads as generated. List exactly as many items as exist - two, five, one.

### 5. Formatting overkill

- No emoji in headers. No 🚀 ✨ 🔥 anywhere. Narrow exception: semantic markers like ✅/❌ in a support matrix the page defines.
- No bolding key terms mid-sentence like a textbook.
- Avoid the "**Term:** definition" bullet wall. If every feature bullet is a bolded name plus a colon plus a clause restating the name ("**Fast Processing:** processes files quickly"), delete the section and write three sentences that say something.
- Don't reach for a list when a sentence works. Lists are for steps and reference material, not prose.
- Avoid em dashes for punchy emphasis. Use commas, parentheses, or a period. (Use a hyphen or restructure; never substitute an em dash just to vary punctuation.)

### 6. Compulsive summarizing and filler transitions

No "In conclusion", "Overall", "In summary", "To summarize". A docs section ends when the information ends. Also cut throat-clearing openers: "In today's fast-paced development world...", "Whether you're a beginner or an expert...". Start with the thing.

### 7. Importance inflation

Don't tell the reader the project matters ("an essential tool for modern development workflows", "a pivotal part of any CI pipeline"). Show what it does; the reader decides if it matters.

### 8. Uniform rhythm

Generated prose has same-length sentences and same-size paragraphs throughout. Vary it. A two-word sentence is fine. So is a long one that walks through a gnarly configuration scenario step by step because that's what the scenario needs.

### 9. Hedging and symmetric caveats

"While X has many benefits, it also has drawbacks." A maintainer states their actual position: "Use X unless you need streaming; then use Y." Commit to recommendations. Real docs have opinions.

## What good sounds like

Study how established projects write. Common traits across the best:

- First sentence says what it is in plain words: "a line-oriented search tool that recursively searches the current directory for a regex pattern."
- Claims come with receipts: benchmark tables, version numbers, links to design docs.
- Limitations stated plainly, often in a dedicated section. Admitting what the tool doesn't do is the strongest credibility signal available.
- Examples use realistic input and show actual output.
- Humor and personality are fine when they're the maintainer's, sparse, and never at the expense of clarity. Don't inject personality on the maintainer's behalf - default to neutral and precise.

## The de-AI revision pass (mandatory checklist)

After drafting, reread the full text and check:

1. Search for every word in the banned vocabulary lists above. Replace or delete.
2. Any header containing an emoji? Remove it.
3. Any "not just X, it's Y" or "from X to Y" constructions? Rewrite.
4. Count items in each list. If multiple lists all have three items, you padded or trimmed to fit the pattern; fix the lists to their natural length.
5. Any bolded-term bullet whose text just restates the term? Replace with a concrete claim or delete.
6. Any sentence that asserts quality (fast, simple, powerful) without evidence in the same section? Add the evidence or cut the claim.
7. Any paragraph that summarizes the paragraph above it? Delete it.
8. Any em dashes used for emphasis? Replace.
9. Read the page title and first paragraph as a stranger. Is it clear which reader question this page answers (learn / do / look up / understand)? If not, the page is mixing types; restructure.
