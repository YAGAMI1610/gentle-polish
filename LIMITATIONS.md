# LIMITATIONS.md

Honest record of what is **not** yet real in this repo, per `CLAUDE.md` rules 1 and 6.
Each entry states what exists today, why, and what the production fix is.

Current build-sequence position: **step 3 core complete** — the Prisma schema, the
offline-generated initial migration, and the wallet-scoped data-access layer (unit tests
passing; DB-gated integration tests present) are all in place; see §9. Applying the
migration to a live Postgres and running the integration suite is gated on a reachable
database (§8), not on any missing code. Step 2's one outstanding piece is still the **live
testnet deploy tx hash**, which needs a funded deployer key (see §2). Steps 4–12 of
`CommitAI-Build-Prompt.md` §14 are outstanding.

---

## 1. All frontend data is labelled placeholder data

**Status:** by design at this step, not a defect.

Every screen reads through `apps/web/hooks/useCommitAI.ts`, whose `queryFn` bodies
resolve fixtures from `apps/web/lib/demo-data.ts`. Nothing touches a database, an AI
model, or a chain.

This is visible in the UI rather than hidden:

- `IS_DEMO_DATA = true` in `hooks/useCommitAI.ts`
- `<DemoBadge />` on every screen that shows numbers
- `<UiOnlyNote>` on every screen with an action button that does not act
- The sidebar reads "Frontend preview. Data is placeholder and on-chain actions are UI only."

Per build prompt §0 the requirement at this stage is _labelling_, not removal.

**Production fix:** build sequence step 9. The hooks were written so only the `queryFn`
bodies change — each already carries a `// TODO: fetch('/api/...')` marker and the
exported signatures stay identical, so no component changes.

## 2. Smart contract: built and tested, live deploy tx hash still outstanding

**Status:** contract + tests done and verified; the on-chain deployment is the one
remaining piece, blocked only on a funded key.

`contracts/src/CommitmentVault.sol` exists with the §8 function set, an
attestor/pull-payment trust model, `ReentrancyGuard` on every fund mover, and a
non-punitive `cancelCommitment` that returns 100% of principal to the depositor and any
reward to its funder. `contracts/test/` has 42 tests (happy path, cancel, reentrancy with
the guard proven to fire, unauthorized approve, double-claim, wrong-caller withdrawal,
rejecting-recipient atomicity, plus fuzz). `forge build` is clean under `deny="warnings"`
and all 42 pass on a fresh recursive clone.

**What is NOT yet real:** no transaction has been broadcast to BOT Chain testnet, so there
is **no real tx hash to record in `README.md` yet**. Per `CLAUDE.md` rule 1, none will be
invented — the README will get a real hash only once `script/Deploy.s.sol` has actually
run against the testnet.

The frontend still therefore shows placeholder chain data (see §1). `explorerUrl()` still
points at the non-resolving `.test` domain. No real hash is claimed anywhere.

**To complete this (needs a funded key — deliberately not requested in-transcript):**
The deployer key never has to touch this transcript. From a local checkout:

```bash
cd contracts
cp .env.example .env            # then edit .env:
#   PRIVATE_KEY=<your funded testnet key>   (get tBOT: https://faucet.botchain.ai/basic)
#   INITIAL_ATTESTOR=<backend attestor address>
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast -vvvv
```

The broadcast prints the deployed address + tx hash; those go into `README.md` and the
frontend/`contractClient` config. BOT Chain testnet params are live-verified in
`.env.example` (chain id 968, RPC `https://rpc.bohr.life`).

## 3. No wallet connection

`components/commitai/ConnectWalletDialog.tsx` is presentational. The address shown on
`/profile` comes from `useWalletProfile()` → `demo-data.ts`.

Per `CLAUDE.md` rule 1 this is not presented as a working connection; the dialog is
inside a `<DemoBadge />`-labelled card.

**Production fix:** step 8 — wagmi + viem + RainbowKit, SIWE for session auth.

## 4. CSRF protection was dropped in the framework migration

The pre-migration TanStack Start app had `src/start.ts` containing
`createCsrfMiddleware()` applied to server functions. Next.js App Router has no
equivalent global hook, and this step ships **no** server functions, route handlers or
mutations — so there is currently nothing to protect and no equivalent was added.

This is recorded rather than dropped silently because the intent must survive to the
step that reintroduces server-side mutations.

**Production fix:** step 3 onward. When `app/api/*/route.ts` handlers land, they need
origin checking and CSRF defence re-established at the route-handler layer, plus the
SIWE session binding from step 8. Do not add write endpoints before this is in place.

## 5. Lovable editor round-trip is broken

Accepted trade-off, confirmed with the repo owner before migrating.

`.lovable/project.json` pins template `tanstack_start_ts_current`. The app is now
Next.js App Router in a pnpm workspace, so the Lovable editor can no longer
round-trip this repo. `.lovable/` and the root `AGENTS.md` are left in place
untouched.

`AGENTS.md`'s git constraint still applies and is being honoured: **no force-push, no
rebase, no amend, no squash** of pushed commits. History here is add-only.

## 6. Formatting violations — RESOLVED

**Status: fixed.** Kept here as a record of what changed and why, not as an open item.

The migration commit (`14b8a32`) carried 57 pre-existing `prettier/prettier` errors —
all 57 predated it, in 25 of the 82 original `src/` files, which already failed the
repo's own `.prettierrc` as generated by Lovable. They were left alone at that point so
the migration diff stayed byte-for-byte auditable.

They were then fixed in a separate formatting-only commit, so the two concerns never
mixed. `pnpm lint` and `pnpm format:check` both exit 0.

Two notes for anyone auditing the migration afterwards:

- `hooks/useCommitAI.ts` is no longer byte-identical to its pre-migration state. The
  single change is `<T,>` → `<T>` on the `settle` helper — the trailing comma was only
  needed to disambiguate a generic from JSX in `.tsx`, and this is a `.ts` file. All 13
  exported signatures are untouched. The byte-identical state is preserved in `14b8a32`
  if you want to `diff` the migration itself.
- `app/goals/[goalId]/GoalDetail.tsx` gained two `{" "}` JSX expressions. Those are
  prettier _preserving_ rendered spaces across lines it wrapped, not new content.

`.prettierignore` excludes `CLAUDE.md`, `AGENTS.md` and `CommitAI-Build-Prompt.md`.
Those are content-of-record — two are auto-loaded as agent instructions and one is the
execution spec — so they are never reflowed by a formatting run. `.lovable/` is
excluded for the same reason: it belongs to an external tool.

Run `pnpm format` from the **repo root**, not from `apps/web`. Prettier resolves
`.prettierignore` relative to its cwd, so a run from the app directory would miss the
root ignore file and sweep `.next/`. `apps/web`'s own `format` script passes
`--ignore-path ../../.prettierignore` to close that trap.

## 7. Turbopack cannot build inside this PRoot sandbox

`next build` (Turbopack, the Next 16 default) fails here with
`TurbopackInternalError: Invalid symlink` while reading
`node_modules/next/dist/types.d.ts`.

This is an environment limitation, not a repo defect: the same file reads fine through
glibc (`head`, `python3`) and fails only through Rust's `statx` path, which also breaks
`ls` on that file. `next build --webpack` succeeds and produces all 12 routes.

**Fix:** none needed in the repo. On a normal Linux host the default Turbopack build
works. Use `--webpack` when building inside this sandbox.

## 8. Tooling absent for later build-sequence steps

Not installed in this build environment (no root — installs are user-local to
`~/.local/`): `forge` was installed for step 2. Still to arrange for steps 3–8:

- **PostgreSQL** (step 3): no `psql`/`docker` and no root. The schema is real Postgres and
  the initial migration SQL is generated with `prisma migrate diff` (needs no server), so
  the migration artifact is real. Applying it and running repository tests needs a live
  Postgres — set up either via the committed `docker-compose.yml`, a user-local Postgres, or
  a managed instance; `DATABASE_URL` is a `.env` placeholder. See the step-3 entry for how
  repository tests are gated when no DB is reachable.
- **Gemini API key** (steps 4–6): the `GeminiProvider` is real; live calls need
  `GEMINI_API_KEY`. Provider/tool logic is tested with an explicit in-test fake transport
  (a test double, clearly not a production code path); an end-to-end test runs against the
  live API only when the key is present.
- **Funded testnet key** (step 8): see §2.

## 9. Step 3 — Prisma schema, migration, and wallet-scoped data-access layer

**Status:** real and verified offline. Applying it to a live Postgres is gated on §8, not
on missing code.

**What exists and is real:**

- **Schema** — `apps/web/prisma/schema.prisma`: 11 models and 9 enums modelling the full
  domain, real PostgreSQL. Enum names/order for `CommitmentStatus` mirror
  `CommitmentVault.sol` so the indexer maps the on-chain `uint8` straight across.
- **Migration** — `apps/web/prisma/migrations/20260817101901_init/`, generated with
  `prisma migrate diff` (needs no running server), so the SQL artifact is real rather than
  invented. `migration_lock.toml` pins `postgresql`.
- **Client** — `@prisma/client` and the `prisma` CLI are both pinned to `6.19.3`; classic
  `prisma-client-js` generator, default output (`node_modules/.prisma/client`).
- **Repositories** — `apps/web/lib/db/repositories/{wallet,goals,checkins,evidence}.ts`,
  surfaced through `apps/web/lib/db/index.ts` (the test-only `probe.ts` is deliberately not
  re-exported).

**Wallet-scoped isolation guarantee** (build-prompt §9/§10, exercised by the integration
tests). Every user-owned query folds the authenticated `walletAddress` into its `where`
clause, and there is no code path that returns or mutates another wallet's row:

- Cross-wallet **read** → `null` / empty list. A caller cannot tell "not yours" apart from
  "does not exist".
- Cross-wallet **write** → either `updateMany` touches **0 rows** (the count is returned to
  the caller), or the parent-ownership check throws `WalletScopeError` (`createCheckIn` /
  `createEvidence` when the parent goal/check-in is not owned). At the API layer — the
  route handlers of §4, **not yet built** — `WalletScopeError` is what maps to HTTP 403.
- Deleting a `Wallet` cascades to every row it owns.

**How the tests are gated when no DB is reachable** (this is the reference §8 points at):

- **Unit tests always run, no DB required** — `lib/db/schemas.test.ts`, 14 tests over the
  Zod boundary schemas. `pnpm --filter web test` → 14 passed.
- **Integration tests are DB-gated** — `lib/db/repositories/repositories.integration.test.ts`,
  6 tests proving the cross-wallet isolation above plus cascade delete. They sit behind
  `probeDatabaseReady()` (races a `wallet.count()` against a 2 s timeout) and
  `describe.skipIf`. With no database they skip cleanly and print a SKIPPED reason with
  run instructions; the `prisma:error Can't reach database server` line that Prisma logs
  during the probe is expected, not a test failure.
- **To actually run the integration suite** (needs a live Postgres — see §8):

  ```bash
  docker compose up -d db                 # root docker-compose.yml
  pnpm --filter web db:migrate            # prisma migrate deploy → applies 20260817101901_init
  pnpm --filter web test                  # the 6 integration tests now run instead of skipping
  ```

**Deferred / honest boundaries** (CLAUDE.md rule 6 — the real interface exists now; the gap
is recorded here, not silently cut):

- **EVM address validation is format-only and lowercase-canonical.** `evmAddressSchema`
  checks `0x` + 40 hex and lowercases; it does **not** verify an EIP-55 checksum, and there
  is no signature/session binding yet. The schema comment says it "does not fake a
  checksum." Real wallet ownership (SIWE session → authenticated wallet) and true
  checksummed addresses arrive in **step 8**; `Wallet.address`'s "checksummed" doc-comment
  describes that eventual state, not today's.
- **`binaryTargets` defaults to `native`** (arm64 in this environment). A production host on
  a different libc/arch must add its target to the `generator client` block and
  re-generate. This is the reference the comment in `schema.prisma` points at.
- **The schema is ahead of the repositories, by design.** All 11 models exist, but only
  `Wallet` / `Goal` / `CheckIn` / `Evidence` have a repository this step.
  `VerificationStrategy`, `Milestone`, `VerificationRecord`, `Commitment`,
  `AccountabilityScoreLog`, `DecisionLog` and `ChainTransaction` get their data-access in the
  steps that use them (verification 4–6, chain indexing 8). Modelling the whole domain now
  is additive — so later steps need no schema-breaking migration over early data — not a
  scope cut.
- **Money-shape choices are additive too, not cuts:** wei as `Decimal(78, 0)` (the full
  uint256 range), on-chain ids as `BigInt`, and Reward modelled as a _view_ over a
  Commitment's reward leg (APPROVED + not-withdrawn ⇒ claimable) rather than a separate
  balance table. The DB is an off-chain index; deleting a row never moves funds (CLAUDE.md
  rule 2) — the contract's pull-payment model is the only path that moves value.

**No write endpoints were added.** The repositories are internal data-access only; no
`app/api/*/route.ts` handler or server mutation ships in this step, so §4's "do not add
write endpoints before this [CSRF/origin defence] is in place" is honoured.
