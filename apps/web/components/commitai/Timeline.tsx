import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared vertical timeline: goal milestones and the activity feed. */
export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("relative", className)}>{children}</ul>;
}

export function TimelineItem({
  node,
  last,
  className,
  children,
}: {
  /** The marker rendered on the line — a dot, ring or icon chip. */
  node: ReactNode;
  last?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-4 pb-6", className)}>
      {!last && (
        <span
          className="absolute bottom-0 left-4 top-8 w-px -translate-x-1/2 bg-gradient-to-b from-border via-border to-transparent"
          aria-hidden
        />
      )}
      <div className="relative z-10 flex w-8 shrink-0 justify-center pt-0.5">{node}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

export function TimelineDot({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1 size-4 rounded-full border-2 bg-background ring-4 ring-background",
        filled && "bg-current",
        className,
      )}
    />
  );
}
