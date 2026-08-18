"use client";

/**
 * Renders a real AI turn transcript (`AIMessage[]` from `/api/ai/turn`) as chat
 * bubbles (build step 9, phase 3). Used by the /create and /check-in flows so
 * both show the SAME real conversation — no hardcoded script anywhere.
 *
 * `model_tool_calls` are surfaced as a muted "action taken" line (the agent did
 * something server-side, e.g. created a goal); `tool_result` payloads are internal
 * and not shown. Nothing here is fabricated — it only displays what the runner
 * actually returned.
 */
import type { AIMessage } from "@/lib/ai/provider";
import { AgentBubble, UserBubble } from "@/components/commitai/Chat";

export function ChatTranscript({ messages }: { messages: AIMessage[] }) {
  return (
    <>
      {messages.map((message, index) => {
        const key = `${message.kind}-${index}`;
        switch (message.kind) {
          case "user_text":
            return <UserBubble key={key}>{message.text}</UserBubble>;
          case "model_text":
            return <AgentBubble key={key}>{message.text}</AgentBubble>;
          case "model_tool_calls":
            return (
              <p
                key={key}
                className="text-center text-xs italic text-muted-foreground"
                aria-label="Agent action"
              >
                {message.toolCalls.map((call) => call.name).join(", ")} · action taken
              </p>
            );
          case "tool_result":
            return null;
          default:
            return null;
        }
      })}
    </>
  );
}
