import Anthropic from "@anthropic-ai/sdk";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

// Two model tiers: a cheap one for per-transcript extraction, a stronger one
// for the cross-notes comparison.
export type Tier = "extract" | "compare";

export type JsonRequest = {
  tier: Tier;
  system: string;
  prompt: string;
  name: string; // short identifier for the output, used as the Bedrock tool name
  description: string;
  schema: Record<string, unknown>; // JSON Schema; every object closed and fully required
};

export const provider = () =>
  (process.env.LLM_PROVIDER ?? (process.env.CLAUDE_API_KEY ? "anthropic" : "bedrock")) as "anthropic" | "bedrock";

export function generateJson<T>(req: JsonRequest): Promise<T> {
  return provider() === "anthropic" ? viaAnthropic<T>(req) : viaBedrock<T>(req);
}

// ---------- Claude API ----------

const ANTHROPIC_MODELS: Record<Tier, string> = {
  extract: process.env.EXTRACT_MODEL ?? "claude-haiku-5-5",
  compare: process.env.COMPARE_MODEL ?? "claude-sonnet-5-5",
};

let anthropic: Anthropic | undefined;

async function viaAnthropic<T>(req: JsonRequest): Promise<T> {
  // Explicit base URL: an inherited ANTHROPIC_BASE_URL (e.g. from a dev tool)
  // must not silently reroute these calls.
  anthropic ??= new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY,
    baseURL: process.env.CLAUDE_API_BASE_URL ?? "https://api.anthropic.com",
  });
  const model = ANTHROPIC_MODELS[req.tier];
  const res = await anthropic.beta.messages.create({
    model,
    max_tokens: 16000,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    output_config: { format: { type: "json_schema", schema: req.schema } },
    // On a safety decline, re-run on a fallback model chosen by the API.
    ...(model === "claude-sonnet-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (res.stop_reason === "refusal") throw new Error(`${req.name}: the model declined this content`);
  if (res.stop_reason === "max_tokens") throw new Error(`${req.name}: output was cut off (max_tokens)`);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

// ---------- Amazon Bedrock ----------

const BEDROCK_MODELS: Record<Tier, string> = {
  extract: process.env.EXTRACT_MODEL_ID ?? "us.anthropic.claude-haiku-5-5",
  compare: process.env.COMPARE_MODEL_ID ?? "us.anthropic.claude-sonnet-5-5",
};

let bedrock: BedrockRuntimeClient | undefined;

async function viaBedrock<T>(req: JsonRequest): Promise<T> {
  bedrock ??= new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-2" });
  // Current Claude models reject a forced toolChoice, so the tool is offered
  // with "auto" and the prompt asks for it.
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: BEDROCK_MODELS[req.tier],
      system: [{ text: `${req.system}\n\nRespond only by calling the ${req.name} tool.` }],
      messages: [{ role: "user", content: [{ text: req.prompt }] }],
      inferenceConfig: { maxTokens: 16000 },
      toolConfig: {
        tools: [{ toolSpec: { name: req.name, description: req.description, inputSchema: { json: req.schema as never } } }],
        toolChoice: { auto: {} },
      },
    }),
  );
  const block = res.output?.message?.content?.find((c) => c.toolUse);
  if (!block?.toolUse?.input) throw new Error(`${req.name}: model returned no tool call (${res.stopReason})`);
  return block.toolUse.input as T;
}
