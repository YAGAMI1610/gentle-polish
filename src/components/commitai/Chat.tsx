import type { ReactNode } from "react";

import { AgentMark } from "@/components/commitai/AgentMark";
import { cn } from "@/lib/utils";

export function ChatThread({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

export function AgentBubble({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "caution";
}) {
  return (
    <div className="flex max-w-[88%] gap-3 sm:max-w-[72%]">
      <AgentMark className="mt-0.5 size-8" />
      <div className="min-w-0">
        <div
          className={cn(
            "rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground shadow-soft",
            tone === "caution" && "border-caution/40 bg-caution-soft",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex max-w-[88%] justify-end gap-3 sm:max-w-[72%]">
      <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground shadow-soft">
        {children}
      </div>
      <span
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-medium text-accent-foreground ring-1 ring-border"
      >
        You
      </span>
    </div>
  );
}
