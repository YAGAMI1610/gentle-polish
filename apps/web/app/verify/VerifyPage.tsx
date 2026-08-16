"use client";

import { FileText, Github, ShieldCheck, Upload, Watch } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { DemoBadge, UiOnlyNote } from "@/components/commitai/DemoBadge";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const evText = "/assets/ev-text.png";
const evUpload = "/assets/ev-upload.png";
const evConnect = "/assets/ev-connect.png";

const OPTIONS = [
  {
    value: "text",
    art: evText,
    label: "Write it out",
    detail: "A short reflection in your own words",
  },
  {
    value: "upload",
    art: evUpload,
    label: "Upload a file",
    detail: "Photo, screenshot or document",
  },
  {
    value: "connect",
    art: evConnect,
    label: "Connect data",
    detail: "Let a service confirm it for you",
  },
] as const;

export default function VerifyPage() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Evidence"
        title="What evidence are you comfortable providing?"
        description="More detail usually means a higher confidence result — but you decide how much to share."
        action={<DemoBadge />}
      />

      <Tabs defaultValue="text">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-2 bg-transparent p-0">
          {OPTIONS.map((o) => (
            <TabsTrigger
              key={o.value}
              value={o.value}
              className="h-full flex-col items-start gap-2 whitespace-normal rounded-2xl border border-border bg-card p-4 text-left shadow-soft data-[state=active]:border-verify/40 data-[state=active]:bg-verify-soft data-[state=active]:shadow-none"
            >
              <img
                src={o.art}
                alt=""
                aria-hidden
                loading="lazy"
                width={512}
                height={512}
                className="size-9 object-contain"
              />
              <span className="text-sm font-medium">{o.label}</span>
              <span className="hidden text-xs font-normal leading-snug text-muted-foreground sm:block">
                {o.detail}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="text" className="mt-5 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Describe what you did, in your own words. Specifics help — dates, numbers, what was hard."
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{text.length} characters</span>
            <Button disabled={text.trim().length === 0}>Send to your agent</Button>
          </div>
          <UiOnlyNote>
            Text is the only path that would work without a backend today — and even here, nothing is sent
            yet.
          </UiOnlyNote>
        </TabsContent>

        <TabsContent value="upload" className="mt-5 space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border p-10 text-center surface-grain">
            <Upload className="size-6 text-muted-foreground" />
            <span className="mt-3 text-sm font-medium">
              {fileName ?? "Add a photo, screenshot or document"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">PNG, JPG or PDF up to 10MB</span>
            <input
              type="file"
              className="sr-only"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </label>
          <UiOnlyNote>
            File handling isn't live yet — the picker shows the flow, nothing is uploaded or stored.
          </UiOnlyNote>
        </TabsContent>

        <TabsContent value="connect" className="mt-5 space-y-3">
          {[
            { name: "GitHub", detail: "Commit and PR activity for shipping goals", icon: Github },
            { name: "Fitness tracker", detail: "Runs, workouts and distance", icon: Watch },
            { name: "Reading app", detail: "Finished books and progress", icon: FileText },
          ].map(({ name, detail, icon: Icon }) => (
            <Card key={name}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <Icon className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">{detail}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" disabled>
                  Connect
                </Button>
              </CardContent>
            </Card>
          ))}
          <UiOnlyNote>
            Data connections are not live yet. These are shown so you can see what would be available.
          </UiOnlyNote>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex gap-3 rounded-xl border border-verify/25 bg-verify-soft/50 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background/70 text-verify ring-1 ring-verify/25">
          <ShieldCheck className="size-4" aria-hidden />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your evidence stays private to you and your agent. If a goal has an on-chain commitment, only a
          verification hash — a fingerprint of the result — is written to the chain. The photo, document or
          text itself never leaves your account.
        </p>
      </div>
    </AppShell>
  );
}
