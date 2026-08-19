import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureWallet,
  listAchievementDefinitions,
  listEarnedAchievements,
  prisma,
  recordEarnedAchievements,
  syncAchievementCatalog,
} from "@/lib/db";
import { probeDatabaseReady } from "@/lib/db/probe";
import { ACHIEVEMENT_CATALOG } from "@/lib/achievements/catalog";

/**
 * Achievement catalog + earned-at persistence (build item 7). These DB-gated tests
 * prove the promises the repo makes: the catalog TABLE mirrors the code catalog
 * (idempotent sync, no drift), and a crossing is recorded ONCE with a genuine
 * first-observation timestamp that never moves on re-record (CLAUDE.md rule 1 — the
 * earnedAt is a real first-seen time, never fabricated), all strictly wallet-scoped.
 */

const WALLET_A = "0xace0000100000000000000000000000000000000";
const WALLET_B = "0xace0000200000000000000000000000000000000";

const dbReady = await probeDatabaseReady();
if (!dbReady) {
  console.info(
    "[achievements.repo] tests SKIPPED — no migrated Postgres reachable at DATABASE_URL.",
  );
}

describe.skipIf(!dbReady)("achievement catalog sync", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("populates one AchievementDefinition row per catalog entry, in declared order", async () => {
    const n = await syncAchievementCatalog();
    expect(n).toBe(ACHIEVEMENT_CATALOG.length);

    const defs = await listAchievementDefinitions();
    // Every code-catalog id is present in the table.
    const ids = new Set(defs.map((d) => d.id));
    for (const def of ACHIEVEMENT_CATALOG) {
      expect(ids.has(def.id)).toBe(true);
    }
    // The rows come back in the catalog's declared display order (sortOrder = index).
    const catalogOrder = ACHIEVEMENT_CATALOG.map((d) => d.id);
    const persistedOrder = defs.filter((d) => catalogOrder.includes(d.id)).map((d) => d.id);
    expect(persistedOrder).toEqual(catalogOrder);
  });

  it("is idempotent: re-syncing keeps one row per id and refreshes metadata", async () => {
    await syncAchievementCatalog();
    const again = await syncAchievementCatalog();
    expect(again).toBe(ACHIEVEMENT_CATALOG.length);

    const defs = await listAchievementDefinitions();
    for (const def of ACHIEVEMENT_CATALOG) {
      // Exactly one persisted row per catalog id (no duplicates from re-sync).
      expect(defs.filter((d) => d.id === def.id)).toHaveLength(1);
      const row = defs.find((d) => d.id === def.id);
      expect(row?.name).toBe(def.name);
      expect(row?.description).toBe(def.description);
      expect(row?.metric).toBe(def.metric);
      expect(row?.threshold).toBe(def.threshold);
    }
  });
});

describe.skipIf(!dbReady)("earned-achievement persistence", () => {
  const first = ACHIEVEMENT_CATALOG[0]?.id ?? "";
  const second = ACHIEVEMENT_CATALOG[1]?.id ?? "";

  beforeAll(async () => {
    await prisma.earnedAchievement.deleteMany({
      where: { walletAddress: { in: [WALLET_A, WALLET_B] } },
    });
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_A, WALLET_B] } } });
    await ensureWallet(WALLET_A);
    await ensureWallet(WALLET_B);
  });
  afterAll(async () => {
    await prisma.earnedAchievement.deleteMany({
      where: { walletAddress: { in: [WALLET_A, WALLET_B] } },
    });
    await prisma.wallet.deleteMany({ where: { address: { in: [WALLET_A, WALLET_B] } } });
    await prisma.$disconnect();
  });

  it("records a first crossing and reads it back as an id→Date map", async () => {
    const recorded = await recordEarnedAchievements(WALLET_A, [first]);
    expect(recorded).toBe(1);
    const map = await listEarnedAchievements(WALLET_A);
    expect(map.has(first)).toBe(true);
    expect(map.get(first)).toBeInstanceOf(Date);
  });

  it("is first-writer-wins: re-recording never moves the earnedAt, and only new ids insert", async () => {
    const before = await listEarnedAchievements(WALLET_A);
    const firstAt = before.get(first);
    expect(firstAt).toBeInstanceOf(Date);

    // Re-record the already-known `first` alongside a genuinely new `second`:
    // only `second` is inserted, `first`'s stored crossing time is untouched.
    const recorded = await recordEarnedAchievements(WALLET_A, [first, second]);
    expect(recorded).toBe(1);

    const after = await listEarnedAchievements(WALLET_A);
    expect(after.get(first)?.getTime()).toBe(firstAt?.getTime());
    expect(after.has(second)).toBe(true);
  });

  it("records nothing new when every id is already known", async () => {
    const recorded = await recordEarnedAchievements(WALLET_A, [first, second]);
    expect(recorded).toBe(0);
  });

  it("treats an empty earned list as a no-op", async () => {
    const recorded = await recordEarnedAchievements(WALLET_A, []);
    expect(recorded).toBe(0);
  });

  it("is wallet-scoped: one wallet's crossings never appear for another", async () => {
    // B has recorded nothing yet.
    expect((await listEarnedAchievements(WALLET_B)).size).toBe(0);

    await recordEarnedAchievements(WALLET_B, [first]);
    const mapB = await listEarnedAchievements(WALLET_B);
    expect(mapB.has(first)).toBe(true);
    expect(mapB.has(second)).toBe(false); // A's `second` is not B's

    // A still has both; the two wallets are fully independent.
    const mapA = await listEarnedAchievements(WALLET_A);
    expect(mapA.has(first)).toBe(true);
    expect(mapA.has(second)).toBe(true);
  });
});
