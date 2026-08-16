import type { Metadata } from "next";

import VerifyPage from "./VerifyPage";

export const metadata: Metadata = {
  title: "Submit evidence — CommitAI",
  description:
    "Share only the evidence you're comfortable with. It stays private; only a hash goes on-chain.",
  openGraph: {
    title: "Submit evidence — CommitAI",
    description: "Private evidence, verifiable result.",
  },
};

export default function Page() {
  return <VerifyPage />;
}
