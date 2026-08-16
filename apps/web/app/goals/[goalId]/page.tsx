import type { Metadata } from "next";

import GoalDetail from "./GoalDetail";

export const metadata: Metadata = {
  title: "Goal detail — CommitAI",
  description: "Milestone timeline, verification history and commitment terms.",
  openGraph: {
    title: "Goal detail — CommitAI",
    description: "See how each milestone was verified and why.",
  },
};

export default async function Page({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  return <GoalDetail goalId={goalId} />;
}
