/**
 * Data-access layer public surface.
 *
 * Import from `@/lib/db` everywhere above this layer. The Prisma client, the
 * scope error, the boundary validation schemas, and the wallet-scoped
 * repositories are all re-exported here. (`probe.ts` is intentionally not
 * re-exported — it is a test-only helper.)
 */
export { prisma } from "./client";
export { WalletScopeError } from "./errors";
export * from "./schemas";
export * from "./repositories";
