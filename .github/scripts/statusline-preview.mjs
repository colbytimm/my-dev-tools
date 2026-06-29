#!/usr/bin/env node
// Renders the shared preview cases (statusline-cases.mjs) for cross-platform
// review: every bar is printed to the run log in color and saved as a per-OS SVG
// artifact. Bars carrying an `expect` list are smoke-tested (exit non-zero if a
// segment is missing or a render throws). The GitHub step summary shows the
// committed showcase SVG by raw URL — its sanitized Markdown can't render ANSI
// color, so the colorless bars are intentionally not duplicated there.
//
//   node .github/scripts/statusline-preview.mjs

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseAnsiRuns,
  emitRunGlyphs,
  xmlEscape,
  CHAR_WIDTH_EM,
  BASELINE_EM,
  DEFAULT_PAGE_BG,
} from './ansi-svg.mjs';
import { root, dumpConfig, renderBar, buildCases } from './statusline-cases.mjs';

const outDir = path.join(root, 'statusline-preview');
mkdirSync(outDir, { recursive: true });

const CFG = dumpConfig();
const now = Math.floor(Date.now() / 1000);
const cases = buildCases({ cwd: root, now, themes: CFG.availableThemes });

const osLabel =
  { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] ?? process.platform;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const chevronize = (s) => s.replace(/[\u{E0B0}\u{E0B1}]/gu, '❯');

// ── ANSI → SVG (per-bar artifact) ─────────────────────────────
const PAD = 8;
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

let failures = 0;
function emit(caption, ansi, id) {
  process.stdout.write(`\n\x1b[1m[${osLabel}] ${caption}\x1b[0m\n${chevronize(ansi)}\n`);
  try {
    writeFileSync(path.join(outDir, `${process.platform}-${id}.svg`), ansiToSvg(ansi));
  } catch (e) {
    console.error(`svg ${id}: ${e.message}`);
  }
}

// ── Render every case → log + artifacts (+ smoke-test bars with `expect`) ──
let bars = 0;
for (const section of cases) {
  for (const group of section.groups) {
    for (const bar of group.bars) {
      let ansi;
      try {
        ansi = renderBar(bar.payload, bar.theme);
      } catch (e) {
        failures++;
        console.error(`[${osLabel}] ${bar.id}: ${e.message}`);
        continue;
      }
      for (const needle of bar.expect ?? []) {
        if (!stripAnsi(ansi).includes(needle)) {
          failures++;
          console.error(`[${osLabel}] ${bar.id}: missing "${needle}"`);
        }
      }
      emit(`${section.title} › ${group.label}`, ansi, bar.id);
      bars++;
    }
  }
}

// ── Step summary: the committed showcase SVG (color), not the colorless bars ──
// GitHub sanitizes summary Markdown (no ANSI, no data-URI images), so embed the
// showcase by raw URL. PR `GITHUB_SHA` is an ephemeral merge commit raw won't
// serve, so the workflow passes the head SHA via PREVIEW_SHA.
let md = `## Statusline preview — ${osLabel} \`${process.platform}\`, Node ${process.version}\n\n`;
const repo = process.env.GITHUB_REPOSITORY;
const previewSha = process.env.PREVIEW_SHA || process.env.GITHUB_SHA;
if (repo && previewSha) {
  const url = `https://raw.githubusercontent.com/${repo}/${previewSha}/docs/images/statusline-showcase.svg`;
  md += `![statusline showcase](${url})\n\n`;
}
md += `_Full-color showcase above (Claude + Copilot across every theme and usage level). This run's live per-OS bars are in the job log (in color) and uploaded as \`statusline-preview-${process.platform}\` SVG artifacts — GitHub summaries can't render ANSI color, so they're not repeated here as plain text._\n\n`;

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
else process.stdout.write('\n--- step summary (preview) ---\n' + md);

if (failures) {
  console.error(`\n${failures} preview check(s) failed on ${osLabel}.`);
  process.exit(1);
}
console.log(`\nOK — ${osLabel}: rendered ${bars} bars across ${cases.length} sections.`);
