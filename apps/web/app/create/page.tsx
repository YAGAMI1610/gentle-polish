import type { Metadata } from "next";

import CreateGoal from "./CreateGoal";

export const metadata: Metadata = {
  title: "Set a goal — CommitAI",
  description:
    "Talk a goal through with your accountability agent until it's specific and checkable.",
  openGraph: {
    title: "Set a goal — CommitAI",
    description: "A short conversation turns a vague intention into a plan.",
  },
};

export default function Page() {
  return <CreateGoal />;
}
