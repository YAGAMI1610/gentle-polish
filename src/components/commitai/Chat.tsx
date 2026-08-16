import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ChatThread({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

export function AgentBubble({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "caution" }) {
  return (
    <div className="flex max-w-[88%] gap-3 sm:max-w-[72%]">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Sparkles className="size-3.5" aria-hidden />
      </div>
      <div
        className={cn(
          "rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-sm leading-relaxed shadow-soft",
          tone === "caution" && "border-caution/40 bg-caution-soft",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto max-w-[88%] sm:max-w-[72%]">
      <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
        {children}
      </div>
    </div>
  );
}
