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

test("file without markers → block prepended at top, original preserved, blank-line separated", () => {
  const out = mergeClaudeMd("# My Project\n\nSome notes.\n");
  assert.ok(out.startsWith(START));
  assert.ok(out.endsWith("# My Project\n\nSome notes.\n"));
  assert.equal((out.match(/LUMINITE:START/g) || []).length, 1);
  assert.match(out, /<!-- LUMINITE:END -->\n\n# My Project/);
});

test("file with markers → block moved to top, surrounding text kept", () => {
  const prev =
    "# Title\n\n" + START + "\nOLD BLOCK CONTENT\n" + END + "\n\n## After\n";
  const out = mergeClaudeMd(prev);
  assert.ok(out.startsWith(START));
  assert.ok(out.includes("# Title"));
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

test("orphaned START (no END) → block prepended at top, no duplicate well-formed block", () => {
  const orphan = "# Title\n\n<!-- LUMINITE:START -->\nhand-broken, no end marker\n";
  const once = mergeClaudeMd(orphan);
  // a complete block (with END) now sits at the very top
  assert.ok(once.startsWith(START));
  assert.ok(once.includes("<!-- LUMINITE:END -->"));
  // exactly one END marker — the orphan START (no END) is left untouched below
  assert.equal((once.match(/LUMINITE:END/g) || []).length, 1);
  // re-running is stable: the well-formed top block is replaced in place, not duplicated
  const twice = mergeClaudeMd(once);
  assert.equal(twice, once);
  assert.equal((twice.match(/LUMINITE:END/g) || []).length, 1);
});

test("block routes decisions to add_thread_entry, not create_note", () => {
  assert.ok(LUMINITE_BLOCK.includes("add_thread_entry"));
  assert.ok(!LUMINITE_BLOCK.includes("create_note"));
});
