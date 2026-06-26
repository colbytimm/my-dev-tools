#!/usr/bin/env zsh
# ──────────────────────────────────────────────────────────────
# agent-statusline.zsh — Agentic tool statusline renderer
# Styled to match Powerlevel10k classic powerline (dark, 236 bg,
# angled separators, sharp heads, flat tails).
#
# Reads JSON on stdin, outputs a p10k-styled status bar.
#
# Usage:
#   echo '{"context_window": {...}}' | ./statusline.zsh
#   echo '{"context_window": {...}}' | ./statusline.zsh --adapter copilot
#
# Requirements: jq, zsh (or bash), a powerline-patched font
# ──────────────────────────────────────────────────────────────

set -euo pipefail

# ── P10k Design Tokens ────────────────────────────────────────
# Pulled directly from your p10k.zsh config.
#
#   POWERLEVEL9K_BACKGROUND=236
#   POWERLEVEL9K_LEFT_SEGMENT_SEPARATOR='\uE0B0'
#   POWERLEVEL9K_LEFT_SUBSEGMENT_SEPARATOR='%244F\uE0B1'
#   VCS clean=76, modified=178, untracked=39, conflicted=196
#   command_execution_time fg=248
#   status ok=70, error=160
#   dir fg=31, anchor=39
#   context fg=180
#   node_version fg=70, azure fg=32, aws fg=208

# ── Config ────────────────────────────────────────────────────

STATUSLINE_USE_COLOR="${STATUSLINE_USE_COLOR:-true}"

# Custom environment variable segments.
# Format: comma-separated list of ENV_VAR:label:color
#   ENV_VAR  — the environment variable name to display
#   label    — short label shown before the value (optional, defaults to var name)
#   color    — 256-color code (optional, defaults to 66)
#
# Segments only render when the env var is set and non-empty.
#
# Example:
#   export STATUSLINE_CUSTOM_SEGMENTS="KUBECONTEXT:k8s:134,AWS_PROFILE:aws:208,MY_PROJECT::70"
#
# You can also put one entry per line in a config file:
#   ~/.config/agent-statusline/segments.conf
#
# Well-known p10k colors for reference:
#   208=aws orange, 32=azure blue, 134=kube purple, 38=terraform cyan,
#   70=node green, 178=direnv yellow, 74=nix blue, 66=time teal
STATUSLINE_CUSTOM_SEGMENTS="${STATUSLINE_CUSTOM_SEGMENTS:-}"
STATUSLINE_CUSTOM_SEGMENTS_FILE="${STATUSLINE_CUSTOM_SEGMENTS_FILE:-${HOME}/.config/agent-statusline/segments.conf}"

# ── Color Palette (256-color, matching p10k) ──────────────────

if [[ "$STATUSLINE_USE_COLOR" == "true" ]]; then
  # Segment background — same as POWERLEVEL9K_BACKGROUND
  BG=236

  # Foreground colors — pulled from p10k segment definitions
  FG_AGENT=180       # context foreground (tan)
  FG_MODEL=66        # time/ram (muted teal) — secondary info
  FG_BRANCH=76       # vcs clean (green)
  FG_BRANCH_DIRTY=178  # vcs modified (yellow)
  FG_CTX=39          # dir anchor (bright blue)
  FG_CTX_LABEL=103   # dir shortened (muted blue)
  FG_GAUGE_LO=76     # green (< 50%)
  FG_GAUGE_MID=178   # yellow/amber (50-80%)
  FG_GAUGE_HI=196    # red (80%+)
  FG_TIME=248        # command_execution_time
  FG_ADD=70          # status ok green
  FG_DEL=160         # status error red
  FG_DIFF=134        # kubecontext purple
  FG_SUBSEP=244      # subsegment separator color

  # ANSI builders
  bg()  { printf "\033[48;5;%dm" "$1"; }
  fg()  { printf "\033[38;5;%dm" "$1"; }
  rst() { printf "\033[0m"; }

  # Powerline glyphs (matching your p10k separators)
  SEP=$(printf '\xee\x82\xb0')       # U+E0B0 POWERLEVEL9K_LEFT_SEGMENT_SEPARATOR
  SUBSEP=$(printf '\xee\x82\xb1')    # U+E0B1 POWERLEVEL9K_LEFT_SUBSEGMENT_SEPARATOR
else
  bg()  { :; }
  fg()  { :; }
  rst() { :; }
  SEP="│"
  SUBSEP="│"
  FG_SUBSEP=""
  BG=""
fi

# ── Helpers ───────────────────────────────────────────────────

format_tokens() {
  local val="$1"
  if [[ "$val" == "null" || -z "$val" ]]; then
    echo "?"
    return
  fi
  if (( $(echo "$val >= 1000000" | bc -l) )); then
    printf "%.1fm" "$(echo "$val / 1000000" | bc -l)"
  elif (( $(echo "$val >= 1000" | bc -l) )); then
    printf "%.1fk" "$(echo "$val / 1000" | bc -l)"
  else
    printf "%.0f" "$val"
  fi
}

format_duration() {
  local ms="$1"
  if [[ "$ms" == "null" || -z "$ms" ]]; then
    echo "00:00:00"
    return
  fi
  local total_secs=$(( ${ms%.*} / 1000 ))
  local hours=$(( total_secs / 3600 ))
  local mins=$(( (total_secs % 3600) / 60 ))
  local secs=$(( total_secs % 60 ))
  printf "%02d:%02d:%02d" "$hours" "$mins" "$secs"
}

render_gauge() {
  local pct="$1"
  if [[ "$pct" == "null" || -z "$pct" ]]; then
    echo "··········"
    return
  fi

  local bounded=$(printf "%.0f" "$pct")
  (( bounded > 100 )) && bounded=100
  (( bounded < 0 )) && bounded=0

  local filled=$(( bounded / 10 ))
  local empty=$(( 10 - filled ))

  # Pick color based on percentage (matches p10k warning thresholds)
  if [[ "$STATUSLINE_USE_COLOR" == "true" ]]; then
    if (( bounded >= 80 )); then
      printf "%s" "$(fg $FG_GAUGE_HI)"
    elif (( bounded >= 50 )); then
      printf "%s" "$(fg $FG_GAUGE_MID)"
    else
      printf "%s" "$(fg $FG_GAUGE_LO)"
    fi
  fi

  local i
  for (( i = 0; i < filled; i++ )); do printf "▊"; done
  for (( i = 0; i < empty; i++ )); do printf "░"; done
}

# ── Parse Args ────────────────────────────────────────────────

ADAPTER="auto"
STATUSLINE_DEBUG="${STATUSLINE_DEBUG:-false}"
STATUSLINE_DEBUG_FILE="${STATUSLINE_DEBUG_FILE:-${HOME}/.config/agent-statusline/debug.json}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --adapter) ADAPTER="$2"; shift 2 ;;
    --no-color) STATUSLINE_USE_COLOR="false"; shift ;;
    --debug) STATUSLINE_DEBUG="true"; shift ;;
    *) shift ;;
  esac
done

# ── Read stdin ────────────────────────────────────────────────

PAYLOAD="$(cat)"

# ── Debug: dump raw payload ───────────────────────────────────
if [[ "$STATUSLINE_DEBUG" == "true" && -n "$PAYLOAD" ]]; then
  echo "$(date '+%H:%M:%S') | PAYLOAD_LEN=${#PAYLOAD} | ${PAYLOAD}" >> /tmp/statusline-debug.log 2>/dev/null || true
fi

if [[ -z "$PAYLOAD" ]]; then
  printf "%s%s Agent status unavailable%s" "$(fg $FG_AGENT)" "⊘" "$(rst)"
  exit 0
fi

if ! echo "$PAYLOAD" | jq empty 2>/dev/null; then
  printf "%s%s Invalid payload%s" "$(fg $FG_AGENT)" "⊘" "$(rst)"
  exit 0
fi

# ── Auto-detect adapter ──────────────────────────────────────

if [[ "$ADAPTER" == "auto" ]]; then
  has_context_window=$(echo "$PAYLOAD" | jq -r 'has("context_window")' 2>/dev/null)
  has_session=$(echo "$PAYLOAD" | jq -r 'has("session")' 2>/dev/null)

  if [[ "$has_context_window" == "true" ]]; then
    ADAPTER="copilot"
  elif [[ "$has_session" == "true" ]]; then
    ADAPTER="claude-code"
  else
    ADAPTER="generic"
  fi
fi

# ── Adapter: Normalize JSON → variables ──────────────────────

case "$ADAPTER" in
  copilot)
    SL_AGENT_NAME="Copilot"
    SL_MODEL=$(echo "$PAYLOAD" | jq -r '.model.id // empty')
    SL_CWD=$(echo "$PAYLOAD" | jq -r '.cwd // .workspace.current_dir // empty')
    SL_CONTEXT_CURRENT=$(echo "$PAYLOAD" | jq -r '.context_window.current_context_tokens // empty')
    SL_CONTEXT_LIMIT=$(echo "$PAYLOAD" | jq -r '.context_window.displayed_context_limit // empty')
    SL_CONTEXT_PCT=$(echo "$PAYLOAD" | jq -r '.context_window.current_context_used_percentage // empty')
    SL_DURATION_MS=$(echo "$PAYLOAD" | jq -r '.cost.total_duration_ms // empty')
    SL_LINES_ADDED=$(echo "$PAYLOAD" | jq -r '.cost.total_lines_added // "0"')
    SL_LINES_REMOVED=$(echo "$PAYLOAD" | jq -r '.cost.total_lines_removed // "0"')
    ;;

  claude-code)
    SL_AGENT_NAME="Claude"
    SL_MODEL=$(echo "$PAYLOAD" | jq -r '.session.model // empty')
    SL_CWD=$(echo "$PAYLOAD" | jq -r '.cwd // empty')
    SL_CONTEXT_CURRENT=$(echo "$PAYLOAD" | jq -r '.context.tokens_used // empty')
    SL_CONTEXT_LIMIT=$(echo "$PAYLOAD" | jq -r '.context.tokens_limit // empty')
    SL_CONTEXT_PCT=$(echo "$PAYLOAD" | jq -r '.context.pct // empty')
    SL_DURATION_MS=$(echo "$PAYLOAD" | jq -r '.cost.duration_ms // empty')
    SL_LINES_ADDED=$(echo "$PAYLOAD" | jq -r '.cost.lines_added // "0"')
    SL_LINES_REMOVED=$(echo "$PAYLOAD" | jq -r '.cost.lines_removed // "0"')
    ;;

  generic|*)
    SL_AGENT_NAME="Agent"
    SL_MODEL=$(echo "$PAYLOAD" | jq -r '.model.id // .model // empty')
    SL_CWD=$(echo "$PAYLOAD" | jq -r '.cwd // empty')
    SL_CONTEXT_CURRENT=$(echo "$PAYLOAD" | jq -r '
      .context_window.current_context_tokens //
      .context.tokens_used //
      .tokens_used // empty')
    SL_CONTEXT_LIMIT=$(echo "$PAYLOAD" | jq -r '
      .context_window.displayed_context_limit //
      .context.tokens_limit //
      .tokens_limit // empty')
    SL_CONTEXT_PCT=$(echo "$PAYLOAD" | jq -r '
      .context_window.current_context_used_percentage //
      .context_window.used_percentage //
      .context.pct // empty')
    SL_DURATION_MS=$(echo "$PAYLOAD" | jq -r '
      .cost.total_duration_ms //
      .cost.duration_ms //
      .duration_ms // empty')
    SL_LINES_ADDED=$(echo "$PAYLOAD" | jq -r '
      .cost.total_lines_added //
      .cost.lines_added //
      .lines_added // "0"')
    SL_LINES_REMOVED=$(echo "$PAYLOAD" | jq -r '
      .cost.total_lines_removed //
      .cost.lines_removed //
      .lines_removed // "0"')
    ;;
esac

# ── Resolve git branch from CWD ──────────────────────────────

SL_GIT_BRANCH=""
SL_GIT_DIRTY=""
if [[ -n "$SL_CWD" && -d "$SL_CWD" ]]; then
  SL_GIT_BRANCH=$(git -C "$SL_CWD" symbolic-ref --short HEAD 2>/dev/null || \
                   git -C "$SL_CWD" rev-parse --short HEAD 2>/dev/null || echo "")
  if [[ -n "$SL_GIT_BRANCH" ]]; then
    # Truncate long branch names: first 12 … last 12 (same as your p10k git formatter)
    if (( ${#SL_GIT_BRANCH} > 32 )); then
      SL_GIT_BRANCH="${SL_GIT_BRANCH:0:12}…${SL_GIT_BRANCH: -12}"
    fi
    local_changes=$(git -C "$SL_CWD" status --porcelain 2>/dev/null | head -1)
    [[ -n "$local_changes" ]] && SL_GIT_DIRTY="!"
  fi
fi

# ── Format values ─────────────────────────────────────────────

FMT_CTX_CURRENT=$(format_tokens "$SL_CONTEXT_CURRENT")
FMT_CTX_LIMIT=$(format_tokens "$SL_CONTEXT_LIMIT")
FMT_DURATION=$(format_duration "$SL_DURATION_MS")

# ── Render ────────────────────────────────────────────────────
# All segments share bg 236 (like p10k classic), separated by
# the subsegment separator \uE0B1 in fg 244. The bar ends with
# the full powerline arrow \uE0B0.

OUTPUT=""

# Start the background
if [[ "$STATUSLINE_USE_COLOR" == "true" ]]; then
  OUTPUT+="$(bg $BG)"
fi

# ── Segment: Agent name + model ──────────────────────────────
OUTPUT+="$(fg $FG_AGENT) ${SL_AGENT_NAME}"
if [[ -n "${SL_MODEL:-}" ]]; then
  OUTPUT+="$(fg $FG_MODEL) ${SL_MODEL}"
fi
OUTPUT+=" "

# ── Check for init/loading state ──────────────────────────────
# Copilot sends zeroed payloads on session restore before the first
# exchange. Show a clean loading state instead of ctx 0/?.
SL_LOADING=false
if [[ -z "$SL_CONTEXT_LIMIT" || "$SL_CONTEXT_LIMIT" == "null" ]] ||
   [[ "${SL_CONTEXT_CURRENT:-0}" == "0" && -z "${SL_MODEL:-}" ]]; then
  SL_LOADING=true
fi

if [[ "$SL_LOADING" == "true" ]]; then
  # ── Loading state: minimal bar ──────────────────────────────
  OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"
  OUTPUT+="$(fg $FG_CTX_LABEL) waiting for first exchange $(fg $FG_TIME)… "
else
  # ── Normal state: full segments ─────────────────────────────

  # ── Subseparator ─────────────────────────────────────────────
  if [[ -n "$SL_GIT_BRANCH" ]]; then
    OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"

    # ── Segment: Git branch ──────────────────────────────────────
    if [[ -n "$SL_GIT_DIRTY" ]]; then
      OUTPUT+="$(fg $FG_BRANCH_DIRTY) ${SL_GIT_BRANCH} ${SL_GIT_DIRTY} "
    else
      OUTPUT+="$(fg $FG_BRANCH) ${SL_GIT_BRANCH} "
    fi
  fi

  # ── Subseparator ─────────────────────────────────────────────
  OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"

  # ── Segment: Context tokens ─────────────────────────────────
  OUTPUT+="$(fg $FG_CTX_LABEL) ctx $(fg $FG_CTX)${FMT_CTX_CURRENT}$(fg $FG_CTX_LABEL)/$(fg $FG_CTX)${FMT_CTX_LIMIT} "

  # ── Subseparator ─────────────────────────────────────────────
  OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"

  # ── Segment: Context gauge ───────────────────────────────────
  OUTPUT+=" $(render_gauge "$SL_CONTEXT_PCT") "

  # ── Subseparator ─────────────────────────────────────────────
  OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"

  # ── Segment: Duration ────────────────────────────────────────
  OUTPUT+="$(fg $FG_TIME) ${FMT_DURATION} "

  # ── Segment: Line changes (only if non-zero) ─────────────────
  if [[ "$SL_LINES_ADDED" != "0" || "$SL_LINES_REMOVED" != "0" ]]; then
    OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"
    OUTPUT+="$(fg $FG_ADD) +${SL_LINES_ADDED}$(fg $FG_DIFF)/$(fg $FG_DEL)-${SL_LINES_REMOVED} "
  fi

  # ── Segment: Custom environment variables ─────────────────────
  # Collect segment definitions from env var and config file.
  CUSTOM_DEFS=""
  if [[ -n "$STATUSLINE_CUSTOM_SEGMENTS" ]]; then
    CUSTOM_DEFS="$STATUSLINE_CUSTOM_SEGMENTS"
  fi
  if [[ -f "$STATUSLINE_CUSTOM_SEGMENTS_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Skip comments and blank lines
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${line// /}" ]] && continue
      if [[ -n "$CUSTOM_DEFS" ]]; then
        CUSTOM_DEFS+=",${line}"
      else
        CUSTOM_DEFS="$line"
      fi
    done < "$STATUSLINE_CUSTOM_SEGMENTS_FILE"
  fi

  if [[ -n "$CUSTOM_DEFS" ]]; then
    # Parse and render each custom segment
    # Split on comma (zsh syntax)
    SEGMENTS=("${(@s/,/)CUSTOM_DEFS}")
    for segment in "${SEGMENTS[@]}"; do
      # Trim whitespace
      segment="${segment## }"
      segment="${segment%% }"
      [[ -z "$segment" ]] && continue

      # Parse ENV_VAR:label:color (zsh syntax, 1-indexed)
      PARTS=("${(@s/:/)segment}")
      local_var="${PARTS[1]:-}"
      local_label="${PARTS[2]:-}"
      local_color="${PARTS[3]:-66}"

      [[ -z "$local_var" ]] && continue

      # Get the env var value (zsh indirect expansion)
      local_val="${(P)local_var:-}"
      [[ -z "$local_val" ]] && continue

      # Default label to var name (lowercase, truncated)
      if [[ -z "$local_label" ]]; then
        local_label="${(L)local_var}"
        # Truncate long labels
        (( ${#local_label} > 12 )) && local_label="${local_label:0:12}"
      fi

      OUTPUT+="$(fg $FG_SUBSEP)${SUBSEP}"
      OUTPUT+="$(fg $FG_CTX_LABEL) ${local_label} $(fg "$local_color")${local_val} "
    done
  fi

fi  # end loading/normal branch

# ── End cap: powerline arrow ─────────────────────────────────
if [[ "$STATUSLINE_USE_COLOR" == "true" ]]; then
  OUTPUT+="$(rst)$(fg $BG)${SEP}$(rst)"
else
  OUTPUT+="${SEP}"
fi

printf "%b" "$OUTPUT"

