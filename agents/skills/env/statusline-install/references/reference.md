# Statusline reference

Full configuration for `statusline.js`. SKILL.md covers install; read this when
theming, toggling segments, wiring usage/quota, or looking up a flag.

- [Adapters](#adapters)
- [Segments](#segments)
- [Percent thresholds](#percent-thresholds)
- [Themes](#themes)
- [Font](#font)
- [Custom segments](#custom-segments)
- [Usage, credits, and quota](#usage-credits-and-quota)
- [Flags & environment](#flags--environment)

## Adapters

The adapter is auto-detected from the payload shape. Copilot is tested first
because its payload now also carries Claude-style `context_window` fields, but
only Copilot has the `current_context_*` display view — detecting Claude first
would misread the field paths and leave the bar stuck on "waiting for first
exchange" (the bug the old zsh version had). Force one with
`--adapter claude-code | copilot | generic`.

## Segments

Each value can be shown or hidden; a disabled segment drops its divider too, so
there are no dangling separators. Defaults live in the `SEGMENTS` object; override
one with `STATUSLINE_SHOW_<NAME>=true|false`.

| Segment | Env override | Shows |
| --- | --- | --- |
| `model` | `STATUSLINE_SHOW_MODEL` | model name after the agent, plus reasoning effort in brackets (e.g. `Opus 4.8 [high]`) when the agent reports it. Copilot has no effort field but bakes it into `display_name` (`gpt-5.4 · medium`), so its model name uses `display_name`. |
| `gitBranch` | `STATUSLINE_SHOW_GITBRANCH` | git branch + dirty marker |
| `context` | `STATUSLINE_SHOW_CONTEXT` | ctx tokens used / limit |
| `gauge` | `STATUSLINE_SHOW_GAUGE` | context-window fill gauge |
| `duration` | `STATUSLINE_SHOW_DURATION` | elapsed session time |
| `limits` | `STATUSLINE_SHOW_LIMITS` | Claude usage limits (5h / weekly) |
| `credits` | `STATUSLINE_SHOW_CREDITS` | Copilot session AI credits (`⚡`) |
| `quota` | `STATUSLINE_SHOW_QUOTA` | Copilot monthly premium-request quota (`mth NN%`) |
| `lines` | `STATUSLINE_SHOW_LINES` | +added / -removed |
| `custom` | `STATUSLINE_SHOW_CUSTOM` | custom env-var segments |

```sh
# hide the gauge and line counts (their dividers go too)
STATUSLINE_SHOW_GAUGE=false STATUSLINE_SHOW_LINES=false
```

## Percent thresholds

The gauge and usage/quota percentages step green → amber → red at these cutoffs
(`PERCENT` in the config):

```sh
STATUSLINE_AMBER_AT=50   # >= this is amber
STATUSLINE_RED_AT=80     # >= this is red
```

## Themes

Colors come from a named palette, selected with `STATUSLINE_THEME`:

- `p10k` (default) and `mono` — neutral palettes.
- `dracula`, `nord`, `gruvbox`, `tokyonight`, `catppuccin`, `onedark`,
  `solarized`, `monokai` — matched to the real editor palettes.

All built-ins are truecolor `#rrggbb` and need a 24-bit terminal (most modern ones
qualify). Add your own by adding a key to the `THEMES` object (same keys as
`p10k`); a color is a `#rrggbb` string or a 256-color code (number). Override
individual colors without forking via `STATUSLINE_COLORS` (`key=value`,
comma-separated):

```sh
STATUSLINE_THEME=dracula
STATUSLINE_COLORS="agent=#ff79c6,gaugeHi=#ff5555"
```

The repo's "Statusline preview" CI workflow renders every theme to an SVG artifact
for visual review.

## Font

Applies only to image/SVG rendering (the terminal owns the font for live output);
the preview workflow reads it via `--dump-config`. Defaults in `FONT`:

```sh
STATUSLINE_FONT_FAMILY="'JetBrains Mono', monospace"
STATUSLINE_FONT_WEIGHT=bold
STATUSLINE_FONT_SIZE=16
```

## Custom segments

Add env-var segments via `STATUSLINE_CUSTOM_SEGMENTS` (`ENV_VAR:label:color`,
comma-separated) or one per line in `~/.config/agent-statusline/segments.conf`.
They render only when the variable is set:

```sh
export STATUSLINE_CUSTOM_SEGMENTS="AWS_PROFILE:aws:208,KUBECONTEXT:k8s:134"
```

## Usage, credits, and quota

**Claude (`limits`).** Pro/Max payloads carry `rate_limits` for the 5-hour and
7-day windows. The bar shows each as percent used with the reset countdown, e.g.
`5h 13% (4h) · wk 9% (3d)`, colored by consumption. Only `used_percentage` and
`resets_at` are exposed (no absolute token count). Auto-hides when `rate_limits`
is absent (non-subscription, or before the first response); disable with
`STATUSLINE_LIMITS=false`.

**Copilot** has two independent segments — toggle each separately:

- **`credits` (session)** — AI-credit usage for *this session*, from
  `ai_used.formatted` (preferred) or `ai_used.total_nano_aiu`, the figure Copilot's
  `/usage` prints. Rendered `⚡<value>`; auto-hides for Claude.
- **`quota` (monthly)** — the *account's* monthly premium-request quota, rendered
  Claude-style as `mth NN% (reset)`, colored by consumption. `NN%` is **percent
  used**, climbing 0 → 100; the reset countdown shows days, hours, or minutes as it
  nears.

Copilot's payload carries only session figures, not the monthly quota — its own
bar fetches that from `https://api.github.com/copilot_internal/user`
(`quota_snapshots.premium_interactions.percent_remaining`, where used =
`100 − percent_remaining`), and the `quota` segment does the same. To keep the
render from blocking on the network, the response is cached at
`~/.config/agent-statusline/quota-cache.json` for `STATUSLINE_QUOTA_TTL` seconds
(default 120), and a stale cache is reused if the call fails. The fetch needs a
GitHub token, resolved in order: `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` /
`GITHUB_TOKEN`, then `~/.config/github-copilot/apps.json` (`oauth_token`), then
`~/.copilot/config.json` (`copilot_tokens`), then `gh auth token`. Auto-hides when
no token/network/cache is available. `STATUSLINE_QUOTA="NN[:reset]"` injects a
value and skips the network (preview CI, screenshots).

## Flags & environment

| Flag / variable | Effect |
| --- | --- |
| `--adapter <name>` | Force `claude-code`, `copilot`, or `generic` |
| `--dump-config` | Print resolved theme, colors, segments, and font as JSON |
| `--debug` / `STATUSLINE_DEBUG=true` | Log raw payloads to `$TMPDIR/statusline-debug.log` |
| `--no-color` / `STATUSLINE_USE_COLOR=false` | Plain output with `│` separators, no color |
| `--powerline` / `--no-powerline` (`--plain`) | Force powerline glyphs on/off (default auto by `TERM_PROGRAM`) |
| `STATUSLINE_POWERLINE=auto\|true\|false` | Same via env; `auto` degrades on Apple Terminal / VS Code |
| `STATUSLINE_LIMITS=false` | Hide the Claude usage-limit segment |
| `STATUSLINE_QUOTA="NN[:reset]"` | Inject the Copilot monthly quota (skips the network; previews/screenshots) |
| `STATUSLINE_QUOTA_TTL=<seconds>` | Quota cache lifetime before a re-fetch (default 120) |
| `STATUSLINE_QUOTA_TIMEOUT=<ms>` | Quota API request timeout (default 2500) |
| `STATUSLINE_BRANCH=<name>` | Override the git branch label; dirty marker reflects `cwd` unless `STATUSLINE_DIRTY` is set |
| `STATUSLINE_DIRTY=true\|false` | Force the git dirty marker instead of probing `cwd` (deterministic screenshots/demos) |

Segment toggles (`STATUSLINE_SHOW_*`), percent thresholds, themes, colors, and
font are listed in their sections above.
