import { createFileRoute } from "@tanstack/react-router";
import { Copy, Wallet } from "lucide-react";

import { AppShell } from "@/components/commitai/AppShell";
import { ConnectWalletDialog } from "@/components/commitai/ConnectWalletDialog";
import { DemoBadge } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  explorerUrl,
  formatAddress,
  formatDate,
  formatTxHash,
  useCommitments,
  useWalletProfile,
} from "@/hooks/useCommitAI";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — CommitAI" },
      { name: "description", content: "Wallet, accountability score breakdown and commitment history." },
      { property: "og:title", content: "Your profile — CommitAI" },
      { property: "og:description", content: "What your accountability score is actually made of." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { data: profile } = useWalletProfile();
  const { data: commitments = [] } = useCommitments();

  if (!profile) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader eyebrow="Profile" title="Your record" action={<DemoBadge />} />

      <Card className="mb-5 border-chain/40">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-chain-soft text-chain">
              <Wallet className="size-5" />
            </div>
            <div>
              <p className="font-mono text-sm">{formatAddress(profile.address)}</p>
              <p className="text-xs text-muted-foreground">
                {profile.connected ? "Connected" : "Not connected"} · BOT Chain testnet
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
              aria-label="Copy address"
            >
              <Copy className="size-4" />
            </button>
            <ConnectWalletDialog />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Accountability score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-display text-5xl">{profile.accountabilityScore}</p>
          <div className="mt-5 space-y-4">
            {profile.scoreBreakdown.map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-sm">
                  <span>{item.label}</span>
                  <span className="text-muted-foreground">{item.value}</span>
                </div>
                <Progress value={item.value} className="mt-1.5 h-1.5" />
                <p className="mt-1 text-xs text-muted-foreground">{item.weight}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: "Completed", value: profile.goalsCompleted },
          { label: "Active", value: profile.goalsActive },
          { label: "Abandoned", value: profile.goalsAbandoned },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4 text-center">
              <p className="text-display text-2xl">{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-lg">Self-commitment history</h2>
      <div className="space-y-3">
        {commitments.map((c) => (
          <Card key={c.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium">{c.goalTitle}</p>
                <p className="text-xs text-muted-foreground">Opened {formatDate(c.createdAt)}</p>
                <a
                  href={explorerUrl(c.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-chain underline underline-offset-4"
                >
                  {formatTxHash(c.txHash)}
                </a>
              </div>
              <div className="text-right">
                <p className="text-sm text-chain">
                  {c.amountLocked} {c.token}
                </p>
                <Badge variant="outline" className="mt-1 text-xs capitalize">
                  {c.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
