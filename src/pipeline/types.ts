export type Utterance = { id: number; text: string; speaker: string; t: number };

export type Transcript = {
  slot: Slot;
  displayName: string;
  conversationId: number;
  title: string | null;
  startTime: number | null;
  utterances: Utterance[];
};

export type Slot = "a" | "b";

export const POINT_KINDS = ["definition", "concept", "example", "formula", "step", "fact", "tip", "question"] as const;
export type PointKind = (typeof POINT_KINDS)[number];

export type Point = { claim: string; detail?: string; kind: PointKind; evidence?: number[] };
export type Topic = { title: string; points: Point[] };
// Study to-dos and advice said in the session ("focus on X for the midterm").
export type Action = { text: string; evidence?: number[] };
export type Notes = { subject: string; topics: Topic[]; actions: Action[] };

// One point on each side (topic index, point index) plus a short label.
// Pairs may span differently organised topics.
export type PointPair = { aTopic: number; aPoint: number; bTopic: number; bPoint: number; label: string };
// A framing is one-way: `from` is the side whose explanation is the new angle.
export type Framing = PointPair & { from: "A" | "B" };

// Indices refer to topics/points in the two Notes objects, so the model never
// rewrites the other person's words; render.ts copies them verbatim.
export type TopicMatch = {
  a: number;
  b: number;
  onlyA: number[];
  onlyB: number[];
};
export type Comparison = {
  matches: TopicMatch[];
  conflicts: PointPair[]; // incompatible claims
  framings: Framing[]; // same idea, explained differently
  unmatchedA: number[];
  unmatchedB: number[];
  actionsOnlyA: number[];
  actionsOnlyB: number[];
};

export type JobStatus =
  | { state: "waiting"; slots: Slot[] }
  | { state: "running"; step: string }
  | { state: "done"; outputs: Record<Slot, { name: string; markdown: string }> }
  | { state: "failed"; error: string };
