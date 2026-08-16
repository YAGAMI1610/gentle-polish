"use client";

import { ArrowRight, ExternalLink, PenLine, Wallet } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { StepIndicator } from "@/components/commitai/StepIndicator";
import { DemoBadge, UiOnlyNote } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  explorerUrl,
  formatDate,
  formatTxHash,
  useCommitments,
  useGoals,
} from "@/hooks/useCommitAI";

const lockedFunds = "/assets/locked-funds.png";

const STATUS_STYLE = {
  active: "border-chain/40 text-chain",
  completed: "border-verify/40 text-verify",
  cancelled: "border-border text-muted-foreground",
} as const;

function CreateCommitmentFlow() {
  const { data: goals = [] } = useGoals();
  const [step, setStep] = useState(0);
  const [goalId, setGoalId] = useState<string>("");
  const [amount, setAmount] = useState("20");
  const [reward, setReward] = useState("3");
  const goal = goals.find((g) => g.id === goalId);
  const steps = ["Goal", "Amount", "Terms", "Sign", "Done"];

  return (
    <Card className="border-chain/30">
      <CardContent className="py-5">
        <StepIndicator steps={steps} current={step} className="mb-6" />

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <Label>Which goal are you backing?</Label>
              <Select value={goalId} onValueChange={setGoalId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Pick a goal" />
                </SelectTrigger>
                <SelectContent>
                  {goals.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!goalId} onClick={() => setStep(1)} className="gap-2">
              Continue <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="amount">Amount to lock (BOT)</Label>
                <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-2" />
              </div>
              <div>
                <Label htmlFor="reward">Reward on success (BOT)</Label>
                <Input id="reward" value={reward} onChange={(e) => setReward(e.target.value)} className="mt-2" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Lock what's meaningful to you, not what's painful. The point is attention, not risk.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)} className="gap-2">
                Review terms <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-sm">
            <h3 className="text-lg">The terms, in plain language</h3>
            <div className="space-y-3 rounded-xl border border-chain/30 bg-chain-soft p-4">
              <p>
                <span className="font-medium">Goal: </span>
                {goal?.title ?? "—"}
              </p>
              <p>
                <span className="font-medium">Locked: </span>
                {amount} BOT until {goal ? formatDate(goal.deadline) : "the deadline"}
              </p>
              <p>
                <span className="font-medium">If you succeed: </span>
                your {amount} BOT returns plus a {reward} BOT reward.
              </p>
              <p>
                <span className="font-medium">If you don't: </span>
                your {amount} BOT still returns in full. You forfeit the reward — nothing more. CommitAI
                never keeps your principal.
              </p>
              <p>
                <span className="font-medium">If you cancel early: </span>
                your principal is released the same day, no penalty. The goal stays as accountability-only.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)} className="gap-2 bg-chain text-chain-foreground hover:bg-chain/90">
                <Wallet className="size-4" /> Continue to signing
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-col items-center rounded-xl border border-dashed border-chain/40 p-8 text-center">
              <PenLine className="size-6 text-chain" />
              <p className="mt-3 text-sm font-medium">Waiting for your wallet signature…</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You'd confirm locking {amount} BOT on BOT Chain testnet here.
              </p>
            </div>
            <UiOnlyNote>
              Wallet signing is not live. Continuing simply shows what the confirmed state looks like — no
              transaction is created and no funds move.
            </UiOnlyNote>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button variant="outline" onClick={() => setStep(4)}>
                Preview the success state
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-chain/30 bg-chain-soft p-5">
              <p className="text-display text-3xl leading-none text-chain">
                {amount} <span className="text-base font-normal">BOT locked</span>
              </p>
              <p className="mt-1 text-sm">{goal?.title}</p>
              <p className="mt-3 text-xs text-muted-foreground">Transaction (placeholder pattern)</p>
              <a
                href={explorerUrl("0x0000000000000000000000000000000000000000")}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-chain underline underline-offset-4"
              >
                0xdemo…000000 on the explorer
              </a>
            </div>
            <UiOnlyNote>
              This is a mock confirmation. The hash pattern shows what a real receipt would look like; no
              transaction exists.
            </UiOnlyNote>
            <Button variant="ghost" onClick={() => setStep(0)}>
              Start over
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CommitmentsPage() {
  const { data: commitments = [] } = useCommitments();

  return (
    <AppShell>
      <PageHeader
        eyebrow="On-chain"
        title="Commitments"
        description="Money makes a goal harder to ignore. It should never make failure feel like punishment."
        action={<DemoBadge />}
      />

      <div className="space-y-4">
        {commitments.map((c) => (
          <Card key={c.id} className={c.status === "active" ? "border-chain/40" : undefined}>
            <CardContent className="py-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline" className={STATUS_STYLE[c.status]}>
                  {c.status === "active" ? "Active" : c.status === "completed" ? "Completed" : "Cancelled"}
                </Badge>
                <span className="text-xs text-muted-foreground">Opened {formatDate(c.createdAt)}</span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-chain-soft ring-1 ring-chain/25">
                  <img
                    src={lockedFunds}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    width={512}
                    height={512}
                    className="size-[62%] object-contain"
                  />
                </span>
                <div>
                  <p className="text-display text-3xl leading-none text-chain">
                    {c.amountLocked} <span className="text-base font-normal">{c.token}</span>
                  </p>
                  <p className="mt-1.5 text-sm">{c.goalTitle}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Reward on success: {c.reward} {c.token}
              </p>

              <div className="mt-4 space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
                <p>
                  <span className="font-medium">Released when: </span>
                  {c.releaseCondition}
                </p>
                <p>
                  <span className="font-medium">If it doesn't happen: </span>
                  {c.failurePath}
                </p>
              </div>

              <a
                href={explorerUrl(c.txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-chain/30 bg-chain-soft/60 px-3 py-2 text-xs font-medium text-chain transition-colors hover:bg-chain-soft"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="font-mono">{formatTxHash(c.txHash)}</span>
                <span className="font-normal text-muted-foreground">on the explorer (placeholder)</span>
              </a>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg">Back a goal with funds</h2>
        <CreateCommitmentFlow />
      </section>
    </AppShell>
  );
}
