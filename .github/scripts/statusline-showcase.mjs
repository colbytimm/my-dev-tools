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
};

function render(payload, theme) {
  const extra = theme ? { STATUSLINE_THEME: theme } : {};
  return execFileSync(process.execPath, [script, '--powerline'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...extra, TERM_PROGRAM: 'ghostty' },
  });
}

// ── rows ──────────────────────────────────────────────────────
const rows = [
  { section: 'Harnesses' },
  { label: 'Claude', ansi: render(claude(34, 13, 48)) },
  { label: 'Copilot', ansi: render(copilot) },
  { section: 'Themes' },
  ...CFG.availableThemes.map((t) => ({ label: t, ansi: render(claude(34, 13, 48), t) })),
  { section: 'Usage % — green · amber · red' },
  { label: 'green', ansi: render(claude(20, 18, 24)) },
  { label: 'amber', ansi: render(claude(60, 58, 64)) },
  { label: 'red', ansi: render(claude(92, 88, 95)) },
];

// ── ANSI → SVG row ────────────────────────────────────────────
const FS = 15;
const CW = FS * 0.56;
const ROWH = 28;
const PITCH = ROWH + 8;
const HEADER = 30;
const GUTTER = 116;
const PADX = 16;
const PADTOP = 14;

const hex = (r, g, b) => `#${[r, g, b].map((v) => (v & 255).toString(16).padStart(2, '0')).join('')}`;
const BASIC = [
  '000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff',
];
const CUBE = [0, 95, 135, 175, 215, 255];
function color256(n) {
  if (n < 16) return `#${BASIC[n]}`;
  if (n < 232) {
    const i = n - 16;
    return hex(CUBE[Math.floor(i / 36) % 6], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]);
  }
  const v = 8 + (n - 232) * 10;
  return hex(v, v, v);
}
const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseRow(ansi, x0, y0) {
  let fg = '#cccccc';
  let bgc = null;
  const runs = [];
  let buf = '';
  let cols = 0;
  const flush = () => {
    if (buf) runs.push({ text: buf, fg, bg: bgc, col: cols - buf.length });
    buf = '';
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  const push = (t) => {
    for (const ch of t) {
      buf += ch;
      cols += 1;
    }
  };
  while ((m = re.exec(ansi))) {
    push(ansi.slice(last, m.index));
    flush();
    const c = m[1].split(';').map(Number);
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 0) {
        fg = '#cccccc';
        bgc = null;
      } else if (c[i] === 38 && c[i + 1] === 5) {
        fg = color256(c[i + 2]);
        i += 2;
      } else if (c[i] === 48 && c[i + 1] === 5) {
        bgc = color256(c[i + 2]);
        i += 2;
      } else if (c[i] === 38 && c[i + 1] === 2) {
        fg = hex(c[i + 2], c[i + 3], c[i + 4]);
        i += 4;
      } else if (c[i] === 48 && c[i + 1] === 2) {
        bgc = hex(c[i + 2], c[i + 3], c[i + 4]);
        i += 4;
      }
    }
    last = re.lastIndex;
  }
  push(ansi.slice(last));
  flush();

  const mid = y0 + ROWH / 2;
  const top = mid - FS * 0.7;
  const bot = mid + FS * 0.7;
  const baseline = mid + FS * 0.35;
  let frag = '';
  let texts = '';
  for (const r of runs) {
    for (let i = 0; i < r.text.length; i++) {
      const cp = r.text.codePointAt(i);
      const x = x0 + (r.col + i) * CW;
      if (cp === 0xe0b0) {
        frag += `<polygon points="${x.toFixed(1)},${y0} ${(x + CW).toFixed(1)},${mid.toFixed(1)} ${x.toFixed(1)},${(y0 + ROWH).toFixed(1)}" fill="${r.fg}"/>`;
      } else if (cp === 0xe0b1) {
        frag += `<polyline points="${(x + 2).toFixed(1)},${top.toFixed(1)} ${(x + CW - 2).toFixed(1)},${mid.toFixed(1)} ${(x + 2).toFixed(1)},${bot.toFixed(1)}" fill="none" stroke="${r.fg}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else {
        texts += `<tspan x="${x.toFixed(1)}" fill="${r.fg}">${xmlEscape(r.text[i])}</tspan>`;
      }
    }
  }
  const bg = runs.find((r) => r.bg)?.bg ?? '#1d1f21';
  const contentWidth = cols * CW;
  return { bg, contentWidth, frag, text: `<text y="${baseline.toFixed(1)}" xml:space="preserve">${texts}</text>` };
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
