// Single source of truth for the statusline previews. Both the README showcase
// (statusline-showcase.mjs → one composed SVG) and the CI preview
// (statusline-preview.mjs → colored run log + per-OS SVG artifacts) build from
// the cases returned here, so a payload or theme is defined in exactly one place.
//
// Shape: section { title, groups: [ group { label, bars: [ bar ] } ] }
//   • Harnesses — one group per harness ("Claude" / "Copilot"), agent named in
//     the group label because that's the only thing distinguishing the rows.
//   • Themes / Usage — one group per theme / per level; each holds a Claude and a
//     Copilot bar. No per-bar agent label: you can tell them apart from the bar.
//   bar.expect (optional) — substrings the CI smoke test asserts are present.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const script = path.join(
  root,
  'agents',
  'skills',
  'env',
  'statusline-install',
  'scripts',
  'statusline.js'
);

const FONT_FALLBACK = {
  family: "'DejaVu Sans Mono', Menlo, Consolas, monospace",
  weight: 'normal',
  size: 15,
};

export function dumpConfig() {
  try {
    return JSON.parse(execFileSync(process.execPath, [script, '--dump-config'], { encoding: 'utf8' }));
  } catch {
    return { availableThemes: ['p10k'], font: FONT_FALLBACK };
  }
}

// Render one powerline bar from the real statusline.js. A fixed branch keeps the
// output stable across machines; a theme is applied via env when given. `quota`
// ("usedPct[:resetLabel]") injects the Copilot monthly quota so the preview is
// deterministic and never hits the network; it's cleared otherwise so an ambient
// STATUSLINE_QUOTA can't leak into the Claude bars.
export function renderBar(payload, theme, quota) {
  const env = { ...process.env, STATUSLINE_BRANCH: 'feat/statusline' };
  if (theme) env.STATUSLINE_THEME = theme;
  if (quota) env.STATUSLINE_QUOTA = quota;
  else delete env.STATUSLINE_QUOTA;
  return execFileSync(process.execPath, [script, '--powerline'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
}

export function payloads(cwd, now) {
  const claude = (used, fiveH, sevenD) => ({
    model: { display_name: 'Opus 4.8' },
    effort: { level: 'high' },
    cwd,
    context_window: {
      total_input_tokens: Math.round((used / 100) * 1_000_000),
      context_window_size: 1_000_000,
      used_percentage: used,
    },
    cost: { total_duration_ms: 9_525_000, total_lines_added: 156, total_lines_removed: 23 },
    rate_limits: {
      // small buffer past the boundary so the floored countdown reads cleanly
      five_hour: { used_percentage: fiveH, resets_at: now + 3 * 3600 + 600 },
      seven_day: { used_percentage: sevenD, resets_at: now + 2 * 86400 + 3600 },
    },
  });
  const copilot = {
    model: { id: 'gpt-5.4', display_name: 'gpt-5.4 · medium' },
    cwd,
    context_window: {
      current_context_tokens: 42_000,
      displayed_context_limit: 160_000,
      current_context_used_percentage: 26,
    },
    cost: { total_duration_ms: 1_054_000, total_lines_added: 10, total_lines_removed: 4 },
    ai_used: { formatted: '8.4', total_nano_aiu: 8_400_000_000 },
  };
  const copilotAt = (pct) => ({
    ...copilot,
    context_window: {
      current_context_tokens: Math.round((pct / 100) * 160_000),
      displayed_context_limit: 160_000,
      current_context_used_percentage: pct,
    },
  });
  return { claude, copilot, copilotAt };
}

// Render every bar in the cases once, keyed by bar id. Used by the showcase to
// compose the SVG and by the preview to log/assert and compose the same SVG.
export function renderAll(cases) {
  const byId = {};
  for (const section of cases)
    for (const group of section.groups)
      for (const bar of group.bars) byId[bar.id] = renderBar(bar.payload, bar.theme, bar.quota);
  return byId;
}

export function buildCases({ cwd, now, themes }) {
  const { claude, copilot, copilotAt } = payloads(cwd, now);
  const themed = claude(34, 13, 48);
  const COPILOT_QUOTA = '28:2d'; // monthly quota injected for deterministic, network-free previews

  return [
    {
      title: 'Harnesses',
      groups: [
        {
          label: 'Claude',
          bars: [{ id: 'harness-claude', payload: themed, expect: ['Claude', '[high]', 'ctx', '5h'] }],
        },
        {
          label: 'Copilot',
          bars: [
            {
              id: 'harness-copilot',
              payload: copilot,
              quota: COPILOT_QUOTA,
              expect: ['Copilot', 'gpt-5.4 · medium', 'ctx', '⚡ 8.4', 'mth 28%'],
            },
          ],
        },
      ],
    },
    {
      title: 'Themes',
      groups: themes.map((theme) => ({
        label: theme,
        bars: [
          { id: `theme-${theme}-claude`, payload: themed, theme },
          { id: `theme-${theme}-copilot`, payload: copilot, theme, quota: COPILOT_QUOTA },
        ],
      })),
    },
    {
      title: 'Usage % — green · amber · red',
      groups: [
        ['green', 20, 18, 24, '24:12d'],
        ['amber', 60, 58, 64, '60:8h'],
        ['red', 92, 88, 95, '92:45m'],
      ].map(([level, used, fiveH, sevenD, quota]) => ({
        label: level,
        bars: [
          { id: `usage-${level}-claude`, payload: claude(used, fiveH, sevenD) },
          { id: `usage-${level}-copilot`, payload: copilotAt(used), quota },
        ],
      })),
    },
  ];
}
