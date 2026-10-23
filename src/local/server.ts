import "./env.js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, type Deps } from "../core/routes.js";
import { parseKey } from "../core/seal.js";
import { LocalStorage, localDataDir } from "../core/storage.js";
import { runPipeline } from "../pipeline/run.js";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const webDir = join(root, "web");
const port = Number(process.env.PORT ?? 8787);

const platform = { darwin: "mac", linux: "linux" }[process.platform as "darwin" | "linux"];
const binary =
  process.env.BEE_CLI_BINARY ?? join(root, "node_modules/@beeai/cli/dist/platforms", `${platform}-${process.arch}`, "bee");

const storage = new LocalStorage(localDataDir(root));
const key = process.env.SEAL_KEY ? parseKey(process.env.SEAL_KEY) : await localSealKey();

// Kept in .data/ so restarting the dev server doesn't sign everyone out.
async function localSealKey(): Promise<Buffer> {
  const file = join(localDataDir(root), "seal.key");
  try {
    return parseKey(await readFile(file, "utf8"));
  } catch {
    const fresh = randomBytes(32);
    await mkdir(localDataDir(root), { recursive: true });
    await writeFile(file, fresh.toString("base64"), { mode: 0o600 });
    return fresh;
  }
}
const deps: Deps = {
  bee: { binary, key },
  storage,
  startPipeline: async (jobId) => {
    void runPipeline(storage, jobId);
  },
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400).end();
      return;
    }
    const out = await handle(deps, req.method ?? "GET", url.pathname, body);
    res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body));
    return;
  }
  const file = resolve(webDir, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(webDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Pollinator running at http://localhost:${port}`);
});
