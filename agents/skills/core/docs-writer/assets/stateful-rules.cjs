// Stateful voice rules that regex-in-config can't express.
// Loaded by voice.markdownlint-cli2.jsonc via customRules.
"use strict";

const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+\S/;
const TERM_BULLET = /^\s*[-*]\s+\*\*[^*]+:?\*\*:?\s/;
const FENCE = /^(```+|~~~+)/;

// Walk lines with fence awareness, invoking cb(line, lineNumber) on prose lines.
function proseLines(lines, cb) {
  let inFence = false;
  let marker = "";
  lines.forEach((line, idx) => {
    const s = line.trim();
    const m = s.match(FENCE);
    if (m) {
      if (!inFence) {
        inFence = true;
        marker = m[1][0].repeat(3);
      } else if (s.startsWith(marker)) {
        inFence = false;
      }
      return;
    }
    if (!inFence) cb(line, idx + 1);
  });
}

module.exports = [
  {
    names: ["voice-term-bullets"],
    description:
      "4+ consecutive '**Term:** definition' bullets; write sentences with concrete claims instead",
    tags: ["voice"],
    parser: "none",
    function: (params, onError) => {
      let run = 0;
      proseLines(params.lines, (line, n) => {
        if (LIST_ITEM.test(line) && TERM_BULLET.test(line)) {
          run += 1;
          if (run === 4) onError({ lineNumber: n });
        } else {
          run = 0;
        }
      });
    },
  },
  {
    names: ["voice-rule-of-threes"],
    description:
      "Every list has exactly 3 items; lists should be their natural length",
    tags: ["voice"],
    parser: "none",
    function: (params, onError) => {
      const lengths = [];
      const starts = [];
      let cur = 0;
      let start = 0;
      proseLines(params.lines, (line, n) => {
        if (LIST_ITEM.test(line)) {
          if (cur === 0) start = n;
          cur += 1;
        } else if (line.trim() !== "" && cur > 0) {
          lengths.push(cur);
          starts.push(start);
          cur = 0;
        }
      });
      if (cur > 0) {
        lengths.push(cur);
        starts.push(start);
      }
      if (lengths.length >= 3 && lengths.every((l) => l === 3)) {
        onError({ lineNumber: starts[0] });
      }
    },
  },
];
