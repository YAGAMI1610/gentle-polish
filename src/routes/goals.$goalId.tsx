import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Coins, Eye } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { DemoBadge } from "@/components/commitai/DemoBadge";
import { StatusChip } from "@/components/commitai/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  explorerUrl,
  formatDate,
  formatTxHash,
  useCommitment,
  useGoal,
  type Milestone,
} from "@/hooks/useCommitAI";

export const Route = createFileRoute("/goals/$goalId")({
  head: () => ({
    meta: [
      { title: "Goal detail — CommitAI" },
      { name: "description", content: "Milestone timeline, verification history and commitment terms." },
      { property: "og:title", content: "Goal detail — CommitAI" },
      { property: "og:description", content: "See how each milestone was verified and why." },
    ],
  }),
  component: GoalDetail,
});

function MilestoneRow({ milestone, last }: { milestone: Milestone; last: boolean }) {
  const [open, setOpen] = useState(false);
  const v = milestone.verification;

  return (
    <li className="relative flex gap-4 pb-6">
      {!last && <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />}
      <span
        className={cn(
          "mt-1 size-3.5 shrink-0 rounded-full border-2",
          milestone.done ? "border-verify bg-verify" : "border-border bg-background",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{milestone.title}</p>
          <span className="text-xs text-muted-foreground">Due {formatDate(milestone.dueDate)}</span>
        </div>
        {v ? (
          <div className="mt-2 rounded-xl border border-border bg-card p-3">
            <StatusChip status={v.status} confidence={v.confidence} />
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{v.reasoning}</p>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-4"
            >
              <Eye className="size-3.5" /> {open ? "Hide evidence details" : "Show evidence details"}
            </button>
            {open && (
              <div className="mt-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <p>Submitted {formatDate(v.submittedAt)} · {v.evidenceSummary}</p>
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
    </li>
  );
}

function GoalDetail() {
  const { goalId } = Route.useParams();
  const { data: goal } = useGoal(goalId);
  const { data: commitment } = useCommitment(goal?.commitmentId);

  if (!goal) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading goal…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 gap-1">
        <Link to="/goals">
          <ChevronLeft className="size-4" /> All goals
        </Link>
      </Button>

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
        <DemoBadge />
      </div>
      <h1 className="mt-3 text-2xl leading-tight sm:text-3xl">{goal.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{goal.summary}</p>

      <div className="mt-4 flex items-center gap-3">
        <Progress value={goal.progress} className="h-2" />
        <span className="shrink-0 text-sm font-medium">{goal.progress}% verified</span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Check-in schedule</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{goal.checkInFrequency}</p>
            <p className="mt-1 text-muted-foreground">Next: {formatDate(goal.nextCheckIn)}</p>
            <p className="mt-1 text-muted-foreground">Deadline: {formatDate(goal.deadline)}</p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/check-in">Check in now</Link>
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
        <Card className="mt-4 border-chain/40 bg-chain-soft">
          <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-chain">
              <Coins className="size-4" /> On-chain commitment terms
            </CardTitle>
            <DemoBadge />
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-display text-2xl text-chain">
              {commitment.amountLocked} {commitment.token} locked
            </p>
            <p className="mt-1 text-muted-foreground">
              Reward on success: {commitment.reward} {commitment.token}
            </p>
            <p className="mt-3">
              <span className="font-medium">Released when: </span>
              {commitment.releaseCondition}
            </p>
            <p className="mt-2">
              <span className="font-medium">If it doesn't happen: </span>
              {commitment.failurePath}
            </p>
            <a
              href={explorerUrl(commitment.txHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs font-medium text-chain underline underline-offset-4"
            >
              {formatTxHash(commitment.txHash)} on the explorer (placeholder link)
            </a>
          </CardContent>
        </Card>
      )}

      <section className="mt-8">
        <h2 className="mb-4 text-lg">Milestone timeline</h2>
        <ul>
          {goal.milestones.map((m, i) => (
            <MilestoneRow key={m.id} milestone={m} last={i === goal.milestones.length - 1} />
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
