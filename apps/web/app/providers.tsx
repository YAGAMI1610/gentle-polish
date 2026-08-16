"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * React Query provider for the app.
 *
 * The client is created inside useState so each browser session gets its own
 * cache and it is never shared across server requests — the equivalent of the
 * per-router-instance QueryClient the TanStack Start entry used to build.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
