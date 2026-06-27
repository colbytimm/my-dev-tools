---
name: statusline-install
description: Install and configure a Powerlevel10k-styled status line for terminal
  coding agents that support a command-backed statusline (Claude Code and GitHub
  Copilot CLI). Ships a portable, dependency-light Node renderer (statusline.js)
  that reads the host agent's session JSON on stdin and prints a powerline bar — agent
  + model, git branch, context-window usage, a fill gauge, elapsed time, and line
  changes — plus a legacy zsh variant. Use when the user wants to set up, theme,
  fix, or port a coding-agent statusline, asks why their Claude/Copilot status bar
  is blank or stuck on "waiting for first exchange", or wants one statusline that
  works across macOS, Linux, and Windows. Codex CLI and Gemini CLI render their
  status lines internally and can't be driven live yet (no command hook); a
  forward-ready `codex` adapter parses Codex's hook JSON for when it ships.
license: MIT
---

# Statusline

A one-line, Powerlevel10k-styled status bar for terminal coding agents. The
agent pipes session JSON to the script on stdin; the script writes a powerline
bar to stdout.

```
 Claude Opus │ feat/x ! │ ctx 86.2k/200.0k │ ████░░░░░░ │ 01:02:05 │ +156/-23 │
```

## Pick the script

Both live in `scripts/`. **Use `statusline.js`** — it is the portable version.

| Script           | Platforms              | Dependencies             |
| ---------------- | ---------------------- | ------------------------ |
| `statusline.js`  | macOS, Linux, Windows  | `node` ≥ 18, `git`       |
| `statusline.zsh` | macOS, Linux (zsh)     | `zsh`, `jq`, `bc`, `git` |

`statusline.zsh` is the original, kept for reference; it won't run on Windows
(no zsh) and uses zsh-only syntax bash can't execute.

### Fonts and the powerline separators

The angled separators between segments are powerline glyphs (`U+E0B0`/`U+E0B1`)
that live in the Unicode Private Use Area and need a [powerline-patched
font](https://github.com/romkatv/powerlevel10k#fonts). Terminals with one
(Ghostty, iTerm2/Kitty/WezTerm with a Nerd Font, etc.) render the full bar.
Terminals without one (notably **Apple Terminal.app**) show the separators as
tofu (`▯`).

`statusline.js` handles this: it keeps powerline glyphs by default but
auto-degrades to a plain `│` separator (color and gauge intact) when
`TERM_PROGRAM` is a terminal known to lack the glyphs (Apple Terminal, VS Code).
Override with `STATUSLINE_POWERLINE=true|false` or `--powerline`/`--no-powerline`.
For the full powerline look in Apple Terminal, set its profile font to a Nerd
Font instead.

## Supported agents

The script only works where the agent runs a user-defined command and pipes
session JSON to its stdin:

| Agent              | Supported | How                                                             |
| ------------------ | --------- | -------------------------------------------------------------- |
| Claude Code        | ✅        | `statusLine.command` in `settings.json`                        |
| GitHub Copilot CLI | ✅        | `statusLine.command` in `~/.copilot/settings.json` (experimental) |
| Codex CLI          | ⚠️        | Built-in footer only (`tui.status_line` enum) — **no command hook yet** ([openai/codex#20043](https://github.com/openai/codex/issues/20043)). A `codex` adapter is ready for when it ships, or behind a polling wrapper. |
| Gemini CLI         | ❌        | Built-in footer only (`ui.footer.*`); no command hook          |
| other / future     | ⚠️        | `--adapter generic` probes common field names                  |

Codex and Gemini render their status lines internally and never hand the session
to an external command, so today there is nothing to hook into. **Codex cannot
drive this script live** until it ships a command-backed statusline. The repo
ships a dedicated `codex` adapter anyway — it parses Codex's documented hook JSON
shape (string `model`, `model_provider`) so the bar renders the day that hook
lands (or if you front Codex with a polling wrapper that pipes its session state
to the script). Force it with `--adapter codex`. If Gemini ships a command-backed
statusline, the `generic` adapter will pick it up.

## Setup

### Claude Code — `~/.claude/settings.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/skills/statusline/scripts/statusline.js",
    "padding": 0
  }
}
```

### GitHub Copilot CLI — `~/.copilot/settings.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.copilot/skills/statusline/scripts/statusline.js"
  }
}
```

### Windows

Both agents run the command through Git Bash (if installed) or PowerShell;
`node ...` works in both. Use **forward slashes** and a full path if `~` doesn't
expand:

```json
{ "statusLine": { "type": "command", "command": "node C:/Users/you/.claude/skills/statusline/scripts/statusline.js" } }
```

`node` and `git` must be on `PATH`.

## Adapters

The adapter is auto-detected from the payload shape. Copilot is tested before
Claude because Copilot's payload now also carries Claude-style `context_window`
fields; only Copilot has the `current_context_*` display view. The previous zsh
version misdetected Claude as Copilot and read the wrong field paths, which left
the bar stuck on "waiting for first exchange" — `statusline.js` fixes this.

Force an adapter with `--adapter claude-code | copilot | codex | generic`. The
`codex` adapter is auto-detected from Codex's top-level `model_provider` (and a
plain-string `model`), which Claude and Copilot never emit.

## Configuration

Everything tunable lives in a `CONFIG` block at the top of
`scripts/statusline.js` — edit the defaults there. Each value also takes an
environment-variable override, so you can tweak an install without forking the
file. Print the resolved config with `node scripts/statusline.js --dump-config`.

### Segments

Show or hide any value. A disabled segment drops its divider with it (no
dangling separators). Defaults live in the `SEGMENTS` object; override one with
`STATUSLINE_SHOW_<NAME>=true|false`:

| Segment | Env override | Shows |
| --- | --- | --- |
| `model` | `STATUSLINE_SHOW_MODEL` | model name after the agent |
| `gitBranch` | `STATUSLINE_SHOW_GITBRANCH` | git branch + dirty marker |
| `context` | `STATUSLINE_SHOW_CONTEXT` | ctx tokens used / limit |
| `gauge` | `STATUSLINE_SHOW_GAUGE` | context-window fill gauge |
| `duration` | `STATUSLINE_SHOW_DURATION` | elapsed session time |
| `limits` | `STATUSLINE_SHOW_LIMITS` | Claude usage limits |
| `lines` | `STATUSLINE_SHOW_LINES` | +added / -removed |
| `custom` | `STATUSLINE_SHOW_CUSTOM` | custom env-var segments |

```sh
# hide the gauge and line counts (their dividers go too)
STATUSLINE_SHOW_GAUGE=false STATUSLINE_SHOW_LINES=false
```

### Percent thresholds

The gauge and usage-limit percentages step green → amber → red at these cutoffs
(`PERCENT` in the config):

```sh
STATUSLINE_AMBER_AT=50   # >= this is amber
STATUSLINE_RED_AT=80     # >= this is red
```

### Themes

Colors come from a named palette. Select one with `STATUSLINE_THEME`. Built-ins:

- `p10k` (default) and `mono` — neutral palettes.
- `dracula`, `nord`, `gruvbox`, `tokyonight`, `catppuccin`, `onedark`,
  `solarized`, `monokai` — matched to the real editor palettes.

All built-in palettes are truecolor `#rrggbb`, so they need a 24-bit-color
terminal (most modern ones qualify). Add your own by adding a key to the
`THEMES` object (same keys as `p10k`); a color value is a `#rrggbb` string or a
256-color code (number).
Override individual colors without forking via `STATUSLINE_COLORS`
(`key=value`, comma-separated; value is a code or hex):

```sh
STATUSLINE_THEME=dracula
STATUSLINE_COLORS="agent=#ff79c6,gaugeHi=#ff5555"
```

The repo's "Statusline preview" CI workflow renders every theme to an SVG
artifact for visual review.

### Font

Applies only to image/SVG rendering (the terminal owns the font for live
output); the preview workflow reads it via `--dump-config`. Defaults in `FONT`:

```sh
STATUSLINE_FONT_FAMILY="'JetBrains Mono', monospace"
STATUSLINE_FONT_WEIGHT=bold
STATUSLINE_FONT_SIZE=16
```

## Custom segments

Add environment-variable segments via `STATUSLINE_CUSTOM_SEGMENTS`
(`ENV_VAR:label:color`, comma-separated) or one entry per line in
`~/.config/agent-statusline/segments.conf`. They render only when the variable
is set:

```sh
export STATUSLINE_CUSTOM_SEGMENTS="AWS_PROFILE:aws:208,KUBECONTEXT:k8s:134"
```

## Usage limits

For **Claude Pro/Max** accounts, the payload carries `rate_limits` for the
5-hour session window and the 7-day weekly window. The bar shows each as percent
used with the reset countdown in parens, e.g. `5h 13% (4h) · wk 9% (3d)`,
colored by consumption (green → amber → red as it climbs). Only
`used_percentage` and `resets_at` are exposed — there is no absolute token
count — so the value is a percentage.

The segment auto-hides when `rate_limits` is absent (non-subscription accounts,
or before the first response). Disable it with `STATUSLINE_LIMITS=false`.

GitHub Copilot does **not** expose an account token limit or remaining quota in
its statusline payload (only context-window tokens and a session request
counter), so a "usage left" segment can't be computed for it from stdin alone.

## Flags & environment

| Flag / variable                             | Effect                                         |
| ------------------------------------------- | ---------------------------------------------- |
| `--adapter <name>`                          | Force `claude-code`, `copilot`, `codex`, or `generic` |
| `STATUSLINE_LIMITS=false`                   | Hide the Claude usage-limit segment (default shown when present) |
| `--no-color` / `STATUSLINE_USE_COLOR=false` | Plain output with `│` separators, no color     |
| `--powerline` / `--no-powerline` (`--plain`) | Force powerline glyphs on/off (default auto by `TERM_PROGRAM`) |
| `STATUSLINE_POWERLINE=auto\|true\|false`    | Same as above via env; `auto` degrades on Apple Terminal / VS Code |
| `--debug` / `STATUSLINE_DEBUG=true`         | Log raw payloads to `$TMPDIR/statusline-debug.log` |
| `--dump-config`                             | Print resolved theme, colors, segments, and font as JSON |

See [Configuration](#configuration) for segment toggles, percent thresholds,
themes, and font.

## Verify

```sh
echo '{"model":{"display_name":"Opus"},"cwd":".","context_window":{"total_input_tokens":85000,"context_window_size":200000,"used_percentage":43},"cost":{"total_duration_ms":3725000,"total_lines_added":156,"total_lines_removed":23}}' \
  | node scripts/statusline.js --no-color
```
