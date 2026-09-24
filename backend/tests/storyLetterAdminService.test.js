import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStatus, toggleArchiveState, normalizeLetterSequenceOrder } from "../services/storyLetterAdminService.js";

test("normalizeStatus keeps values in the supported set", () => {
  assert.equal(normalizeStatus("active"), "ACTIVE");
  assert.equal(normalizeStatus("paused"), "PAUSED");
  assert.equal(normalizeStatus("unknown"), "ACTIVE");
});

test("toggleArchiveState flips between active and archived safely", () => {
  assert.equal(toggleArchiveState("ACTIVE"), "ARCHIVED");
  assert.equal(toggleArchiveState("ARCHIVED"), "ACTIVE");
  assert.equal(toggleArchiveState(undefined), "ARCHIVED");
});

test("normalizeLetterSequenceOrder keeps the provided sequence stable while removing duplicates", () => {
  const ordered = normalizeLetterSequenceOrder(["b", "a", "c"]);
  assert.deepEqual(ordered, ["b", "a", "c"]);

  const reordered = normalizeLetterSequenceOrder(["a", "c", "b", "a"]);
  assert.deepEqual(reordered, ["a", "c", "b"]);
});
