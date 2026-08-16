import { createFileRoute } from "@tanstack/react-router";
import { Copy, Wallet } from "lucide-react";

import { AppShell } from "@/components/commitai/AppShell";
import { ProgressRing } from "@/components/commitai/ProgressRing";
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
          <div className="flex items-center gap-5">
            <ProgressRing value={profile.accountabilityScore} size={92} stroke={7}>
              <span className="text-display text-2xl leading-none">
                {profile.accountabilityScore}
              </span>
            </ProgressRing>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              A running read on how your check-ins, evidence and follow-through hold up over time.
            </p>
          </div>
          <div className="mt-6 space-y-4 border-t border-border pt-5">
            {profile.scoreBreakdown.map((item) => (
              <div key={item.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-display text-sm text-verify">{item.value}</span>
                </div>
                <Progress value={item.value} className="mt-2 h-2" />
                <p className="mt-1.5 text-xs text-muted-foreground">{item.weight}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: "Completed", value: profile.goalsCompleted, tone: "text-verify" },
          { label: "Active", value: profile.goalsActive, tone: "text-foreground" },
          { label: "Abandoned", value: profile.goalsAbandoned, tone: "text-muted-foreground" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-5 text-center">
              <p className={`text-display text-3xl leading-none ${s.tone}`}>{s.value}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.1em] text-muted-foreground">
                {s.label}
              </p>
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
