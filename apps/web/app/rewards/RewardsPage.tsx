"use client";

import { ExternalLink, Gift, Loader2 } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api/client";
import { useChainTx } from "@/hooks/useChainTx";
import type { Reward } from "@/hooks/useCommitAI";
import { formatDate, formatTxHash, usePrepareClaim, useRewards } from "@/hooks/useCommitAI";
import { useSession } from "@/hooks/useSession";

/**
 * A claimable reward with a real claim action (build step 9, phase 3; CLAUDE.md
 * rules 1–4). "Claim" prepares `claimReward` calldata and the DEPOSITOR's own
 * wallet signs it — the contract only ever pays the depositor, and only on an
 * APPROVED commitment, so an unearned claim reverts on-chain rather than being
 * faked here. The backend never signs. Honest gating when there is nothing to
 * claim on-chain yet.
 */
function ClaimableRewardCard({ reward }: { reward: Reward }) {
  const { isConnected } = useSession();
  const prepareClaim = usePrepareClaim();
  const chainTx = useChainTx();
  const [notice, setNotice] = useState<string | null>(null);

  const busy = prepareClaim.isPending || chainTx.isPending;
  const error = prepareClaim.error ?? chainTx.error;

  async function claim() {
    setNotice(null);
    if (!reward.commitmentId) {
      setNotice("This reward has no on-chain commitment to claim from yet.");
      return;
    }
    try {
      const result = await prepareClaim.mutateAsync(reward.commitmentId);
      if (!result.configured) {
        setNotice(
          "On-chain claiming isn't available on this server yet (CommitmentVault not configured).",
        );
        return;
      }
      if (!result.prepared || !result.transaction) {
        setNotice(result.reason ?? "This reward can't be claimed yet.");
        return;
      }
      await chainTx.mutateAsync({
        transaction: result.transaction,
        record: {
          kind: "CLAIM_REWARD",
          title: `Claim reward for "${reward.goalTitle}"`,
          commitmentId: reward.commitmentId,
          detail: `${reward.amount} ${reward.token}`,
        },
      });
    } catch {
      // prepareClaim.error / chainTx.error surfaced below.
    }
  }

  return (
    <Card className="border-chain/40 bg-chain-soft">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-display text-xl text-chain">
              {reward.amount} {reward.token}
            </p>
            <p className="mt-0.5 text-sm">{reward.goalTitle}</p>
            <p className="text-xs text-muted-foreground">Earned {formatDate(reward.earnedAt)}</p>
          </div>
          {chainTx.data ? (
            <a
              href={chainTx.data.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs font-medium text-chain underline underline-offset-4"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="font-mono">{formatTxHash(chainTx.data.txHash)}</span> claimed
            </a>
          ) : (
            <Button
              onClick={claim}
              disabled={!isConnected || busy}
              className="gap-2 bg-chain text-chain-foreground hover:bg-chain/90"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {chainTx.isPending
                ? "Confirm in your wallet…"
                : prepareClaim.isPending
                  ? "Preparing…"
                  : "Claim"}
            </Button>
          )}
        </div>
        {notice && (
          <p className="rounded-lg border border-caution/40 bg-caution-soft px-3 py-2 text-xs leading-relaxed">
            {notice}
          </p>
        )}
        {error && (
          <p className="text-xs text-destructive">
            {error instanceof ApiError && error.status === 401
              ? "Connect your wallet to claim your reward."
              : `Couldn't claim the reward: ${error.message}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function RewardsPage() {
  const { isConnected } = useSession();
  const { data: rewards = [] } = useRewards();
  const claimable = rewards.filter((r) => r.state === "claimable");
  const claimed = rewards.filter((r) => r.state === "claimed");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Rewards"
        title="Earned, not given"
        description="Every reward here traces back to a milestone that passed verification."
      />

      {!isConnected && (
        <Card className="mb-5 border-caution/40 bg-caution-soft">
          <CardContent className="py-4 text-sm">
            Connect your wallet to see and claim your rewards.
          </CardContent>
        </Card>
      )}

      <h2 className="mb-3 text-lg">Ready to claim</h2>
      {claimable.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center surface-grain">
          <Gift className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing claimable yet. Rewards appear as milestones get verified.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {claimable.map((r) => (
            <ClaimableRewardCard key={r.id} reward={r} />
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg">Already claimed</h2>
      {claimed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rewards claimed yet.</p>
      ) : (
        <div className="space-y-3">
          {claimed.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="text-sm font-medium">{r.goalTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    Claimed {r.claimedAt ? formatDate(r.claimedAt) : "—"}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">
                  {r.amount} {r.token}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
