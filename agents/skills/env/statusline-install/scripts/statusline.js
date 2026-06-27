#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// statusline.js — Agentic tool statusline renderer
//
// Portable (macOS / Linux / Windows) Node.js port of statusline.zsh.
// No external dependencies — no jq, no bc. Reads harness JSON on
// stdin, writes a Powerlevel10k-styled status bar to stdout.
//
// Supported harnesses:
//   • Claude Code        (settings.json -> statusLine.command)
//   • GitHub Copilot CLI (~/.copilot/settings.json -> statusLine.command)
//   • generic            (best-effort field probing for anything that
//                          copies the JSON-on-stdin pattern)
//
// Usage:
//   echo '{...}' | node statusline.js
//   echo '{...}' | node statusline.js --adapter claude-code
//   echo '{...}' | node statusline.js --no-color
//   node statusline.js --dump-config        # print resolved config as JSON
//
// Everything user-tunable lives in the CONFIG block below; each value
// also takes an env-var override so you can tweak an install without
// forking the file.
//
// Requirements: node >= 18, git on PATH. A powerline-patched font renders
// the angled separators; without one the bar auto-degrades to plain |.
// ──────────────────────────────────────────────────────────────

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const env = process.env;

function num(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════

// ── Segments ──────────────────────────────────────────────────
// Show/hide each value in the bar. A disabled segment also drops its
// divider (no dangling separators). Override one at runtime with
// STATUSLINE_SHOW_<NAME>=true|false, e.g. STATUSLINE_SHOW_LINES=false.
const SEGMENTS = {
  model: true, // model name, after the agent name
  gitBranch: true, // git branch + dirty marker
  context: true, // ctx tokens used / limit
  gauge: true, // context-window fill gauge
  duration: true, // elapsed session time
  limits: true, // Claude usage limits (5h / weekly)
  lines: true, // +added / -removed line counts
  custom: true, // custom env-var segments
};

// ── Percent thresholds ────────────────────────────────────────
// At/above these percentages the gauge and usage-limit values step up
// in color: < amberAt is green, >= amberAt is amber, >= redAt is red.
// Override with STATUSLINE_AMBER_AT / STATUSLINE_RED_AT.
const PERCENT = {
  amberAt: 50,
  redAt: 80,
};

// ── Themes ────────────────────────────────────────────────────
// Named 256-color palettes. Select one with STATUSLINE_THEME (default
// "p10k"). Add a built-in theme by adding a key with the same shape.
// Override individual colors without forking via STATUSLINE_COLORS,
// e.g. STATUSLINE_COLORS="agent=33,gaugeHi=201".
const THEMES = {
  // Powerlevel10k classic — the original look.
  p10k: {
    bg: 236,
    agent: 180,
    model: 66,
    branch: 76,
    branchDirty: 178,
    ctx: 39,
    ctxLabel: 103,
    gaugeLo: 76,
    gaugeMid: 178,
    gaugeHi: 196,
    track: 240,
    time: 248,
    add: 70,
    del: 160,
    diff: 134,
    subsep: 244,
  },
  // Grayscale — low-key, no hue.
  mono: {
    bg: 236,
    agent: 253,
    model: 245,
    branch: 250,
    branchDirty: 247,
    ctx: 253,
    ctxLabel: 245,
    gaugeLo: 250,
    gaugeMid: 247,
    gaugeHi: 231,
    track: 239,
    time: 245,
    add: 252,
    del: 244,
    diff: 250,
    subsep: 240,
  },
};

// ── Font ──────────────────────────────────────────────────────
// Used only when rendering the bar to an image/SVG (the terminal owns
// the font for live output). Exposed via --dump-config so the preview
// renderer can pick it up. Override with STATUSLINE_FONT_FAMILY /
// STATUSLINE_FONT_WEIGHT / STATUSLINE_FONT_SIZE.
const FONT = {
  family: "'DejaVu Sans Mono', Menlo, Consolas, monospace",
  weight: 'normal',
  size: 15,
};

// ── Resolve config (apply env overrides) ──────────────────────

let useColor = (env.STATUSLINE_USE_COLOR ?? 'true') !== 'false';
let powerlineSetting = (env.STATUSLINE_POWERLINE ?? 'auto').toLowerCase();
let debug = (env.STATUSLINE_DEBUG ?? 'false') === 'true';

function envBool(name, fallback) {
  const v = env[name];
  if (v === undefined) return fallback;
  return v !== 'false' && v !== '0';
}

const segments = {};
for (const key of Object.keys(SEGMENTS)) {
  segments[key] = envBool(`STATUSLINE_SHOW_${key.toUpperCase()}`, SEGMENTS[key]);
}
if ((env.STATUSLINE_LIMITS ?? '') === 'false') segments.limits = false; // back-compat

const amberAt = num(env.STATUSLINE_AMBER_AT) ?? PERCENT.amberAt;
const redAt = num(env.STATUSLINE_RED_AT) ?? PERCENT.redAt;

const themeName = THEMES[env.STATUSLINE_THEME] ? env.STATUSLINE_THEME : 'p10k';
const C = { ...THEMES.p10k, ...THEMES[themeName] };
if (env.STATUSLINE_COLORS) {
  for (const pair of env.STATUSLINE_COLORS.split(',')) {
    const [k, v] = pair.split('=').map((s) => (s ?? '').trim());
    const code = num(v);
    if (k && code !== null) C[k] = code;
  }
}

const font = {
  family: env.STATUSLINE_FONT_FAMILY ?? FONT.family,
  weight: env.STATUSLINE_FONT_WEIGHT ?? FONT.weight,
  size: num(env.STATUSLINE_FONT_SIZE) ?? FONT.size,
};

// ── Parse args ────────────────────────────────────────────────

let adapter = 'auto';
let dumpConfig = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--adapter') adapter = process.argv[++i] ?? 'auto';
  else if (arg === '--no-color') useColor = false;
  else if (arg === '--powerline') powerlineSetting = 'true';
  else if (arg === '--no-powerline' || arg === '--plain') powerlineSetting = 'false';
  else if (arg === '--debug') debug = true;
  else if (arg === '--dump-config') dumpConfig = true;
}

if (dumpConfig) {
  process.stdout.write(
    JSON.stringify(
      { theme: themeName, colors: C, percent: { amberAt, redAt }, segments, font },
      null,
      2
    ) + '\n'
  );
  process.exit(0);
}

// ── Color + glyphs ────────────────────────────────────────────

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

const SUBSEP = usePowerline ? '\u{E0B1}' : '│';
const DIV = `${fg(C.subsep)}${SUBSEP}`;

// ── Helpers ───────────────────────────────────────────────────

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

function percentColor(pct) {
  if (!useColor) return '';
  if (pct >= redAt) return fg(C.gaugeHi);
  if (pct >= amberAt) return fg(C.gaugeMid);
  return fg(C.gaugeLo);
}

function renderGauge(pct) {
  const n = num(pct);
  if (n === null) return '·'.repeat(10);

  let bounded = Math.round(n);
  if (bounded > 100) bounded = 100;
  if (bounded < 0) bounded = 0;

  const filled = Math.floor(bounded / 10);
  const empty = 10 - filled;

  const track = useColor ? fg(C.track) : '';
  const emptyCell = useColor ? '█' : '░';
  return percentColor(bounded) + '█'.repeat(filled) + track + emptyCell.repeat(empty);
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
  process.stdout.write(`${fg(C.agent)}⊘ ${message}${rst()}`);
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
    sl.durationMs = first('cost.total_duration_ms', 'cost.duration_ms', 'duration_ms');
    sl.linesAdded =
      first('cost.total_lines_added', 'cost.lines_added', 'lines_added') ?? 0;
    sl.linesRemoved =
      first('cost.total_lines_removed', 'cost.lines_removed', 'lines_removed') ?? 0;
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

if (segments.gitBranch && sl.cwd && fs.existsSync(sl.cwd) && fs.statSync(sl.cwd).isDirectory()) {
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

// ── Custom env-var segments ───────────────────────────────────

const customSegmentsEnv = env.STATUSLINE_CUSTOM_SEGMENTS ?? '';
const customSegmentsFile =
  env.STATUSLINE_CUSTOM_SEGMENTS_FILE ??
  path.join(os.homedir(), '.config', 'agent-statusline', 'segments.conf');

function renderCustomSegments() {
  let defs = customSegmentsEnv;
  if (fs.existsSync(customSegmentsFile)) {
    try {
      for (const line of fs.readFileSync(customSegmentsFile, 'utf8').split(/\r?\n/)) {
        if (/^\s*#/.test(line) || !line.trim()) continue;
        defs = defs ? `${defs},${line}` : line;
      }
    } catch {
      /* ignore unreadable config */
    }
  }
  const result = [];
  if (!defs) return result;
  for (let segment of defs.split(',')) {
    segment = segment.trim();
    if (!segment) continue;
    const p = segment.split(':');
    const varName = (p[0] ?? '').trim();
    let label = (p[1] ?? '').trim();
    const color = num((p[2] ?? '').trim()) ?? C.model;
    if (!varName) continue;
    const value = env[varName];
    if (!value) continue;
    if (!label) {
      label = varName.toLowerCase();
      if (label.length > 12) label = label.slice(0, 12);
    }
    result.push(`${fg(C.ctxLabel)} ${label} ${fg(color)}${value} `);
  }
  return result;
}

// ── Render ────────────────────────────────────────────────────
// The bar is a head (agent name) plus a list of segment strings, each
// joined with the divider. Disabled or empty segments never enter the
// list, so they take their divider with them.

const fmtCtxCurrent = formatTokens(sl.ctxCurrent);
const fmtCtxLimit = formatTokens(sl.ctxLimit);
const fmtDuration = formatDuration(sl.durationMs);

let out = '';
if (useColor) out += bg(C.bg);

out += `${fg(C.agent)} ${sl.agentName}`;
if (segments.model && sl.model) out += `${fg(C.model)} ${sl.model}`;
out += ' ';

const loading = sl.ctxLimit === null || ((num(sl.ctxCurrent) ?? 0) === 0 && !sl.model);

if (loading) {
  out += DIV;
  out += `${fg(C.ctxLabel)} waiting for first exchange ${fg(C.time)}… `;
} else {
  const parts = [];

  if (segments.gitBranch && gitBranch) {
    parts.push(
      gitDirty
        ? `${fg(C.branchDirty)} ${gitBranch} ${gitDirty} `
        : `${fg(C.branch)} ${gitBranch} `
    );
  }

  if (segments.context) {
    parts.push(
      `${fg(C.ctxLabel)} ctx ${fg(C.ctx)}${fmtCtxCurrent}${fg(C.ctxLabel)}/${fg(C.ctx)}${fmtCtxLimit} `
    );
  }

  if (segments.gauge) {
    parts.push(` ${renderGauge(sl.ctxPct)} `);
  }

  if (segments.duration) {
    parts.push(`${fg(C.time)} ${fmtDuration} `);
  }

  if (segments.limits && sl.limits.length) {
    const lim = sl.limits.map((w) => {
      const used = Math.min(100, Math.max(0, Math.round(w.usedPct)));
      const reset = formatReset(w.resetsAt);
      return (
        `${fg(C.ctxLabel)}${w.label} ${percentColor(used)}${used}%` +
        (reset ? `${fg(C.time)} (${reset})` : '')
      );
    });
    parts.push(` ${lim.join(`${fg(C.subsep)} · `)} `);
  }

  if (
    segments.lines &&
    (String(sl.linesAdded) !== '0' || String(sl.linesRemoved) !== '0')
  ) {
    parts.push(`${fg(C.add)} +${sl.linesAdded}${fg(C.diff)}/${fg(C.del)}-${sl.linesRemoved} `);
  }

  if (segments.custom) {
    parts.push(...renderCustomSegments());
  }

  for (const p of parts) out += DIV + p;
}

out += rst();

process.stdout.write(out);
