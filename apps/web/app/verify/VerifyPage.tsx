"use client";

import { CheckCircle2, FileText, Github, Loader2, ShieldCheck, Upload, Watch } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/commitai/AppShell";
import { PageHeader } from "@/components/commitai/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import type { EvidenceResult } from "@/lib/api/dto";
import type { UploadEvidenceInput } from "@/hooks/useCommitAI";
import {
  useConnectors,
  useDisconnectGithub,
  useGoals,
  useImportGithub,
  useUploadEvidence,
} from "@/hooks/useCommitAI";
import { useSession } from "@/hooks/useSession";

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

/** Turn an upload failure into a specific, honest message (413/415/401 mapped). */
function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Connect your wallet to submit evidence.";
    if (err.status === 409) return "Connect GitHub first, then import your activity.";
    if (err.status === 413) return "That file is too large — evidence is capped at 15MB.";
    if (err.status === 415) return "That file type isn't allowed as evidence.";
    if (err.status === 503) return "That connector isn't configured on this deployment.";
    if (err.status === 400) return err.message || "Add some evidence content first.";
  }
  return err instanceof Error ? err.message : "Upload failed.";
}

export default function VerifyPage() {
  const { isConnected } = useSession();
  const { data: goals = [] } = useGoals();
  const upload = useUploadEvidence();
  const connectors = useConnectors();
  const importGithub = useImportGithub();
  const disconnectGithub = useDisconnectGithub();

  const [goalId, setGoalId] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [oauthFlash, setOauthFlash] = useState<string | null>(null);

  // Read the one-time ?connect=github&status=… flag the OAuth callback redirects
  // back with, then clean it off the URL. A full-page redirect remounts the app,
  // so the connectors query refetches fresh status on its own.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "github") {
      setOauthFlash(params.get("status"));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const result: EvidenceResult | undefined = upload.data ?? importGithub.data;
  const canSubmit = isConnected && Boolean(goalId);

  const githubConfigured = connectors.data?.configured.github ?? false;
  const githubConn = connectors.data?.connections.find((c) => c.provider === "GITHUB") ?? null;

  function importFromGithub() {
    if (!goalId) return;
    importGithub.mutate({ goalId });
  }

  function submitText() {
    if (!goalId || text.trim().length === 0) return;
    upload.mutate({ goalId, type: "TEXT", contentText: text.trim() });
  }

  function submitFile() {
    if (!goalId || !file) return;
    const type = file.type.startsWith("image/") ? "PHOTO" : "FILE";
    const input: UploadEvidenceInput = {
      goalId,
      type,
      file,
      fileName: file.name,
      ...(file.type ? { mimeType: file.type } : {}),
    };
    upload.mutate(input);
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Evidence"
        title="What evidence are you comfortable providing?"
        description="More detail usually means a higher confidence result — but you decide how much to share."
      />

      {!isConnected && (
        <Card className="mb-5 border-caution/40 bg-caution-soft">
          <CardContent className="py-4 text-sm">
            Connect your wallet to submit evidence — it&apos;s stored privately against your goal.
          </CardContent>
        </Card>
      )}

      <div className="mb-5">
        <Label htmlFor="evidence-goal">Which goal is this evidence for?</Label>
        <Select
          value={goalId}
          onValueChange={(v) => {
            setGoalId(v);
            upload.reset();
          }}
        >
          <SelectTrigger
            id="evidence-goal"
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

      <Tabs defaultValue="text" onValueChange={() => upload.reset()}>
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
            maxLength={20000}
            placeholder="Describe what you did, in your own words. Specifics help — dates, numbers, what was hard."
            disabled={!canSubmit}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{text.length} characters</span>
            <Button
              onClick={submitText}
              disabled={!canSubmit || text.trim().length === 0 || upload.isPending}
              className="gap-2"
            >
              {upload.isPending && <Loader2 className="size-4 animate-spin" />}
              Submit evidence
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="upload" className="mt-5 space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border p-10 text-center surface-grain">
            <Upload className="size-6 text-muted-foreground" />
            <span className="mt-3 text-sm font-medium">
              {file?.name ?? "Add a photo, screenshot or document"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              Images, PDF or text up to 15MB
            </span>
            <input
              type="file"
              className="sr-only"
              disabled={!canSubmit}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                upload.reset();
              }}
            />
          </label>
          <div className="flex justify-end">
            <Button
              onClick={submitFile}
              disabled={!canSubmit || !file || upload.isPending}
              className="gap-2"
            >
              {upload.isPending && <Loader2 className="size-4 animate-spin" />}
              Upload evidence
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="connect" className="mt-5 space-y-3">
          {oauthFlash && (
            <p
              className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                oauthFlash === "connected"
                  ? "border-verify/40 bg-verify-soft"
                  : "border-caution/40 bg-caution-soft"
              }`}
            >
              {oauthFlash === "connected"
                ? "GitHub connected — pick a goal and import your latest activity below."
                : oauthFlash === "denied"
                  ? "GitHub connection was cancelled."
                  : oauthFlash === "mismatch"
                    ? "Couldn't verify that sign-in attempt safely — please try connecting again."
                    : "GitHub connection didn't complete — please try again."}
            </p>
          )}

          {/* GitHub — a REAL OAuth connector (item 8). Live when configured, honest
              and disabled when not; other connectors remain genuinely planned. */}
          <Card>
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="flex items-center gap-3">
                <Github className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">GitHub</p>
                  <p className="text-xs text-muted-foreground">
                    {githubConn
                      ? `Connected as @${githubConn.externalLogin}`
                      : "Commit and PR activity for shipping goals"}
                  </p>
                </div>
              </div>
              {githubConn ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={importFromGithub}
                    disabled={!canSubmit || importGithub.isPending}
                    className="gap-2"
                  >
                    {importGithub.isPending && <Loader2 className="size-4 animate-spin" />}
                    Import latest activity
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disconnectGithub.mutate()}
                    disabled={disconnectGithub.isPending}
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isConnected || !githubConfigured}
                  onClick={() => {
                    window.location.href = "/api/connectors/github/start";
                  }}
                >
                  Connect
                </Button>
              )}
            </CardContent>
          </Card>

          {[
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

          <p className="text-xs leading-relaxed text-muted-foreground">
            {githubConfigured
              ? "GitHub is live: connect it to import your recent commit and PR activity as evidence — it's summarised, hashed and stored for real, exactly like an uploaded file. Fitness and reading connectors are still planned (see LIMITATIONS.md)."
              : "Automatic GitHub import isn't enabled on this deployment (no OAuth app configured). You can still submit a written note or upload a file — both are stored and analysed for real. Fitness and reading connectors are still planned (see LIMITATIONS.md)."}
          </p>
        </TabsContent>
      </Tabs>

      {(upload.isError || importGithub.isError) && (
        <p className="mt-4 rounded-lg border border-caution/40 bg-caution-soft px-3 py-2 text-xs leading-relaxed">
          {uploadErrorMessage(upload.error ?? importGithub.error)}
        </p>
      )}
      {result && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-verify/30 bg-verify-soft px-3 py-2 text-xs leading-relaxed">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-verify" aria-hidden />
          <span>
            Evidence recorded against your goal — content fingerprint{" "}
            <span className="font-mono">{result.contentHash.slice(0, 12)}…</span>. Your agent can
            now assess it on your next check-in.
          </span>
        </div>
      )}

      <div className="mt-6 flex gap-3 rounded-xl border border-verify/25 bg-verify-soft/50 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background/70 text-verify ring-1 ring-verify/25">
          <ShieldCheck className="size-4" aria-hidden />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your evidence stays private to you and your agent. If a goal has an on-chain commitment,
          only a verification hash — a fingerprint of the result — is written to the chain. The
          photo, document or text itself never leaves your account.
        </p>
      </div>
    </AppShell>
  );
}
