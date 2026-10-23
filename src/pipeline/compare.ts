import { generateJson } from "./llm.js";
import type { Comparison, Notes } from "./types.js";

const SYSTEM = `You compare two students' study notes on the same material, taken in different study groups.
Your job is to find only the differences, so each student sees what the other group did differently. Points both sides covered the same way are left out.
Rules:
- Match topics that cover the same idea even if titled differently (A topic index -> B topic index). A topic matches at most one topic on the other side.
- Within a matched pair, list the point indices that only that side has (onlyA, onlyB). A point counts as shared (omit it) if the other side states the same idea, even in other words or with less detail. If one side adds real specifics the other lacks (a number, a step, an example), treat that point as only on that side.
- conflicts: pairs of points, one from each side, that state incompatible things (different values, opposite claims).
- framings: pairs of points, one from each side, about the same idea where one side explained it in a genuinely different way the other would learn from: a different example, analogy, method or emphasis. Never for mere rewording.
- Pairs reference (topic index, point index) on each side and may cross topics, since the two groups may organise topics differently. A pair is either a conflict or a framing, not both.
- A framing is one-way: set "from" to the side ("A" or "B") whose explanation is the new angle. If both sides offer something the other lacks, give two framings.
- Each conflict or framing gets a "label" of at most 6 words naming what differs (e.g. "Glucose vs G3P", "Dam-and-turbine analogy"), without referring to "A", "B" or either group.
- Labels only describe what the two sides said. Never add your own knowledge, say which side is right, or suggest what is "commonly" true; the students resolve it themselves.
- Topics with no counterpart go in unmatchedA / unmatchedB.
- Action items: list the indices of actions only that side has (actionsOnlyA, actionsOnlyB). Actions with the same intent match even if worded differently ("practise the Z scheme" = "draw the Z scheme").
- Use only indices that exist.`;

const pair = {
  type: "object",
  additionalProperties: false,
  required: ["aTopic", "aPoint", "bTopic", "bPoint", "label"],
  properties: {
    aTopic: { type: "integer" },
    aPoint: { type: "integer" },
    bTopic: { type: "integer" },
    bPoint: { type: "integer" },
    label: { type: "string" },
  },
};
const indices = (description: string) => ({ type: "array", items: { type: "integer" }, description });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matches", "conflicts", "framings", "unmatchedA", "unmatchedB", "actionsOnlyA", "actionsOnlyB"],
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "b", "onlyA", "onlyB"],
        properties: {
          a: { type: "integer", description: "topic index in A" },
          b: { type: "integer", description: "topic index in B" },
          onlyA: indices("point indices in topic A missing from B"),
          onlyB: indices("point indices in topic B missing from A"),
        },
      },
    },
    conflicts: { type: "array", items: pair },
    framings: {
      type: "array",
      items: {
        ...pair,
        required: [...pair.required, "from"],
        properties: { ...pair.properties, from: { type: "string", enum: ["A", "B"] } },
      },
    },
    unmatchedA: indices("topic indices in A with no counterpart in B"),
    unmatchedB: indices("topic indices in B with no counterpart in A"),
    actionsOnlyA: indices("action indices in A that B does not have"),
    actionsOnlyB: indices("action indices in B that A does not have"),
  },
};

const indexed = (notes: Notes) =>
  [
    ...notes.topics.map(
      (t, ti) =>
        `Topic ${ti}: ${t.title}\n` +
        t.points.map((p, pi) => `  ${pi}. [${p.kind}] ${p.claim}${p.detail ? ` — ${p.detail}` : ""}`).join("\n"),
    ),
    `Actions:\n${notes.actions.map((x, i) => `  ${i}. ${x.text}`).join("\n") || "  (none)"}`,
  ].join("\n");

const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export async function compareNotes(a: Notes, b: Notes): Promise<Comparison> {
  const res = await generateJson<Comparison>({
    tier: "compare",
    system: SYSTEM,
    prompt: `NOTES A\n${indexed(a)}\n\nNOTES B\n${indexed(b)}`,
    name: "save_comparison",
    description: "Save the differences between notes A and B.",
    schema: SCHEMA,
  });
  return {
    matches: list(res.matches),
    conflicts: list(res.conflicts),
    framings: list(res.framings),
    unmatchedA: list(res.unmatchedA),
    unmatchedB: list(res.unmatchedB),
    actionsOnlyA: list(res.actionsOnlyA),
    actionsOnlyB: list(res.actionsOnlyB),
  };
}
