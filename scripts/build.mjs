// Bundles the app with esbuild.
//   node scripts/build.mjs          -> local server + Lambda zips
//   node scripts/build.mjs local    -> local server only (used by the container)
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const target = process.argv[2] ?? "all";

const bundle = (entry, outfile) =>
  build({
    entryPoints: [join(root, entry)],
    outfile: join(dist, outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Some bundled CommonJS dependencies call require().
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });

await bundle("src/local/server.ts", "local/server.mjs");
console.log("built dist/local/server.mjs");

if (target === "all" && existsSync(join(root, "src/lambda/api.ts"))) {
  for (const fn of ["api", "worker"]) {
    rmSync(join(dist, fn), { recursive: true, force: true });
    await bundle(`src/lambda/${fn}.ts`, `${fn}/index.mjs`);
  }
  // Lambda runs on arm64; the API function shells out to the Bee CLI.
  mkdirSync(join(dist, "api/bin"), { recursive: true });
  copyFileSync(join(root, "node_modules/@beeai/cli/dist/platforms/linux-arm64/bee"), join(dist, "api/bin/bee"));
  chmodSync(join(dist, "api/bin/bee"), 0o755);
  for (const fn of ["api", "worker"]) {
    rmSync(join(dist, `${fn}.zip`), { force: true });
    execFileSync("zip", ["-X", "-q", "-r", join(dist, `${fn}.zip`), "."], { cwd: join(dist, fn) });
    console.log(`built dist/${fn}.zip`);
  }
}
