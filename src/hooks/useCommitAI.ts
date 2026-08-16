/**
 * Data access layer for CommitAI.
 *
 * Every screen reads through these hooks. Today they resolve placeholder data
 * from src/lib/demo-data.ts; when the backend exists, replace the queryFn
 * bodies with `fetch('/api/...')` calls and nothing else has to change.
 */
import { useQuery } from "@tanstack/react-query";

import {
  demoAchievements,
  demoActivity,
  demoCommitments,
  demoGoals,
  demoProfile,
  demoRewards,
  type Achievement,
  type ActivityEvent,
  type Commitment,
  type Goal,
  type Reward,
  type WalletProfile,
} from "@/lib/demo-data";

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
} from "@/lib/demo-data";

/** Flag surfaced in the UI wherever placeholder data is rendered. */
export const IS_DEMO_DATA = true;

const settle = <T,>(value: T) => Promise.resolve(value);

export function useGoals() {
  return useQuery<Goal[]>({
    queryKey: ["goals"],
    queryFn: () => settle(demoGoals), // TODO: fetch('/api/goals')
  });
}

export function useGoal(id: string) {
  return useQuery<Goal | undefined>({
    queryKey: ["goals", id],
    queryFn: () => settle(demoGoals.find((g) => g.id === id)), // TODO: fetch(`/api/goals/${id}`)
  });
}

export function useCommitments() {
  return useQuery<Commitment[]>({
    queryKey: ["commitments"],
    queryFn: () => settle(demoCommitments), // TODO: fetch('/api/commitments')
  });
}

export function useCommitment(id?: string) {
  return useQuery<Commitment | undefined>({
    queryKey: ["commitments", id],
    enabled: Boolean(id),
    queryFn: () => settle(demoCommitments.find((c) => c.id === id)),
  });
}

export function useRewards() {
  return useQuery<Reward[]>({
    queryKey: ["rewards"],
    queryFn: () => settle(demoRewards), // TODO: fetch('/api/rewards')
  });
}

export function useAchievements() {
  return useQuery<Achievement[]>({
    queryKey: ["achievements"],
    queryFn: () => settle(demoAchievements), // TODO: fetch('/api/achievements')
  });
}

export function useActivity() {
  return useQuery<ActivityEvent[]>({
    queryKey: ["activity"],
    queryFn: () => settle(demoActivity), // TODO: fetch('/api/activity')
  });
}

export function useWalletProfile() {
  return useQuery<WalletProfile>({
    queryKey: ["wallet-profile"],
    queryFn: () => settle(demoProfile), // TODO: fetch('/api/profile')
  });
}

export function formatAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTxHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Placeholder explorer link — swap for the real BOT Chain explorer later. */
export function explorerUrl(hash: string) {
  return `https://explorer.example-botchain.test/tx/${hash}`;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
