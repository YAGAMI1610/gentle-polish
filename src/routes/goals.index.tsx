import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Target } from "lucide-react";

import { AppShell } from "@/components/commitai/AppShell";
import { DemoBadge } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { StatusChip } from "@/components/commitai/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDate, useGoals } from "@/hooks/useCommitAI";

export const Route = createFileRoute("/goals/")({
  head: () => ({
    meta: [
      { title: "Your goals — CommitAI" },
      { name: "description", content: "Every goal you're tracking, with progress and verification status." },
      { property: "og:title", content: "Your goals — CommitAI" },
      { property: "og:description", content: "Progress, next check-ins and verification status per goal." },
    ],
  }),
  component: GoalsPage,
});

function GoalsPage() {
  const { data: goals = [], isLoading } = useGoals();

  return (
    <AppShell>
      <PageHeader
        eyebrow="Goals"
        title="What you're working on"
        description="Progress is only what's been verified — not what's been promised."
        action={<DemoBadge />}
      />

      {!isLoading && goals.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center surface-grain">
          <Target className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg">Nothing tracked yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Start with the thing you keep meaning to do. The agent will ask a few questions and turn it
            into something checkable.
          </p>
          <Button asChild className="mt-5 gap-2">
            <Link to="/create">
              <Sparkles className="size-4" /> Set your first goal
            </Link>
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {goals.map((goal) => {
          const latest = [...goal.milestones].reverse().find((m) => m.verification)?.verification;
          return (
            <Link
              key={goal.id}
              to="/goals/$goalId"
              params={{ goalId: goal.id }}
              className="block rounded-2xl border border-border bg-card p-5 shadow-soft transition-colors hover:bg-accent/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    goal.mode === "self-commitment"
                      ? "border-chain/40 text-chain"
                      : "border-border text-muted-foreground"
                  }
                >
                  {goal.mode === "self-commitment" ? "Self-commitment" : "Accountability only"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Next check-in {formatDate(goal.nextCheckIn)}
                </span>
              </div>
              <h2 className="mt-3 text-lg">{goal.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{goal.summary}</p>
              <div className="mt-4 flex items-center gap-3">
                <Progress value={goal.progress} className="h-1.5" />
                <span className="shrink-0 text-sm font-medium">{goal.progress}%</span>
              </div>
              {latest && (
                <div className="mt-3">
                  <StatusChip status={latest.status} confidence={latest.confidence} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
