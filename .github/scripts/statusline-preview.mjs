#!/usr/bin/env node
// Renders the shared preview cases (statusline-cases.mjs) for cross-platform
// review: every bar is printed to the run log in color, and the whole set is
// composed into one per-OS SVG artifact — the same layout as the committed README
// showcase. Bars carrying an `expect` list are smoke-tested (exit non-zero if a
// segment is missing or a render throws). The GitHub step summary embeds the
// committed showcase SVG by raw URL, since its sanitized Markdown can't render
// ANSI color.
//
//   node .github/scripts/statusline-preview.mjs

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, dumpConfig, renderBar, buildCases } from './statusline-cases.mjs';
import { composeShowcaseSvg } from './statusline-compose.mjs';

const outDir = path.join(root, 'statusline-preview');
mkdirSync(outDir, { recursive: true });

const CFG = dumpConfig();
const now = Math.floor(Date.now() / 1000);
const cases = buildCases({ cwd: root, now, themes: CFG.availableThemes });

const osLabel =
  { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] ?? process.platform;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const chevronize = (s) => s.replace(/[\u{E0B0}\u{E0B1}]/gu, '❯');

// ── Render every case → colored log + smoke-test the bars with `expect` ──
let failures = 0;
let bars = 0;
const ansiById = {};
for (const section of cases) {
  for (const group of section.groups) {
    for (const bar of group.bars) {
      let ansi;
      try {
        ansi = renderBar(bar.payload, bar.theme, bar.quota);
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
      process.stdout.write(`\n\x1b[1m[${osLabel}] ${section.title} › ${group.label}\x1b[0m\n${chevronize(ansi)}\n`);
      ansiById[bar.id] = ansi;
      bars++;
    }
  }
}

// ── Per-OS artifact: the same composed showcase the README embeds ──
try {
  const { svg } = composeShowcaseSvg(cases, CFG.font, ansiById);
  writeFileSync(path.join(outDir, `${process.platform}-showcase.svg`), svg);
} catch (e) {
  console.error(`showcase svg: ${e.message}`);
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
md += `_Full-color showcase above (Claude + Copilot across every theme and usage level). This run's live per-OS bars are in the job log (in color) and the same layout is uploaded as the \`statusline-preview-${process.platform}\` SVG artifact — GitHub summaries can't render ANSI color, so the bars aren't repeated here as plain text._\n\n`;

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
else process.stdout.write('\n--- step summary (preview) ---\n' + md);

if (failures) {
  console.error(`\n${failures} preview check(s) failed on ${osLabel}.`);
  process.exit(1);
}
console.log(`\nOK — ${osLabel}: rendered ${bars} bars across ${cases.length} sections.`);
