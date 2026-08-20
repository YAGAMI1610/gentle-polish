import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const DESCRIPTION =
  "An AI accountability agent that turns personal goals into verifiable commitments.";

export const metadata: Metadata = {
  title: "CommitAI",
  description: DESCRIPTION,
  openGraph: {
    title: "CommitAI",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: { url: "/favicon.ico", type: "image/x-icon" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fraunces (display) + Public Sans (body) are referenced by the
            --font-display / --font-sans tokens in globals.css. Kept as plain
            <link> tags rather than next/font so font loading behaviour stays
            identical to the pre-migration app. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
