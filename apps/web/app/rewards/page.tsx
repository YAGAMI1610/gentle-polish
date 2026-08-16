import type { Metadata } from "next";

import RewardsPage from "./RewardsPage";

export const metadata: Metadata = {
  title: "Rewards — CommitAI",
  description: "Rewards earned from verified milestones and completed commitments.",
  openGraph: {
    title: "Rewards — CommitAI",
    description: "What you've earned, and what it came from.",
  },
};

export default function Page() {
  return <RewardsPage />;
}
