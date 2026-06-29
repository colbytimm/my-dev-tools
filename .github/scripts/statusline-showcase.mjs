#!/usr/bin/env node
// Composes one showcase SVG for the skill's README from the shared preview cases
// (statusline-cases.mjs): a section per group (Harnesses / Themes / Usage), a
// sub-section per harness / theme / level, and the real statusline.js bars
// stacked beneath each.
//
//   node .github/scripts/statusline-showcase.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
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

const assets = path.join(root, 'docs', 'images');
mkdirSync(assets, { recursive: true });

const CFG = dumpConfig();
const now = Math.floor(Date.now() / 1000);
const cases = buildCases({ cwd: root, now, themes: CFG.availableThemes });

// ── geometry ──────────────────────────────────────────────────
const FS = 15;
const CW = FS * CHAR_WIDTH_EM;
const ROWH = 28;
const ROW_GAP = 6; // between stacked bars in a sub-section
const SECTION_H = 34; // space a section header occupies
const SUBSEC_H = 24; // space a sub-section header occupies
const GROUP_GAP = 10; // extra space after a sub-section's bars
const PADX = 16;
const PADTOP = 12;

function parseBar(ansi, yTop) {
  const { runs, cols } = parseAnsiRuns(ansi);
  const { shapes, tspans } = emitRunGlyphs(runs, { x0: PADX, yTop, rowHeight: ROWH, cw: CW, fontSize: FS });
  const baseline = yTop + ROWH / 2 + FS * BASELINE_EM;
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
let maxContent = 0;
const items = [];
for (const section of cases) {
  items.push({ type: 'section', text: section.title, top: y });
  y += SECTION_H;
  for (const group of section.groups) {
    items.push({ type: 'subsec', text: group.label, top: y });
    y += SUBSEC_H;
    for (const bar of group.bars) {
      const parsed = parseBar(renderBar(bar.payload, bar.theme), y);
      maxContent = Math.max(maxContent, parsed.contentWidth);
      items.push({ type: 'bar', top: y, ...parsed });
      y += ROWH + ROW_GAP;
    }
    y += GROUP_GAP - ROW_GAP;
  }
}
const totalH = y + PADTOP;
const colW = maxContent + 14;
const totalW = PADX + colW + PADX;

const PAGE = '#0d1117';
const LABEL = '#8b949e';
const HEAD = '#e6edf3';

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(totalW)}" height="${Math.ceil(totalH)}" font-family="${xmlEscape(CFG.font.family)}" font-size="${FS}">`;
svg += `<rect width="100%" height="100%" rx="8" fill="${PAGE}"/>`;
for (const it of items) {
  if (it.type === 'bar') {
    svg += `<rect x="${PADX}" y="${it.top}" width="${colW.toFixed(1)}" height="${ROWH}" rx="3" fill="${it.bg}"/>`;
  }
}
for (const it of items) {
  if (it.type === 'section') {
    svg += `<text x="${PADX}" y="${it.top + FS}" fill="${HEAD}" font-size="${FS}" font-weight="bold">${xmlEscape(it.text)}</text>`;
  } else if (it.type === 'subsec') {
    svg += `<text x="${PADX}" y="${it.top + FS - 4}" fill="${LABEL}" font-size="${FS - 3}" letter-spacing="0.5">${xmlEscape(it.text)}</text>`;
  }
}
for (const it of items) {
  if (it.type === 'bar') svg += it.frag + it.text;
}
svg += '</svg>';

const outFile = path.join(assets, 'statusline-showcase.svg');
writeFileSync(outFile, svg);
console.log(`wrote ${path.relative(root, outFile)} (${(svg.length / 1024).toFixed(1)} KB, ${Math.ceil(totalW)}x${Math.ceil(totalH)})`);
