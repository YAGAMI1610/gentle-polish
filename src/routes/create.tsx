import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, Send, Target } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { AgentBubble, ChatThread, UserBubble } from "@/components/commitai/Chat";
import { DemoBadge, UiOnlyNote } from "@/components/commitai/DemoBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Set a goal — CommitAI" },
      {
        name: "description",
        content: "Talk a goal through with your accountability agent until it's specific and checkable.",
      },
      { property: "og:title", content: "Set a goal — CommitAI" },
      { property: "og:description", content: "A short conversation turns a vague intention into a plan." },
    ],
  }),
  component: CreateGoal,
});

function Composer({ placeholder }: { placeholder: string }) {
  const [value, setValue] = useState("");
  return (
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
        placeholder={placeholder}
        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Button type="submit" size="icon" aria-label="Send message">
        <Send className="size-4" />
      </Button>
    </form>
  );
}

function CreateGoal() {
  return (
    <AppShell>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            New goal
          </p>
          <h1 className="mt-1 text-2xl leading-tight">Let's make this specific</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A few questions, one at a time. Vague goals can't be verified — that's the whole point.
          </p>
        </div>
        <DemoBadge />
      </div>

      <Tabs defaultValue="conversation">
        <TabsList className="w-full">
          <TabsTrigger value="conversation" className="flex-1">
            Conversation
          </TabsTrigger>
          <TabsTrigger value="pushback" className="flex-1">
            When the agent pushes back
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversation" className="mt-5">
          <ChatThread>
            <AgentBubble>What do you want to get done? Plain words are fine.</AgentBubble>
            <UserBubble>I want to read more.</UserBubble>
            <AgentBubble>
              Good starting point. Where are you now — roughly how many books in the last year?
            </AgentBubble>
            <UserBubble>Maybe four.</UserBubble>
            <AgentBubble>And what would feel like a real step up without wrecking your week?</AgentBubble>
            <UserBubble>Twelve this year. One a month.</UserBubble>
            <AgentBubble>Is there a hard deadline, or is this ongoing?</AgentBubble>
            <UserBubble>End of the year.</UserBubble>
            <AgentBubble>How often should I check in? Weekly tends to work best for reading.</AgentBubble>
            <UserBubble>Weekly is fine.</UserBubble>
            <AgentBubble>
              Here's what I've written down. Change anything that isn't right.
            </AgentBubble>
          </ChatThread>

          <Card className="mt-5">
            <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="size-4" /> Read 12 books this year
              </CardTitle>
              <DemoBadge />
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Milestones
                </p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  <li>Books 1-3 by 31 March</li>
                  <li>Books 4-6 by 30 June</li>
                  <li>Books 7-9 by 30 September</li>
                  <li>Books 10-12 by 31 December</li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Deadline
                  </p>
                  <p className="mt-1 flex items-center gap-1.5">
                    <CalendarDays className="size-4" /> 31 December 2026
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Check-ins
                  </p>
                  <p className="mt-1">Weekly, Wednesdays</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  How I'll verify it
                </p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  <li>A short reflection on what you read</li>
                  <li>Follow-up questions only a reader could answer</li>
                  <li>Optionally, a photo of the book or e-reader progress</li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/goals">Save this goal</Link>
                </Button>
                <Button variant="outline">Keep editing</Button>
              </div>
              <UiOnlyNote>
                Saving is not wired up yet — this screen shows the flow only. No goal is created.
              </UiOnlyNote>
            </CardContent>
          </Card>

          <Composer placeholder="Reply to your agent…" />
        </TabsContent>

        <TabsContent value="pushback" className="mt-5">
          <ChatThread>
            <UserBubble>I want to run a marathon in six weeks. I don't run right now.</UserBubble>
            <AgentBubble tone="caution">
              That's a big jump in a short time — let's talk about it. Going from no running to 42km in six
              weeks usually ends in injury rather than a finish line. I'm not saying no; I want the goal to
              be one you can actually clear.
            </AgentBubble>
            <AgentBubble>
              Two options: keep six weeks and aim for a 10K, or keep the marathon and give it five to six
              months. Is there a date you're tied to?
            </AgentBubble>
            <UserBubble>There's a race I want to do with a friend, but there's a 10K on the day too.</UserBubble>
            <AgentBubble>
              Then the 10K in six weeks is the honest version, and we can set the marathon as a follow-on
              goal for spring. Want me to write it up that way?
            </AgentBubble>
          </ChatThread>
          <Composer placeholder="Tell the agent what you'd rather do…" />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
