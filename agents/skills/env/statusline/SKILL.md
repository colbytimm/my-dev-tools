---
name: statusline
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

A one-line, Powerlevel10k-styled status bar for terminal coding agents. The
agent pipes session JSON to the script on stdin; the script writes a powerline
bar to stdout.

```
 Claude Opus │ feat/x ! │ ctx 86.2k/200.0k │ ▊▊▊▊░░░░░░ │ 01:02:05 │ +156/-23 │
```

## Pick the script

Both live in `scripts/`. **Use `statusline.js`** — it is the portable version.

| Script           | Platforms              | Dependencies             |
| ---------------- | ---------------------- | ------------------------ |
| `statusline.js`  | macOS, Linux, Windows  | `node` ≥ 18, `git`       |
| `statusline.zsh` | macOS, Linux (zsh)     | `zsh`, `jq`, `bc`, `git` |

`statusline.zsh` is the original, kept for reference; it won't run on Windows
(no zsh) and uses zsh-only syntax bash can't execute. A [powerline-patched
font](https://github.com/romkatv/powerlevel10k#fonts) is required for the ``
separators and gauge glyphs.

## Supported agents

The script only works where the agent runs a user-defined command and pipes
session JSON to its stdin:

| Agent              | Supported | How                                                             |
| ------------------ | --------- | -------------------------------------------------------------- |
| Claude Code        | ✅        | `statusLine.command` in `settings.json`                        |
| GitHub Copilot CLI | ✅        | `statusLine.command` in `~/.copilot/settings.json` (experimental) |
| Codex CLI          | ❌        | Built-in footer only (`tui.status_line` enum); no command hook |
| Gemini CLI         | ❌        | Built-in footer only (`ui.footer.*`); no command hook          |
| other / future     | ⚠️        | `--adapter generic` probes common field names                  |

Codex and Gemini render their status lines internally and never hand the session
to an external command, so there is nothing to hook into. If either ships a
command-backed statusline, the `generic` adapter will pick it up.

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

Force an adapter with `--adapter claude-code | copilot | generic`.

## Custom segments

Add environment-variable segments via `STATUSLINE_CUSTOM_SEGMENTS`
(`ENV_VAR:label:color`, comma-separated) or one entry per line in
`~/.config/agent-statusline/segments.conf`. They render only when the variable
is set:

```sh
export STATUSLINE_CUSTOM_SEGMENTS="AWS_PROFILE:aws:208,KUBECONTEXT:k8s:134"
```

## Flags & environment

| Flag / variable                             | Effect                                         |
| ------------------------------------------- | ---------------------------------------------- |
| `--adapter <name>`                          | Force `claude-code`, `copilot`, or `generic`   |
| `--no-color` / `STATUSLINE_USE_COLOR=false` | Plain output with `│` separators               |
| `--debug` / `STATUSLINE_DEBUG=true`         | Log raw payloads to `$TMPDIR/statusline-debug.log` |

## Verify

```sh
echo '{"model":{"display_name":"Opus"},"cwd":".","context_window":{"total_input_tokens":85000,"context_window_size":200000,"used_percentage":43},"cost":{"total_duration_ms":3725000,"total_lines_added":156,"total_lines_removed":23}}' \
  | node scripts/statusline.js --no-color
```
