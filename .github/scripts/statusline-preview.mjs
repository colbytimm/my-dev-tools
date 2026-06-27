#!/usr/bin/env node
// Renders the statusline for representative Claude and Copilot payloads in
// several glyph/color modes, prints the colored result to the log, writes a
// plain-text preview to the GitHub step summary, and emits SVG snapshots.
//
// Runs identically on Linux, macOS, and Windows (and from any shell) because
// all the work happens in Node — no shell piping. Exits non-zero if a render
// throws or is missing an expected segment, so it doubles as a smoke test.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

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

const osLabel =
  { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] ??
  process.platform;
const now = Math.floor(Date.now() / 1000);

const payloads = {
  Claude: {
    model: { display_name: 'Opus 4.8' },
    cwd: process.cwd(),
    context_window: {
      total_input_tokens: 131000,
      total_output_tokens: 2800,
      context_window_size: 1000000,
      used_percentage: 26,
    },
    cost: { total_duration_ms: 725000, total_lines_added: 156, total_lines_removed: 23 },
    rate_limits: {
      five_hour: { used_percentage: 13, resets_at: now + 4 * 3600 },
      seven_day: { used_percentage: 64, resets_at: now + 3 * 86400 },
    },
  },
  Copilot: {
    model: { id: 'claude-haiku-4.5' },
    cwd: process.cwd(),
    context_window: {
      current_context_tokens: 42000,
      displayed_context_limit: 160000,
      current_context_used_percentage: 26,
    },
    cost: { total_duration_ms: 1054000, total_lines_added: 10, total_lines_removed: 4 },
  },
};

const modes = [
  { key: 'powerline', label: 'powerline (color)', args: ['--powerline'], svg: true },
  { key: 'plain', label: 'plain (color)', args: ['--no-powerline'], svg: true },
  { key: 'nocolor', label: 'no-color', args: ['--no-color'], svg: false },
];

function render(payload, args) {
  return execFileSync(process.execPath, [script, ...args], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ── xterm-256 → #rrggbb ───────────────────────────────────────
const BASIC = [
  '000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff',
];
const CUBE = [0, 95, 135, 175, 215, 255];
function color256(n) {
  if (n < 16) return `#${BASIC[n]}`;
  if (n < 232) {
    const i = n - 16;
    const r = CUBE[Math.floor(i / 36) % 6];
    const g = CUBE[Math.floor(i / 6) % 6];
    const b = CUBE[i % 6];
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const v = (8 + (n - 232) * 10).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}

const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal single-line ANSI → SVG. Handles 38;5;N / 48;5;N / 0 (reset).
function ansiToSvg(ansi) {
  const cw = 8.4;
  const fontSize = 15;
  let fg = '#cccccc';
  let bg = null;
  const runs = [];
  let buf = '';
  let cols = 0;
  const flush = () => {
    if (buf) runs.push({ text: buf, fg, bg, col: cols - buf.length });
    buf = '';
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  const pushText = (t) => {
    for (const ch of t) {
      buf += ch;
      cols += 1;
    }
  };
  while ((m = re.exec(ansi))) {
    pushText(ansi.slice(last, m.index));
    flush();
    const codes = m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      if (codes[i] === 0) {
        fg = '#cccccc';
        bg = null;
      } else if (codes[i] === 38 && codes[i + 1] === 5) {
        fg = color256(codes[i + 2]);
        i += 2;
      } else if (codes[i] === 48 && codes[i + 1] === 5) {
        bg = color256(codes[i + 2]);
        i += 2;
      }
    }
    last = re.lastIndex;
  }
  pushText(ansi.slice(last));
  flush();

  const width = Math.ceil(cols * cw) + 16;
  const height = 30;
  const rects = runs
    .filter((r) => r.bg)
    .map(
      (r) =>
        `<rect x="${(8 + r.col * cw).toFixed(1)}" y="4" width="${(r.text.length * cw).toFixed(1)}" height="22" fill="${r.bg}"/>`
    )
    .join('');
  const texts = runs
    .map(
      (r) =>
        `<tspan x="${(8 + r.col * cw).toFixed(1)}" fill="${r.fg}">${xmlEscape(r.text)}</tspan>`
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="'JetBrainsMono Nerd Font','Hack Nerd Font','DejaVu Sans Mono',monospace" font-size="${fontSize}">` +
    `<rect width="100%" height="100%" fill="#1d1f21"/>${rects}` +
    `<text y="20" xml:space="preserve">${texts}</text></svg>`
  );
}

// ── Run ───────────────────────────────────────────────────────
const expect = { Claude: ['Claude', 'ctx', '5h'], Copilot: ['Copilot', 'ctx'] };
let failures = 0;
let md = `## Statusline preview — ${osLabel} \`${process.platform}\`, Node ${process.version}\n\n`;

for (const [agent, payload] of Object.entries(payloads)) {
  md += `### ${agent}\n\n`;
  for (const mode of modes) {
    let out;
    try {
      out = render(payload, mode.args);
    } catch (e) {
      failures++;
      md += `**${mode.label}** — ERROR: ${e.message}\n\n`;
      console.error(`[${osLabel}] ${agent} ${mode.label}: ${e.message}`);
      continue;
    }
    const plain = stripAnsi(out);

    if (mode.key === 'nocolor') {
      for (const needle of expect[agent]) {
        if (!plain.includes(needle)) {
          failures++;
          console.error(`[${osLabel}] ${agent}: missing "${needle}" in: ${plain}`);
        }
      }
    }

    process.stdout.write(`\n\x1b[1m[${osLabel}] ${agent} — ${mode.label}\x1b[0m\n${out}\n`);
    md += `**${mode.label}**\n\n\`\`\`\n${plain}\n\`\`\`\n\n`;

    if (mode.svg) {
      const file = path.join(outDir, `${process.platform}-${agent}-${mode.key}.svg`);
      try {
        writeFileSync(file, ansiToSvg(out));
      } catch (e) {
        console.error(`svg failed for ${file}: ${e.message}`);
      }
    }
  }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
else process.stdout.write('\n--- step summary (preview) ---\n' + md);

if (failures) {
  console.error(`\n${failures} render check(s) failed on ${osLabel}.`);
  process.exit(1);
}
console.log(`\nOK — ${osLabel}: all renders produced expected segments.`);
