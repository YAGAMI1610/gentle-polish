import type { Metadata } from "next";

import GoalsPage from "./GoalsPage";

export const metadata: Metadata = {
  title: "Your goals — CommitAI",
  description: "Every goal you're tracking, with progress and verification status.",
  openGraph: {
    title: "Your goals — CommitAI",
    description: "Progress, next check-ins and verification status per goal.",
  },
};

export default function Page() {
  return <GoalsPage />;
}
