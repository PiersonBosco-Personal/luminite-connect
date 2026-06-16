import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeClaudeMd, LUMINITE_BLOCK } from "../src/claudemd.js";

const START = "<!-- LUMINITE:START -->";
const END = "<!-- LUMINITE:END -->";

test("missing/empty file → returns just the block", () => {
  const out = mergeClaudeMd("");
  assert.ok(out.includes(START) && out.includes(END));
  assert.ok(out.includes("## Luminite project sync"));
});

test("undefined prev is treated as empty", () => {
  const out = mergeClaudeMd(undefined);
  assert.ok(out.includes(START));
  assert.deepEqual(mergeClaudeMd(undefined), mergeClaudeMd(""));
});

test("file without markers → block appended, original preserved, blank-line separated", () => {
  const out = mergeClaudeMd("# My Project\n\nSome notes.\n");
  assert.ok(out.startsWith("# My Project\n\nSome notes.\n"));
  assert.ok(out.includes(START));
  assert.equal((out.match(/LUMINITE:START/g) || []).length, 1);
  assert.match(out, /Some notes\.\n\n<!-- LUMINITE:START -->/);
});

test("file with markers → content replaced in place, surrounding text kept", () => {
  const prev =
    "# Title\n\n" + START + "\nOLD BLOCK CONTENT\n" + END + "\n\n## After\n";
  const out = mergeClaudeMd(prev);
  assert.ok(out.startsWith("# Title\n"));
  assert.ok(out.includes("## After"));
  assert.ok(!out.includes("OLD BLOCK CONTENT"));
  assert.ok(out.includes("## Luminite project sync"));
  assert.equal((out.match(/LUMINITE:START/g) || []).length, 1);
});

test("idempotent: merging twice yields the same result", () => {
  const once = mergeClaudeMd("# Title\n\nbody\n");
  const twice = mergeClaudeMd(once);
  assert.equal(twice, once);
});

test("orphaned START (no END) falls through to append, then self-heals on re-run", () => {
  const orphan = "# Title\n\n<!-- LUMINITE:START -->\nhand-broken, no end marker\n";
  const once = mergeClaudeMd(orphan);
  // append branch ran → a complete block (with END) now exists
  assert.ok(once.includes("<!-- LUMINITE:END -->"));
  // re-running replaces from the first START to the first END, removing the orphan text
  const twice = mergeClaudeMd(once);
  assert.ok(!twice.includes("hand-broken, no end marker"));
  assert.equal((twice.match(/LUMINITE:START/g) || []).length, 1);
  assert.equal((twice.match(/LUMINITE:END/g) || []).length, 1);
});
