#!/usr/bin/env node
// Composes the README showcase SVG from the shared preview cases
// (statusline-cases.mjs) using the shared composer (statusline-compose.mjs), so
// it's the same image the CI preview produces per-OS.
//
//   node .github/scripts/statusline-showcase.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root, dumpConfig, buildCases, renderAll } from './statusline-cases.mjs';
import { composeShowcaseSvg } from './statusline-compose.mjs';

const assets = path.join(root, 'docs', 'images');
mkdirSync(assets, { recursive: true });

const CFG = dumpConfig();
const now = Math.floor(Date.now() / 1000);
const cases = buildCases({ cwd: root, now, themes: CFG.availableThemes });
const { svg, width, height } = composeShowcaseSvg(cases, CFG.font, renderAll(cases));

const outFile = path.join(assets, 'statusline-showcase.svg');
writeFileSync(outFile, svg);
console.log(`wrote ${path.relative(root, outFile)} (${(svg.length / 1024).toFixed(1)} KB, ${width}x${height})`);
