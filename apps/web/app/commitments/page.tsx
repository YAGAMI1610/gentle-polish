import type { Metadata } from "next";

import CommitmentsPage from "./CommitmentsPage";

export const metadata: Metadata = {
  title: "On-chain commitments — CommitAI",
  description:
    "Lock funds behind a goal. Complete it and your stake comes back in full — no reward, no punishment, exactly what you put in.",
  openGraph: {
    title: "On-chain commitments — CommitAI",
    description: "Clear terms, visible failure path, no punishment.",
  },
};

export default function Page() {
  return <CommitmentsPage />;
}
