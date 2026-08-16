import { createFileRoute } from "@tanstack/react-router";
import { Award, Flame, Lock } from "lucide-react";

import { AppShell } from "@/components/commitai/AppShell";
import { DemoBadge } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, useAchievements, useWalletProfile } from "@/hooks/useCommitAI";

export const Route = createFileRoute("/achievements")({
  head: () => ({
    meta: [
      { title: "Achievements — CommitAI" },
      { name: "description", content: "Milestones, streaks and badges earned through verified progress." },
      { property: "og:title", content: "Achievements — CommitAI" },
      { property: "og:description", content: "Quiet markers of work you actually did." },
    ],
  }),
  component: AchievementsPage,
});

function AchievementsPage() {
  const { data: achievements = [] } = useAchievements();
  const { data: profile } = useWalletProfile();

  return (
    <AppShell>
      <PageHeader
        eyebrow="Achievements"
        title="Markers, not trophies"
        description="These exist to show the shape of your effort — they're not the point of the work."
        action={<DemoBadge />}
      />

      <Card className="mb-6">
        <CardContent className="flex items-center gap-4 py-5">
          <Flame className="size-8 text-chain" />
          <div>
            <p className="text-display text-2xl">{profile?.currentStreak ?? 0} weeks</p>
            <p className="text-sm text-muted-foreground">of check-ins kept in a row</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {achievements.map((a) => (
          <Card key={a.id} className={cn(!a.earned && "opacity-60")}>
            <CardContent className="flex gap-3 py-4">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full",
                  a.earned ? "bg-verify-soft text-verify" : "bg-muted text-muted-foreground",
                )}
              >
                {a.earned ? <Award className="size-5" /> : <Lock className="size-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
                {a.earned && a.earnedAt && (
                  <p className="mt-1 text-xs text-verify">Earned {formatDate(a.earnedAt)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
