import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDifferences } from "../src/pipeline/render.js";
import type { Comparison, Notes } from "../src/pipeline/types.js";

const a: Notes = {
  subject: "Photosynthesis",
  topics: [
    {
      title: "Light reactions",
      points: [
        { claim: "Happen in the thylakoid membrane", kind: "fact" },
        { claim: "Unsure if 2 ATP per water split", kind: "question" },
        { claim: "ATP synthase uses the proton gradient", kind: "concept" },
      ],
    },
    { title: "Exam tips", points: [{ claim: "Mnemonic: PS2 comes first", kind: "tip" }] },
  ],
  actions: [{ text: "Draw the Z scheme" }, { text: "Review chapter 8" }],
};
const b: Notes = {
  subject: "Photosynthesis",
  topics: [
    {
      title: "Light-dependent stage",
      points: [
        { claim: "Located in thylakoids", kind: "fact" },
        { claim: "Photolysis splits water releasing O2", kind: "formula", detail: "2H2O → 4H+ + 4e- + O2" },
        { claim: "Produces 3 ATP per water split", kind: "fact" },
        { claim: "Proton gradient works like water through a dam turbine", kind: "example" },
      ],
    },
    { title: "Calvin cycle", points: [{ claim: "Fixes CO2 using RuBisCO", kind: "concept" }] },
  ],
  actions: [{ text: "Practise drawing the Z scheme" }, { text: "Focus on photorespiration for the midterm" }],
};
const cmp: Comparison = {
  matches: [{ a: 0, b: 0, onlyA: [], onlyB: [1] }],
  conflicts: [{ aTopic: 0, aPoint: 1, bTopic: 0, bPoint: 2, label: "ATP per water split" }],
  framings: [{ aTopic: 0, aPoint: 2, bTopic: 0, bPoint: 3, label: "Dam-and-turbine analogy", from: "B" }],
  unmatchedA: [1],
  unmatchedB: [1],
  actionsOnlyA: [1],
  actionsOnlyB: [1],
};
const sides = { a: { name: "Ana", notes: a }, b: { name: "Ben", notes: b } };

test("shows only Ben's differences to Ana", () => {
  const md = renderDifferences("a", sides, cmp);
  assert.match(md, /^# Photosynthesis: what Ben's group did differently\n/);
  assert.match(md, /> ⚠️ disagreement · 💡 different angle · 🐝 you didn't cover · ✅ action item/);
  assert.match(md, /> \*\*2\*\* discussed differently · \*\*2\*\* you didn't cover · \*\*1\*\* action item\n/);
  assert.match(
    md,
    /- ⚠️ \*\*ATP per water split\*\* \(Light reactions\): Produces 3 ATP per water split _You: \(question\) Unsure if 2 ATP per water split_/,
  );
  assert.match(md, /- 💡 \*\*Dam-and-turbine analogy\*\* \(Light reactions\): _example:_ Proton gradient works like water/);
  assert.match(md, /- 🐝 \*\*Light reactions:\*\* _formula:_ Photolysis splits water releasing O2 — 2H2O/);
  assert.match(md, /- 🐝 \*\*Calvin cycle\*\* \(new\): Fixes CO2 using RuBisCO/);
  assert.match(md, /## Action items\n\n- ✅ Focus on photorespiration for the midterm\n/);
  // Shared points and Ana's own material never appear as additions.
  assert.doesNotMatch(md, /Located in thylakoids|Practise drawing|Mnemonic|Exam tips/);
});

test("shows Ana's differences to Ben", () => {
  const md = renderDifferences("b", sides, cmp);
  assert.match(md, /_You: Produces 3 ATP per water split_/);
  assert.match(md, /- 🐝 \*\*Exam tips\*\* \(new\): _tip:_ Mnemonic: PS2 comes first/);
  assert.match(md, /- ✅ Review chapter 8/);
  assert.doesNotMatch(md, /Photolysis|Calvin cycle/);
  // Ben's analogy is a new angle for Ana only.
  assert.doesNotMatch(md, /- 💡|Dam-and-turbine/);
});

test("pairs across differently organised topics hide the paired point", () => {
  const cross: Comparison = {
    ...cmp,
    framings: [{ aTopic: 0, aPoint: 2, bTopic: 1, bPoint: 0, label: "RuBisCO angle", from: "B" }],
  };
  const md = renderDifferences("a", sides, cross);
  assert.match(md, /- 💡 \*\*RuBisCO angle\*\* \(Light reactions\): Fixes CO2 using RuBisCO/);
  assert.doesNotMatch(md, /\(new\): Fixes CO2/);
});

test("empty state when nothing differs", () => {
  const same: Comparison = { matches: [], conflicts: [], framings: [], unmatchedA: [], unmatchedB: [], actionsOnlyA: [], actionsOnlyB: [] };
  assert.equal(renderDifferences("a", sides, same), "# Photosynthesis: what Ben's group did differently\n\n_Both sessions covered the same ground._\n");
});

test("ignores out-of-range indices and duplicates from the model", () => {
  const bad: Comparison = {
    matches: [
      { a: 0, b: 9, onlyA: [], onlyB: [0] },
      { a: 0, b: 0, onlyA: [], onlyB: [1, 1, 7, 3] },
    ],
    conflicts: [{ aTopic: 0, aPoint: 5, bTopic: 0, bPoint: 0, label: "x" }],
    framings: [
      { aTopic: 0, aPoint: 2, bTopic: 0, bPoint: 3, label: "Dam", from: "B" },
      { aTopic: 0, aPoint: 0, bTopic: 0, bPoint: 3, label: "Dup", from: "B" },
    ],
    unmatchedA: [],
    unmatchedB: [4, 1, 1],
    actionsOnlyA: [],
    actionsOnlyB: [9, 1, 1],
  };
  const md = renderDifferences("a", sides, bad);
  // 1 framing; not covered = point 1 (point 3 is the framing) + Calvin cycle; 1 action.
  assert.match(md, /\*\*1\*\* discussed differently · \*\*2\*\* you didn't cover · \*\*1\*\* action item\n/);
});
