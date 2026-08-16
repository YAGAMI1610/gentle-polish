import type { Metadata } from "next";

import AchievementsPage from "./AchievementsPage";

export const metadata: Metadata = {
  title: "Achievements — CommitAI",
  description: "Milestones, streaks and badges earned through verified progress.",
  openGraph: {
    title: "Achievements — CommitAI",
    description: "Quiet markers of work you actually did.",
  },
};

export default function Page() {
  return <AchievementsPage />;
}
