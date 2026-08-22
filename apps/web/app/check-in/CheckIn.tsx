"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { AgentMark } from "@/components/commitai/AgentMark";
import { AppShell } from "@/components/commitai/AppShell";
import { ChatThread } from "@/components/commitai/Chat";
import { ChatTranscript } from "@/components/commitai/ChatTranscript";
import { ConfidenceMeter } from "@/components/commitai/ConfidenceMeter";
import { StatusChip } from "@/components/commitai/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client";
import type { AIMessage } from "@/lib/ai/provider";
import type { Goal, Verification } from "@/hooks/useCommitAI";
import { useAiTurn, useCreateCheckIn, useGoal, useGoals } from "@/hooks/useCommitAI";
import { useSession } from "@/hooks/useSession";

/**
 * Weekly check-in (build step 9, phase 3). Everything on this screen is real:
 * the conversation is a live `/api/ai/turn` round (no hardcoded script), the
 * confidence meter reads the goal's most-recent real `VerificationRecord` (there
 * is no fixed confidence constant any more), and "Record check-in" persists a real
 * `CheckIn` row via `/api/checkins`. When a goal has never been verified we say so
 * honestly rather than showing an invented number.
 */

/** Most-recent verification across a goal's milestones — real data, not a constant. */
function latestVerification(goal: Goal | undefined): Verification | undefined {
  if (!goal) return undefined;
  const verifications = goal.milestones
    .map((m) => m.verification)
    .filter((v): v is Verification => Boolean(v));
  if (verifications.length === 0) return undefined;
  return verifications.reduce((a, b) => (a.submittedAt >= b.submittedAt ? a : b));
}

export default function CheckIn() {
  const { isConnected } = useSession();
  const { data: goals = [] } = useGoals();
  const aiTurn = useAiTurn();
  const createCheckIn = useCreateCheckIn();

  const [goalId, setGoalId] = useState<string>("");
  const { data: goal } = useGoal(goalId);

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  const aiUnavailable = aiTurn.error instanceof ApiError && aiTurn.error.status === 503;
  const verification = latestVerification(goal);
  const selectedGoal = goals.find((g) => g.id === goalId);

  function pickGoal(next: string) {
    setGoalId(next);
    setMessages([]);
    setNoteSaved(false);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !goalId || aiTurn.isPending) return;
    setInput("");
    const history = messages;
    // Show the user's line immediately; the real transcript replaces it on reply.
    setMessages([...history, { kind: "user_text", text }]);
    // Route the turn to the chosen goal. The user's own message is wrapped as
    // untrusted content server-side (rule 5); this is only routing context.
    const toolPolicy = selectedGoal
      ? `The user is checking in on their existing goal "${selectedGoal.title}" (goalId: ${selectedGoal.id}). Focus this turn on that goal: ask for concrete specifics, assess progress honestly, and only use your tools for this goal. Never invent progress the user did not report.`
      : undefined;
    try {
      const result = await aiTurn.mutateAsync({
        userMessage: text,
        history,
        ...(toolPolicy !== undefined ? { toolPolicy } : {}),
      });
      setMessages(result.messages);
    } catch {
      // Surfaced from aiTurn.error below; the user's message stays visible.
    }
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = note.trim();
    if (!message || !goalId) return;
    setNoteSaved(false);
    try {
      await createCheckIn.mutateAsync({ goalId, message });
      setNote("");
      setNoteSaved(true);
    } catch {
      // Surfaced from createCheckIn.error below.
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-start gap-3">
        <AgentMark className="mt-1 size-10" />
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Check-in
          </p>
          <h1 className="mt-1 text-2xl leading-tight">How is it actually going?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Honest answers help more than impressive ones. Pick a goal and talk it through.
          </p>
        </div>
      </div>

      {!isConnected && (
        <Card className="mb-5 border-caution/40 bg-caution-soft">
          <CardContent className="py-4 text-sm">
            Connect your wallet to check in — your goals and progress are tied to your signed-in
            wallet.
          </CardContent>
        </Card>
      )}

      <div className="mb-5">
        <Label htmlFor="checkin-goal">Which goal?</Label>
        <Select value={goalId} onValueChange={pickGoal}>
          <SelectTrigger
            id="checkin-goal"
            className="mt-2"
            disabled={!isConnected || goals.length === 0}
          >
            <SelectValue placeholder={goals.length === 0 ? "No goals yet" : "Pick a goal"} />
          </SelectTrigger>
          <SelectContent>
            {goals.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {goalId && (
        <Card className="mb-5">
          <CardContent className="py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Current verification</p>
              <StatusChip
                status={verification?.status ?? "pending"}
                {...(verification ? { confidence: verification.confidence } : {})}
              />
            </div>
            {verification ? (
              <>
                <ConfidenceMeter
                  value={verification.confidence}
                  status={verification.status}
                  className="mt-4 max-w-xs"
                />
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {verification.reasoning}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No verification recorded for this goal yet. Talk through your progress below and add
                evidence — confidence appears here once your agent has something real to assess.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/goals/${goalId}`}>See the goal</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/verify">Add evidence</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ChatThread>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {goalId
              ? "Tell your agent how this goal is going. It'll ask for specifics so progress can be verified honestly."
              : "Pick a goal above to start the check-in."}
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
            ? `The AI isn't configured on this server yet — ${
                aiTurn.error?.message ?? "no provider API key is set"
              }. You can still record a check-in note below.`
            : `Couldn't reach your agent: ${aiTurn.error?.message ?? "unknown error"}`}
        </p>
      )}

      <form
        onSubmit={send}
        className="sticky bottom-20 mt-6 flex gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft lg:bottom-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={goalId ? "Tell your agent how it went…" : "Pick a goal first"}
          disabled={!isConnected || !goalId || aiTurn.isPending}
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          disabled={!isConnected || !goalId || aiTurn.isPending || input.trim().length === 0}
        >
          <Send className="size-4" />
        </Button>
      </form>

      <section className="mt-8">
        <Card>
          <CardContent className="py-5">
            <form onSubmit={saveNote} className="space-y-3">
              <div>
                <Label htmlFor="checkin-note">Record a progress note</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved against the goal as a durable check-in you and your agent can refer back to.
                </p>
              </div>
              <Textarea
                id="checkin-note"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteSaved(false);
                }}
                rows={3}
                placeholder="e.g. Finished chapter 7 this week — slower than planned but on track."
                maxLength={5000}
                disabled={!isConnected || !goalId}
              />
              {createCheckIn.isError && (
                <p className="text-xs text-destructive">
                  {createCheckIn.error instanceof ApiError && createCheckIn.error.status === 401
                    ? "Connect your wallet to record a check-in."
                    : `Couldn't save the check-in: ${createCheckIn.error?.message ?? "unknown error"}`}
                </p>
              )}
              {noteSaved && <p className="text-xs text-verify">Check-in recorded.</p>}
              <Button
                type="submit"
                disabled={
                  !isConnected || !goalId || note.trim().length === 0 || createCheckIn.isPending
                }
              >
                {createCheckIn.isPending ? "Saving…" : "Record check-in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
