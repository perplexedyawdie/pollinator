import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local-only: load .env from the project and from bee-app/ above it.
// Import this module first so the values exist before other modules read them.
const root = resolve(fileURLToPath(import.meta.url), "../../..");
for (const file of [resolve(root, ".env"), resolve(root, "../.env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
