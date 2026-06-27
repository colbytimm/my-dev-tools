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
//   • Codex CLI          (forward-ready: parses Codex's hook JSON shape.
//                          Codex has no command-backed statusline hook yet
//                          — see openai/codex#20043 — so it can't drive this
//                          live today; the adapter is ready for when it can,
//                          or behind a polling wrapper. Force with
//                          --adapter codex.)
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
const GAUGE_CELLS = 10; // width of the context-fill gauge, in cells
const STDIN_FD = 0;

function num(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(n) {
  return Math.min(100, Math.max(0, Math.round(n)));
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
// Named palettes. Select one with STATUSLINE_THEME (default "p10k").
// Add a built-in by adding a key with the same shape. Built-in colors are
// '#rrggbb' truecolor (needs a 24-bit terminal); a 256-color code (number)
// also works. Override individual colors via STATUSLINE_COLORS, e.g.
// "agent=#ff79c6,gaugeHi=#ff5555".
const THEMES = {
  // Powerlevel10k classic — the original look (xterm-256 equivalents).
  p10k: {
    bg: '#303030', agent: '#d7af87', model: '#5f8787', branch: '#5fd700',
    branchDirty: '#d7af00', ctx: '#00afff', ctxLabel: '#8787af', gaugeLo: '#5fd700',
    gaugeMid: '#d7af00', gaugeHi: '#ff0000', track: '#585858', time: '#a8a8a8',
    add: '#5faf00', del: '#d70000', diff: '#af5fd7', subsep: '#808080',
  },
  // Grayscale — low-key, no hue.
  mono: {
    bg: '#303030', agent: '#dadada', model: '#8a8a8a', branch: '#bcbcbc',
    branchDirty: '#9e9e9e', ctx: '#dadada', ctxLabel: '#8a8a8a', gaugeLo: '#bcbcbc',
    gaugeMid: '#9e9e9e', gaugeHi: '#ffffff', track: '#4e4e4e', time: '#8a8a8a',
    add: '#d0d0d0', del: '#808080', diff: '#bcbcbc', subsep: '#585858',
  },

  // Popular editor themes.
  dracula: {
    bg: '#282a36', agent: '#bd93f9', model: '#6272a4', branch: '#50fa7b',
    branchDirty: '#ffb86c', ctx: '#8be9fd', ctxLabel: '#6272a4', gaugeLo: '#50fa7b',
    gaugeMid: '#ffb86c', gaugeHi: '#ff5555', track: '#44475a', time: '#6272a4',
    add: '#50fa7b', del: '#ff5555', diff: '#ff79c6', subsep: '#6272a4',
  },
  nord: {
    bg: '#2e3440', agent: '#88c0d0', model: '#81a1c1', branch: '#a3be8c',
    branchDirty: '#ebcb8b', ctx: '#88c0d0', ctxLabel: '#81a1c1', gaugeLo: '#a3be8c',
    gaugeMid: '#ebcb8b', gaugeHi: '#bf616a', track: '#434c5e', time: '#616e88',
    add: '#a3be8c', del: '#bf616a', diff: '#b48ead', subsep: '#4c566a',
  },
  gruvbox: {
    bg: '#282828', agent: '#fabd2f', model: '#928374', branch: '#b8bb26',
    branchDirty: '#fe8019', ctx: '#83a598', ctxLabel: '#928374', gaugeLo: '#b8bb26',
    gaugeMid: '#fabd2f', gaugeHi: '#fb4934', track: '#504945', time: '#928374',
    add: '#b8bb26', del: '#fb4934', diff: '#d3869b', subsep: '#665c54',
  },
  tokyonight: {
    bg: '#1a1b26', agent: '#7aa2f7', model: '#565f89', branch: '#9ece6a',
    branchDirty: '#e0af68', ctx: '#7dcfff', ctxLabel: '#565f89', gaugeLo: '#9ece6a',
    gaugeMid: '#e0af68', gaugeHi: '#f7768e', track: '#414868', time: '#565f89',
    add: '#9ece6a', del: '#f7768e', diff: '#bb9af7', subsep: '#414868',
  },
  catppuccin: {
    bg: '#1e1e2e', agent: '#cba6f7', model: '#6c7086', branch: '#a6e3a1',
    branchDirty: '#f9e2af', ctx: '#89b4fa', ctxLabel: '#a6adc8', gaugeLo: '#a6e3a1',
    gaugeMid: '#fab387', gaugeHi: '#f38ba8', track: '#45475a', time: '#6c7086',
    add: '#a6e3a1', del: '#f38ba8', diff: '#f5c2e7', subsep: '#585b70',
  },
  onedark: {
    bg: '#282c34', agent: '#61afef', model: '#5c6370', branch: '#98c379',
    branchDirty: '#e5c07b', ctx: '#56b6c2', ctxLabel: '#5c6370', gaugeLo: '#98c379',
    gaugeMid: '#d19a66', gaugeHi: '#e06c75', track: '#3e4451', time: '#5c6370',
    add: '#98c379', del: '#e06c75', diff: '#c678dd', subsep: '#4b5263',
  },
  solarized: {
    bg: '#002b36', agent: '#268bd2', model: '#586e75', branch: '#859900',
    branchDirty: '#b58900', ctx: '#2aa198', ctxLabel: '#657b83', gaugeLo: '#859900',
    gaugeMid: '#b58900', gaugeHi: '#dc322f', track: '#073642', time: '#586e75',
    add: '#859900', del: '#dc322f', diff: '#6c71c4', subsep: '#586e75',
  },
  monokai: {
    bg: '#272822', agent: '#66d9ef', model: '#75715e', branch: '#a6e22e',
    branchDirty: '#e6db74', ctx: '#66d9ef', ctxLabel: '#75715e', gaugeLo: '#a6e22e',
    gaugeMid: '#fd971f', gaugeHi: '#f92672', track: '#49483e', time: '#75715e',
    add: '#a6e22e', del: '#f92672', diff: '#ae81ff', subsep: '#49483e',
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
const colors = { ...THEMES.p10k, ...THEMES[themeName] };
if (env.STATUSLINE_COLORS) {
  for (const pair of env.STATUSLINE_COLORS.split(',')) {
    const [k, v] = pair.split('=').map((s) => (s ?? '').trim());
    if (!k || !v) continue;
    colors[k] = v[0] === '#' ? v : (num(v) ?? colors[k]);
  }
}

const font = {
  family: env.STATUSLINE_FONT_FAMILY ?? FONT.family,
  weight: env.STATUSLINE_FONT_WEIGHT ?? FONT.weight,
  size: num(env.STATUSLINE_FONT_SIZE) ?? FONT.size,
};

let adapterOverride = 'auto';
let dumpConfig = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--adapter') adapterOverride = process.argv[++i] ?? 'auto';
  else if (arg === '--no-color') useColor = false;
  else if (arg === '--powerline') powerlineSetting = 'true';
  else if (arg === '--no-powerline' || arg === '--plain') powerlineSetting = 'false';
  else if (arg === '--debug') debug = true;
  else if (arg === '--dump-config') dumpConfig = true;
}

if (dumpConfig) {
  process.stdout.write(
    JSON.stringify(
      {
        theme: themeName,
        availableThemes: Object.keys(THEMES),
        colors,
        percent: { amberAt, redAt },
        segments,
        font,
      },
      null,
      2
    ) + '\n'
  );
  process.exit(0);
}

// ── Color + glyphs ────────────────────────────────────────────
// A color is a 256-color code (number) or a '#rrggbb' string (truecolor).
function ansiColor(layer, v) {
  if (typeof v === 'string' && v[0] === '#') {
    const r = parseInt(v.slice(1, 3), 16);
    const g = parseInt(v.slice(3, 5), 16);
    const b = parseInt(v.slice(5, 7), 16);
    return `\x1b[${layer};2;${r};${g};${b}m`;
  }
  return `\x1b[${layer};5;${v}m`;
}
const ANSI_FG = 38;
const ANSI_BG = 48;
const bg = useColor ? (v) => ansiColor(ANSI_BG, v) : () => '';
const fg = useColor ? (v) => ansiColor(ANSI_FG, v) : () => '';
const rst = useColor ? () => '\x1b[0m' : () => '';

// Powerline separators (U+E0B0/E0B1) need a patched font; degrade to a
// plain bar on terminals known to lack PUA glyph fallback.
const NO_PUA_TERMINALS = ['Apple_Terminal', 'vscode'];
function resolvePowerline() {
  if (!useColor) return false;
  if (powerlineSetting === 'true' || powerlineSetting === '1') return true;
  if (powerlineSetting === 'false' || powerlineSetting === '0') return false;
  return !NO_PUA_TERMINALS.includes(env.TERM_PROGRAM ?? '');
}
const usePowerline = resolvePowerline();
const SUBSEP = usePowerline ? '\u{E0B1}' : '│';
const DIV = `${fg(colors.subsep)}${SUBSEP}`;

const SECONDS_PER = { day: 86400, hour: 3600, minute: 60 };

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
  const hours = Math.floor(totalSecs / SECONDS_PER.hour);
  const mins = Math.floor((totalSecs % SECONDS_PER.hour) / SECONDS_PER.minute);
  const secs = totalSecs % SECONDS_PER.minute;
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function formatReset(epochSec) {
  const n = num(epochSec);
  if (n === null) return '';
  const secs = Math.round(n - Date.now() / 1000);
  if (secs <= 0) return 'now';
  if (secs >= SECONDS_PER.day) return `${Math.floor(secs / SECONDS_PER.day)}d`;
  if (secs >= SECONDS_PER.hour) return `${Math.floor(secs / SECONDS_PER.hour)}h`;
  return `${Math.floor(secs / SECONDS_PER.minute)}m`;
}

function percentColor(pct) {
  if (!useColor) return '';
  if (pct >= redAt) return fg(colors.gaugeHi);
  if (pct >= amberAt) return fg(colors.gaugeMid);
  return fg(colors.gaugeLo);
}

function renderGauge(pct) {
  const n = num(pct);
  if (n === null) return '·'.repeat(GAUGE_CELLS);

  const bounded = clampPercent(n);
  const filled = Math.floor((bounded / 100) * GAUGE_CELLS);
  const empty = GAUGE_CELLS - filled;

  const track = useColor ? fg(colors.track) : '';
  const emptyCell = useColor ? '█' : '░';
  return percentColor(bounded) + '█'.repeat(filled) + track + emptyCell.repeat(empty);
}

function bail(message) {
  process.stdout.write(`${fg(colors.agent)}⊘ ${message}${rst()}`);
  process.exit(0);
}

function readPayload() {
  let payload = '';
  try {
    payload = fs.readFileSync(STDIN_FD, 'utf8');
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
  if (!payload.trim()) bail('Agent status unavailable');
  try {
    return JSON.parse(payload);
  } catch {
    return bail('Invalid payload');
  }
}

function getPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, obj);
}

// Copilot must be tested first: its payload now also carries the
// Claude-style context_window.{context_window_size,used_percentage},
// but the display-view fields below are exclusive to Copilot.
function detectAdapter(data) {
  const has = (...paths) =>
    paths.some((p) => {
      const v = getPath(data, p);
      return v !== null && v !== undefined;
    });
  if (
    has(
      'context_window.current_context_tokens',
      'context_window.displayed_context_limit',
      'context_window.current_context_used_percentage'
    )
  ) {
    return 'copilot';
  }
  // Codex's hook JSON carries a top-level `model_provider` (and a plain-string
  // `model`), neither of which Claude or Copilot emit — distinctive enough to
  // detect on. Checked before claude-code so a future Codex payload that also
  // adds Claude-style context_window fields still routes to the Codex adapter.
  if (has('model_provider') || typeof getPath(data, 'model') === 'string') {
    return 'codex';
  }
  if (
    has(
      'context_window.used_percentage',
      'context_window.context_window_size',
      'context_window.total_input_tokens',
      'effort',
      'thinking',
      'exceeds_200k_tokens'
    )
  ) {
    return 'claude-code';
  }
  return 'generic';
}

function normalize(adapter, data) {
  const read = (...paths) => {
    for (const p of paths) {
      const v = getPath(data, p);
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  };

  const session = {
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
      session.agentName = 'Copilot';
      session.model = read('model.id', 'model.display_name');
      session.cwd = read('cwd', 'workspace.current_dir');
      session.ctxCurrent = read('context_window.current_context_tokens');
      session.ctxLimit = read('context_window.displayed_context_limit');
      session.ctxPct = read('context_window.current_context_used_percentage');
      session.durationMs = read('cost.total_duration_ms');
      session.linesAdded = read('cost.total_lines_added') ?? 0;
      session.linesRemoved = read('cost.total_lines_removed') ?? 0;
      break;

    case 'codex': {
      session.agentName = 'Codex';
      // Codex's hook schema carries `model` as a plain string; fall back to the
      // object shapes in case a future payload nests it like the others do.
      session.model = read('model.display_name', 'model.id', 'model');
      session.cwd = read('cwd', 'workspace.current_dir');
      session.ctxCurrent = read(
        'context_window.current_context_tokens',
        'context_window.total_input_tokens',
        'token_count',
        'tokens_used'
      );
      session.ctxLimit = read(
        'context_window.displayed_context_limit',
        'context_window.context_window_size',
        'context_window_size'
      );
      session.ctxPct = read(
        'context_window.current_context_used_percentage',
        'context_window.used_percentage'
      );
      session.durationMs = read('cost.total_duration_ms', 'duration_ms');
      session.linesAdded = read('cost.total_lines_added', 'lines_added') ?? 0;
      session.linesRemoved = read('cost.total_lines_removed', 'lines_removed') ?? 0;
      break;
    }

    case 'claude-code': {
      session.agentName = 'Claude';
      session.model = read('model.display_name', 'model.id');
      session.cwd = read('cwd', 'workspace.current_dir');
      const inTok = num(read('context_window.total_input_tokens')) ?? 0;
      const outTok = num(read('context_window.total_output_tokens')) ?? 0;
      session.ctxCurrent = inTok + outTok || null;
      session.ctxLimit = read('context_window.context_window_size');
      session.ctxPct = read('context_window.used_percentage');
      session.durationMs = read('cost.total_duration_ms');
      session.linesAdded = read('cost.total_lines_added') ?? 0;
      session.linesRemoved = read('cost.total_lines_removed') ?? 0;
      break;
    }

    default:
      session.agentName = 'Agent';
      session.model = read('model.display_name', 'model.id', 'model');
      session.cwd = read('cwd', 'workspace.current_dir');
      session.ctxCurrent = read(
        'context_window.current_context_tokens',
        'context_window.total_input_tokens',
        'context.tokens_used',
        'tokens_used'
      );
      session.ctxLimit = read(
        'context_window.displayed_context_limit',
        'context_window.context_window_size',
        'context.tokens_limit',
        'tokens_limit'
      );
      session.ctxPct = read(
        'context_window.current_context_used_percentage',
        'context_window.used_percentage',
        'context.pct'
      );
      session.durationMs = read('cost.total_duration_ms', 'cost.duration_ms', 'duration_ms');
      session.linesAdded = read('cost.total_lines_added', 'cost.lines_added', 'lines_added') ?? 0;
      session.linesRemoved =
        read('cost.total_lines_removed', 'cost.lines_removed', 'lines_removed') ?? 0;
      break;
  }

  session.limits = [
    { label: '5h', window: 'five_hour' },
    { label: 'wk', window: 'seven_day' },
  ]
    .map((w) => ({
      label: w.label,
      usedPct: num(read(`rate_limits.${w.window}.used_percentage`)),
      resetsAt: read(`rate_limits.${w.window}.resets_at`),
    }))
    .filter((w) => w.usedPct !== null);

  return session;
}

const MAX_BRANCH_LEN = 32;
const BRANCH_KEEP = 12; // chars kept from each end when eliding a long branch

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

function resolveGit(cwd) {
  if (!segments.gitBranch || !cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return { branch: '', dirty: '' };
  }
  let branch =
    git(['symbolic-ref', '--short', 'HEAD'], cwd) || git(['rev-parse', '--short', 'HEAD'], cwd);
  if (!branch) return { branch: '', dirty: '' };
  if (branch.length > MAX_BRANCH_LEN) {
    branch = `${branch.slice(0, BRANCH_KEEP)}…${branch.slice(-BRANCH_KEEP)}`;
  }
  const dirty = git(['status', '--porcelain'], cwd) ? '!' : '';
  return { branch, dirty };
}

const MAX_CUSTOM_LABEL = 12;
const customSegmentsEnv = env.STATUSLINE_CUSTOM_SEGMENTS ?? '';
const customSegmentsFile =
  env.STATUSLINE_CUSTOM_SEGMENTS_FILE ??
  path.join(os.homedir(), '.config', 'agent-statusline', 'segments.conf');

function loadCustomDefs() {
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
  return defs;
}

function renderCustomSegments() {
  const result = [];
  const defs = loadCustomDefs();
  if (!defs) return result;
  for (let segment of defs.split(',')) {
    segment = segment.trim();
    if (!segment) continue;
    const parts = segment.split(':');
    const varName = (parts[0] ?? '').trim();
    let label = (parts[1] ?? '').trim();
    const color = num((parts[2] ?? '').trim()) ?? colors.model;
    if (!varName) continue;
    const value = env[varName];
    if (!value) continue;
    if (!label) {
      label = varName.toLowerCase().slice(0, MAX_CUSTOM_LABEL);
    }
    result.push(`${fg(colors.ctxLabel)} ${label} ${fg(color)}${value} `);
  }
  return result;
}

// The bar is a head (agent name) plus a list of segment strings joined by the
// divider. Disabled or empty segments never enter the list, so they take their
// divider with them.
function buildBar(session, gitInfo) {
  const fmtCtxCurrent = formatTokens(session.ctxCurrent);
  const fmtCtxLimit = formatTokens(session.ctxLimit);
  const fmtDuration = formatDuration(session.durationMs);

  let out = '';
  if (useColor) out += bg(colors.bg);

  out += `${fg(colors.agent)} ${session.agentName}`;
  if (segments.model && session.model) out += `${fg(colors.model)} ${session.model}`;
  out += ' ';

  const loading =
    session.ctxLimit === null || ((num(session.ctxCurrent) ?? 0) === 0 && !session.model);

  if (loading) {
    out += DIV;
    out += `${fg(colors.ctxLabel)} waiting for first exchange ${fg(colors.time)}… `;
    return out + rst();
  }

  const parts = [];

  if (segments.gitBranch && gitInfo.branch) {
    parts.push(
      gitInfo.dirty
        ? `${fg(colors.branchDirty)} ${gitInfo.branch} ${gitInfo.dirty} `
        : `${fg(colors.branch)} ${gitInfo.branch} `
    );
  }

  if (segments.context) {
    parts.push(
      `${fg(colors.ctxLabel)} ctx ${fg(colors.ctx)}${fmtCtxCurrent}${fg(colors.ctxLabel)}/${fg(colors.ctx)}${fmtCtxLimit} `
    );
  }

  if (segments.gauge) {
    parts.push(` ${renderGauge(session.ctxPct)} `);
  }

  if (segments.duration) {
    parts.push(`${fg(colors.time)} ${fmtDuration} `);
  }

  if (segments.limits && session.limits.length) {
    const lim = session.limits.map((w) => {
      const used = clampPercent(w.usedPct);
      const reset = formatReset(w.resetsAt);
      return (
        `${fg(colors.ctxLabel)}${w.label} ${percentColor(used)}${used}%` +
        (reset ? `${fg(colors.time)} (${reset})` : '')
      );
    });
    parts.push(` ${lim.join(`${fg(colors.subsep)} · `)} `);
  }

  if (
    segments.lines &&
    (String(session.linesAdded) !== '0' || String(session.linesRemoved) !== '0')
  ) {
    parts.push(
      `${fg(colors.add)} +${session.linesAdded}${fg(colors.diff)}/${fg(colors.del)}-${session.linesRemoved} `
    );
  }

  if (segments.custom) {
    parts.push(...renderCustomSegments());
  }

  for (const p of parts) out += DIV + p;
  return out + rst();
}

function main() {
  const data = readPayload();
  const adapter = adapterOverride === 'auto' ? detectAdapter(data) : adapterOverride;
  const session = normalize(adapter, data);
  const gitInfo = resolveGit(session.cwd);
  process.stdout.write(buildBar(session, gitInfo));
}

main();
