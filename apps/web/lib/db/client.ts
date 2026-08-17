import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * Next.js dev / HMR re-evaluates modules, which would otherwise spawn a new
 * connection pool on every reload and exhaust Postgres. We cache one instance
 * on `globalThis` in non-production, exactly as the Prisma + Next.js guidance
 * recommends. In production a single module instance is used.
 *
 * This module only constructs the client — it does NOT connect. Prisma connects
 * lazily on the first query, so importing this file has no side effect and is
 * safe for unit tests that never touch the database.
 */

const log: Prisma.LogLevel[] =
  process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ log });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
