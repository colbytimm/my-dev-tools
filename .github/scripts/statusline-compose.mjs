// Composes the preview cases into one labeled SVG: a section per group
// (Harnesses / Themes / Usage), a sub-section per harness / theme / level, and
// the rendered bars stacked beneath each. Shared so the README showcase and the
// per-OS CI artifact are byte-for-byte the same layout — only the bars differ if
// statusline.js renders differently on a platform.

import {
  parseAnsiRuns,
  emitRunGlyphs,
  xmlEscape,
  CHAR_WIDTH_EM,
  BASELINE_EM,
  DEFAULT_PAGE_BG,
} from './ansi-svg.mjs';

const FS = 15;
const CW = FS * CHAR_WIDTH_EM;
const ROWH = 28;
const ROW_GAP = 6; // between stacked bars in a sub-section
const SECTION_H = 34; // space a section header occupies
const SUBSEC_H = 24; // space a sub-section header occupies
const GROUP_GAP = 10; // extra space after a sub-section's bars
const PADX = 16;
const PADTOP = 12;
const PAGE = '#0d1117';
const LABEL = '#8b949e';
const HEAD = '#e6edf3';

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

export function composeShowcaseSvg(cases, font, ansiById) {
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
        const ansi = ansiById[bar.id];
        if (ansi == null) continue;
        const parsed = parseBar(ansi, y);
        maxContent = Math.max(maxContent, parsed.contentWidth);
        items.push({ type: 'bar', top: y, ...parsed });
        y += ROWH + ROW_GAP;
      }
      y += GROUP_GAP - ROW_GAP;
    }
  }
  const height = Math.ceil(y + PADTOP);
  const colW = maxContent + 14;
  const width = Math.ceil(PADX + colW + PADX);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${xmlEscape(font.family)}" font-size="${FS}">`;
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
  return { svg, width, height };
}
