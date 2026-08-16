import { CircleDashed, CircleHelp, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { VerificationStatus } from "@/hooks/useCommitAI";

const MAP: Record<
  VerificationStatus,
  { label: string; className: string; dot: string; text: string }
> = {
  verified: {
    label: "Verified",
    className: "bg-verify-soft text-verify border-verify/30",
    dot: "border-verify bg-verify text-verify",
    text: "text-verify",
  },
  "needs-evidence": {
    label: "Needs more evidence",
    className: "bg-caution-soft text-caution border-caution/30",
    dot: "border-caution bg-caution-soft text-caution",
    text: "text-caution",
  },
  unverified: {
    label: "Unverified",
    className: "bg-muted text-muted-foreground border-border",
    dot: "border-border bg-background text-muted-foreground",
    text: "text-muted-foreground",
  },
  pending: {
    label: "Awaiting check-in",
    className: "bg-muted text-muted-foreground border-border",
    dot: "border-border bg-background text-muted-foreground",
    text: "text-muted-foreground",
  },
};

/** Shared status colours so chips, timeline nodes and meters always agree. */
export function statusAccent(status: VerificationStatus) {
  return MAP[status];
}

export function statusIcon(status: VerificationStatus) {
  return status === "verified"
    ? ShieldCheck
    : status === "needs-evidence"
      ? CircleHelp
      : CircleDashed;
}

export function StatusChip({
  status,
  confidence,
  className,
}: {
  status: VerificationStatus;
  confidence?: number;
  className?: string;
}) {
  const config = MAP[status];
  const Icon = statusIcon(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        config.className,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {config.label}
      {typeof confidence === "number" && <span className="opacity-70">· {confidence}%</span>}
    </span>
  );
}
