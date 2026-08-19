import type { AchievementDefinition } from "@prisma/client";
import { prisma } from "../client";
import { evmAddressSchema } from "../schemas";
import { ensureWallet } from "./wallet";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";

/**
 * Achievement catalog + earned-at persistence (build item 7).
 *
 * `AchievementDefinition` is the catalog TABLE, mirrored from the code
 * `ACHIEVEMENT_CATALOG` constant (`lib/achievements/catalog.ts`, the source of truth
 * for the earn predicate) by `syncAchievementCatalog`, so code and DB can't drift.
 * `EarnedAchievement` records the FIRST moment the system observed a wallet meeting a
 * threshold — written once and never moved (first-writer-wins via
 * `createMany({ skipDuplicates: true })`), so `earnedAt` is a genuine
 * first-observation timestamp, not a fabricated one (CLAUDE.md rule 1). `earned`
 * itself is always recomputed live from real counts (see `deriveAchievements`); this
 * module only persists WHEN a crossing was first seen.
 */

// The catalog is tiny and static within a process, and earned rows FK to it, so we
// sync it into the table at most once per process (memoized). A failed sync clears
// the memo so a later call can retry rather than caching a rejected promise.
let catalogSynced: Promise<void> | null = null;

/**
 * Upsert every `ACHIEVEMENT_CATALOG` entry into the `AchievementDefinition` table.
 * Idempotent: re-running refreshes metadata (name/description/metric/threshold/order)
 * and never removes a wallet's earned rows. Returns the number of catalog entries.
 */
export async function syncAchievementCatalog(): Promise<number> {
  await Promise.all(
    ACHIEVEMENT_CATALOG.map((def, sortOrder) =>
      prisma.achievementDefinition.upsert({
        where: { id: def.id },
        create: {
          id: def.id,
          name: def.name,
          description: def.description,
          metric: def.metric,
          threshold: def.threshold,
          sortOrder,
        },
        update: {
          name: def.name,
          description: def.description,
          metric: def.metric,
          threshold: def.threshold,
          sortOrder,
        },
      }),
    ),
  );
  return ACHIEVEMENT_CATALOG.length;
}

function ensureCatalogSynced(): Promise<void> {
  if (!catalogSynced) {
    catalogSynced = syncAchievementCatalog().then(() => undefined);
    catalogSynced.catch(() => {
      catalogSynced = null;
    });
  }
  return catalogSynced;
}

/** The persisted catalog, in display order (empty until first synced). */
export async function listAchievementDefinitions(): Promise<AchievementDefinition[]> {
  return prisma.achievementDefinition.findMany({ orderBy: { sortOrder: "asc" } });
}

/**
 * Persist the first-observation crossing for each currently-earned achievement id.
 * Idempotent and first-writer-wins: `createMany({ skipDuplicates: true })` inserts
 * only (walletAddress, achievementId) rows that don't exist yet, so an already
 * recorded `earnedAt` is never overwritten (the crossing time is write-once). The
 * catalog is synced first (the rows FK to it) and the wallet is ensured (rows FK to
 * Wallet). Returns how many NEW crossings were recorded (0 if all already known).
 */
export async function recordEarnedAchievements(
  walletAddress: string,
  earnedIds: readonly string[],
): Promise<number> {
  const addr = evmAddressSchema.parse(walletAddress);
  if (earnedIds.length === 0) return 0;
  await ensureCatalogSynced();
  await ensureWallet(addr);
  const result = await prisma.earnedAchievement.createMany({
    data: earnedIds.map((achievementId) => ({ walletAddress: addr, achievementId })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Map of achievementId → first-observed `earnedAt` for this wallet (empty if none).
 * Wallet-scoped: only this wallet's crossings are returned. Fed to
 * `deriveAchievements` so an earned achievement can show WHEN it was first earned.
 */
export async function listEarnedAchievements(walletAddress: string): Promise<Map<string, Date>> {
  const addr = evmAddressSchema.parse(walletAddress);
  const rows = await prisma.earnedAchievement.findMany({
    where: { walletAddress: addr },
    select: { achievementId: true, earnedAt: true },
  });
  return new Map(rows.map((r) => [r.achievementId, r.earnedAt]));
}
