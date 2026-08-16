import type { Metadata } from "next";

import CheckIn from "./CheckIn";

export const metadata: Metadata = {
  title: "Check in — CommitAI",
  description:
    "Walk through this week's progress with your agent and get an honest verification result.",
  openGraph: {
    title: "Check in — CommitAI",
    description: "Let's make sure this week's progress counts.",
  },
};

export default function Page() {
  return <CheckIn />;
}
