#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// statusline.js — Agentic tool statusline renderer
//
// Portable (macOS / Linux / Windows) Node.js port of statusline.zsh.
// No external dependencies — no jq, no bc. Reads harness JSON on
// stdin, writes a Powerlevel10k-styled status bar to stdout.
//
// Supported harnesses:
//   • Claude Code      (settings.json  -> statusLine.command)
//   • GitHub Copilot CLI (~/.copilot/settings.json -> statusLine.command)
//   • generic          (best-effort field probing for anything that
//                        copies the JSON-on-stdin pattern, e.g. a
//                        future Codex/Gemini hook)
//
// Usage:
//   echo '{...}' | node statusline.js
//   echo '{...}' | node statusline.js --adapter claude-code
//   echo '{...}' | node statusline.js --no-color
//
// Requirements: node >= 18, git on PATH. A powerline-patched font renders the
// angled separators; without one the bar auto-degrades to plain | separators.
// ──────────────────────────────────────────────────────────────

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────

const env = process.env;
let useColor = (env.STATUSLINE_USE_COLOR ?? 'true') !== 'false';

const customSegmentsEnv = env.STATUSLINE_CUSTOM_SEGMENTS ?? '';
const customSegmentsFile =
  env.STATUSLINE_CUSTOM_SEGMENTS_FILE ??
  path.join(os.homedir(), '.config', 'agent-statusline', 'segments.conf');

let debug = (env.STATUSLINE_DEBUG ?? 'false') === 'true';

// Powerline separators (U+E0B0/E0B1) live in the Unicode Private Use Area and
// require a patched font. Terminals without one render them as tofu, so degrade
// to a plain bar there. "auto" keeps powerline unless TERM_PROGRAM names a
// terminal known to lack PUA glyph fallback (Apple Terminal, VS Code).
let powerlineSetting = (env.STATUSLINE_POWERLINE ?? 'auto').toLowerCase();

// Usage-limit segment. rate_limits is present only for Claude Pro/Max, so the
// segment auto-hides otherwise; this just lets users force it off.
let showLimits = (env.STATUSLINE_LIMITS ?? 'true') !== 'false';

// ── Parse args ────────────────────────────────────────────────

let adapter = 'auto';
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--adapter') adapter = process.argv[++i] ?? 'auto';
  else if (arg === '--no-color') useColor = false;
  else if (arg === '--powerline') powerlineSetting = 'true';
  else if (arg === '--no-powerline' || arg === '--plain') powerlineSetting = 'false';
  else if (arg === '--debug') debug = true;
}

// ── Color palette (256-color, matching p10k) ──────────────────

const BG = 236;
const FG = {
  AGENT: 180, // context foreground (tan)
  MODEL: 66, // time/ram (muted teal)
  BRANCH: 76, // vcs clean (green)
  BRANCH_DIRTY: 178, // vcs modified (yellow)
  CTX: 39, // dir anchor (bright blue)
  CTX_LABEL: 103, // dir shortened (muted blue)
  GAUGE_LO: 76, // green (< 50%)
  GAUGE_MID: 178, // yellow/amber (50-80%)
  GAUGE_HI: 196, // red (80%+)
  TIME: 248, // command_execution_time
  ADD: 70, // status ok green
  DEL: 160, // status error red
  DIFF: 134, // kubecontext purple
  SUBSEP: 244, // subsegment separator color
};

const bg = useColor ? (n) => `\x1b[48;5;${n}m` : () => '';
const fg = useColor ? (n) => `\x1b[38;5;${n}m` : () => '';
const rst = useColor ? () => '\x1b[0m' : () => '';

const NO_PUA_TERMINALS = ['Apple_Terminal', 'vscode'];
const usePowerline = !useColor
  ? false
  : powerlineSetting === 'true' || powerlineSetting === '1'
    ? true
    : powerlineSetting === 'false' || powerlineSetting === '0'
      ? false
      : !NO_PUA_TERMINALS.includes(env.TERM_PROGRAM ?? '');

const SEP = ''; // powerline tail; emitted only when usePowerline
const SUBSEP = usePowerline ? '' : '│';

// ── Helpers ───────────────────────────────────────────────────

function num(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function formatTokens(val) {
  const n = num(val);
  if (n === null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function formatDuration(ms) {
  const n = num(ms);
  if (n === null) return '00:00:00';
  const totalSecs = Math.floor(n / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function formatReset(epochSec) {
  const n = num(epochSec);
  if (n === null) return '';
  const secs = Math.round(n - Date.now() / 1000);
  if (secs <= 0) return 'now';
  if (secs >= 86400) return `${Math.floor(secs / 86400)}d`;
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 60)}m`;
}

function limitColor(used) {
  if (!useColor) return '';
  if (used >= 80) return fg(FG.GAUGE_HI);
  if (used >= 50) return fg(FG.GAUGE_MID);
  return fg(FG.GAUGE_LO);
}

function renderGauge(pct) {
  const n = num(pct);
  if (n === null) return '·'.repeat(10);

  let bounded = Math.round(n);
  if (bounded > 100) bounded = 100;
  if (bounded < 0) bounded = 0;

  const filled = Math.floor(bounded / 10);
  const empty = 10 - filled;

  let color = '';
  if (useColor) {
    if (bounded >= 80) color = fg(FG.GAUGE_HI);
    else if (bounded >= 50) color = fg(FG.GAUGE_MID);
    else color = fg(FG.GAUGE_LO);
  }

  return color + '▊'.repeat(filled) + '░'.repeat(empty);
}

// ── Read stdin ────────────────────────────────────────────────

let payload = '';
try {
  payload = fs.readFileSync(0, 'utf8');
} catch {
  payload = '';
}

if (debug && payload) {
  const logLine = `${new Date().toISOString()} | LEN=${payload.length} | ${payload}\n`;
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'statusline-debug.log'), logLine);
  } catch {
    /* best effort */
  }
}

function bail(message) {
  process.stdout.write(`${fg(FG.AGENT)}⊘ ${message}${rst()}`);
  process.exit(0);
}

if (!payload.trim()) bail('Agent status unavailable');

let data;
try {
  data = JSON.parse(payload);
} catch {
  bail('Invalid payload');
}

// ── Path probing ──────────────────────────────────────────────

function get(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, obj);
}

function first(...paths) {
  for (const p of paths) {
    const v = get(data, p);
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function has(...paths) {
  return paths.some((p) => {
    const v = get(data, p);
    return v !== null && v !== undefined;
  });
}

// ── Auto-detect adapter ───────────────────────────────────────
// Copilot must be tested first: its payload now also carries the
// Claude-style context_window.{context_window_size,used_percentage},
// but the display-view fields below are exclusive to Copilot.

if (adapter === 'auto') {
  if (
    has(
      'context_window.current_context_tokens',
      'context_window.displayed_context_limit',
      'context_window.current_context_used_percentage'
    )
  ) {
    adapter = 'copilot';
  } else if (
    has(
      'context_window.used_percentage',
      'context_window.context_window_size',
      'context_window.total_input_tokens',
      'effort',
      'thinking',
      'exceeds_200k_tokens'
    )
  ) {
    adapter = 'claude-code';
  } else {
    adapter = 'generic';
  }
}

// ── Adapter: normalize JSON → variables ──────────────────────

const sl = {
  agentName: 'Agent',
  model: null,
  cwd: null,
  ctxCurrent: null,
  ctxLimit: null,
  ctxPct: null,
  durationMs: null,
  linesAdded: 0,
  linesRemoved: 0,
};

switch (adapter) {
  case 'copilot':
    sl.agentName = 'Copilot';
    sl.model = first('model.id', 'model.display_name');
    sl.cwd = first('cwd', 'workspace.current_dir');
    sl.ctxCurrent = first('context_window.current_context_tokens');
    sl.ctxLimit = first('context_window.displayed_context_limit');
    sl.ctxPct = first('context_window.current_context_used_percentage');
    sl.durationMs = first('cost.total_duration_ms');
    sl.linesAdded = first('cost.total_lines_added') ?? 0;
    sl.linesRemoved = first('cost.total_lines_removed') ?? 0;
    break;

  case 'claude-code': {
    sl.agentName = 'Claude';
    sl.model = first('model.display_name', 'model.id');
    sl.cwd = first('cwd', 'workspace.current_dir');
    const inTok = num(first('context_window.total_input_tokens')) ?? 0;
    const outTok = num(first('context_window.total_output_tokens')) ?? 0;
    sl.ctxCurrent = inTok + outTok || null;
    sl.ctxLimit = first('context_window.context_window_size');
    sl.ctxPct = first('context_window.used_percentage');
    sl.durationMs = first('cost.total_duration_ms');
    sl.linesAdded = first('cost.total_lines_added') ?? 0;
    sl.linesRemoved = first('cost.total_lines_removed') ?? 0;
    break;
  }

  default:
    sl.agentName = 'Agent';
    sl.model = first('model.display_name', 'model.id', 'model');
    sl.cwd = first('cwd', 'workspace.current_dir');
    sl.ctxCurrent = first(
      'context_window.current_context_tokens',
      'context_window.total_input_tokens',
      'context.tokens_used',
      'tokens_used'
    );
    sl.ctxLimit = first(
      'context_window.displayed_context_limit',
      'context_window.context_window_size',
      'context.tokens_limit',
      'tokens_limit'
    );
    sl.ctxPct = first(
      'context_window.current_context_used_percentage',
      'context_window.used_percentage',
      'context.pct'
    );
    sl.durationMs = first(
      'cost.total_duration_ms',
      'cost.duration_ms',
      'duration_ms'
    );
    sl.linesAdded =
      first('cost.total_lines_added', 'cost.lines_added', 'lines_added') ?? 0;
    sl.linesRemoved =
      first('cost.total_lines_removed', 'cost.lines_removed', 'lines_removed') ??
      0;
    break;
}

sl.limits = [
  { label: '5h', window: 'five_hour' },
  { label: 'wk', window: 'seven_day' },
]
  .map((w) => ({
    label: w.label,
    usedPct: num(first(`rate_limits.${w.window}.used_percentage`)),
    resetsAt: first(`rate_limits.${w.window}.resets_at`),
  }))
  .filter((w) => w.usedPct !== null);

// ── Resolve git branch from cwd ───────────────────────────────

let gitBranch = '';
let gitDirty = '';

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

if (sl.cwd && fs.existsSync(sl.cwd) && fs.statSync(sl.cwd).isDirectory()) {
  gitBranch =
    git(['symbolic-ref', '--short', 'HEAD'], sl.cwd) ||
    git(['rev-parse', '--short', 'HEAD'], sl.cwd);

  if (gitBranch) {
    if (gitBranch.length > 32) {
      gitBranch = `${gitBranch.slice(0, 12)}…${gitBranch.slice(-12)}`;
    }
    const status = git(['status', '--porcelain'], sl.cwd);
    if (status) gitDirty = '!';
  }
}

// ── Format values ─────────────────────────────────────────────

const fmtCtxCurrent = formatTokens(sl.ctxCurrent);
const fmtCtxLimit = formatTokens(sl.ctxLimit);
const fmtDuration = formatDuration(sl.durationMs);

// ── Render ────────────────────────────────────────────────────

let out = '';
if (useColor) out += bg(BG);

out += `${fg(FG.AGENT)} ${sl.agentName}`;
if (sl.model) out += `${fg(FG.MODEL)} ${sl.model}`;
out += ' ';

const loading =
  sl.ctxLimit === null ||
  ((num(sl.ctxCurrent) ?? 0) === 0 && !sl.model);

if (loading) {
  out += `${fg(FG.SUBSEP)}${SUBSEP}`;
  out += `${fg(FG.CTX_LABEL)} waiting for first exchange ${fg(FG.TIME)}… `;
} else {
  if (gitBranch) {
    out += `${fg(FG.SUBSEP)}${SUBSEP}`;
    if (gitDirty) {
      out += `${fg(FG.BRANCH_DIRTY)} ${gitBranch} ${gitDirty} `;
    } else {
      out += `${fg(FG.BRANCH)} ${gitBranch} `;
    }
  }

  out += `${fg(FG.SUBSEP)}${SUBSEP}`;
  out += `${fg(FG.CTX_LABEL)} ctx ${fg(FG.CTX)}${fmtCtxCurrent}${fg(FG.CTX_LABEL)}/${fg(FG.CTX)}${fmtCtxLimit} `;

  out += `${fg(FG.SUBSEP)}${SUBSEP}`;
  out += ` ${renderGauge(sl.ctxPct)} `;

  out += `${fg(FG.SUBSEP)}${SUBSEP}`;
  out += `${fg(FG.TIME)} ${fmtDuration} `;

  if (showLimits && sl.limits.length) {
    out += `${fg(FG.SUBSEP)}${SUBSEP}`;
    const parts = sl.limits.map((w) => {
      const used = Math.min(100, Math.max(0, Math.round(w.usedPct)));
      const reset = formatReset(w.resetsAt);
      return (
        `${fg(FG.CTX_LABEL)}${w.label} ${limitColor(used)}${used}% used` +
        (reset ? `${fg(FG.TIME)} (${reset})` : '')
      );
    });
    out += ` ${parts.join(`${fg(FG.SUBSEP)} \u00b7 `)} `;
  }

  if (String(sl.linesAdded) !== '0' || String(sl.linesRemoved) !== '0') {
    out += `${fg(FG.SUBSEP)}${SUBSEP}`;
    out += `${fg(FG.ADD)} +${sl.linesAdded}${fg(FG.DIFF)}/${fg(FG.DEL)}-${sl.linesRemoved} `;
  }

  // ── Custom environment variable segments ────────────────────
  let customDefs = customSegmentsEnv;
  if (fs.existsSync(customSegmentsFile)) {
    try {
      const lines = fs.readFileSync(customSegmentsFile, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        if (/^\s*#/.test(line)) continue;
        if (!line.trim()) continue;
        customDefs = customDefs ? `${customDefs},${line}` : line;
      }
    } catch {
      /* ignore unreadable config */
    }
  }

  if (customDefs) {
    for (let segment of customDefs.split(',')) {
      segment = segment.trim();
      if (!segment) continue;

      const parts = segment.split(':');
      const varName = (parts[0] ?? '').trim();
      let label = (parts[1] ?? '').trim();
      const color = num((parts[2] ?? '').trim()) ?? 66;

      if (!varName) continue;
      const value = env[varName];
      if (!value) continue;

      if (!label) {
        label = varName.toLowerCase();
        if (label.length > 12) label = label.slice(0, 12);
      }

      out += `${fg(FG.SUBSEP)}${SUBSEP}`;
      out += `${fg(FG.CTX_LABEL)} ${label} ${fg(color)}${value} `;
    }
  }
}

if (usePowerline) {
  out += `${rst()}${fg(BG)}${SEP}${rst()}`;
} else {
  out += rst();
}

process.stdout.write(out);
