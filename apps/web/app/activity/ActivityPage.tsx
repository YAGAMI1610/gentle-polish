"use client";

import { ExternalLink, Link2 } from "lucide-react";
import { useState } from "react";

import { AgentMark } from "@/components/commitai/AgentMark";
import { AppShell } from "@/components/commitai/AppShell";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Timeline, TimelineItem } from "@/components/commitai/Timeline";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { explorerUrl, formatTxHash, useActivity } from "@/hooks/useCommitAI";

export default function ActivityPage() {
  const { data: events = [] } = useActivity();
  const [filter, setFilter] = useState<"all" | "ai" | "chain">("all");
  const shown = events.filter((e) => filter === "all" || e.type === filter);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Activity"
        title="Everything that happened"
        description="Agent decisions and on-chain events in one place, so nothing is hidden from you."
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

      <Timeline>
        {shown.map((e, i) => (
          <TimelineItem
            key={e.id}
            last={i === shown.length - 1}
            node={
              e.type === "ai" ? (
                <AgentMark className="size-8 ring-4 ring-background" />
              ) : (
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 rotate-45 items-center justify-center rounded-md bg-chain-soft text-chain ring-1 ring-chain/30"
                >
                  <Link2 className="size-4 -rotate-45" />
                </span>
              )
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={cn("text-sm font-medium", e.type === "chain" && "text-chain")}>
                {e.title}
              </p>
              <span className="text-xs text-muted-foreground">
                {new Date(e.at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {e.type === "ai" ? "Agent decision" : "On-chain event"}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{e.detail}</p>
            {e.txHash && (
              <a
                href={explorerUrl(e.txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-chain/30 bg-chain-soft/60 px-2.5 py-1 font-mono text-xs text-chain transition-colors hover:bg-chain-soft"
              >
                <ExternalLink className="size-3" aria-hidden />
                {formatTxHash(e.txHash)}
              </a>
            )}
          </TimelineItem>
        ))}
      </Timeline>
    </AppShell>
  );
}
