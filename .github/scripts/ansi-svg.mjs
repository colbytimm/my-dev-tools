// Shared ANSI → SVG helpers for the statusline preview and showcase renderers.
// Tokenizes a single line of ANSI (256-color and truecolor) into colored runs
// and emits the per-glyph SVG fragments. The two renderers differ only in
// layout (single auto-sized bar vs. multi-row gallery), so that stays in each.

export const CHAR_WIDTH_EM = 0.56; // monospace advance as a fraction of font size, tuned to the bundled font
export const BASELINE_EM = 0.35; // text baseline offset below the row's vertical center
const CHEVRON_HALF_EM = 0.7; // half-height of the U+E0B1 chevron, relative to font size
const CHEVRON_INSET = 2; // px the chevron is inset from the cell edges
const STROKE_WIDTH = 1.4; // chevron stroke width
export const DEFAULT_FG = '#cccccc';
export const DEFAULT_PAGE_BG = '#1d1f21';
const POWERLINE_TAIL = 0xe0b0; // solid right-pointing triangle
const POWERLINE_THIN = 0xe0b1; // thin separator chevron

const BASIC = [
  '000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff',
];
const CUBE = [0, 95, 135, 175, 215, 255];

export const hex = (r, g, b) =>
  `#${[r, g, b].map((v) => (v & 255).toString(16).padStart(2, '0')).join('')}`;

export function color256(n) {
  if (n < 16) return `#${BASIC[n]}`;
  if (n < 232) {
    const i = n - 16;
    return hex(CUBE[Math.floor(i / 36) % 6], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]);
  }
  const v = 8 + (n - 232) * 10;
  return hex(v, v, v);
}

export const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Split a line of ANSI into runs of constant color: { text, fg, bg, col }.
// `col` is the run's starting column; `cols` is the total visible width.
export function parseAnsiRuns(ansi) {
  let fg = DEFAULT_FG;
  let bg = null;
  const runs = [];
  let buf = '';
  let cols = 0;
  const flush = () => {
    if (buf) runs.push({ text: buf, fg, bg, col: cols - buf.length });
    buf = '';
  };
  const pushText = (t) => {
    for (const ch of t) {
      buf += ch;
      cols += 1;
    }
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(ansi))) {
    pushText(ansi.slice(last, m.index));
    flush();
    const c = m[1].split(';').map(Number);
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 0) {
        fg = DEFAULT_FG;
        bg = null;
      } else if (c[i] === 38 && c[i + 1] === 5) {
        fg = color256(c[i + 2]);
        i += 2;
      } else if (c[i] === 48 && c[i + 1] === 5) {
        bg = color256(c[i + 2]);
        i += 2;
      } else if (c[i] === 38 && c[i + 1] === 2) {
        fg = hex(c[i + 2], c[i + 3], c[i + 4]);
        i += 4;
      } else if (c[i] === 48 && c[i + 1] === 2) {
        bg = hex(c[i + 2], c[i + 3], c[i + 4]);
        i += 4;
      }
    }
    last = re.lastIndex;
  }
  pushText(ansi.slice(last));
  flush();
  return { runs, cols };
}

// Emit one row of glyphs. Powerline separators (PUA) become vector shapes so
// they render without a patched font. Returns the shape fragment and the text
// tspans (the caller wraps tspans in a <text> at the baseline).
export function emitRunGlyphs(runs, { x0, yTop, rowHeight, cw, fontSize }) {
  const mid = yTop + rowHeight / 2;
  const top = mid - fontSize * CHEVRON_HALF_EM;
  const bot = mid + fontSize * CHEVRON_HALF_EM;
  let shapes = '';
  let tspans = '';
  for (const r of runs) {
    for (let i = 0; i < r.text.length; i++) {
      const cp = r.text.codePointAt(i);
      const x = x0 + (r.col + i) * cw;
      if (cp === POWERLINE_TAIL) {
        shapes += `<polygon points="${x.toFixed(1)},${yTop} ${(x + cw).toFixed(1)},${mid.toFixed(1)} ${x.toFixed(1)},${(yTop + rowHeight).toFixed(1)}" fill="${r.fg}"/>`;
      } else if (cp === POWERLINE_THIN) {
        shapes += `<polyline points="${(x + CHEVRON_INSET).toFixed(1)},${top.toFixed(1)} ${(x + cw - CHEVRON_INSET).toFixed(1)},${mid.toFixed(1)} ${(x + CHEVRON_INSET).toFixed(1)},${bot.toFixed(1)}" fill="none" stroke="${r.fg}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`;
      } else {
        tspans += `<tspan x="${x.toFixed(1)}" fill="${r.fg}">${xmlEscape(r.text[i])}</tspan>`;
      }
    }
  }
  return { shapes, tspans };
}
