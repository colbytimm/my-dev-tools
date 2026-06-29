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
  status lines internally and cannot be driven by this skill.
license: MIT
---

# Statusline

A one-line, Powerlevel10k-styled status bar for terminal coding agents. The agent
pipes session JSON to the script on stdin; the script prints a powerline bar to
stdout.

```
 Claude Opus │ feat/x ! │ ctx 86.2k/200.0k │ ████░░░░░░ │ 01:02:05 │ +156/-23 │
```

Two scripts live in `scripts/`. **Use `statusline.js`** — it's portable (no `jq`
or `bc`) and the only one that runs on Windows:

| Script           | Platforms             | Dependencies             |
| ---------------- | --------------------- | ------------------------ |
| `statusline.js`  | macOS, Linux, Windows | `node` ≥ 18, `git`       |
| `statusline.zsh` | macOS, Linux (zsh)    | `zsh`, `jq`, `bc`, `git` |

`statusline.zsh` is the original, kept only for reference.

## Supported agents

The script works only where the agent runs a user-defined command and pipes
session JSON to its stdin: **Claude Code** (`~/.claude/settings.json`) and **GitHub
Copilot CLI** (`~/.copilot/settings.json`, experimental). **Codex** and **Gemini**
render their status lines internally with no command hook, so they can't be driven
here — if either adds one, the `generic` adapter will pick it up.

## Setup

The skill is **idempotent** — safe to re-run to update the script or change config.
**Never clobber silently:** before overwriting an existing
`~/.config/agent-statusline/statusline.js` or an existing `statusLine` block in a
`settings.json`, show what's there and confirm — the user may have edited the
in-file `CONFIG` block or set a custom theme/command. When editing a
`settings.json`, rewrite only the `statusLine` key and preserve everything else. A
fresh install (neither exists) proceeds without prompting.

### 1. Copy the script to a stable location

Install it **outside the skill directory**: a skill can be moved, updated, or
uninstalled, any of which would break a `statusLine.command` that pointed into it.
One copy serves every agent (the adapter auto-detects), and it's also where the
optional `segments.conf` lives.

```sh
mkdir -p ~/.config/agent-statusline
cp scripts/statusline.js ~/.config/agent-statusline/statusline.js
```

### 2. Point the agent at it

Claude Code — `~/.claude/settings.json` (keep `"padding": 0`):

```json
{ "statusLine": { "type": "command", "command": "node ~/.config/agent-statusline/statusline.js", "padding": 0 } }
```

GitHub Copilot CLI — `~/.copilot/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "node ~/.config/agent-statusline/statusline.js" } }
```

**Windows:** the command runs through Git Bash or PowerShell. Use a full path with
forward slashes if `~` doesn't expand
(`node C:/Users/you/.config/agent-statusline/statusline.js`); `node` and `git`
must be on `PATH`.

## Troubleshooting

- **Separators show as tofu (`▯`)** — the angled glyphs (`U+E0B0`/`U+E0B1`) need a
  [powerline/Nerd font](https://github.com/romkatv/powerlevel10k#fonts). The script
  auto-degrades to a plain `│` on terminals known to lack them (Apple Terminal,
  VS Code); force the choice with `--powerline` / `--no-powerline`. For the full
  look in Apple Terminal, set its profile font to a Nerd Font.
- **Stuck on "waiting for first exchange" or blank** — the bar needs the first
  model response to populate the context window. If it persists, run with `--debug`
  to log raw payloads to `$TMPDIR/statusline-debug.log` and inspect the shape.

## Configuration

Defaults live in the `CONFIG` block at the top of `statusline.js`; every value also
takes an env-var override, so an install can be tuned without forking the file.
Print the resolved config with `node statusline.js --dump-config`. Common knobs:

```sh
STATUSLINE_THEME=dracula                       # named palette (10 built in)
STATUSLINE_SHOW_GAUGE=false                    # hide a segment (its divider goes too)
STATUSLINE_AMBER_AT=50 STATUSLINE_RED_AT=80    # percent color thresholds
```

For the complete reference — adapters, every segment and theme, font, Claude/Copilot
usage & quota mechanics, custom segments, and the full flag/env table — read
[`references/reference.md`](references/reference.md).

## Verify

```sh
echo '{"model":{"display_name":"Opus"},"cwd":".","context_window":{"total_input_tokens":85000,"context_window_size":200000,"used_percentage":43},"cost":{"total_duration_ms":3725000,"total_lines_added":156,"total_lines_removed":23}}' \
  | node scripts/statusline.js --no-color
```
