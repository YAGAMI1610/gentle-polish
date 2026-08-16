import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, Coins, Sparkles } from "lucide-react";

import { AppShell } from "@/components/commitai/AppShell";
import { DemoBadge } from "@/components/commitai/DemoBadge";
import { StatusChip } from "@/components/commitai/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  explorerUrl,
  formatDate,
  formatTxHash,
  useCommitments,
  useGoals,
  useWalletProfile,
} from "@/hooks/useCommitAI";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CommitAI — Your accountability agent" },
      {
        name: "description",
        content:
          "Track goals, check in with an honest AI coach, and back the ones that matter with on-chain commitments.",
      },
      { property: "og:title", content: "CommitAI — Your accountability agent" },
      {
        property: "og:description",
        content: "Turn personal goals into verifiable commitments you actually keep.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: goals = [] } = useGoals();
  const { data: profile } = useWalletProfile();
  const { data: commitments = [] } = useCommitments();
  const activeCommitment = commitments.find((c) => c.status === "active");
  const upcoming = [...goals].sort((a, b) => a.nextCheckIn.localeCompare(b.nextCheckIn));

  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Sunday, 16 August
        </p>
        <h1 className="mt-1 text-3xl leading-tight">Three goals in motion. One needs a word.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing here is judgement — just where things actually stand.
        </p>
      </div>

      <Card className="mb-5 border-primary/20 bg-primary text-primary-foreground">
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div>
            <p className="text-display text-lg">Talk it through with your agent</p>
            <p className="mt-1 text-sm opacity-80">
              Book 7 came back needing more evidence. Two minutes should clear it up.
            </p>
          </div>
          <Button asChild variant="secondary" size="icon" className="shrink-0 rounded-full">
            <Link to="/check-in" aria-label="Start a check-in">
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Accountability score
            </CardTitle>
            <DemoBadge />
          </CardHeader>
          <CardContent>
            <p className="text-display text-4xl">{profile?.accountabilityScore ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Built from kept check-ins, verification strength and honesty on missed weeks.
            </p>
            <Button asChild variant="link" className="mt-1 h-auto p-0 text-xs">
              <Link to="/profile">See the breakdown</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="size-4" /> Next check-ins
            </CardTitle>
            <DemoBadge />
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.slice(0, 3).map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{g.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(g.nextCheckIn)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {activeCommitment && (
        <Card className="mb-6 border-chain/40 bg-chain-soft">
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-chain">
              <Coins className="size-4" /> Funds locked on-chain
            </CardTitle>
            <DemoBadge />
          </CardHeader>
          <CardContent>
            <p className="text-display text-3xl text-chain">
              {activeCommitment.amountLocked} {activeCommitment.token}
            </p>
            <p className="mt-1 text-sm">{activeCommitment.goalTitle}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {activeCommitment.releaseCondition}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={explorerUrl(activeCommitment.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-chain underline underline-offset-4"
              >
                {formatTxHash(activeCommitment.txHash)} on the explorer
              </a>
              <Button asChild size="sm" variant="outline" className="border-chain/40 text-chain">
                <Link to="/commitments">View commitment</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Active goals</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/goals">All goals</Link>
          </Button>
        </div>
        <div className="space-y-3">
          {goals.map((goal) => {
            const latest = [...goal.milestones].reverse().find((m) => m.verification)?.verification;
            return (
              <Link
                key={goal.id}
                to="/goals/$goalId"
                params={{ goalId: goal.id }}
                className="block rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{goal.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Next check-in {formatDate(goal.nextCheckIn)} · {goal.checkInFrequency}
                    </p>
                  </div>
                  <span className="text-display text-lg">{goal.progress}%</span>
                </div>
                <Progress value={goal.progress} className="mt-3 h-1.5" />
                {latest && <StatusChip status={latest.status} confidence={latest.confidence} className="mt-3" />}
              </Link>
            );
          })}
        </div>
        <Button asChild variant="outline" className="mt-4 w-full gap-2">
          <Link to="/create">
            <Sparkles className="size-4" /> Set a new goal with the agent
          </Link>
        </Button>
      </section>
    </AppShell>
  );
}
