import { cn } from "@/lib/utils";

export type MedalKind = "honesty" | "verified" | "chain" | "finish" | "consistency";

const ART: Record<MedalKind, string> = {
  honesty: "/assets/badge-honesty.png",
  verified: "/assets/badge-verified.png",
  chain: "/assets/badge-chain.png",
  finish: "/assets/badge-finish.png",
  consistency: "/assets/badge-consistency.png",
};

/** Presentation-only mapping until achievements carry a kind from the backend. */
export function medalKind(achievement: { id: string; name: string }): MedalKind {
  const hay = `${achievement.id} ${achievement.name}`.toLowerCase();
  if (/honest/.test(hay)) return "honesty";
  if (/verif/.test(hay)) return "verified";
  if (/skin|chain|commit/.test(hay)) return "chain";
  if (/finish|complete/.test(hay)) return "finish";
  return "consistency";
}

export function AchievementMedal({
  kind,
  earned,
  className,
}: {
  kind: MedalKind;
  earned: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-14 shrink-0 items-center justify-center rounded-full ring-1 transition-colors",
        earned ? "bg-verify-soft ring-verify/30" : "bg-muted ring-border",
        className,
      )}
    >
      <img
        src={ART[kind]}
        alt=""
        aria-hidden
        loading="lazy"
        width={512}
        height={512}
        className={cn(
          "size-[70%] object-contain transition-all",
          earned ? "opacity-100" : "opacity-35 grayscale",
        )}
      />
    </span>
  );
}
