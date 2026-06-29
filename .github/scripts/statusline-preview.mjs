#!/usr/bin/env node
// Renders the statusline for visual review across platforms:
//   • Adapters   — Claude + Copilot, plain/no-color (cross-OS smoke test)
//   • Themes     — every built-in theme, one bar each
//   • Percents   — gauge + usage limits at green / amber / red levels
//
// Runs identically on Linux, macOS, and Windows (all work in Node, no shell
// piping). Prints colored bars to the log, a plain-text preview to the GitHub
// step summary, and SVG snapshots uploaded as per-OS artifacts. Exits non-zero
// if an adapter render throws or drops an expected segment.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseAnsiRuns,
  emitRunGlyphs,
  xmlEscape,
  CHAR_WIDTH_EM,
  BASELINE_EM,
  DEFAULT_PAGE_BG,
} from './ansi-svg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const script = path.join(
  root,
  'agents',
  'skills',
  'env',
  'statusline-install',
  'scripts',
  'statusline.js'
);
const outDir = path.join(root, 'statusline-preview');
mkdirSync(outDir, { recursive: true });

// Pull resolved config (font + theme list) straight from the skill so the
// preview always matches the live config — single source of truth.
let CFG = {
  availableThemes: ['p10k'],
  font: { family: "'DejaVu Sans Mono', Menlo, Consolas, monospace", weight: 'normal', size: 15 },
};
try {
  CFG = JSON.parse(execFileSync(process.execPath, [script, '--dump-config'], { encoding: 'utf8' }));
} catch {
  /* fall back to defaults */
}

const osLabel =
  { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] ?? process.platform;

function render(payload, args, extraEnv = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, STATUSLINE_BRANCH: 'feat/statusline', ...extraEnv },
  });
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const chevronize = (s) => s.replace(/[\u{E0B0}\u{E0B1}]/gu, '❯');

// ── Payloads ──────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const claude = (used, fiveH, sevenD) => ({
  model: { display_name: 'Opus 4.8' },
  effort: { level: 'high' },
  cwd: process.cwd(),
  context_window: {
    total_input_tokens: Math.round((used / 100) * 1_000_000),
    context_window_size: 1_000_000,
    used_percentage: used,
  },
  cost: { total_duration_ms: 725_000, total_lines_added: 156, total_lines_removed: 23 },
  rate_limits: {
    // small buffer past the boundary so the floored countdown reads cleanly
    five_hour: { used_percentage: fiveH, resets_at: now + 3 * 3600 + 600 },
    seven_day: { used_percentage: sevenD, resets_at: now + 2 * 86400 + 3600 },
  },
});
const copilot = {
  model: { id: 'claude-haiku-4.5' },
  cwd: process.cwd(),
  context_window: {
    current_context_tokens: 42_000,
    displayed_context_limit: 160_000,
    current_context_used_percentage: 26,
  },
  cost: { total_duration_ms: 1_054_000, total_lines_added: 10, total_lines_removed: 4 },
  ai_used: { formatted: '8.4', total_nano_aiu: 8_400_000_000 },
};

// ── ANSI → SVG ────────────────────────────────────────────────
const PAD = 8; // left/right inner padding around the bar

function ansiToSvg(ansi) {
  const fontSize = CFG.font.size;
  const cw = fontSize * CHAR_WIDTH_EM;
  const { runs, cols } = parseAnsiRuns(ansi);

  const width = Math.ceil(cols * cw) + PAD * 2;
  const height = Math.ceil(fontSize * 2);
  const pageBg = runs.find((r) => r.bg)?.bg ?? DEFAULT_PAGE_BG;
  const rects = runs
    .filter((r) => r.bg)
    .map(
      (r) =>
        `<rect x="${(PAD + r.col * cw).toFixed(1)}" y="0" width="${(r.text.length * cw).toFixed(1)}" height="${height}" fill="${r.bg}"/>`
    )
    .join('');

  const { shapes, tspans } = emitRunGlyphs(runs, { x0: PAD, yTop: 0, rowHeight: height, cw, fontSize });
  const baseline = height / 2 + fontSize * BASELINE_EM;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${xmlEscape(CFG.font.family)}" font-weight="${CFG.font.weight}" font-size="${fontSize}">` +
    `<rect width="100%" height="100%" fill="${pageBg}"/>${rects}${shapes}` +
    `<text y="${baseline.toFixed(1)}" xml:space="preserve">${tspans}</text></svg>`
  );
}

// ── Run ───────────────────────────────────────────────────────
let md = `## Statusline preview — ${osLabel} \`${process.platform}\`, Node ${process.version}\n\n`;
md +=
  '> Powerline separators show as `❯` in the text previews (the summary font has no patched glyphs); the SVG artifacts draw them as real shapes.\n\n';
let failures = 0;

function emit(label, ansi, svgName) {
  process.stdout.write(`\n\x1b[1m[${osLabel}] ${label}\x1b[0m\n${chevronize(ansi)}\n`);
  md += `**${label}**\n\n\`\`\`\n${chevronize(stripAnsi(ansi))}\n\`\`\`\n\n`;
  if (svgName) {
    try {
      writeFileSync(path.join(outDir, `${process.platform}-${svgName}.svg`), ansiToSvg(ansi));
    } catch (e) {
      console.error(`svg ${svgName}: ${e.message}`);
    }
  }
}

// A. Adapters (cross-OS smoke)
md += '### Adapters\n\n';
const adapterCases = [
  ['Claude', claude(26, 13, 64), ['Claude', '[high]', 'ctx', '5h']],
  ['Copilot', copilot, ['Copilot', 'ctx', '⚡8.4']],
];
for (const [agent, payload, expect] of adapterCases) {
  let out;
  try {
    out = render(payload, ['--no-powerline']);
  } catch (e) {
    failures++;
    console.error(`[${osLabel}] ${agent}: ${e.message}`);
    continue;
  }
  for (const needle of expect) {
    if (!stripAnsi(out).includes(needle)) {
      failures++;
      console.error(`[${osLabel}] ${agent}: missing "${needle}"`);
    }
  }
  emit(`${agent} (plain)`, out, `adapter-${agent}`);
}

// B. Theme gallery
md += '### Themes\n\n';
for (const theme of CFG.availableThemes) {
  const out = render(claude(34, 13, 48), ['--powerline'], { STATUSLINE_THEME: theme });
  emit(`theme: ${theme}`, out, `theme-${theme}`);
}

// C. Percent examples (default theme)
md += '### Percent colors (green / amber / red)\n\n';
const levels = [
  ['green', 20, 18, 24],
  ['amber', 60, 58, 64],
  ['red', 92, 88, 95],
];
for (const [name, used, fiveH, sevenD] of levels) {
  const out = render(claude(used, fiveH, sevenD), ['--powerline']);
  emit(`percent: ${name} (~${used}%)`, out, `percent-${name}`);
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
else process.stdout.write('\n--- step summary (preview) ---\n' + md);

if (failures) {
  console.error(`\n${failures} adapter check(s) failed on ${osLabel}.`);
  process.exit(1);
}
console.log(`\nOK — ${osLabel}: rendered adapters, ${CFG.availableThemes.length} themes, 3 percent levels.`);
