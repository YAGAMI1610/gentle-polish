import type { Metadata } from "next";

import CommitmentsPage from "./CommitmentsPage";

export const metadata: Metadata = {
  title: "On-chain commitments — CommitAI",
  description:
    "Lock funds behind a goal. Your principal always comes back — the reward is what's at stake.",
  openGraph: {
    title: "On-chain commitments — CommitAI",
    description: "Clear terms, visible failure path, no punishment.",
  },
};

export default function Page() {
  return <CommitmentsPage />;
}
