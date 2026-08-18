"use client";

/**
 * Data-access hooks for CommitAI (build step 9, phase 2).
 *
 * Every screen reads through these hooks. They fetch the authenticated wallet's
 * real data from the `/api/*` routes (`apiGet` sends the SIWE session cookie),
 * keyed on the connected address from `useSession` so a query only runs once a
 * wallet has actually signed in — and refetches when the wallet changes.
 *
 * There is no demo/placeholder data anywhere in this module any more: the view
 * types now live in `@/lib/types/view` (re-exported here so component imports are
 * unchanged) and the rows come from Prisma via the serializers.
 */
import { useQuery } from "@tanstack/react-query";

import { ApiError, apiGet } from "@/lib/api/client";
import { explorerTxUrl } from "@/lib/chain/botchain";
import { useSession } from "@/hooks/useSession";
import type {
  Achievement,
  ActivityEvent,
  Commitment,
  Goal,
  Reward,
  WalletProfile,
} from "@/lib/types/view";

export type {
  Achievement,
  ActivityEvent,
  Commitment,
  Goal,
  GoalMode,
  GoalStatus,
  Milestone,
  Reward,
  Verification,
  VerificationStatus,
  WalletProfile,
} from "@/lib/types/view";

/** Resolve a detail fetch, turning a 404 (missing OR cross-wallet) into `undefined`. */
async function getOrUndefined<T>(path: string): Promise<T | undefined> {
  try {
    return await apiGet<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

export function useGoals() {
  const { address } = useSession();
  return useQuery<Goal[]>({
    queryKey: ["goals", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<Goal[]>("/api/goals"),
  });
}

export function useGoal(id: string) {
  const { address } = useSession();
  return useQuery<Goal | undefined>({
    queryKey: ["goals", id, address],
    enabled: Boolean(address) && Boolean(id),
    queryFn: () => getOrUndefined<Goal>(`/api/goals/${id}`),
  });
}

export function useCommitments() {
  const { address } = useSession();
  return useQuery<Commitment[]>({
    queryKey: ["commitments", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<Commitment[]>("/api/commitments"),
  });
}

export function useCommitment(id?: string) {
  const { address } = useSession();
  return useQuery<Commitment | undefined>({
    queryKey: ["commitments", id, address],
    enabled: Boolean(address) && Boolean(id),
    queryFn: () => getOrUndefined<Commitment>(`/api/commitments/${id}`),
  });
}

export function useRewards() {
  const { address } = useSession();
  return useQuery<Reward[]>({
    queryKey: ["rewards", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<Reward[]>("/api/rewards"),
  });
}

export function useAchievements() {
  const { address } = useSession();
  return useQuery<Achievement[]>({
    queryKey: ["achievements", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<Achievement[]>("/api/achievements"),
  });
}

export function useActivity() {
  const { address } = useSession();
  return useQuery<ActivityEvent[]>({
    queryKey: ["activity", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<ActivityEvent[]>("/api/activity"),
  });
}

export function useWalletProfile() {
  const { address } = useSession();
  return useQuery<WalletProfile>({
    queryKey: ["wallet-profile", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<WalletProfile>("/api/profile"),
  });
}

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTxHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Real BOT Chain explorer link for a transaction hash (scan.bohr.life). */
export function explorerUrl(hash: string) {
  return explorerTxUrl(hash);
}

export function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
