"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UiOnlyNote } from "@/components/commitai/DemoBadge";

export function ConnectWalletDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "connecting">("idle");

  return (
    <Dialog onOpenChange={() => setState("idle")}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2 border-chain/40 text-chain">
            <Wallet className="size-4" /> Connect wallet
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
          <DialogDescription>
            You only need a wallet for self-commitments. Accountability-only goals work without one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {["Browser wallet", "WalletConnect", "BOT Chain testnet wallet"].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setState("connecting")}
              className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
            >
              <span>{name}</span>
              <span className="text-xs text-muted-foreground">
                {state === "connecting" ? "Waiting…" : "Select"}
              </span>
            </button>
          ))}
        </div>
        <UiOnlyNote>
          Wallet connection is not yet live — this is the interface only. Nothing is signed, sent or
          stored when you tap an option above.
        </UiOnlyNote>
      </DialogContent>
    </Dialog>
  );
}
