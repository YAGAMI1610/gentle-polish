import type { NextConfig } from "next";

// @coinbase/cdp-sdk (pulled in transitively by RainbowKit's Base Account connector:
// rainbowkit → wagmi/connectors → @base-org/account → @coinbase/cdp-sdk) declares
// @x402/{core,evm,extensions,svm} as PEER dependencies. Those are Coinbase's x402
// payment-protocol packages; CommitAI never uses x402 payments — it uses standard
// EVM wallets on BOT Chain — so we neither install them nor reach the code paths
// that import them. Left unresolved they abort the bundle ("Module not found:
// Can't resolve '@x402/evm'"), so both bundlers alias them to an empty module.
// See lib/stubs/x402-peer-stub.ts and LIMITATIONS.md §4.
const X402_PEER_DEPS = ["@x402/core", "@x402/evm", "@x402/extensions", "@x402/svm"] as const;
const X402_STUB_PATH = "./lib/stubs/x402-peer-stub.ts";

// Minimal structural type for the webpack config we touch — avoids an `any` param
// (which the type-checked lint rules would flag) without pulling in webpack's types.
interface WebpackResolveConfig {
  resolve?: { alias?: Record<string, string | false | string[]> };
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise generates apps/web/{AGENTS.md,CLAUDE.md} on every boot.
  // This repo's agent instructions live in the root CLAUDE.md / AGENTS.md /
  // CommitAI-Build-Prompt.md; a tool-generated file in the app directory would be
  // auto-loaded alongside them and dilute the non-negotiable rules there.
  agentRules: false,

  // Security response headers on every route. These are the safe, high-value headers
  // that don't risk breaking the wallet/RPC flow. Chief among them, for a dApp whose
  // whole purpose is prompting wallet signatures: the anti-clickjacking pair, so a
  // hostile page can't frame CommitAI and trick a user into signing over an overlay.
  // Nothing legitimately embeds this app in a frame.
  //
  // A full script-src/connect-src Content-Security-Policy is deliberately NOT set here:
  // the wallet stack (RainbowKit/WalletConnect) reaches a wss relay plus several RPC/CDN
  // origins, and a wrong allowlist would silently break wallet connection — a worse bug
  // than the gap it closes. Deferred and specified in LIMITATIONS.md §24.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },

  // Turbopack builder (portability: this env falls back to --webpack, see below).
  turbopack: {
    resolveAlias: Object.fromEntries(X402_PEER_DEPS.map((mod) => [mod, X402_STUB_PATH] as const)),
  },

  // Webpack builder (the one this repo's scripts use — see package.json). `false`
  // resolves each module to webpack's empty module, so the unused named imports
  // (`toClientEvmSigner`, …) become `undefined` with no export-analysis warnings.
  webpack: (config: WebpackResolveConfig) => {
    const resolve = (config.resolve ??= {});
    resolve.alias = {
      ...resolve.alias,
      ...Object.fromEntries(X402_PEER_DEPS.map((mod) => [mod, false] as const)),
    };
    return config;
  },
};

export default nextConfig;
