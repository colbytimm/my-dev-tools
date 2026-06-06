#!/usr/bin/env node
// Lint markdown for mechanics and generated-sounding writing.
//
// Two markdownlint-cli2 passes:
//   1. Mechanics: the repo's own .markdownlint* config when one exists,
//      otherwise the bundled assets/markdownlint.json.
//   2. Voice: assets/voice.markdownlint-cli2.jsonc - banned vocabulary, emoji
//      policy, em dashes, summary openers, dead relative links, plus the
//      stateful rules in assets/stateful-rules.cjs.
//
// The two published rule packages (markdownlint-rule-search-replace,
// markdownlint-rule-relative-links) auto-install into assets/node_modules on
// first run.
//
// Usage: node lint_voice.mjs <file-or-directory> [--strict] [--voice-only]
// Exit codes: 0 clean (or warnings only), 1 errors (warnings too with --strict).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const RULE_PACKAGES = [
  "markdownlint-rule-search-replace",
  "markdownlint-rule-relative-links",
];
// voice rules that read as judgment calls -> warnings, not errors
const WARN_RULES = new Set([
  "soft-words", "condescension", "negative-parallelism", "future-tense-step",
  "relative-links", "voice-rule-of-threes", "voice-term-bullets",
]);
const REPO_CONFIGS = [
  ".markdownlint-cli2.jsonc", ".markdownlint-cli2.yaml", ".markdownlint-cli2.cjs",
  ".markdownlint.json", ".markdownlint.jsonc", ".markdownlint.yaml",
];
const FINDING = /^(?<loc>\S+:\d+(?::\d+)?) error (?<rule>\S+)(?<rest>.*)$/;

function findTargets(path) {
  if (!statSync(path).isDirectory()) return [path];
  const out = [];
  for (const entry of readdirSync(path, { withFileTypes: true, recursive: true })) {
    const full = join(entry.parentPath ?? entry.path, entry.name);
    if (full.includes("node_modules")) continue;
    if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function findRepoConfig(start) {
  let dir = statSync(start).isDirectory() ? resolve(start) : dirname(resolve(start));
  for (;;) {
    for (const name of REPO_CONFIGS) {
      if (existsSync(join(dir, name))) return join(dir, name);
    }
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function ensureRulePackages() {
  if (RULE_PACKAGES.every((p) => existsSync(join(ASSETS, "node_modules", p)))) {
    return true;
  }
  console.error(`installing voice rule packages into ${ASSETS}/node_modules ...`);
  const r = spawnSync(
    "npm",
    ["install", "--prefix", ASSETS, "--no-save", "--no-fund", "--no-audit", ...RULE_PACKAGES],
    { encoding: "utf8" },
  );
  if (r.status !== 0) console.error((r.stderr || "").trim().slice(-500));
  return r.status === 0;
}

function runMdl(targets, config) {
  const args = ["--yes", "markdownlint-cli2"];
  if (config) args.push("--config", config);
  const r = spawnSync("npx", [...args, ...targets], { encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
}

// Split markdownlint findings into errors and warnings by rule name.
function classify(output, voicePass, errors, warns) {
  const customRules = new Set([
    "search-replace", "relative-links", "voice-term-bullets", "voice-rule-of-threes",
  ]);
  for (const raw of output.split("\n")) {
    const m = raw.trim().match(FINDING);
    if (!m) continue;
    const { loc, rule, rest } = m.groups;
    const isCustom = customRules.has(rule);
    if (voicePass && !isCustom) continue; // mechanics can leak via merged repo config
    if (!voicePass && isCustom) continue; // voice findings belong to pass 2
    let name = rule;
    if (rule === "search-replace") {
      const nm = rest.match(/\[([a-z-]+):/);
      if (nm) name = nm[1];
    }
    const text = `${loc}: [${name}]${rest}`;
    (WARN_RULES.has(name) ? warns : errors).push(text);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const voiceOnly = argv.includes("--voice-only");
  const target = argv.find((a) => !a.startsWith("--"));
  if (!target || !existsSync(target)) {
    console.error(`usage: lint_voice.mjs <file-or-directory> [--strict] [--voice-only]`);
    return 2;
  }
  const targets = findTargets(target);
  if (targets.length === 0) {
    console.error(`${target}: no markdown files found`);
    return 2;
  }

  const errors = [];
  const warns = [];

  if (!voiceOnly) {
    const repoCfg = findRepoConfig(target);
    const cfg = repoCfg ? null : join(ASSETS, "markdownlint.json");
    console.log(`mechanics pass: markdownlint-cli2, config: ${repoCfg ?? cfg + " (bundled)"}`);
    classify(runMdl(targets, cfg), false, errors, warns);
  }
  if (ensureRulePackages()) {
    console.log("voice pass: markdownlint-cli2, bundled voice rules");
    classify(runMdl(targets, join(ASSETS, "voice.markdownlint-cli2.jsonc")), true, errors, warns);
  } else {
    warns.push("[setup] could not install voice rule packages; voice pass skipped - check network/npm");
  }

  for (const e of errors) console.log(`error ${e}`);
  for (const w of warns) console.log(`warn  ${w}`);
  console.log(`\n${targets.length} file(s): ${errors.length} error(s), ${warns.length} warning(s)`);
  return errors.length > 0 || (strict && warns.length > 0) ? 1 : 0;
}

process.exit(main());
