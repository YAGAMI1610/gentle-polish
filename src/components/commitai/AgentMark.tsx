import agentMark from "@/assets/agent-mark.png";
import { cn } from "@/lib/utils";

/**
 * The agent's identity mark. Used anywhere the agent "speaks":
 * dashboard agent card, chat bubbles, empty states.
 */
export function AgentMark({
  className,
  tone = "light",
}: {
  className?: string;
  /** "light" sits on cream surfaces, "dark" sits on the deep green card. */
  tone?: "light" | "dark";
}) {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-1",
        tone === "dark"
          ? "bg-primary-foreground/10 ring-primary-foreground/25"
          : "bg-verify-soft ring-verify/25",
        className,
      )}
    >
      <img
        src={agentMark}
        alt=""
        aria-hidden
        loading="lazy"
        width={512}
        height={512}
        className={cn("size-[62%] object-contain", tone === "dark" && "brightness-0 invert")}
      />
    </span>
  );
}