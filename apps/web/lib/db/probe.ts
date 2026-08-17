import { prisma } from "./client";

/**
 * Returns true only if a migrated Postgres is reachable at DATABASE_URL.
 *
 * `wallet.count()` needs both a live connection AND the schema applied, so this
 * single check covers connectivity and migration state. It is used to gate the
 * DB-backed integration tests: when no database is up (the common case in this
 * environment — see LIMITATIONS.md step 3), they skip cleanly instead of
 * failing. The query is raced against a timeout so a black-holed host cannot
 * hang the suite.
 */
export async function probeDatabaseReady(timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("db-probe-timeout")), timeoutMs);
  });

  const query = prisma.wallet.count();

  try {
    await Promise.race([query, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    // If the timeout won the race, the query promise is still pending; swallow
    // its eventual rejection so it does not surface as an unhandled rejection.
    void Promise.resolve(query).catch(() => {});
  }
}
