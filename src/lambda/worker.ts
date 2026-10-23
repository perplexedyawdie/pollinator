import { S3Storage } from "../core/storage.js";
import { runPipeline } from "../pipeline/run.js";
import { loadSecrets } from "./secrets.js";

// Invoked asynchronously by the API function once both transcripts are in S3.
export async function handler(event: { jobId: string }): Promise<void> {
  await loadSecrets();
  const bucket = process.env.DATA_BUCKET;
  if (!bucket) throw new Error("DATA_BUCKET is not set");
  await runPipeline(new S3Storage(bucket), event.jobId);
}
