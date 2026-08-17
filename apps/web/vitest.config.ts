import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// apps/web absolute path, no trailing slash. Mirrors the tsconfig "@/*" -> "./*"
// alias so tests can import via "@/lib/..." exactly as the app code does.
const appDir = fileURLToPath(new URL(".", import.meta.url)).replace(/[/\\]$/, "");

export default defineConfig({
  test: {
    environment: "node",
    // No injected globals: the eslint config here declares only browser globals,
    // so every test imports { describe, it, expect } from "vitest" explicitly.
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: [{ find: /^@\//, replacement: `${appDir}/` }],
  },
});
