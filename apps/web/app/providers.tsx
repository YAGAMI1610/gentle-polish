"use client";

import "@rainbow-me/rainbowkit/styles.css";

import {
  RainbowKitAuthenticationProvider,
  RainbowKitProvider,
  createAuthenticationAdapter,
  type AuthenticationStatus,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { SiweMessage } from "siwe";
import { useMemo, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/lib/wagmi/config";
import { SESSION_QUERY_KEY, fetchSession } from "@/hooks/useSession";

/**
 * App providers (build step 9). Nesting order matters:
 *   WagmiProvider (wallet connectors)
 *     → QueryClientProvider (wagmi + our data hooks share one cache)
 *       → RainbowKitAuthenticationProvider (drives SIWE via our /api/auth/* routes)
 *         → RainbowKitProvider (connect UI)
 *
 * Auth is iron-session (an httpOnly cookie), NOT next-auth: the adapter below
 * fetches a server nonce, has the wallet sign a SIWE message, and posts it to
 * /api/auth/verify. The server is the sole authority on "who is signed in".
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 30_000,
  });

  const status: AuthenticationStatus = isLoading
    ? "loading"
    : data?.address
      ? "authenticated"
      : "unauthenticated";

  const adapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => {
          const res = await fetch("/api/auth/nonce", { credentials: "include" });
          if (!res.ok) throw new Error("failed to obtain sign-in nonce");
          return res.text();
        },
        createMessage: ({ nonce, address, chainId }) =>
          new SiweMessage({
            domain: window.location.host,
            address,
            statement: "Sign in to CommitAI to manage your goals and commitments.",
            uri: window.location.origin,
            version: "1",
            chainId,
            nonce,
          }).prepareMessage(),
        verify: async ({ message, signature }) => {
          const res = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ message, signature }),
          });
          if (!res.ok) return false;
          await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
          return true;
        },
        signOut: async () => {
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
          await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
        },
      }),
    [queryClient],
  );

  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}
