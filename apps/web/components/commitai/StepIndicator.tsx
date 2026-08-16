import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/** Numbered progress steps for multi-step flows. */
export function StepIndicator({
  steps,
  current,
  className,
}: {
  steps: readonly string[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start gap-1", className)} aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-center gap-1">
              <span className={cn("h-px flex-1", i === 0 ? "bg-transparent" : done || active ? "bg-chain/50" : "bg-border")} />
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium transition-colors",
                  done && "border-chain bg-chain text-chain-foreground",
                  active && "border-chain bg-chain-soft text-chain ring-4 ring-chain/15",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "h-px flex-1",
                  i === steps.length - 1 ? "bg-transparent" : done ? "bg-chain/50" : "bg-border",
                )}
              />
            </div>
            <span
              className={cn(
                "text-center text-[10px] font-medium uppercase tracking-[0.08em]",
                active ? "text-chain" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}