import type { Comparison, Notes, Point, PointPair, Slot } from "./types.js";

type Side = { name: string; notes: Notes };

// Deterministic rendering: the model only decides *which* items differ; the
// other person's points and actions are copied verbatim from their notes.
// Only differences are shown; what both groups covered the same way is left out.
export function renderDifferences(self: Slot, sides: Record<Slot, Side>, cmp: Comparison): string {
  const other: Slot = self === "a" ? "b" : "a";
  const mine = sides[self];
  const theirs = sides[other];
  const pick = <T>(forA: T, forB: T) => (self === "a" ? forA : forB);
  const pointAt = (notes: Notes, ti: number, pi: number): Point | undefined => notes.topics[ti]?.points[pi];

  // Their points already shown as a disagreement or different angle.
  const paired = new Set<string>();
  const pairLines = (pairs: PointPair[], render: (label: string, myTitle: string, mine: Point, theirs: Point) => string) =>
    pairs.flatMap((p) => {
      const myTopic = pick(p.aTopic, p.bTopic);
      const myPoint = pointAt(mine.notes, myTopic, pick(p.aPoint, p.bPoint));
      const key = `${pick(p.bTopic, p.aTopic)}:${pick(p.bPoint, p.aPoint)}`;
      const theirPoint = pointAt(theirs.notes, pick(p.bTopic, p.aTopic), pick(p.bPoint, p.aPoint));
      if (!myPoint || !theirPoint || paired.has(key)) return [];
      paired.add(key);
      return [render(p.label, mine.notes.topics[myTopic].title, myPoint, theirPoint)];
    });

  const differently = [
    ...pairLines(cmp.conflicts, (label, title, m, t) => `- ⚠️ **${label}** (${title}): ${formatPoint(t)} _You: ${formatPoint(m, true)}_`),
    // Only the reader who lacks the angle sees it.
    ...pairLines(
      cmp.framings.filter((f) => f.from === pick("B", "A")),
      (label, title, _m, t) => `- 💡 **${label}** (${title}): ${formatPoint(t)}`,
    ),
  ];

  const notCovered: string[] = [];
  const add = (theirTopic: number, pi: number, heading: string) => {
    const p = pointAt(theirs.notes, theirTopic, pi);
    if (p && !paired.has(`${theirTopic}:${pi}`)) notCovered.push(`- 🐝 ${heading} ${formatPoint(p)}`);
  };
  const seenTopics = new Set<number>();
  for (const m of cmp.matches) {
    const myTitle = mine.notes.topics[pick(m.a, m.b)]?.title;
    const theirTopic = pick(m.b, m.a);
    if (!myTitle || !theirs.notes.topics[theirTopic] || seenTopics.has(theirTopic)) continue;
    seenTopics.add(theirTopic);
    for (const pi of new Set(pick(m.onlyB, m.onlyA))) add(theirTopic, pi, `**${myTitle}:**`);
  }
  for (const ti of new Set(pick(cmp.unmatchedB, cmp.unmatchedA))) {
    const topic = theirs.notes.topics[ti];
    if (!topic || seenTopics.has(ti)) continue;
    topic.points.forEach((_, pi) => add(ti, pi, `**${topic.title}** (new):`));
  }

  const actions = [...new Set(pick(cmp.actionsOnlyB, cmp.actionsOnlyA))]
    .map((i) => theirs.notes.actions[i])
    .filter(Boolean)
    .map((a) => `- ✅ ${a.text}`);

  const lines = [`# ${mine.notes.subject}: what ${theirs.name}'s group did differently`, ""];
  if (!differently.length && !notCovered.length && !actions.length) {
    lines.push("_Both sessions covered the same ground._");
    return lines.join("\n") + "\n";
  }
  lines.push(
    "> ⚠️ disagreement · 💡 different angle · 🐝 you didn't cover · ✅ action item",
    `> **${differently.length}** discussed differently · **${notCovered.length}** you didn't cover · **${actions.length}** action item${actions.length === 1 ? "" : "s"}`,
    "",
  );
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push(`## ${title}`, "", ...items, "");
  };
  section("Discussed differently", differently);
  section("You didn't cover", notCovered);
  section("Action items", actions);
  return lines.join("\n").trimEnd() + "\n";
}

// Concepts and facts need no label; other kinds keep theirs to aid skimming.
// `inline` is for text already inside italics, where nested emphasis breaks.
function formatPoint(p: Point, inline = false): string {
  const kind = p.kind === "concept" || p.kind === "fact" ? "" : inline ? `(${p.kind}) ` : `_${p.kind}:_ `;
  return `${kind}${p.claim}${p.detail ? ` — ${p.detail}` : ""}`;
}
