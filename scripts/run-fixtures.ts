// Runs the real pipeline on the synthetic fixtures without Bee or a server.
import "../src/local/env.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalStorage, localDataDir } from "../src/core/storage.js";
import { jobKey, runPipeline } from "../src/pipeline/run.js";
import type { JobStatus } from "../src/pipeline/types.js";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const storage = new LocalStorage(localDataDir(root));
const jobId = randomUUID();

for (const slot of ["a", "b"]) {
  await storage.put(jobKey(jobId, `${slot}.json`), await readFile(join(root, "fixtures", `${slot}.json`), "utf8"));
}
const started = Date.now();
await runPipeline(storage, jobId);
const status = JSON.parse((await storage.get(jobKey(jobId, "status.json")))!) as JobStatus;
await storage.del([jobKey(jobId, "status.json")]);

if (status.state !== "done") {
  console.error(status);
  process.exit(1);
}
// Phrases that suggest the model fact-checked instead of only recording.
const OUTSIDE_KNOWLEDGE = /verify|course material|commonly|actually|in fact|correct(ly|ion)?\b|reflects green/i;
for (const out of Object.values(status.outputs)) {
  console.log(`\n=============== ${out.name} ===============\n`);
  console.log(out.markdown);
  for (const line of out.markdown.split("\n").filter((l) => OUTSIDE_KNOWLEDGE.test(l))) {
    console.warn(`!! possible added knowledge: ${line}`);
  }
}
console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
