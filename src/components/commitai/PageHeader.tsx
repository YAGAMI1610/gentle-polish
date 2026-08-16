import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl leading-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}
