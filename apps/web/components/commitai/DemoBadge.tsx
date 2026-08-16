import { cn } from "@/lib/utils";

/**
 * Marks any surface still rendering placeholder data.
 * Remove usages as each screen gets wired to the real backend.
 */
export function DemoBadge({
  className,
  label = "Demo data",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
    >
      <span className="size-1 rounded-full bg-muted-foreground/60" />
      {label}
    </span>
  );
}

export function UiOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
