import type { Metadata } from "next";

import ActivityPage from "./ActivityPage";

export const metadata: Metadata = {
  title: "Activity — CommitAI",
  description: "A single timeline of agent decisions and on-chain events.",
  openGraph: {
    title: "Activity — CommitAI",
    description: "What the agent decided, and what the chain recorded.",
  },
};

export default function Page() {
  return <ActivityPage />;
}
