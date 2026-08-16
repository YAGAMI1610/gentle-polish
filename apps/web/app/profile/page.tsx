import type { Metadata } from "next";

import ProfilePage from "./ProfilePage";

export const metadata: Metadata = {
  title: "Your profile — CommitAI",
  description: "Wallet, accountability score breakdown and commitment history.",
  openGraph: {
    title: "Your profile — CommitAI",
    description: "What your accountability score is actually made of.",
  },
};

export default function Page() {
  return <ProfilePage />;
}
