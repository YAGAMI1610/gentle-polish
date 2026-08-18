"use client";

import { Gift } from "lucide-react";

import { AppShell } from "@/components/commitai/AppShell";
import { UiOnlyNote } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, useRewards } from "@/hooks/useCommitAI";

export default function RewardsPage() {
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
            <Card key={r.id} className="border-chain/40 bg-chain-soft">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="text-display text-xl text-chain">
                    {r.amount} {r.token}
                  </p>
                  <p className="mt-0.5 text-sm">{r.goalTitle}</p>
                  <p className="text-xs text-muted-foreground">Earned {formatDate(r.earnedAt)}</p>
                </div>
                <Button className="bg-chain text-chain-foreground hover:bg-chain/90">Claim</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <UiOnlyNote>
        Claiming isn't wired up — the button shows the flow only, no transaction is sent.
      </UiOnlyNote>

      <h2 className="mb-3 mt-8 text-lg">Already claimed</h2>
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
    </AppShell>
  );
}
