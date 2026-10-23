import assert from "node:assert/strict";
import { test } from "node:test";
import { groundNotes } from "../src/pipeline/extract.js";
import type { Transcript } from "../src/pipeline/types.js";

const transcript: Transcript = {
  slot: "a",
  displayName: "Ana",
  conversationId: 1,
  title: null,
  startTime: null,
  utterances: [
    { id: 10, text: "RuBisCO fixes CO2", speaker: "S1", t: 0 },
    { id: 11, text: "Focus on this for the midterm", speaker: "S2", t: 1 },
  ],
};

test("drops points and actions that cite nothing real, and topics left empty", () => {
  const grounded = groundNotes(
    {
      topics: [
        {
          title: "Calvin cycle",
          points: [
            { claim: "RuBisCO fixes CO2", kind: "fact", evidence: [10, 99] },
            { claim: "Caveat: verify against course material", kind: "fact", evidence: [] },
            { claim: "Made-up citation", kind: "fact", evidence: [42] },
          ],
        },
        { title: "Invented topic", points: [{ claim: "Not said", kind: "fact" }] },
      ],
      actions: [
        { text: "Focus on the Calvin cycle for the midterm", evidence: [11] },
        { text: "Watch a YouTube video on it", evidence: [] },
      ],
    },
    transcript,
  );
  assert.deepEqual(grounded, {
    topics: [{ title: "Calvin cycle", points: [{ claim: "RuBisCO fixes CO2", kind: "fact", evidence: [10] }] }],
    actions: [{ text: "Focus on the Calvin cycle for the midterm", evidence: [11] }],
  });
});
