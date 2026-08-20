"use client";

import { ArrowRight, ExternalLink, Loader2, Lock, PenLine, Wallet } from "lucide-react";
import { useState } from "react";
import { parseEther } from "viem";

import { AppShell } from "@/components/commitai/AppShell";
import { StepIndicator } from "@/components/commitai/StepIndicator";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client";
import type { PrepareCommitmentResult } from "@/lib/api/dto";
import { useChainTx } from "@/hooks/useChainTx";
import type { Commitment } from "@/hooks/useCommitAI";
import {
  explorerUrl,
  formatDate,
  formatTxHash,
  usePrepareCommitment,
  usePrepareLock,
  useCommitments,
  useGoals,
} from "@/hooks/useCommitAI";
import { useSession } from "@/hooks/useSession";

const lockedFunds = "/assets/locked-funds.png";

const STATUS_STYLE = {
  active: "border-chain/40 text-chain",
  completed: "border-verify/40 text-verify",
  cancelled: "border-border text-muted-foreground",
} as const;

/** Parse a human BOT amount to a base-10 wei string, or null if it isn't valid. */
function toWei(amount: string): string | null {
  const trimmed = amount.trim();
  if (!trimmed) return null;
  try {
    const wei = parseEther(trimmed);
    return wei > 0n ? wei.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Back a goal with funds (build step 9, phase 3; CLAUDE.md rules 1–3). The flow is
 * PREPARE → the USER's own wallet SIGNS → the REAL broadcast hash is recorded. No
 * step fabricates a transaction: if the chain isn't configured or the goal isn't
 * registered on-chain yet, we surface the server's honest reason instead of a mock
 * confirmation, and no `0x…0000` placeholder hash exists anywhere.
 */
function CreateCommitmentFlow() {
  const { isConnected } = useSession();
  const { data: goals = [] } = useGoals();
  const prepareCommitment = usePrepareCommitment();
  const chainTx = useChainTx();

  const [step, setStep] = useState(0);
  const [goalId, setGoalId] = useState("");
  const [amount, setAmount] = useState("20");
  const [reward, setReward] = useState("3");
  const [releaseCondition, setReleaseCondition] = useState(
    "Every milestone is verified by the deadline.",
  );
  const [failurePath, setFailurePath] = useState(
    "Your principal is returned in full; only the reward is forfeited.",
  );
  const [prepared, setPrepared] = useState<PrepareCommitmentResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const steps = ["Goal", "Terms", "Review", "Sign", "Done"];
  const goal = goals.find((g) => g.id === goalId);
  const termsValid = toWei(amount) !== null && releaseCondition.trim() && failurePath.trim();

  function reset() {
    setStep(0);
    setPrepared(null);
    setNotice(null);
    prepareCommitment.reset();
    chainTx.reset();
  }

  async function prepare() {
    setNotice(null);
    const principalWei = toWei(amount);
    if (!principalWei) {
      setNotice("Enter a valid amount to lock (greater than zero).");
      return;
    }
    try {
      const result = await prepareCommitment.mutateAsync({
        goalId,
        principalWei,
        rewardWei: toWei(reward) ?? "0",
        releaseCondition: releaseCondition.trim(),
        failurePath: failurePath.trim(),
      });
      if (!result.configured) {
        setNotice(
          "On-chain commitments aren't available on this server yet — the CommitmentVault isn't configured. Your terms were saved as a draft.",
        );
        return;
      }
      if (!result.prepared || !result.transaction) {
        setNotice(result.reason ?? "This commitment can't be prepared yet.");
        return;
      }
      setPrepared(result);
      setStep(3);
    } catch {
      // prepareCommitment.error is surfaced in the Review step.
    }
  }

  async function sign() {
    if (!prepared?.transaction) return;
    try {
      await chainTx.mutateAsync({
        transaction: prepared.transaction,
        record: {
          kind: "CREATE_COMMITMENT",
          title: `Create commitment${goal ? ` for "${goal.title}"` : ""}`,
          goalId,
          ...(prepared.draftCommitmentId ? { commitmentId: prepared.draftCommitmentId } : {}),
          detail: `${amount} BOT principal, ${toWei(reward) ? reward : "0"} BOT reward`,
        },
      });
      setStep(4);
    } catch {
      // chainTx.error is surfaced in the Sign step (e.g. user rejected in wallet).
    }
  }

  return (
    <Card className="border-chain/30">
      <CardContent className="py-5">
        <StepIndicator steps={steps} current={step} className="mb-6" />

        {!isConnected && (
          <p className="mb-4 rounded-lg border border-caution/40 bg-caution-soft px-3 py-2 text-xs">
            Connect your wallet to back a goal — you sign the on-chain commitment yourself.
          </p>
        )}

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <Label>Which goal are you backing?</Label>
              <Select value={goalId} onValueChange={setGoalId}>
                <SelectTrigger className="mt-2" disabled={!isConnected || goals.length === 0}>
                  <SelectValue placeholder={goals.length === 0 ? "No goals yet" : "Pick a goal"} />
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
                <Input
                  id="amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="reward">Reward on success (BOT)</Label>
                <Input
                  id="reward"
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  inputMode="decimal"
                  className="mt-2"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="release">Released when…</Label>
              <Textarea
                id="release"
                value={releaseCondition}
                onChange={(e) => setReleaseCondition(e.target.value)}
                rows={2}
                maxLength={2000}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="failure">If it doesn&apos;t happen…</Label>
              <Textarea
                id="failure"
                value={failurePath}
                onChange={(e) => setFailurePath(e.target.value)}
                rows={2}
                maxLength={2000}
                className="mt-2"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Lock what&apos;s meaningful to you, not what&apos;s painful. The point is attention,
              not risk.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)} disabled={!termsValid} className="gap-2">
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
                {amount} BOT{goal ? ` until ${formatDate(goal.deadline)}` : ""}
              </p>
              <p>
                <span className="font-medium">Reward on success: </span>
                {toWei(reward) ? reward : "0"} BOT
              </p>
              <p>
                <span className="font-medium">Released when: </span>
                {releaseCondition.trim()}
              </p>
              <p>
                <span className="font-medium">If it doesn&apos;t happen: </span>
                {failurePath.trim()}
              </p>
            </div>
            {notice && (
              <p className="rounded-lg border border-caution/40 bg-caution-soft px-3 py-2 text-xs leading-relaxed">
                {notice}
              </p>
            )}
            {prepareCommitment.isError && (
              <p className="text-xs text-destructive">
                {prepareCommitment.error instanceof ApiError &&
                prepareCommitment.error.status === 401
                  ? "Connect your wallet to prepare a commitment."
                  : `Couldn't prepare the commitment: ${prepareCommitment.error?.message ?? "unknown error"}`}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={prepare}
                disabled={!isConnected || prepareCommitment.isPending}
                className="gap-2 bg-chain text-chain-foreground hover:bg-chain/90"
              >
                {prepareCommitment.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Preparing…
                  </>
                ) : (
                  <>
                    <Wallet className="size-4" /> Prepare &amp; continue
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-col items-center rounded-xl border border-dashed border-chain/40 p-8 text-center">
              <PenLine className="size-6 text-chain" />
              <p className="mt-3 text-sm font-medium">
                Sign in your wallet to create this on-chain
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your wallet signs and broadcasts the transaction — CommitAI never signs for you.
              </p>
            </div>
            {chainTx.isError && (
              <p className="text-xs text-destructive">
                Couldn&apos;t complete the transaction: {chainTx.error?.message ?? "unknown error"}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)} disabled={chainTx.isPending}>
                Back
              </Button>
              <Button
                onClick={sign}
                disabled={chainTx.isPending}
                className="gap-2 bg-chain text-chain-foreground hover:bg-chain/90"
              >
                {chainTx.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Confirm in your wallet…
                  </>
                ) : (
                  <>
                    <Wallet className="size-4" /> Sign in wallet
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-chain/30 bg-chain-soft p-5">
              <p className="text-display text-3xl leading-none text-chain">
                {amount} <span className="text-base font-normal">BOT committed</span>
              </p>
              <p className="mt-1 text-sm">{goal?.title}</p>
              <p className="mt-3 text-xs text-muted-foreground">Transaction</p>
              {chainTx.data ? (
                <a
                  href={chainTx.data.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-medium text-chain underline underline-offset-4"
                >
                  <span className="font-mono">{formatTxHash(chainTx.data.txHash)}</span> on the
                  explorer
                </a>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Created on-chain. Lock your principal from the commitment card below when you&apos;re
              ready.
            </p>
            <Button variant="ghost" onClick={reset}>
              Back another goal
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A single commitment card, with a real Lock action (build step 9, phase 3). "Lock
 * funds" prepares `lockFunds` calldata and the USER's wallet signs the payable
 * deposit — the backend never holds a key that could move the principal. Honest
 * reasons surface when the chain isn't configured or the commitment isn't on-chain
 * yet; on success the REAL broadcast hash is recorded and linked.
 */
function CommitmentCard({ commitment }: { commitment: Commitment }) {
  const { isConnected } = useSession();
  const prepareLock = usePrepareLock();
  const chainTx = useChainTx();
  const [notice, setNotice] = useState<string | null>(null);

  const busy = prepareLock.isPending || chainTx.isPending;

  async function lock() {
    setNotice(null);
    try {
      const result = await prepareLock.mutateAsync(commitment.id);
      if (!result.configured) {
        setNotice(
          "On-chain locking isn't available on this server yet (CommitmentVault not configured).",
        );
        return;
      }
      if (!result.prepared || !result.transaction) {
        setNotice(result.reason ?? "This commitment can't be locked yet.");
        return;
      }
      await chainTx.mutateAsync({
        transaction: result.transaction,
        record: {
          kind: "LOCK_FUNDS",
          title: `Lock funds for "${commitment.goalTitle}"`,
          goalId: commitment.goalId,
          commitmentId: commitment.id,
          detail: `${commitment.amountLocked} ${commitment.token}`,
        },
      });
    } catch {
      // prepareLock.error / chainTx.error surfaced below.
    }
  }

  const error = prepareLock.error ?? chainTx.error;

  return (
    <Card className={commitment.status === "active" ? "border-chain/40" : undefined}>
      <CardContent className="py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant="outline" className={STATUS_STYLE[commitment.status]}>
            {commitment.status === "active"
              ? "Active"
              : commitment.status === "completed"
                ? "Completed"
                : "Cancelled"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Opened {formatDate(commitment.createdAt)}
          </span>
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
              {commitment.amountLocked}{" "}
              <span className="text-base font-normal">{commitment.token}</span>
            </p>
            <p className="mt-1.5 text-sm">{commitment.goalTitle}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Reward on success: {commitment.reward} {commitment.token}
        </p>

        <div className="mt-4 space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
          <p>
            <span className="font-medium">Released when: </span>
            {commitment.releaseCondition}
          </p>
          <p>
            <span className="font-medium">If it doesn&apos;t happen: </span>
            {commitment.failurePath}
          </p>
        </div>

        {commitment.txHash ? (
          <a
            href={explorerUrl(commitment.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-chain/30 bg-chain-soft/60 px-3 py-2 text-xs font-medium text-chain transition-colors hover:bg-chain-soft"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="font-mono">{formatTxHash(commitment.txHash)}</span>
            <span className="font-normal text-muted-foreground">on the explorer</span>
          </a>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">Not yet locked on-chain.</p>
        )}

        {commitment.status === "active" && (
          <div className="mt-4 border-t border-border pt-4">
            {chainTx.data ? (
              <a
                href={chainTx.data.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-xs font-medium text-chain underline underline-offset-4"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="font-mono">{formatTxHash(chainTx.data.txHash)}</span> — funds
                locked
              </a>
            ) : commitment.locked ? (
              // Persisted from the indexed LOCK_FUNDS tx — survives reload, so the
              // Lock button is never re-offered for funds already locked.
              <p className="inline-flex items-center gap-2 text-xs font-medium text-chain">
                <Lock className="size-3.5" aria-hidden />
                Funds locked on-chain.
              </p>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={lock}
                  disabled={!isConnected || busy}
                  className="gap-2 bg-chain text-chain-foreground hover:bg-chain/90"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wallet className="size-4" />
                  )}
                  {chainTx.isPending
                    ? "Confirm in your wallet…"
                    : prepareLock.isPending
                      ? "Preparing…"
                      : "Lock funds"}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Locks your principal on-chain — you sign it from your own wallet.
                </p>
              </>
            )}
            {notice && (
              <p className="mt-2 rounded-lg border border-caution/40 bg-caution-soft px-3 py-2 text-xs leading-relaxed">
                {notice}
              </p>
            )}
            {error && (
              <p className="mt-2 text-xs text-destructive">
                {error instanceof ApiError && error.status === 401
                  ? "Connect your wallet to lock funds."
                  : `Couldn't lock funds: ${error.message}`}
              </p>
            )}
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
      />

      <div className="space-y-4">
        {commitments.map((c) => (
          <CommitmentCard key={c.id} commitment={c} />
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg">Back a goal with funds</h2>
        <CreateCommitmentFlow />
      </section>
    </AppShell>
  );
}
