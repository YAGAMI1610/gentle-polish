"use client";

import { ArrowRight, CalendarClock, Coins, Sparkles } from "lucide-react";
import Link from "next/link";

import { AgentMark } from "@/components/commitai/AgentMark";
import { AppShell } from "@/components/commitai/AppShell";
import { CategoryIcon, goalCategory } from "@/components/commitai/CategoryIcon";
import { ProgressRing } from "@/components/commitai/ProgressRing";
import { StatusChip } from "@/components/commitai/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  explorerUrl,
  formatDate,
  formatTxHash,
  useCommitments,
  useGoals,
  useWalletProfile,
} from "@/hooks/useCommitAI";

const heroTexture = "/assets/hero-topo.jpg";

export default function Dashboard() {
  const { data: goals = [] } = useGoals();
  const { data: profile } = useWalletProfile();
  const { data: commitments = [] } = useCommitments();
  const activeCommitment = commitments.find((c) => c.status === "active" && Boolean(c.txHash));
  const upcoming = [...goals].sort((a, b) => a.nextCheckIn.localeCompare(b.nextCheckIn));
  const needsWord = goals.filter((g) => {
    const latest = [...g.milestones].reverse().find((m) => m.verification)?.verification;
    return latest?.status === "needs-evidence";
  }).length;

  return (
    <AppShell>
      <section className="relative -mx-4 overflow-hidden border-b border-border/70 px-4 pb-8 pt-6 sm:mx-0 sm:rounded-3xl sm:border sm:px-8 sm:pt-8">
        <img
          src={heroTexture}
          alt=""
          aria-hidden
          width={1536}
          height={768}
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-90"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/25 via-background/40 to-background"
          aria-hidden
        />
        <div className="relative">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Where things stand
          </p>
          <h1 className="mt-2 max-w-xl text-3xl leading-tight sm:text-4xl">
            {goals.length === 0
              ? "Let's set the first thing you'll follow through on."
              : `${goals.length} goal${goals.length === 1 ? "" : "s"} in motion${
                  needsWord > 0 ? `. ${needsWord} need${needsWord === 1 ? "s" : ""} a word.` : "."
                }`}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Nothing here is judgement — just where things actually stand.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {goals.map((goal) => {
              const latest = [...goal.milestones]
                .reverse()
                .find((m) => m.verification)?.verification;
              const status =
                latest?.status === "verified"
                  ? "On track"
                  : latest?.status === "needs-evidence"
                    ? "Needs a word"
                    : "Awaiting check-in";
              return (
                <Link
                  key={goal.id}
                  href={`/goals/${goal.id}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card/80 p-3 shadow-soft backdrop-blur-sm transition-colors hover:border-border hover:bg-card"
                >
                  <CategoryIcon category={goalCategory(goal)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{goal.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{status}</p>
                  </div>
                  <ProgressRing
                    value={goal.progress}
                    size={38}
                    stroke={3.5}
                    indicatorClassName={
                      latest?.status === "needs-evidence" ? "text-caution" : "text-verify"
                    }
                  >
                    <span className="text-[10px] font-medium">{goal.progress}</span>
                  </ProgressRing>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <Card className="mb-6 mt-10 border-primary/20 bg-primary text-primary-foreground">
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div className="flex items-start gap-3">
            <AgentMark tone="dark" className="mt-0.5" />
            <div>
              <p className="text-display text-lg">Talk it through with your agent</p>
              <p className="mt-1 text-sm opacity-80">
                {needsWord > 0
                  ? "Something came back needing more evidence. A couple of minutes should clear it up."
                  : "Whenever you want to think something through, your agent is here."}
              </p>
            </div>
          </div>
          <Button asChild variant="secondary" size="icon" className="shrink-0 rounded-full">
            <Link href="/check-in" aria-label="Start a check-in">
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
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <ProgressRing
                value={profile?.accountabilityScore ?? 0}
                size={76}
                stroke={6}
                indicatorClassName="text-verify"
              >
                <span className="text-display text-xl">{profile?.accountabilityScore ?? "—"}</span>
              </ProgressRing>
              <div className="min-w-0">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Built from kept check-ins, verification strength and honesty on missed weeks.
                </p>
                <Button asChild variant="link" className="mt-0.5 h-auto p-0 text-xs">
                  <Link href="/profile">See the breakdown</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="size-4" /> Next check-ins
            </CardTitle>
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
                <Link href="/commitments">View commitment</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Active goals</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/goals">All goals</Link>
          </Button>
        </div>
        <div className="space-y-3">
          {goals.map((goal) => {
            const latest = [...goal.milestones].reverse().find((m) => m.verification)?.verification;
            return (
              <Link
                key={goal.id}
                href={`/goals/${goal.id}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-soft transition-colors hover:bg-accent/40"
              >
                <CategoryIcon category={goalCategory(goal)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{goal.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Next check-in {formatDate(goal.nextCheckIn)} · {goal.checkInFrequency}
                  </p>
                  {latest && (
                    <StatusChip
                      status={latest.status}
                      confidence={latest.confidence}
                      className="mt-2"
                    />
                  )}
                </div>
                <ProgressRing
                  value={goal.progress}
                  size={52}
                  stroke={4}
                  indicatorClassName={
                    latest?.status === "needs-evidence" ? "text-caution" : "text-verify"
                  }
                >
                  <span className="text-xs font-medium">{goal.progress}%</span>
                </ProgressRing>
              </Link>
            );
          })}
        </div>
        <Button asChild variant="outline" className="mt-4 w-full gap-2">
          <Link href="/create">
            <Sparkles className="size-4" /> Set a new goal with the agent
          </Link>
        </Button>
      </section>
    </AppShell>
  );
}
