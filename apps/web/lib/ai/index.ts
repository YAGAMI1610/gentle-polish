/**
 * AI layer public surface.
 *
 * Import from `@/lib/ai` above this layer. The provider interface, the concrete
 * Gemini provider, the prompt guards, the tool registry, and the turn runner are
 * all re-exported here. (`probe.ts` is intentionally not re-exported — it is a
 * test/runtime environment check, like `lib/db/probe.ts`.)
 */
export * from "./provider";
export * from "./promptGuards";
export * from "./gemini";
export * from "./runner";
export * from "./tools";
