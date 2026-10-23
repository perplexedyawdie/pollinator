import type { Storage } from "../core/storage.js";
import { compareNotes } from "./compare.js";
import { extractNotes } from "./extract.js";
import { renderDifferences } from "./render.js";
import type { JobStatus, Transcript } from "./types.js";

export const jobKey = (jobId: string, name: string) => `jobs/${jobId}/${name}`;

export async function runPipeline(storage: Storage, jobId: string): Promise<void> {
  const setStatus = (s: JobStatus) => storage.put(jobKey(jobId, "status.json"), JSON.stringify(s));
  const transcriptKeys = [jobKey(jobId, "a.json"), jobKey(jobId, "b.json")];
  try {
    await setStatus({ state: "running", step: "Extracting study notes from both conversations" });
    const [ta, tb] = await Promise.all(
      transcriptKeys.map(async (k) => JSON.parse((await storage.get(k)) ?? "null") as Transcript | null),
    );
    if (!ta || !tb) throw new Error("Both participants must select a conversation first");
    const [na, nb] = await Promise.all([extractNotes(ta), extractNotes(tb)]);
    // Raw transcripts are no longer needed once notes exist.
    await storage.del(transcriptKeys);

    await setStatus({ state: "running", step: "Comparing notes and finding gaps" });
    const cmp = await compareNotes(na, nb);

    const sides = { a: { name: ta.displayName, notes: na }, b: { name: tb.displayName, notes: nb } };
    await setStatus({
      state: "done",
      outputs: {
        a: { name: ta.displayName, markdown: renderDifferences("a", sides, cmp) },
        b: { name: tb.displayName, markdown: renderDifferences("b", sides, cmp) },
      },
    });
  } catch (err) {
    console.error("pipeline failed", err);
    await storage.del(transcriptKeys).catch(() => {});
    await setStatus({ state: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}
