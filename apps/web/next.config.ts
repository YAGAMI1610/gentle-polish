import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise generates apps/web/{AGENTS.md,CLAUDE.md} on every boot.
  // This repo's agent instructions live in the root CLAUDE.md / AGENTS.md /
  // CommitAI-Build-Prompt.md; a tool-generated file in the app directory would be
  // auto-loaded alongside them and dilute the non-negotiable rules there.
  agentRules: false,
};

export default nextConfig;
