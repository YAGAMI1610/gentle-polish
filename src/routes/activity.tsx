import { createFileRoute } from "@tanstack/react-router";
import { Link2, Sparkles } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { DemoBadge } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { explorerUrl, formatTxHash, useActivity } from "@/hooks/useCommitAI";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Activity — CommitAI" },
      { name: "description", content: "A single timeline of agent decisions and on-chain events." },
      { property: "og:title", content: "Activity — CommitAI" },
      { property: "og:description", content: "What the agent decided, and what the chain recorded." },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { data: events = [] } = useActivity();
  const [filter, setFilter] = useState<"all" | "ai" | "chain">("all");
  const shown = events.filter((e) => filter === "all" || e.type === filter);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Activity"
        title="Everything that happened"
        description="Agent decisions and on-chain events in one place, so nothing is hidden from you."
        action={<DemoBadge />}
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="mb-5">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">
            All
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex-1">
            Agent
          </TabsTrigger>
          <TabsTrigger value="chain" className="flex-1">
            On-chain
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <ul>
        {shown.map((e, i) => (
          <li key={e.id} className="relative flex gap-4 pb-6">
            {i < shown.length - 1 && (
              <span className="absolute left-[15px] top-9 h-full w-px bg-border" aria-hidden />
            )}
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                e.type === "ai" ? "bg-verify-soft text-verify" : "bg-chain-soft text-chain",
              )}
            >
              {e.type === "ai" ? <Sparkles className="size-4" /> : <Link2 className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={cn("text-sm font-medium", e.type === "chain" && "text-chain")}>{e.title}</p>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{e.detail}</p>
              {e.txHash && (
                <a
                  href={explorerUrl(e.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs text-chain underline underline-offset-4"
                >
                  {formatTxHash(e.txHash)}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
