import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Award,
  Coins,
  Gift,
  Home,
  ListChecks,
  MessageSquareHeart,
  MoreHorizontal,
  User,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRIMARY = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/goals", label: "Goals", icon: ListChecks },
  { to: "/check-in", label: "Check-in", icon: MessageSquareHeart },
  { to: "/commitments", label: "Commitments", icon: Coins },
  { to: "/profile", label: "Profile", icon: User },
] as const;

const SECONDARY = [
  { to: "/create", label: "New goal with the agent", icon: MessageSquareHeart },
  { to: "/verify", label: "Submit evidence", icon: ListChecks },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/achievements", label: "Achievements", icon: Award },
] as const;

function useActive() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
}

export function AppShell({ children }: { children: ReactNode }) {
  const isActive = useActive();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-baseline gap-1 px-2">
          <span className="text-display text-xl">Commit</span>
          <span className="text-display text-xl text-verify">AI</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {PRIMARY.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(to)
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 px-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          More
        </div>
        <nav className="mt-2 flex flex-col gap-1">
          {SECONDARY.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(to)
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <p className="mt-auto px-3 text-xs leading-relaxed text-muted-foreground">
          Frontend preview. Data is placeholder and on-chain actions are UI only.
        </p>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-baseline gap-0.5">
          <span className="text-display text-lg">Commit</span>
          <span className="text-display text-lg text-verify">AI</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-lg p-2 text-muted-foreground hover:bg-accent" aria-label="More">
            <MoreHorizontal className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SECONDARY.map(({ to, label, icon: Icon }) => (
              <DropdownMenuItem key={to} asChild>
                <Link to={to} className="flex items-center gap-2">
                  <Icon className="size-4" /> {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 lg:max-w-4xl lg:pb-16 lg:pl-72 lg:pr-8">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-between px-2 py-1.5">
          {PRIMARY.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] transition-colors",
                isActive(to) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-5", isActive(to) && "stroke-[2.2]")} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
