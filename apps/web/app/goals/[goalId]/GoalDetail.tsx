"use client";

import { ChevronLeft, ExternalLink, Eye } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { CategoryIcon, goalCategory } from "@/components/commitai/CategoryIcon";
import { ConfidenceMeter } from "@/components/commitai/ConfidenceMeter";
import { StatusChip, statusAccent } from "@/components/commitai/StatusChip";
import { Timeline, TimelineItem } from "@/components/commitai/Timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import {
  explorerUrl,
  formatDate,
  formatTxHash,
  useCommitment,
  useGoal,
  type Milestone,
} from "@/hooks/useCommitAI";

const lockedFunds = "/assets/locked-funds.png";

function MilestoneRow({ milestone, last }: { milestone: Milestone; last: boolean }) {
  const [open, setOpen] = useState(false);
  const v = milestone.verification;
  const accent = statusAccent(v?.status ?? "pending");

  return (
    <TimelineItem
      last={last}
      node={
        <span
          aria-hidden
          className={cn(
            "mt-1 size-4 rounded-full border-2 ring-4 ring-background",
            v ? accent.dot : "border-border bg-background",
            v?.status === "verified" && "bg-verify",
          )}
        />
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{milestone.title}</p>
          <span className="text-xs text-muted-foreground">Due {formatDate(milestone.dueDate)}</span>
        </div>
        {v ? (
          <div className="mt-2 rounded-xl border border-border bg-card p-3">
            <StatusChip status={v.status} />
            <ConfidenceMeter value={v.confidence} status={v.status} className="mt-3" />
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{v.reasoning}</p>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-4"
            >
              <Eye className="size-3.5" />{" "}
              {open ? "Hide evidence details" : "Show evidence details"}
            </button>
            {open && (
              <div className="mt-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <p>
                  Submitted {formatDate(v.submittedAt)} · {v.evidenceSummary}
                </p>
                <p className="mt-1">
                  Evidence stays private. Only this hash was anchored on-chain:{" "}
                  <span className="text-chain">{v.evidenceHash}</span>
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not checked in yet.</p>
        )}
      </div>
    </TimelineItem>
  );
}

export default function GoalDetail({ goalId }: { goalId: string }) {
  const { isConnected, isLoading: sessionLoading } = useSession();
  const { data: goal, isLoading } = useGoal(goalId);
  const { data: commitment } = useCommitment(goal?.commitmentId);

  if (!isConnected && !sessionLoading) {
    return (
      <AppShell>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 gap-1">
          <Link href="/goals">
            <ChevronLeft className="size-4" /> All goals
          </Link>
        </Button>
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">Connect your wallet to view this goal.</p>
        </div>
      </AppShell>
    );
  }

  if (sessionLoading || isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading goal…</p>
      </AppShell>
    );
  }

  if (!goal) {
    return (
      <AppShell>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 gap-1">
          <Link href="/goals">
            <ChevronLeft className="size-4" /> All goals
          </Link>
        </Button>
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <h2 className="text-lg">Goal not found</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            This goal doesn't exist, or it isn't associated with your connected wallet.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 gap-1">
        <Link href="/goals">
          <ChevronLeft className="size-4" /> All goals
        </Link>
      </Button>

      <div className="flex items-start gap-4">
        <CategoryIcon category={goalCategory(goal)} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                goal.mode === "self-commitment"
                  ? "border-chain/40 bg-chain-soft text-chain"
                  : "border-border text-muted-foreground"
              }
            >
              {goal.mode === "self-commitment" ? "Self-commitment" : "Accountability only"}
            </Badge>
          </div>
          <h1 className="mt-2 text-2xl leading-tight sm:text-3xl">{goal.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{goal.summary}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Progress value={goal.progress} className="h-2" />
        <span className="shrink-0 text-sm font-medium">{goal.progress}% verified</span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Check-in schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{goal.checkInFrequency}</p>
            <p className="mt-1 text-muted-foreground">Next: {formatDate(goal.nextCheckIn)}</p>
            <p className="mt-1 text-muted-foreground">Deadline: {formatDate(goal.deadline)}</p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/check-in">Check in now</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              How this gets verified
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {goal.verificationStrategy.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-verify" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {commitment && (
        <Card className="mt-6 border-chain/40 bg-chain-soft ring-1 ring-chain/10">
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2.5 text-sm font-medium text-chain">
              <span className="flex size-9 items-center justify-center rounded-xl bg-background/70 ring-1 ring-chain/25">
                <img
                  src={lockedFunds}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  width={512}
                  height={512}
                  className="size-[64%] object-contain"
                />
              </span>
              On-chain commitment terms
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-chain/70">
                  Locked
                </p>
                <p className="text-display text-3xl leading-none text-chain">
                  {commitment.amountLocked}{" "}
                  <span className="text-base font-normal">{commitment.token}</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-chain/70">
                  Reward on success
                </p>
                <p className="text-display text-2xl leading-none text-chain">
                  {commitment.reward}{" "}
                  <span className="text-sm font-normal">{commitment.token}</span>
                </p>
              </div>
            </div>
            <p className="mt-4">
              <span className="font-medium">Released when: </span>
              {commitment.releaseCondition}
            </p>
            <p className="mt-2 text-muted-foreground">
              <span className="font-medium text-foreground">If it doesn't happen: </span>
              {commitment.failurePath}
            </p>
            {commitment.txHash ? (
              <a
                href={explorerUrl(commitment.txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-chain/30 bg-background/70 px-3 py-2 text-xs font-medium text-chain transition-colors hover:bg-background"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="font-mono">{formatTxHash(commitment.txHash)}</span>
                <span className="font-normal text-muted-foreground">on the explorer</span>
              </a>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                Not yet locked on-chain — the transaction link appears once the funds are signed and
                locked.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <section className="mt-8">
        <h2 className="mb-4 text-lg">Milestone timeline</h2>
        <Timeline>
          {goal.milestones.map((m, i) => (
            <MilestoneRow key={m.id} milestone={m} last={i === goal.milestones.length - 1} />
          ))}
        </Timeline>
      </section>
    </AppShell>
  );
}
