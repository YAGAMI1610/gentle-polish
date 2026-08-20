"use client";

import { Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/commitai/AppShell";
import { ChatThread } from "@/components/commitai/Chat";
import { ChatTranscript } from "@/components/commitai/ChatTranscript";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import type { AIMessage } from "@/lib/ai/provider";
import type { CreateGoalRequest } from "@/lib/api/dto";
import { useAiTurn, useCreateGoal } from "@/hooks/useCommitAI";
import { useSession } from "@/hooks/useSession";

const GOAL_MODES: { value: CreateGoalRequest["mode"]; label: string; detail: string }[] = [
  {
    value: "ACCOUNTABILITY",
    label: "Accountability",
    detail: "You want the agent to hold you to it",
  },
  {
    value: "SELF_COMMITMENT",
    label: "Self-commitment",
    detail: "You'll back it with your own stake",
  },
];

export default function CreateGoal() {
  const { isConnected } = useSession();
  const queryClient = useQueryClient();
  const aiTurn = useAiTurn();
  const createGoal = useCreateGoal();

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [mode, setMode] = useState<CreateGoalRequest["mode"]>("ACCOUNTABILITY");
  const [frequency, setFrequency] = useState("Weekly");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const aiUnavailable = aiTurn.error instanceof ApiError && aiTurn.error.status === 503;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || aiTurn.isPending) return;
    setInput("");
    const history = messages;
    // Show the user's line immediately; the response replaces the transcript.
    setMessages([...history, { kind: "user_text", text }]);
    try {
      const result = await aiTurn.mutateAsync({ userMessage: text, history });
      setMessages(result.messages);
      // A turn may have created a goal / milestones / strategy via tools.
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    } catch {
      // Error is surfaced from aiTurn.error below; keep the user's message visible.
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !summary.trim() || !frequency.trim()) return;
    try {
      const goal = await createGoal.mutateAsync({
        title: title.trim(),
        summary: summary.trim(),
        mode,
        checkInFrequency: frequency.trim(),
      });
      setCreatedId(goal.id);
      setTitle("");
      setSummary("");
    } catch {
      // Surfaced from createGoal.error below.
    }
  }

  return (
    <AppShell>
      <div className="mb-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          New goal
        </p>
        <h1 className="mt-1 text-2xl leading-tight">Let&apos;s make this specific</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A few questions, one at a time. Vague goals can&apos;t be verified — that&apos;s the whole
          point.
        </p>
      </div>

      {!isConnected && (
        <Card className="mb-5 border-caution/40 bg-caution-soft">
          <CardContent className="py-4 text-sm">
            Connect your wallet to start a goal — the conversation and your goals are tied to your
            signed-in wallet.
          </CardContent>
        </Card>
      )}

      <ChatThread>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tell your agent what you want to get done, in plain words. It&apos;ll ask a few
            questions to make the goal specific enough to verify.
          </p>
        ) : (
          <ChatTranscript messages={messages} />
        )}
        {aiTurn.isPending && (
          <p className="text-center text-xs italic text-muted-foreground">Thinking…</p>
        )}
      </ChatThread>

      {aiTurn.isError && (
        <p className="mt-4 rounded-lg border border-caution/40 bg-caution-soft px-3 py-2 text-xs leading-relaxed">
          {aiUnavailable
            ? "The AI isn't configured on this server yet (no GEMINI_API_KEY). You can still create a goal with the form below."
            : `Couldn't reach your agent: ${aiTurn.error?.message ?? "unknown error"}`}
        </p>
      )}

      <form
        onSubmit={send}
        className="sticky bottom-20 mt-6 flex gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft lg:bottom-4"
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={isConnected ? "Reply to your agent…" : "Connect your wallet first"}
          disabled={!isConnected || aiTurn.isPending}
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          disabled={!isConnected || aiTurn.isPending || input.trim().length === 0}
        >
          <Send className="size-4" />
        </Button>
      </form>

      <section className="mt-8">
        <Button variant="outline" className="gap-2" onClick={() => setManualOpen((open) => !open)}>
          <Sparkles className="size-4" />{" "}
          {manualOpen ? "Hide the form" : "Prefer a form? Create a goal directly"}
        </Button>

        {manualOpen && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Create a goal directly</CardTitle>
            </CardHeader>
            <CardContent>
              {createdId ? (
                <div className="space-y-3 text-sm">
                  <p>Your goal was created.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={`/goals/${createdId}`}>Open the goal</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCreatedId(null)}>
                      Create another
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submitManual} className="space-y-4">
                  <div>
                    <Label htmlFor="goal-title">Goal</Label>
                    <Input
                      id="goal-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Read 12 books this year"
                      maxLength={200}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="goal-summary">
                      In a sentence, what does success look like?
                    </Label>
                    <Textarea
                      id="goal-summary"
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      rows={3}
                      placeholder="One book a month, with a short reflection on each."
                      maxLength={2000}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label>Mode</Label>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {GOAL_MODES.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMode(option.value)}
                          className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                            mode === option.value
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <span className="font-medium">{option.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {option.detail}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="goal-frequency">Check-in cadence</Label>
                    <Input
                      id="goal-frequency"
                      value={frequency}
                      onChange={(event) => setFrequency(event.target.value)}
                      placeholder="Weekly"
                      maxLength={100}
                      className="mt-2"
                    />
                  </div>
                  {createGoal.isError && (
                    <p className="text-xs text-destructive">
                      {createGoal.error instanceof ApiError && createGoal.error.status === 401
                        ? "Connect your wallet to create a goal."
                        : `Couldn't create the goal: ${createGoal.error?.message ?? "unknown error"}`}
                    </p>
                  )}
                  <Button type="submit" disabled={!isConnected || createGoal.isPending}>
                    {createGoal.isPending ? "Creating…" : "Create goal"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </AppShell>
  );
}
