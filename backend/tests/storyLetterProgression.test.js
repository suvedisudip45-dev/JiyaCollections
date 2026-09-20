import test from "node:test";
import assert from "node:assert/strict";

import { buildPrintIdempotencyKey, resolveAssignmentProgression, resolveTemplateGenderPool } from "../services/personalizedLetterService.js";

test("print idempotency key stays stable across repeated requests", () => {
  const first = buildPrintIdempotencyKey({ orderId: "order_123", assignmentId: "assignment_456", letterId: "letter_789" });
  const second = buildPrintIdempotencyKey({ orderId: "order_123", assignmentId: "assignment_456", letterId: "letter_789" });

  assert.equal(first, second);
  assert.equal(first, "PERSONALIZED_LETTER:order_123:assignment_456:letter_789");
});

test("non-final story letter increments to the next sequence", () => {
  const progression = resolveAssignmentProgression({
    currentSequenceNumber: 2,
    storyLength: 5,
  });

  assert.equal(progression.isFinalLetter, false);
  assert.equal(progression.shouldCompleteCurrentStory, false);
  assert.equal(progression.nextSequenceNumber, 3);
});

test("final story letter completes current story and resets to sequence 1 for the next assignment", () => {
  const progression = resolveAssignmentProgression({
    currentSequenceNumber: 5,
    storyLength: 5,
  });

  assert.equal(progression.isFinalLetter, true);
  assert.equal(progression.shouldCompleteCurrentStory, true);
  assert.equal(progression.nextSequenceNumber, 1);
});

test("male customers prefer male templates and fallback to generic templates when no exact match exists", () => {
  const templates = [
    { id: "generic", targetGender: "ANY", selectionWeight: 1 },
    { id: "male", targetGender: "MALE", selectionWeight: 2 },
    { id: "female", targetGender: "FEMALE", selectionWeight: 2 },
  ];

  const selected = resolveTemplateGenderPool("MALE", templates);
  assert.deepEqual(selected.map((item) => item.id), ["male"]);

  const fallback = resolveTemplateGenderPool("PREFER_NOT_TO_SAY", [{ id: "male", targetGender: "MALE" }, { id: "generic", targetGender: "ANY" }]);
  assert.equal(fallback[0].id, "generic");
});
