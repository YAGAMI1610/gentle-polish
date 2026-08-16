import { cn } from "@/lib/utils";

export type GoalCategory = "reading" | "fitness" | "building" | "money";

const ART: Record<GoalCategory, string> = {
  reading: "/assets/cat-reading.png",
  fitness: "/assets/cat-fitness.png",
  building: "/assets/cat-building.png",
  money: "/assets/locked-funds.png",
};

/**
 * Presentation-only category inference. Demo goals carry no category field,
 * so it's derived from the goal id/title until the backend provides one.
 */
export function goalCategory(goal: { id: string; title: string }): GoalCategory {
  const hay = `${goal.id} ${goal.title}`.toLowerCase();
  if (/read|book/.test(hay)) return "reading";
  if (/run|5k|marathon|train|fit|gym/.test(hay)) return "fitness";
  if (/save|money|budget|spend|bot\b/.test(hay)) return "money";
  return "building";
}

export function CategoryIcon({
  category,
  className,
  size = "md",
}: {
  category: GoalCategory;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl bg-accent/70 ring-1 ring-border",
        size === "sm" ? "size-8" : "size-11",
        className,
      )}
    >
      <img
        src={ART[category]}
        alt=""
        aria-hidden
        loading="lazy"
        width={512}
        height={512}
        className="size-[64%] object-contain"
      />
    </span>
  );
}
