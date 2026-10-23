import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { handle, type Deps } from "../core/routes.js";
import { parseKey } from "../core/seal.js";
import { S3Storage } from "../core/storage.js";
import { loadSecrets } from "./secrets.js";

const lambda = new LambdaClient({});
let deps: Deps | undefined;

async function getDeps(): Promise<Deps> {
  if (deps) return deps;
  await loadSecrets();
  deps = {
    bee: { binary: process.env.BEE_CLI_BINARY ?? "/var/task/bin/bee", key: parseKey(process.env.SEAL_KEY ?? "") },
    storage: new S3Storage(required("DATA_BUCKET")),
    startPipeline: async (jobId) => {
      await lambda.send(
        new InvokeCommand({
          FunctionName: required("WORKER_FUNCTION"),
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ jobId })),
        }),
      );
    },
  };
  return deps;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: Record<string, unknown> = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }
  }
  const out = await handle(await getDeps(), event.requestContext.http.method, event.rawPath, body);
  return {
    statusCode: out.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(out.body),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
