import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { SESSION_TTL_MS, seal, unseal, type SealedSession } from "./seal.js";

export type BeeConfig = {
  binary: string; // path to the platform bee binary
  key: Buffer; // seal key
};

export type BeeResult = { stdout: string; stderr: string; code: number };

export type Bee = {
  run: (args: string[], opts?: { timeoutMs?: number }) => Promise<BeeResult>;
  json: <T>(args: string[]) => Promise<T>;
};

// Runs `fn` against a throwaway Bee config dir restored from `blob` (or empty
// when starting a login), then reseals whatever the CLI left behind.
export async function withBee<T>(
  config: BeeConfig,
  slot: string,
  blob: string | null,
  fn: (bee: Bee) => Promise<T>,
): Promise<{ value: T; blob: string }> {
  const session: SealedSession = blob
    ? unseal(blob, config.key, slot)
    : { slot, exp: Date.now() + SESSION_TTL_MS, files: {} };

  const home = await mkdtemp(join(tmpdir(), "bee-"));
  const configDir = join(home, ".bee");
  try {
    await restoreDir(configDir, session.files);
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: home,
      BEE_CONFIG_DIR: configDir,
      BEE_FORCE_FILE_STORE: "1",
    };
    const run = (args: string[], opts?: { timeoutMs?: number }) => exec(config.binary, args, env, opts?.timeoutMs);
    const bee: Bee = {
      run,
      json: async <J>(args: string[]) => {
        const res = await run([...args, "--json"]);
        if (res.code !== 0) throw new BeeError(args[0], res);
        return JSON.parse(res.stdout) as J;
      },
    };
    const value = await fn(bee);
    const files = await snapshotDir(configDir);
    return { value, blob: seal({ ...session, files }, config.key) };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function exec(binary: string, args: string[], env: Record<string, string>, timeoutMs = 25_000): Promise<BeeResult> {
  return new Promise((resolve) => {
    execFile(binary, args, { env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      // Only the command name is logged: auth commands print token fragments.
      console.log(`bee ${args[0]} ${args[1] && !args[1].startsWith("-") ? args[1] : ""} -> ${code}`);
      resolve({ stdout, stderr, code });
    });
  });
}

async function snapshotDir(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (current: string) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files[relative(dir, full)] = (await readFile(full)).toString("base64");
    }
  };
  await walk(dir);
  return files;
}

async function restoreDir(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    if (relative(dir, full).startsWith("..")) throw new Error("Bad session path");
    await mkdir(dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, Buffer.from(contents, "base64"), { mode: 0o600 });
  }
}

export class BeeError extends Error {
  readonly status = 502;
  constructor(command: string, res: BeeResult) {
    super(`bee ${command} failed: ${firstLine(res.stderr) || firstLine(res.stdout) || `exit ${res.code}`}`);
  }
}

const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";

const LINK_RE = /https:\/\/bee\.computer\/connect#[A-Za-z0-9_\-]+/;

export function extractConnectUrl(res: BeeResult): string | null {
  return (res.stdout + "\n" + res.stderr).match(LINK_RE)?.[0] ?? null;
}
