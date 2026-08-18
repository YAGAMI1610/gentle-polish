"use client";

/**
 * Client-side view of the SIWE session (build step 9). Reads /api/auth/session,
 * which reflects the encrypted iron-session cookie. This is the authenticated
 * address the data hooks (useCommitAI) key their queries on — so a screen only
 * fetches a wallet's data once that wallet has actually signed in.
 */
import { useQuery } from "@tanstack/react-query";

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

export interface SessionResponse {
  address: string | null;
}

export async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch("/api/auth/session", { credentials: "include" });
  if (!res.ok) return { address: null };
  return (await res.json()) as SessionResponse;
}

export interface UseSessionResult {
  address: string | null;
  isLoading: boolean;
  isConnected: boolean;
}

export function useSession(): UseSessionResult {
  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 30_000,
  });
  const address = data?.address ?? null;
  return { address, isLoading, isConnected: address !== null };
}
