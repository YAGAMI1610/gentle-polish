# CommitAI visual polish pass

The current workspace holds an empty starter, while the uploaded archive contains the full CommitAI app (dashboard, goals, goal detail, check-in, verify, commitments, create, rewards, achievements, profile, activity). Step one is restoring that app into the project; everything after is presentation-only polish. Layout structure and copy tone stay as they are — calm, honest, non-hype.

## 0. Restore the app

Copy the uploaded source (routes, components, hooks, demo data, styles) into the project, excluding any git metadata, so the existing screens are live before polishing.

## 1. Shared design primitives (built first, reused everywhere)

- **StatusChip** — extend the existing chip so Verified / Needs More Evidence / Unverified / Awaiting have one identity (color + icon) used on goals list, goal detail, check-in, activity.
- **DemoBadge** — one component, applied identically on every screen with placeholder data.
- **AgentMark** — small geometric agent avatar (generated abstract mark) used on the dashboard agent card and check-in AI bubbles.
- **CategoryIcon** — minimal generated icons per goal category (reading, fitness, building/making, money) used on dashboard goal cards and goals list.
- **ProgressRing** — reusable radial progress for goal cards, accountability score, and confidence meter.
- **Timeline** — connected vertical line with status-colored nodes, shared by goal detail milestones and the activity feed.

All colors come from existing tokens: forest ink, cream/paper neutrals, `--verify` (verification accent, also the wordmark "AI") and `--chain` (financial accent). No new hues.

## 2. Per screen

**Dashboard** — generated subtle abstract background (soft topographic lines, very low contrast) behind the "Three goals in motion" hero; compact goal cards with category icon, progress ring and one-line status; agent avatar in the dark green agent card; accountability score as a radial with the number inside plus a small trend arrow/sparkline; more breathing room between hero and agent card; active-tab dot on the bottom nav.

**Goals list** — category icon per card, status chip for the latest milestone, and a distinct left-border chain accent plus icon marking Self-Commitment goals versus Accountability Only.

**Goal detail** — milestones become a real vertical timeline with status-colored nodes; on-chain terms move into a separate chain-accent card with a generated "locked funds" mark and an explicit block-explorer link element.

**Check-in** — agent avatar on AI bubbles, distinct high-contrast user bubble, confidence shown as a meter bar alongside the status chip.

**Verify / evidence** — upload, paste text and connect data become three distinct option cards with generated minimal icons; a shield/lock icon beside the evidence-hash privacy note.

**Commitments** — financial card treatment distinct from goal cards: large numeral for locked amount and reward, chain accent framing, and the failure/cancel path always visible in lighter secondary text on the card.

**Create commitment** — numbered step indicator across goal picker → amount/reward → terms → sign.

**Rewards / achievements** — generated line-art medallion artwork per achievement type, with clear unlocked vs locked (muted) states.

**Profile** — accountability score breakdown as a small horizontal bar set (consistency, completions, streaks) instead of bare numbers.

**Activity feed** — timeline line with distinct node shapes: verification accent for AI decision events, chain accent for on-chain events.

## Technical notes

- Generated imagery (hero texture, agent mark, category icons, achievement medallions, locked-funds mark) is produced as image assets and imported; purely functional icons stay as lucide.
- New tokens only for gradients/shadows/textures derived from existing colors, added in `src/styles.css`.
- Every screen keeps its route head metadata; no data model or business logic changes.