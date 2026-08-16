import type { VerificationStatus } from "@/hooks/useCommitAI";
import { statusAccent } from "@/components/commitai/StatusChip";
import { cn } from "@/lib/utils";

const FILL: Record<VerificationStatus, string> = {
  verified: "bg-verify",
  "needs-evidence": "bg-caution",
  unverified: "bg-muted-foreground/50",
  pending: "bg-muted-foreground/50",
};

/** Confidence rendered as a meter so it reads as a measurement, not a number. */
export function ConfidenceMeter({
  value,
  status,
  className,
}: {
  value: number;
  status: VerificationStatus;
  className?: string;
}) {
  const accent = statusAccent(status);
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Confidence
        </span>
        <span className={cn("text-display text-sm", accent.text)}>{value}%</span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border/70"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Verification confidence"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", FILL[status])}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
