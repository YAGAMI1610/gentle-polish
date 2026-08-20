#!/usr/bin/env node
// commitai — launcher for the TypeScript CLI.
//
// The CLI is authored in TypeScript and imports the web app's real core modules
// (lib/chain, lib/ai/verification, lib/ai/promptGuards) directly, so it can never
// drift from the app's actual behaviour. We run it with `tsx`, which transpiles on
// the fly and resolves extensionless TypeScript imports for both the ESM and CJS
// module graphs. Spawning tsx's CLI (rather than its in-process ESM-only API) is
// what makes resolution work regardless of the caller's current directory.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "cli", "main.ts");

let tsxCli;
try {
  tsxCli = require.resolve("tsx/cli");
} catch {
  console.error(
    "commitai: could not find 'tsx' (its runtime dependency). Run `pnpm install` in the repo first.",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`commitai: failed to launch (${result.error.message})`);
  process.exit(1);
}
// Propagate the child's exit code; a signal death maps to a non-zero code.
process.exit(typeof result.status === "number" ? result.status : 1);
