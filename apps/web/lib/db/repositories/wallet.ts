import type { Wallet } from "@prisma/client";
import { prisma } from "../client";
import { evmAddressSchema } from "../schemas";

/**
 * Idempotently ensure a Wallet row exists for `address` and return it.
 *
 * Wallet is the scoping root of the whole data model — every other row hangs
 * off a wallet via a cascading FK. Call this once when a wallet authenticates
 * (build step 8, SIWE) before creating any goals for it.
 */
export async function ensureWallet(address: string): Promise<Wallet> {
  const addr = evmAddressSchema.parse(address);
  return prisma.wallet.upsert({
    where: { address: addr },
    update: {},
    create: { address: addr },
  });
}

/** Fetch a wallet by address, or null if it has never been seen. */
export async function getWallet(address: string): Promise<Wallet | null> {
  const addr = evmAddressSchema.parse(address);
  return prisma.wallet.findUnique({ where: { address: addr } });
}
