"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Wallet connect + SIWE sign-in entry point (build step 9).
 *
 * This is now the REAL flow: RainbowKit's ConnectButton drives wallet connection
 * and, through the authentication adapter wired in app/providers.tsx, the SIWE
 * sign-in that establishes the iron-session cookie. It renders "Connect wallet"
 * when signed out, a "Sign in" prompt after connecting, and the account chip once
 * authenticated. Accountability-only goals still work without connecting.
 */
export function ConnectWalletDialog() {
  return <ConnectButton showBalance={false} accountStatus="address" chainStatus="icon" />;
}
