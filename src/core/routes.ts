import { extractConnectUrl, withBee, type BeeConfig } from "./bee.js";
import type { Storage } from "./storage.js";
import { jobKey } from "../pipeline/run.js";
import type { JobStatus, Slot, Transcript } from "../pipeline/types.js";

export type Deps = {
  bee: BeeConfig;
  storage: Storage;
  startPipeline: (jobId: string) => Promise<void>; // must return once the job is queued
};

export type ApiResponse = { status: number; body: unknown };

type Body = Record<string, unknown>;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SLOTS: Slot[] = ["a", "b"];
const AUTH_POLL_MS = 10_000; // stays well under API Gateway's 29 s limit
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const slotOf = (b: Body): Slot => {
  if (!SLOTS.includes(b.slot as Slot)) throw new HttpError(400, "slot must be 'a' or 'b'");
  return b.slot as Slot;
};
const blobOf = (b: Body): string => {
  if (typeof b.blob !== "string" || !b.blob) throw new HttpError(400, "blob is required");
  return b.blob;
};
const jobOf = (id: unknown): string => {
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new HttpError(400, "invalid job id");
  return id;
};

type Profile = { first_name?: string; last_name?: string };
const nameOf = (p: Profile) => [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Bee user";

export async function handle(deps: Deps, method: string, path: string, body: Body): Promise<ApiResponse> {
  try {
    return { status: 200, body: await route(deps, method, path, body) };
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) console.error(err);
    // Unexpected errors can carry internal details (ARNs, paths); keep them in the logs.
    const message = status === 500 ? "Something went wrong, please try again" : err instanceof Error ? err.message : "Unexpected error";
    return { status, body: { error: message } };
  }
}

async function route(deps: Deps, method: string, path: string, body: Body): Promise<unknown> {
  const { bee, storage } = deps;

  if (method === "POST" && path === "/api/auth/start") {
    const slot = slotOf(body);
    const { value: connectUrl, blob } = await withBee(bee, slot, null, async (b) => {
      const url = extractConnectUrl(await b.run(["login", "--no-wait"]));
      if (!url) throw new HttpError(502, "Bee did not return an authentication link");
      return url;
    });
    return { connectUrl, blob };
  }

  if (method === "POST" && path === "/api/auth/poll") {
    const slot = slotOf(body);
    const { value, blob } = await withBee(bee, slot, blobOf(body), async (b) => {
      const me = async () => {
        const res = await b.run(["me", "--json"]);
        return res.code === 0 ? (JSON.parse(res.stdout) as Profile) : null;
      };
      // Only the blocking `bee login` collects an approval (`--no-wait` and
      // `status` never do). It resumes the saved pairing, so run it briefly
      // and let the browser call again until the owner approves.
      let profile = await me();
      if (!profile) {
        await b.run(["login"], { timeoutMs: AUTH_POLL_MS });
        profile = await me();
      }
      return profile ? { authenticated: true, name: nameOf(profile) } : { authenticated: false };
    });
    return { ...value, blob };
  }

  if (method === "POST" && path === "/api/conversations") {
    const slot = slotOf(body);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const { value, blob } = await withBee(bee, slot, blobOf(body), async (b) => {
      if (query) {
        const res = await b.json<{ results: SearchHit[] }>([
          "search", "--query", query, "--filter", "conversations", "--sort", "mostRecent", "--limit", "20",
        ]);
        return res.results
          .filter((r) => r.type === "conversation")
          .map((r) => ({ id: Number(r.id), title: stripTags(r.title_snippet), snippet: stripTags(r.snippet), startTime: r.created_at }));
      }
      const res = await b.json<{ conversations: ConversationSummary[] }>(["conversations", "list", "--limit", "20"]);
      return res.conversations.map((c) => ({
        id: c.id,
        title: c.short_summary ?? "Untitled conversation",
        snippet: null,
        startTime: c.start_time,
        endTime: c.end_time,
        utterances: c.utterances_count,
      }));
    });
    return { conversations: value, blob };
  }

  if (method === "POST" && path === "/api/select") {
    const slot = slotOf(body);
    const jobId = jobOf(body.jobId);
    const conversationId = Number(body.conversationId);
    if (!Number.isInteger(conversationId)) throw new HttpError(400, "conversationId is required");
    const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim().slice(0, 40) : slot.toUpperCase();

    const { value: transcript } = await withBee(bee, slot, blobOf(body), async (b) => {
      const { conversation: c } = await b.json<{ conversation: ConversationDetail }>(["conversations", "get", String(conversationId)]);
      // Done with this participant's Bee access: sign the throwaway session out.
      await b.run(["logout"]);
      const utterances = (c.transcriptions ?? [])
        .flatMap((t) => t.utterances ?? [])
        .filter((u) => u.text?.trim())
        .sort((x, y) => x.spoken_at - y.spoken_at)
        .map((u) => ({ id: u.id, text: u.text, speaker: u.speaker, t: u.spoken_at }));
      const t: Transcript = { slot, displayName, conversationId, title: c.short_summary ?? null, startTime: c.start_time ?? null, utterances };
      return t;
    });
    if (!transcript.utterances.length) throw new HttpError(422, "That conversation has no transcript yet");
    await storage.put(jobKey(jobId, `${slot}.json`), JSON.stringify(transcript));
    return { ok: true, utterances: transcript.utterances.length };
  }

  if (method === "POST" && path === "/api/pollinate") {
    const jobId = jobOf(body.jobId);
    const present = await presentSlots(storage, jobId);
    if (present.length < 2) throw new HttpError(409, "Both participants must pick a conversation first");
    const running: JobStatus = { state: "running", step: "Starting" };
    await storage.put(jobKey(jobId, "status.json"), JSON.stringify(running));
    await deps.startPipeline(jobId);
    return running;
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && method === "GET") {
    const jobId = jobOf(jobMatch[1]);
    const status = await storage.get(jobKey(jobId, "status.json"));
    if (status) return JSON.parse(status);
    const waiting: JobStatus = { state: "waiting", slots: await presentSlots(storage, jobId) };
    return waiting;
  }
  if (jobMatch && method === "DELETE") {
    const jobId = jobOf(jobMatch[1]);
    await storage.del(["a.json", "b.json", "status.json"].map((n) => jobKey(jobId, n)));
    return { ok: true };
  }

  throw new HttpError(404, "Not found");
}

async function presentSlots(storage: Storage, jobId: string): Promise<Slot[]> {
  const found = await Promise.all(SLOTS.map(async (s) => ((await storage.get(jobKey(jobId, `${s}.json`))) ? s : null)));
  return found.filter((s): s is Slot => s !== null);
}

const stripTags = (s: string | undefined) => (s ?? "").replace(/<[^>]+>/g, "").trim();

type SearchHit = { id: string; type: string; snippet?: string; title_snippet?: string; created_at: number };
type ConversationSummary = { id: number; short_summary?: string; start_time: number; end_time: number; utterances_count?: number };
type ConversationDetail = {
  short_summary?: string;
  start_time?: number;
  transcriptions?: { utterances?: { id: number; text: string; speaker: string; spoken_at: number }[] }[];
};
