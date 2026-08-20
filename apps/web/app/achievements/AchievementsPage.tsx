"use client";

import { Flame, Lock } from "lucide-react";

import { AchievementMedal, medalKind } from "@/components/commitai/AchievementMedal";
import { AppShell } from "@/components/commitai/AppShell";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDate, useAchievements, useWalletProfile } from "@/hooks/useCommitAI";

export default function AchievementsPage() {
  const { data: achievements = [] } = useAchievements();
  const { data: profile } = useWalletProfile();

  return (
    <AppShell>
      <PageHeader
        eyebrow="Achievements"
        title="Markers, not trophies"
        description="These exist to show the shape of your effort — they're not the point of the work."
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
          <Card
            key={a.id}
            className={cn(
              "transition-colors",
              a.earned ? "border-verify/25" : "border-dashed bg-muted/30",
            )}
          >
            <CardContent className="flex gap-4 py-4">
              <AchievementMedal kind={medalKind(a)} earned={a.earned} />
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", !a.earned && "text-muted-foreground")}>
                  {a.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
                {a.earned ? (
                  <p className="mt-1.5 text-xs font-medium text-verify">
                    {a.earnedAt ? `Earned ${formatDate(a.earnedAt)}` : "Earned"}
                  </p>
                ) : (
                  <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3" aria-hidden /> Not yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
