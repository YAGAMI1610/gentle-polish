"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AgentMark } from "@/components/commitai/AgentMark";
import { AppShell } from "@/components/commitai/AppShell";
import { AgentBubble, ChatThread, UserBubble } from "@/components/commitai/Chat";
import { ConfidenceMeter } from "@/components/commitai/ConfidenceMeter";
import { DemoBadge, UiOnlyNote } from "@/components/commitai/DemoBadge";
import { StatusChip } from "@/components/commitai/StatusChip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function CheckIn() {
  const [value, setValue] = useState("");

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AgentMark className="mt-1 size-10" />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Weekly check-in
            </p>
            <h1 className="mt-1 text-2xl leading-tight">Read 12 books this year</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Let's make sure this counts. Honest answers help more than impressive ones.
            </p>
          </div>
        </div>
        <span className="shrink-0">
          <DemoBadge />
        </span>
      </div>

      <ChatThread>
        <AgentBubble>How did the reading go this week?</AgentBubble>
        <UserBubble>Finished book 7. Took me most of the week but I got through it.</UserBubble>
        <AgentBubble>
          Good. A few questions so I can mark it properly — nothing tricky, just specifics.
        </AgentBubble>
        <AgentBubble>What was the central argument or turning point, in a sentence or two?</AgentBubble>
        <UserBubble>
          It's about how attention gets shaped by the tools we use. The turn is when the author admits his
          own habits didn't survive his research.
        </UserBubble>
        <AgentBubble>Was there a section you disagreed with or found weak?</AgentBubble>
        <UserBubble>The policy chapter near the end. Felt thin compared to the rest.</UserBubble>
        <AgentBubble>Roughly how long is it, and where did you do most of the reading?</AgentBubble>
        <UserBubble>Around 300 pages. Mostly on the train.</UserBubble>
      </ChatThread>

      <Card className="mt-6 border-verify/30 bg-verify-soft">
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusChip status="verified" />
            <DemoBadge />
          </div>
          <ConfidenceMeter value={89} status="verified" className="mt-4 max-w-xs" />
          <p className="mt-3 text-sm leading-relaxed">
            Your answers include details that track with the book and with the time you say you spent. I'm
            marking milestone 7 as verified. If anything I've got wrong, tell me and I'll reopen it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/goals/g-read-12">See the goal</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/verify">Add supporting evidence</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Other outcomes this flow can end in
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusChip status="needs-evidence" confidence={52} />
          <StatusChip status="unverified" confidence={18} />
        </div>
        <UiOnlyNote>
          Verification results here are illustrative. No AI call is made from this screen yet.
        </UiOnlyNote>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setValue("");
        }}
        className="sticky bottom-20 mt-6 flex gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft lg:bottom-4"
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add something the agent missed…"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon" aria-label="Send message">
          <Send className="size-4" />
        </Button>
      </form>
    </AppShell>
  );
}
