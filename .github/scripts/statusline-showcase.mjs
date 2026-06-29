#!/usr/bin/env node
// Composes one showcase SVG (Claude + Copilot, every theme, and the
// green/amber/red percent levels) for the skill's README. Renders each bar
// with the real statusline.js, then lays them out as labeled rows.
//
//   node .github/scripts/statusline-showcase.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
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
const skill = path.join(root, 'agents', 'skills', 'env', 'statusline-install');
const script = path.join(skill, 'scripts', 'statusline.js');
const assets = path.join(root, 'docs', 'images');
mkdirSync(assets, { recursive: true });

const CFG = JSON.parse(execFileSync(process.execPath, [script, '--dump-config'], { encoding: 'utf8' }));
const now = Math.floor(Date.now() / 1000);

const claude = (used, fiveH, sevenD) => ({
  model: { display_name: 'Opus 4.8' },
  effort: { level: 'high' },
  cwd: root,
  context_window: {
    total_input_tokens: Math.round((used / 100) * 1_000_000),
    context_window_size: 1_000_000,
    used_percentage: used,
  },
  cost: { total_duration_ms: 9_525_000, total_lines_added: 156, total_lines_removed: 23 },
  rate_limits: {
    five_hour: { used_percentage: fiveH, resets_at: now + 3 * 3600 + 600 },
    seven_day: { used_percentage: sevenD, resets_at: now + 2 * 86400 + 3600 },
  },
});
const copilot = {
  model: { id: 'claude-haiku-4.5' },
  cwd: root,
  context_window: {
    current_context_tokens: 42_000,
    displayed_context_limit: 160_000,
    current_context_used_percentage: 26,
  },
  cost: { total_duration_ms: 1_054_000, total_lines_added: 10, total_lines_removed: 4 },
  ai_used: { formatted: '8.4', total_nano_aiu: 8_400_000_000 },
};

function render(payload, theme) {
  const extra = theme ? { STATUSLINE_THEME: theme } : {};
  return execFileSync(process.execPath, [script, '--powerline'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, STATUSLINE_BRANCH: 'feat/statusline', ...extra, TERM_PROGRAM: 'ghostty' },
  });
}

const copilotAt = (pct) => ({
  ...copilot,
  context_window: {
    current_context_tokens: Math.round((pct / 100) * 160_000),
    displayed_context_limit: 160_000,
    current_context_used_percentage: pct,
  },
});

// ── rows ──────────────────────────────────────────────────────
const rows = [
  { section: 'Harnesses' },
  { label: 'Claude', ansi: render(claude(34, 13, 48)) },
  { label: 'Copilot', ansi: render(copilot) },
  { section: 'Themes' },
  ...CFG.availableThemes.flatMap((t) => [
    { label: t, ansi: render(claude(34, 13, 48), t) },
    { label: '↳ copilot', ansi: render(copilot, t) },
  ]),
  { section: 'Usage % — green · amber · red' },
  { label: 'green', ansi: render(claude(20, 18, 24)) },
  { label: '↳ copilot', ansi: render(copilotAt(20)) },
  { label: 'amber', ansi: render(claude(60, 58, 64)) },
  { label: '↳ copilot', ansi: render(copilotAt(60)) },
  { label: 'red', ansi: render(claude(92, 88, 95)) },
  { label: '↳ copilot', ansi: render(copilotAt(92)) },
];

// ── ANSI → SVG row ────────────────────────────────────────────
const FS = 15;
const CW = FS * CHAR_WIDTH_EM;
const ROWH = 28;
const PITCH = ROWH + 8;
const HEADER = 30;
const GUTTER = 116;
const PADX = 16;
const PADTOP = 14;

function parseRow(ansi, x0, y0) {
  const { runs, cols } = parseAnsiRuns(ansi);
  const { shapes, tspans } = emitRunGlyphs(runs, { x0, yTop: y0, rowHeight: ROWH, cw: CW, fontSize: FS });
  const baseline = y0 + ROWH / 2 + FS * BASELINE_EM;
  const bg = runs.find((r) => r.bg)?.bg ?? DEFAULT_PAGE_BG;
  return {
    bg,
    contentWidth: cols * CW,
    frag: shapes,
    text: `<text y="${baseline.toFixed(1)}" xml:space="preserve">${tspans}</text>`,
  };
}

// ── layout ────────────────────────────────────────────────────
let y = PADTOP;
const items = [];
for (const r of rows) {
  if (r.section) {
    items.push({ type: 'header', text: r.section, y: y + 18 });
    y += HEADER;
  } else {
    items.push({ type: 'row', label: r.label, top: y, ...parseRow(r.ansi, GUTTER, y) });
    y += PITCH;
  }
}
const totalH = y + PADTOP - 8;
const colW = Math.max(...items.filter((i) => i.type === 'row').map((i) => i.contentWidth)) + 14;
const totalW = GUTTER + colW + PADX;

const PAGE = '#0d1117';
const LABEL = '#8b949e';
const HEAD = '#e6edf3';

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(totalW)}" height="${Math.ceil(totalH)}" font-family="${xmlEscape(CFG.font.family)}" font-size="${FS}">`;
svg += `<rect width="100%" height="100%" rx="8" fill="${PAGE}"/>`;
// row backgrounds (theme bg), the bar column
for (const it of items) {
  if (it.type !== 'row') continue;
  svg += `<rect x="${GUTTER}" y="${it.top}" width="${colW.toFixed(1)}" height="${ROWH}" rx="3" fill="${it.bg}"/>`;
}
// section headers + row labels
for (const it of items) {
  if (it.type === 'header') {
    svg += `<text x="8" y="${it.y}" fill="${HEAD}" font-size="${FS - 2}" font-weight="bold">${xmlEscape(it.text)}</text>`;
  } else {
    const ly = it.top + ROWH / 2 + FS * 0.35;
    svg += `<text x="${GUTTER - 12}" y="${ly.toFixed(1)}" fill="${LABEL}" font-size="${FS - 2}" text-anchor="end">${xmlEscape(it.label)}</text>`;
  }
}
// bar content (shapes + glyphs) on top
for (const it of items) {
  if (it.type !== 'row') continue;
  svg += it.frag + it.text;
}
svg += '</svg>';

const outFile = path.join(assets, 'statusline-showcase.svg');
writeFileSync(outFile, svg);
console.log(`wrote ${path.relative(root, outFile)} (${(svg.length / 1024).toFixed(1)} KB, ${Math.ceil(totalW)}x${Math.ceil(totalH)})`);
