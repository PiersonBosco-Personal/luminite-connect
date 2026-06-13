import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.rotate, false);
  assert.equal(a.help, false);
  assert.equal(a.url, "https://app.luminiteapp.com");
});

test("flags", () => {
  const a = parseArgs(["--rotate", "--url", "http://localhost:8000"]);
  assert.equal(a.rotate, true);
  assert.equal(a.url, "http://localhost:8000");
});

test("help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});
