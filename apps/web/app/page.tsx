import type { Metadata } from "next";

import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "CommitAI — Your accountability agent",
  description:
    "Track goals, check in with an honest AI coach, and back the ones that matter with on-chain commitments.",
  openGraph: {
    title: "CommitAI — Your accountability agent",
    description: "Turn personal goals into verifiable commitments you actually keep.",
  },
};

export default function Page() {
  return <Dashboard />;
}
