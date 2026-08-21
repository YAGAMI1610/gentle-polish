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
import { toast } from "sonner";
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
          // getNonce + createMessage are RainbowKit's "Preparing message…" phase; a
          // throw here surfaces only its generic "Error preparing message, please
          // retry!". So log the real status/body/error and raise a specific toast
          // before rethrowing, so the failure is actually diagnosable.
          let res: Response;
          try {
            res = await fetch("/api/auth/nonce", { credentials: "include" });
          } catch (err) {
            console.error("[auth] nonce request failed (network error):", err);
            toast.error("Couldn't reach the sign-in service", {
              description: "Check your connection and try again.",
            });
            throw err instanceof Error ? err : new Error("nonce network error");
          }
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.error(`[auth] nonce request failed: HTTP ${res.status}`, body);
            toast.error("Couldn't start sign-in", {
              description: `The sign-in service returned ${res.status}. Please try again.`,
            });
            throw new Error(`nonce request failed with status ${res.status}`);
          }
          return res.text();
        },
        createMessage: ({ nonce, address, chainId }) => {
          try {
            const message = new SiweMessage({
              domain: window.location.host,
              address,
              statement: "Sign in to CommitAI to manage your goals and commitments.",
              uri: window.location.origin,
              version: "1",
              chainId,
              nonce,
            }).prepareMessage();
            // Breadcrumb: the message is built and RainbowKit now asks the wallet to
            // sign it. If you see this line followed by a wallet "Error signing
            // message" and NO later "[auth] verify" line, the failure is the wallet's
            // own sign step (network/chain/rejection), not our server.
            console.info("[auth] SIWE message prepared — requesting wallet signature…");
            return message;
          } catch (err) {
            // prepareMessage() throws e.g. on a non-EIP-55 address or a malformed field.
            console.error("[auth] failed to build the SIWE message:", err, { chainId });
            toast.error("Couldn't prepare the sign-in message", {
              description: "Your wallet returned an unexpected address or network.",
            });
            throw err;
          }
        },
        verify: async ({ message, signature }) => {
          let res: Response;
          try {
            res = await fetch("/api/auth/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ message, signature }),
            });
          } catch (err) {
            console.error("[auth] verify request failed (network error):", err);
            toast.error("Couldn't verify your signature", {
              description: "Check your connection and try again.",
            });
            return false;
          }
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.error(`[auth] verify failed: HTTP ${res.status}`, body);
            // Surface the server's OWN message when it sent one (e.g. the honest
            // "sign-in is temporarily unavailable" 503), so the toast tells the user
            // what actually happened instead of only a bare status code.
            let serverMessage = "";
            try {
              serverMessage = (JSON.parse(body) as { error?: string }).error ?? "";
            } catch {
              // non-JSON body — fall back to the status-based description below
            }
            toast.error("Couldn't complete sign-in", {
              description:
                serverMessage || `The server returned ${res.status}. Please try connecting again.`,
            });
            return false;
          }
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
