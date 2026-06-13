import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTodos } from "../src/templates/luminite-hook.mjs";

test("extracts TODO and FIXME with priority mapping", () => {
  const src = [
    "const x = 1; // TODO: handle refresh token",
    "function y() {} // FIXME broken on safari",
    "// just a comment",
    "/* TODO: nested cleanup */",
  ].join("\n");

  const todos = extractTodos("src/auth.ts", src);

  assert.equal(todos.length, 3);
  assert.deepEqual(todos[0], { text: "handle refresh token", file: "src/auth.ts", line: 1, priority: "medium" });
  assert.equal(todos[1].priority, "high"); // FIXME → high
  assert.equal(todos[1].text, "broken on safari");
  assert.equal(todos[2].line, 4);
});

test("returns nothing for files with no markers", () => {
  assert.deepEqual(extractTodos("a.js", "const a = 1;\nconst b = 2;"), []);
});
