// Loads the Vedic Astrology skill markdown as Claude's system prompt.
//
// Two callers want two different subsets of the same document, so this can drop
// named sections rather than there being a second copy on disk. A forked
// "spoken" markdown would drift from the original within a couple of edits, and
// the drift would be invisible until someone noticed the voice agent giving
// worse readings than chat.
const fs = require("fs");
const path = require("path");

/**
 * @param {object} [opts]
 * @param {string[]} [opts.drop] Headings to omit, matched against `## ` and
 *   `### ` lines by exact text. Dropping a `##` also drops its `###` children.
 *   Called with no arguments this returns the whole document, byte for byte.
 */
function loadSkill(opts = {}) {
  const p = path.join(__dirname, "..", "Vedic Astrology Skill.md");
  const raw = fs.readFileSync(p, "utf8");
  // Strip the YAML frontmatter block (--- ... ---) if present.
  const body = raw.replace(/^---[\s\S]*?\n---\s*\n?/, "").trim();

  const drop = opts.drop || [];
  if (!drop.length) return body;

  const wanted = new Set(drop);
  const out = [];
  // The document is CRLF on disk. Split on both so a heading line arrives here
  // without a trailing \r — `.` in a JS regex does not match \r, so `$` would
  // never anchor and every drop would silently no-op. Rejoined with whichever
  // ending the file actually uses.
  const eol = body.includes("\r\n") ? "\r\n" : "\n";

  // skipDepth is the heading level that switched skipping on: 2 for a `##`
  // section (which swallows its subsections), 3 for a lone `###`. Any heading
  // at that level or shallower ends the skip.
  let skipDepth = 0;

  for (const line of body.split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.*?)\s*$/.exec(line);
    if (m) {
      const depth = m[1].length;
      if (skipDepth && depth <= skipDepth) skipDepth = 0;
      if (!skipDepth && wanted.has(m[2])) {
        skipDepth = depth;
        continue;
      }
    }
    if (!skipDepth) out.push(line);
  }

  // A dropped section leaves its surrounding blank lines behind; collapse runs
  // of three or more so the seams don't read as missing content.
  const joined = out.join(eol);
  return joined.replace(new RegExp(`(?:${eol.replace(/\r/, "\\r")}){3,}`, "g"), eol + eol).trim();
}

module.exports = { loadSkill };
