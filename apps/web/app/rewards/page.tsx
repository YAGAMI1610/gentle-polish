import type { Metadata } from "next";

import RewardsPage from "./RewardsPage";

export const metadata: Metadata = {
  title: "Your stake — CommitAI",
  description: "Release your staked funds back to yourself after a goal is verified.",
  openGraph: {
    title: "Your stake — CommitAI",
    description: "Get back exactly what you put in, once the goal is verified.",
  },
};

export default function Page() {
  return <RewardsPage />;
}
