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
    env: { ...process.env, ...extraEnv },
  });
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const chevronize = (s) => s.replace(/[\u{E0B0}\u{E0B1}]/gu, '❯');

// ── Payloads ──────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const claude = (used, fiveH, sevenD) => ({
  model: { display_name: 'Opus 4.8' },
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
};

// ── ANSI → SVG ────────────────────────────────────────────────
const BASIC = [
  '000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff',
];
const CUBE = [0, 95, 135, 175, 215, 255];
const hex = (r, g, b) => `#${[r, g, b].map((v) => (v & 255).toString(16).padStart(2, '0')).join('')}`;
function color256(n) {
  if (n < 16) return `#${BASIC[n]}`;
  if (n < 232) {
    const i = n - 16;
    return hex(CUBE[Math.floor(i / 36) % 6], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]);
  }
  const v = 8 + (n - 232) * 10;
  return hex(v, v, v);
}
const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ansiToSvg(ansi) {
  const fontSize = CFG.font.size;
  const cw = fontSize * 0.56;
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
      } else if (codes[i] === 38 && codes[i + 1] === 2) {
        fg = hex(codes[i + 2], codes[i + 3], codes[i + 4]);
        i += 4;
      } else if (codes[i] === 48 && codes[i + 1] === 2) {
        bg = hex(codes[i + 2], codes[i + 3], codes[i + 4]);
        i += 4;
      }
    }
    last = re.lastIndex;
  }
  pushText(ansi.slice(last));
  flush();

  const width = Math.ceil(cols * cw) + 16;
  const height = Math.ceil(fontSize * 2);
  const mid = height / 2;
  const top = mid - fontSize * 0.7;
  const bot = mid + fontSize * 0.7;
  const pageBg = runs.find((r) => r.bg)?.bg ?? '#1d1f21';
  const rects = runs
    .filter((r) => r.bg)
    .map(
      (r) =>
        `<rect x="${(8 + r.col * cw).toFixed(1)}" y="0" width="${(r.text.length * cw).toFixed(1)}" height="${height}" fill="${r.bg}"/>`
    )
    .join('');

  // Powerline separators (PUA) are drawn as vector shapes so they render
  // without a patched font: E0B0 a filled tail, E0B1 a thin chevron.
  const shapes = [];
  let texts = '';
  for (const r of runs) {
    for (let i = 0; i < r.text.length; i++) {
      const cp = r.text.codePointAt(i);
      const x = 8 + (r.col + i) * cw;
      if (cp === 0xe0b0) {
        shapes.push(
          `<polygon points="${x.toFixed(1)},0 ${(x + cw).toFixed(1)},${mid.toFixed(1)} ${x.toFixed(1)},${height}" fill="${r.fg}"/>`
        );
      } else if (cp === 0xe0b1) {
        shapes.push(
          `<polyline points="${(x + 2).toFixed(1)},${top.toFixed(1)} ${(x + cw - 2).toFixed(1)},${mid.toFixed(1)} ${(x + 2).toFixed(1)},${bot.toFixed(1)}" fill="none" stroke="${r.fg}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
        );
      } else {
        texts += `<tspan x="${x.toFixed(1)}" fill="${r.fg}">${xmlEscape(r.text[i])}</tspan>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${xmlEscape(CFG.font.family)}" font-weight="${CFG.font.weight}" font-size="${fontSize}">` +
    `<rect width="100%" height="100%" fill="${pageBg}"/>${rects}${shapes.join('')}` +
    `<text y="${(mid + fontSize * 0.35).toFixed(1)}" xml:space="preserve">${texts}</text></svg>`
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
  ['Claude', claude(26, 13, 64), ['Claude', 'ctx', '5h']],
  ['Copilot', copilot, ['Copilot', 'ctx']],
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
