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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiGet, apiPost, apiPostForm, apiSend } from "@/lib/api/client";
import { explorerTxUrl } from "@/lib/chain/botchain";
import { useSession } from "@/hooks/useSession";
import type {
  AiTurnRequest,
  AiTurnResponse,
  CheckInResult,
  ConnectorsResponse,
  CreateCheckInRequest,
  CreateGoalRequest,
  EvidenceResult,
  ImportGithubRequest,
  PrepareCommitmentRequest,
  PrepareCommitmentResult,
  PrepareSignResult,
} from "@/lib/api/dto";
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

// ---------------------------------------------------------------------------
// Write hooks (build step 9, phase 3)
//
// Mutations over the real write routes. None of them can move funds: the AI turn
// only ever proposes prepare-only calldata, and the `prepare*` hooks return
// unsigned calldata for `useChainTx` to have the USER's wallet sign. Cache is
// invalidated on success so the read hooks above reflect the new state.
// ---------------------------------------------------------------------------

/** One turn of the real Gemini conversation (powers /create and /check-in). */
export function useAiTurn() {
  return useMutation<AiTurnResponse, Error, AiTurnRequest>({
    mutationFn: (body) => apiPost<AiTurnResponse>("/api/ai/turn", body),
  });
}

/** Create a goal, then refresh the goal list. */
export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation<Goal, Error, CreateGoalRequest>({
    mutationFn: (body) => apiPost<Goal>("/api/goals", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

/** Record a progress check-in against a goal. */
export function useCreateCheckIn() {
  const queryClient = useQueryClient();
  return useMutation<CheckInResult, Error, CreateCheckInRequest>({
    mutationFn: (body) => apiPost<CheckInResult>("/api/checkins", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

/** Multipart evidence upload — either a binary `file` or a text `contentText`. */
export interface UploadEvidenceInput {
  goalId: string;
  /** EvidenceType enum value: TEXT | PHOTO | SCREENSHOT | FILE | CONNECTED_TRACKER | GITHUB | TRANSACTION_DATA. */
  type: string;
  file?: File;
  contentText?: string;
  checkInId?: string;
  mimeType?: string;
  fileName?: string;
}

export function useUploadEvidence() {
  const queryClient = useQueryClient();
  return useMutation<EvidenceResult, Error, UploadEvidenceInput>({
    mutationFn: (input) => {
      const form = new FormData();
      form.set("goalId", input.goalId);
      form.set("type", input.type);
      if (input.file) form.set("file", input.file);
      if (input.contentText !== undefined) form.set("contentText", input.contentText);
      if (input.checkInId !== undefined) form.set("checkInId", input.checkInId);
      if (input.mimeType !== undefined) form.set("mimeType", input.mimeType);
      if (input.fileName !== undefined) form.set("fileName", input.fileName);
      return apiPostForm<EvidenceResult>("/api/evidence", form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

/** The wallet's evidence connectors + which providers are configured (item 8). */
export function useConnectors() {
  const { address } = useSession();
  return useQuery<ConnectorsResponse>({
    queryKey: ["connectors", address],
    enabled: Boolean(address),
    queryFn: () => apiGet<ConnectorsResponse>("/api/connectors"),
  });
}

/** Import recent GitHub activity as evidence against a goal (item 8). */
export function useImportGithub() {
  const queryClient = useQueryClient();
  return useMutation<EvidenceResult, Error, ImportGithubRequest>({
    mutationFn: (body) => apiPost<EvidenceResult>("/api/connectors/github/import", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

/** Disconnect GitHub for the signed-in wallet (deletes the stored token; item 8). */
export function useDisconnectGithub() {
  const queryClient = useQueryClient();
  return useMutation<{ disconnected: boolean }, Error, void>({
    mutationFn: () => apiSend<{ disconnected: boolean }>("/api/connectors/github", "DELETE"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connectors"] });
    },
  });
}
export function usePrepareCommitment() {
  const queryClient = useQueryClient();
  return useMutation<PrepareCommitmentResult, Error, PrepareCommitmentRequest>({
    mutationFn: (body) => apiPost<PrepareCommitmentResult>("/api/commitments", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["commitments"] });
    },
  });
}

/** Get `lockFunds` calldata for a commitment (prepare-only; user signs via useChainTx). */
export function usePrepareLock() {
  return useMutation<PrepareSignResult, Error, string>({
    mutationFn: (commitmentId) =>
      apiPost<PrepareSignResult>(`/api/commitments/${commitmentId}/prepare-lock`),
  });
}

/** Get `claimReward` calldata for a commitment (prepare-only; user signs via useChainTx). */
export function usePrepareClaim() {
  return useMutation<PrepareSignResult, Error, string>({
    mutationFn: (commitmentId) =>
      apiPost<PrepareSignResult>(`/api/commitments/${commitmentId}/prepare-claim`),
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
