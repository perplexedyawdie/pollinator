import { generateJson } from "./llm.js";
import { POINT_KINDS, type Action, type Notes, type Topic, type Transcript } from "./types.js";

const SYSTEM = `You turn a raw, noisy transcript of a study-group session into clean study notes.
You are a faithful note-taker, not a tutor: the notes must contain only what the speakers said.
Rules:
- Keep only study content: concepts, definitions, explanations, worked examples, formulas, procedures, facts, tips, open questions.
- Drop small talk, logistics, and anything personal or unrelated to the subject. Never include names of people, contact details, or private matters.
- Group points into topics the way a student would organize revision notes. Topics are subject content only: never make a topic for exam hints, logistics or to-dos.
- Kind "tip" is a memory aid or technique for the content (a mnemonic, a trick to remember a step), not exam or study advice.
- Keep it skimmable. Each point: a short "claim" (at most 15 words) plus "detail" (at most 20 words) with specifics (numbers, steps, examples) the speakers actually gave, or an empty string.
- Put study to-dos and advice in "actions", not in topics: what to focus on, review, practise, or expect on the exam ("focus on photorespiration for the midterm", "professor said draw the Z scheme"). Write each as a short imperative (at most 15 words). An exam hint goes in actions only, never also as a point.
- Only actions a speaker explicitly proposed. Never turn an open question or disagreement into a to-do ("check whether…"), and never suggest your own.
- Never add your own knowledge. Do not correct, fact-check, caveat, qualify or "verify against course material" anything, even when a statement looks wrong; record it exactly as the group stated it. Other tools handle disagreements.
- If a speaker was unsure whether something is true ("I think it's…", "pretty sure"), use kind "question" and say in the claim that the group was unsure. Do not resolve it. Explaining with an analogy or picture ("I think of it as a dam") is not uncertainty: record it as kind "example".
- Every point and action must cite the ids of the utterances it comes from in "evidence". Anything you cannot cite does not belong in the notes.
- If nothing study-related was discussed, return empty topics and actions lists.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "topics", "actions"],
  properties: {
    subject: { type: "string", description: "Subject studied in at most 5 words, no colon, e.g. 'SN1 and SN2 reactions'" },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "points"],
        properties: {
          title: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["claim", "detail", "kind", "evidence"],
              properties: {
                claim: { type: "string" },
                detail: { type: "string", description: "Specifics actually said; empty string if none" },
                kind: { type: "string", enum: [...POINT_KINDS] },
                evidence: { type: "array", items: { type: "integer" } },
              },
            },
          },
        },
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence"],
        properties: {
          text: { type: "string" },
          evidence: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
};

export async function extractNotes(transcript: Transcript): Promise<Notes> {
  const lines = transcript.utterances.map((u) => `[${u.id}] ${u.speaker || "Speaker"}: ${u.text}`).join("\n");
  const notes = await generateJson<Notes>({
    tier: "extract",
    system: SYSTEM,
    prompt: `Transcript${transcript.title ? ` (Bee's title: "${transcript.title}")` : ""}:\n\n${lines}`,
    name: "save_study_notes",
    description: "Save the structured study notes extracted from the transcript.",
    schema: SCHEMA,
  });
  return { subject: notes.subject ?? "Study notes", ...groundNotes(notes, transcript) };
}

// Keeps only points and actions that cite at least one real utterance, so
// nothing the model made up (rather than heard) reaches either person.
export function groundNotes(
  notes: { topics?: Topic[]; actions?: Action[] },
  transcript: Transcript,
): { topics: Topic[]; actions: Action[] } {
  const ids = new Set(transcript.utterances.map((u) => u.id));
  const cited = <T extends { evidence?: number[] }>(item: T): T[] => {
    const evidence = (item.evidence ?? []).filter((id) => ids.has(id));
    return evidence.length ? [{ ...item, evidence }] : [];
  };
  const topics = (Array.isArray(notes.topics) ? notes.topics : [])
    .map((t) => ({ ...t, points: (t.points ?? []).flatMap(cited) }))
    .filter((t) => t.points.length);
  const actions = (Array.isArray(notes.actions) ? notes.actions : []).flatMap(cited);
  return { topics, actions };
}
