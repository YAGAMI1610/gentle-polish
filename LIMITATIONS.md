# LIMITATIONS.md

Honest record of what is **not** yet real in this repo, per `CLAUDE.md` rules 1 and 6.
Each entry states what exists today, why, and what the production fix is.

Current build-sequence position: **steps 5–8 complete (code)** — step 8 adds the viem
`CommitmentVault` client (`apps/web/lib/chain/`), the `ChainTransaction` indexer
(`repositories/chainTx.ts`), and the chain-aware tools registered safely
(`createCommitment` / `claimReward` are **prepare-only**; `requestCompletion` /
`anchorMilestone` are **value-neutral attestor** calls), all typechecked and tested.
Live chain _reads_ already work: a real `getChainId()` against the testnet RPC returns
**968** (asserted by `contractClient.integration.test.ts`). This builds on steps 5–7 —
the remaining §4 agent tools (§11), the §6 verification engines + their tools (§12), and
the real evidence upload/storage pipeline (§13). Steps 1–4 stand as recorded: step 4 (§10,
the SDK-agnostic `AIProvider` boundary, the real `GeminiProvider`, the §7 prompt-injection
guards, the `createGoal` tool end-to-end, and the bounded agentic runner), the wallet-scoped
data layer (§9), the contract + tests (§2), and the frontend labelling (§1). Live model calls
and the DB-gated handler tests are gated on a key / a reachable Postgres (§8), not on any
missing code. The **live testnet deploy is now done**: `CommitmentVault` is deployed at
`0x0076c4269be298429af7827a2a5cc40a65f8f8a8` (deploy tx
`0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`), recorded in `README.md`, and
the live-gated vault read now runs against it and passes (see §2 and §14). **Step 9 (phases 1–2 of 4) have landed** — the SIWE + iron-session + CSRF/origin auth foundation (§4, §15) and the real read
wiring that deletes the placeholder data surface (§16); step 9 phases 3–4 and steps 10–12 of
`CommitAI-Build-Prompt.md` §14 are outstanding.

---

## 1. Frontend data — real for reads as of step 9 (phase 2); write/AI flows still UI-only

**Status:** the placeholder data surface is **gone**. This section previously documented
`IS_DEMO_DATA=true`, a `<DemoBadge />` on every screen, and a "Frontend preview…" footer;
phase 2 removed all of it. `apps/web/lib/demo-data.ts` is **deleted**, and every read screen
now renders the authenticated wallet's real Prisma data through the `/api/*` GET routes (§16).

The 11 view types moved verbatim to `apps/web/lib/types/view.ts`; `hooks/useCommitAI.ts`
re-exports them, so no component import changed. Removed with the mock surface: the
`<DemoBadge />` markers on all eight read screens (Dashboard, Goals, Goal detail, Commitments
list, Rewards, Achievements, Activity, Profile), the AppShell "Frontend preview…" footer, the
Dashboard's hardcoded hero ("Sunday, 16 August", "Three goals in motion") and its "+4 this
month" sparkline. Every placeholder `0x…0000` explorer link is gone — explorer links now
render only when a real broadcast `txHash` exists (rule 1).

**Still honestly UI-only until phase 3** (each still carries a `<UiOnlyNote>`/`<DemoBadge>` so
the state is visible, not hidden): the three action screens that need the write/AI/signing seam
— `/create` (`CreateGoal`), `/check-in` (`CheckIn`), `/verify` (`VerifyPage`) — and the
`CreateCommitmentFlow` step-through on `/commitments`, which still shows a labelled "mock
confirmation" and a `0x…0000` pattern. These are rebuilt on real flows in phase 3, when
`components/commitai/DemoBadge.tsx` is deleted. This staging is the approved plan, not a silent
gap; the residual grep hits it produces are enumerated in §16.

## 2. Smart contract: built, tested, and deployed to BOT Chain testnet

**Status:** contract + tests done and verified, and **deployed to BOT Chain testnet** —
address `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`, deploy tx
`0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`, both recorded in
`README.md`. Verified live: the backend client reads the deployed vault (see §14).

`contracts/src/CommitmentVault.sol` exists with the §8 function set, an
attestor/pull-payment trust model, `ReentrancyGuard` on every fund mover, and a
non-punitive `cancelCommitment` that returns 100% of principal to the depositor and any
reward to its funder. `contracts/test/` has 42 tests (happy path, cancel, reentrancy with
the guard proven to fire, unauthorized approve, double-claim, wrong-caller withdrawal,
rejecting-recipient atomicity, plus fuzz). `forge build` is clean under `deny="warnings"`
and all 42 pass on a fresh recursive clone.

**The deployment (real, verified against the explorer — `CLAUDE.md` rule 1):**
`CommitmentVault` is live at `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`, created in the
transaction `0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4` (block
20252821, deployer `0xae5c7bC4Cb9f54F7cf29fA988bb6E9010dD57607`). Explorer:
`https://scan.bohr.life/address/0x0076c4269be298429af7827a2a5cc40a65f8f8a8`. On-chain state
matches the source: `MAX_GRACE_PERIOD` reads `15552000` (180 days), `nextGoalId` /
`nextCommitmentId` are `1` (fresh), and the backend `contractClient` reads it live (the
integration test's vault-read now runs instead of skipping).

**Production caveat — separation of duties (opsec, not a fund-safety hole):** on this
testnet deployment the `owner`, the `attestor`, and the deployer are the **same** account
(`0xae5c…7607`). It is money-safe: neither `owner` nor `attestor` has any code path to move a
depositor's funds — the contract makes every transfer depositor-signed and pull-based
(invariant proved in `contractClient.safety.test.ts` and the Foundry suite). But collapsing
the three roles removes defence-in-depth. For production: use a distinct owner (ideally a
multisig), a separate attestor key held only by the backend, and rotate the attestor key. The
deployer/attestor key and the API keys shared during this build session appeared in chat and
**must be rotated** before any non-throwaway use.

The frontend still shows placeholder chain data (see §1); wiring the deployed address into the
app UI is part of step 9. The explorer helpers resolve to `https://scan.bohr.life` — the
non-resolving `.test` domain noted here previously is fixed in `lib/chain/botchain.ts`
(`explorerTxUrl` / `explorerAddressUrl`). The tx hash recorded above is real and
explorer-verified (rule 1). The backend contract client that consumes the deployed address is
itself built and tested, and its live chain reads work — see §14.

**How to (re)deploy your own instance (needs a funded key — never paste one in-transcript):**
From a local checkout:

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

## 3. Wallet connection — real as of step 9 (phase 1)

**Status:** real wallet connect + SIWE authentication landed (phase 1), and as of phase 2 the
`/profile` data is real too (§16). Nothing on this screen is placeholder any more.

`components/commitai/ConnectWalletDialog.tsx` and `AppShell` now render RainbowKit's
`ConnectButton`, backed by a wagmi config over the BOT Chain testnet viem chain
(`lib/wagmi/config.ts`). Signing in runs a real SIWE (EIP-4361) challenge: `GET /api/auth/nonce`
→ the wallet signs the message → `POST /api/auth/verify` performs a real offline EIP-191
signature recovery via `siwe@3` (no mock), binds the authenticated address into an encrypted
`iron-session` cookie, and clears the nonce. `hooks/useSession.ts` (`GET /api/auth/session`)
exposes the verified address; `POST /api/auth/logout` destroys the session.

**Now real as of phase 2:** the numbers on `/profile` come from `useWalletProfile()` → `GET
/api/profile`, keyed on the SIWE address and live-computed from the wallet's own rows (§16).
Signed out, `/profile` shows a connect prompt instead of spinning; the connect affordance itself
has been real since phase 1.

## 4. CSRF / origin defence and SIWE session — landed in step 9 (phase 1)

**Status: implemented.** Renamed from "CSRF protection was dropped in the framework migration"
and kept as the record that the intent survived to the step that reintroduced server-side
handlers. The first route handlers (the `/api/auth/*` set) ship in step 9 **together with** their
defence, honouring §9's rule "do not add write endpoints before this is in place":

- **SIWE session** — `lib/auth/session.ts` wraps `iron-session` (encrypted, `httpOnly`,
  `sameSite=lax`, `secure` in production, cookie `commitai_session`). `SESSION_PASSWORD` must be
  ≥32 chars with **no weak fallback** — `getSessionOptions()` throws otherwise. `requireWallet()`
  yields the authenticated lowercased address or throws `UnauthorizedError` → 401.
- **Origin / CSRF defence** — `lib/auth/origin.ts` `assertSameOrigin(req)` rejects state-changing
  requests whose `Origin` host is neither the request host nor in the
  `APP_ORIGIN`/`NEXT_PUBLIC_APP_URL` allowlist (`ForbiddenError` → 403); GET/HEAD bypass.
  `middleware.ts` applies the same check across `/api/*` as defence-in-depth, and each
  state-changing handler re-checks at the route layer.
- **Error mapping** — `lib/auth/errors.ts` `toHttpError()` maps `UnauthorizedError`→401,
  `ForbiddenError`/origin failure→403, `WalletScopeError` (`lib/db/errors.ts`)→403 with a
  **non-leaking** `{error:"forbidden"}` body, `ZodError`/bad input→400, unknown→500
  `{error:"internal error"}`.

Verified by always-on tests (no DB/network): `siwe.test.ts` (real viem-signed messages accepted;
wrong-nonce / domain-mismatch / tampered-sig / address-spoof / malformed rejected),
`origin.test.ts`, `session.test.ts` (weak-password refusal, hardened cookie options, iron-session
seal/unseal round-trip proving password-mismatch yields `{}` not a forged identity),
`errors.test.ts` (status mapping incl. the non-leak 403 and generic 500). The read endpoints
landed in phase 2 (§16); the write endpoints this protects (goals / check-ins / evidence /
commitment prepare-sign-record) land in step 9 phase 3.

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
`ls` on that file. `next build --webpack` succeeds and produces every route (the app
pages plus the step-9 `/api/auth/*` handlers and the middleware). As of step 9, `apps/web`'s
`dev` and `build` scripts pass `--webpack` explicitly so this sandbox works out of the box;
drop the flag on a normal host to use the faster default Turbopack builder.

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
- **Gemini API key** (steps 4–6): the `GeminiProvider` is real and typechecks against the
  installed `@google/genai` SDK; live calls need `GEMINI_API_KEY` (and optionally
  `GEMINI_MODEL`). The runner/tool logic is unit-tested with an explicit in-test double
  (`ScriptedProvider` — clearly not a production code path); the live end-to-end test
  (`gemini.integration.test.ts`) runs only when a key is present. See §10.
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
- **Every model now has a wallet-scoped repository.** As of step 8 all eleven do: `Wallet` /
  `Goal` / `CheckIn` / `Evidence` (step 3), `DecisionLog` (step 4), `Milestone` /
  `VerificationStrategy` / `VerificationRecord` / `Commitment` / `AccountabilityScoreLog`
  (steps 5–6), and `ChainTransaction` (step 8 — the chain indexer, see §14). `Commitment` also
  gained a **prepare-only** `createDraftCommitment` writer in step 8: it persists off-chain
  terms for pre-sign review only, with `onchainCommitmentId` / `txHash` staying null until a
  real broadcast is indexed (rule 1). Modelling the whole domain up front was additive — later
  steps needed no schema-breaking migration over early data — not a scope cut.
- **Money-shape choices are additive too, not cuts:** wei as `Decimal(78, 0)` (the full
  uint256 range), on-chain ids as `BigInt`, and Reward modelled as a _view_ over a
  Commitment's reward leg (APPROVED + not-withdrawn ⇒ claimable) rather than a separate
  balance table. The DB is an off-chain index; deleting a row never moves funds (CLAUDE.md
  rule 2) — the contract's pull-payment model is the only path that moves value.

**No write endpoints were added.** The repositories are internal data-access only; no
`app/api/*/route.ts` handler or server mutation ships in this step, so §4's "do not add
write endpoints before this [CSRF/origin defence] is in place" is honoured.

## 10. Step 4 — AI provider, prompt guards, and the createGoal tool end-to-end

**Status:** real and verified offline. `pnpm --filter web typecheck`, `pnpm --filter web lint`,
`pnpm format:check`, and the always-on tests all pass; the DB-gated and key-gated tests skip
cleanly with printed run instructions.

**What exists and is real:**

- **Vendor boundary** — `lib/ai/provider.ts` defines the SDK-agnostic `AIProvider` interface
  (a `kind`-discriminated `AIMessage` union, `ToolSpec`, `GenerateRequest`/`GenerateResult`).
  `lib/ai/gemini.ts` is the ONLY file that imports the vendor SDK, so swapping models never
  touches the tools, runner, or guards (build-prompt §1).
- **Prompt-injection defence** — `lib/ai/promptGuards.ts` implements the SYSTEM / GOAL DATA /
  EVIDENCE separation (§7): an immutable trust-boundary preamble plus delimiter neutralisation
  that stops untrusted text forging a fence to "break out". Pure and fully unit-tested
  (`promptGuards.test.ts`, always-on).
- **One tool end-to-end** — `lib/ai/tools/createGoal.ts`: Zod-revalidated arguments →
  wallet-scoped `createGoal` DB write → `logDecision` audit entry (§4/§10). Registered in
  `lib/ai/tools/registry.ts`, which fails closed on unknown tools / invalid arguments.
- **Runner** — `lib/ai/runner.ts` runs the bounded generate→dispatch→feed-back loop with a
  `maxToolRounds` cap and a final tool-less answer when the budget is spent.
- **Decision-log repository** — `lib/db/repositories/decisionLog.ts` (`logDecision` /
  `listDecisions`), wallet-scoped like every other repo; a cross-wallet goal reference throws
  `WalletScopeError`.

**Deliberate deviation — SDK choice (CLAUDE.md rule 6, not a silent cut):** the build spec
literally pins `@google/generative-ai`, but that is the frozen legacy SDK. This repo uses its
current supported replacement `@google/genai` (pinned `2.17.1`), entirely behind the
`AIProvider` boundary. Build-prompt §1 explicitly says to confirm the current model name at
build time, and nothing above `gemini.ts` can tell which SDK is underneath.

**Model + data-privacy caveat (build-prompt §9/§10):** the default model is `gemini-3.7-flash`
(current free-tier Flash, function-calling capable), overridable via `GEMINI_MODEL`. On
Google's FREE tier, prompts and responses may be used to improve Google's products. CommitAI
is privacy-focused — raw evidence lives off-chain and only hashes are anchored — so:

- the decision log stores only an evidence id / content hash in `evidenceRef`, NEVER raw
  evidence (enforced by `createDecisionInput`);
- a production deployment should use a paid tier (data excluded from training) or self-hosted
  inference, and must never send raw evidence bytes to the model. This is recorded now; the
  evidence-handling tools land in steps 6–7.

**How the tests are gated:**

- **Always run, no key or DB** — `promptGuards.test.ts` (10), the `createGoal` schema/params
  tests (2), and the runner orchestration tests (3, driven by the `ScriptedProvider` in-test
  double). These pass under `pnpm --filter web test`.
- **DB-gated** — the `createGoal` handler test and the runner end-to-end test write real rows;
  they sit behind `probeDatabaseReady()` and skip cleanly when no Postgres is reachable.
- **Key-gated** — `gemini.integration.test.ts` makes a real call to the real model and asserts
  it proposes a `createGoal` tool call; it runs only when `GEMINI_API_KEY` is set.

**No write endpoints were added.** The AI layer is internal library code; no `app/api/*` route
handler or server mutation ships in this step, so §4's rule (no write endpoints before
CSRF/origin defence + SIWE) is still honoured. The AI holds no key and has no fund-moving path
(CLAUDE.md rule 3).

## 11. Step 5 — remaining DB/AI agent tools

**Status:** real and verified offline. `pnpm --filter web typecheck` is clean and the
always-on tests pass; the DB-gated handler tests skip cleanly with printed run instructions
(§8). No fakes, no fund path.

**What exists and is real** (all clone the step-4 `createGoal` tool shape: hand-authored
JSON-Schema `parameters` + a Zod `input` schema re-validated at dispatch + a `handler` that
does a wallet-scoped DB write and a `logDecision` audit entry on any material change):

- **9 tools** in `apps/web/lib/ai/tools/`: `getWalletGoals` (read), `analyzeGoal`,
  `createMilestones`, `scheduleCheckIn`, `updateProgress`, `createVerificationStrategy`,
  `requestEvidence`, `getCommitmentStatus` (read), `calculateAccountabilityScore`. All
  registered in `registry.ts` and exported from `tools/index.ts`.
- **New wallet-scoped repositories** — `milestones.ts`, `strategy.ts`,
  `verificationRecords.ts`, `commitments.ts` (**read-only**), `scores.ts`, plus
  `goals.scheduleCheckIn` / `goals.updateGoalShaping` / `evidence.getEvidence`. `Milestone`
  and `VerificationStrategy` have no `walletAddress` column, so they are scoped through the
  parent goal relation (`goal: { walletAddress }`); the isolation guarantee of §9 holds.
- **Boundary schemas** extended in `lib/db/schemas.ts` for every new tool input.

**Honest deferrals (CLAUDE.md rules 1 & 6 — real interface now, gap recorded here):**

- **`getCommitmentStatus` is read-only and reports "no commitment" for every goal today.**
  Nothing creates a `Commitment` row this pass — creating/funding/claiming one moves real
  value and is **step 8** (the contract client + indexer). Per rule 1 no placeholder commitment
  or tx hash is invented; the tool honestly returns `exists: false`, which its handler test
  asserts. `updateProgress` records **self-reported** progress only and explicitly does **not**
  mark anything verified/completed — verification is §12, settlement is step 8.
- **`calculateAccountabilityScore` is server-computed only (§10).** The score is derived from
  the wallet's own goals/milestones/verifications/check-ins; there is no client-writable total
  the model could inflate. `computeAccountabilityScore` folds `walletAddress` into every read.

## 12. Step 6 — verification strategy / reality-check / confidence engines and tools

**Status:** real and verified offline. The engines are pure functions with always-on unit
tests; `pnpm --filter web typecheck` is clean. The DB-gated tool-handler tests skip cleanly
without a Postgres (§8). See `VERIFICATION_STRATEGIES.md` for the full behaviour.

**What exists and is real:**

- **5 pure engines** in `apps/web/lib/ai/verification/`: `strategyEngine.ts` (a category
  _registry_ — not a hardcoded switch — with built-ins for all 8 `GoalCategory` values, each
  combining ≥2 independent signals), `confidence.ts` (signals → 0–100 → status),
  `antiGaming.ts` (objective detectors), `realityCheck.ts` (verdict + non-accusatory
  reasoning + hard gates), `verificationHash.ts` (§6.5 canonical `sha256`). Each has an
  always-on `*.test.ts`.
- **5 tools**: `generateVerificationQuestions`, `evaluateAnswers`, `analyzeEvidence`,
  `runRealityCheck`, `calculateVerificationConfidence` — all registered.

**The reality-check trust model (why it is real, not a fake — CLAUDE.md rule 1):** the engine
does **not** ask the model "is this verified?" and trust the reply. The verdict is computed
deterministically from structured signals, `evidenceQuality` is derived from the objective
evidence **type** (a bare TEXT claim is pinned LOW and can never reach VERIFIED), duplicate
detection compares content **hashes**, and hard gates over objective facts
(contradiction / impossible-delta / duplicate) cannot be overridden by optimistic
model-supplied signals. This is the anti-injection guarantee, proved exhaustively and without a
DB in `tools/antiInjection.test.ts` (a LOW-evidence matrix over every other signal combination
never returns VERIFIED) and in the engine's own tests.

**Non-accusatory guarantee (§6.3):** reasoning distinguishes "cannot verify yet" from any
claim of dishonesty and never uses accusatory vocabulary; asserted by a regex in
`realityCheck.test.ts` and `antiInjection.test.ts`.

**Honest deferrals (rules 1, 3 & 6):**

- **Completion/fund tools arrived in step 8 — and still move no funds.** At step 6 these were
  deliberately not registered; **step 8** registered `requestCompletion` / `createCommitment` /
  `claimReward` (and `anchorMilestone`) _safely_: the fund-relevant ones are prepare-only and
  the attestor calls are value-neutral (see §14, proved architecturally in
  `contractClient.safety.test.ts`). `antiInjection.test.ts` was updated to assert that
  registered-but-money-safe property rather than their absence. `analyzeEvidence` writes a
  `VerificationRecord` with the canonical hash but still triggers **no** money path itself.
- **Signal extraction is intentionally shallow today.** `evaluateAnswers` uses a deterministic
  generic-answer check (it never produces a HIGH signal from free text, and never a verdict);
  richer extraction (NLP over answers, EXIF/tracker/transaction parsing to auto-derive
  plausibility & consistency) is future work. Today the conversational model supplies its read
  of `plausibility`/`consistency` as advisory signals, while `evidenceQuality` and the hard
  gates stay objective — so the shallow extraction cannot weaken the injection guarantee.
- **Evidence storage/upload is step 7.** These tools consume `Evidence` rows (and their
  `contentHash`) that already exist via the step-3 repository; the upload pipeline that creates
  them from real files is not part of this pass.

**No write endpoints were added.** Everything here is internal library code behind the same
boundaries as §10; the AI holds no key and has no fund-moving path (CLAUDE.md rule 3).

## 13. Step 7 — evidence upload/storage pipeline

**Status:** real and verified offline. The `EvidenceStorage` interface and the local-disk driver
are exercised by always-on tests against a real temp directory (no mocks); the pipeline's
wallet-scoped privacy behaviour is covered by DB-gated tests that skip cleanly without a Postgres
(§8). `pnpm --filter web typecheck` is clean.

**What exists and is real:**

- **`apps/web/lib/storage/`** — `EvidenceStorage` (the off-chain blob boundary),
  `LocalDiskEvidenceStorage` (a real `node:fs/promises` driver), and a `getEvidenceStorage()`
  factory keyed by `EVIDENCE_STORAGE_DRIVER`. Keys are **content-addressed and wallet-namespaced**
  (`wallet/<addr>/<sha256>`), so a key encodes ownership, identical bytes dedupe, and a blob for
  one wallet can never resolve into another's tree. A path-traversal guard rejects malformed keys
  before they touch disk.
- **`apps/web/lib/evidence/storeEvidence.ts`** — the pipeline: binary payloads go to
  `storage.put()`; text claims are hashed (`sha256`) and kept off-chain in the row. Both then flow
  through the step-3 `createEvidence()`, which enforces goal/check-in ownership. `readEvidenceBlob()`
  is the wallet-scoped read (returns null for "not yours", "no blob", and "absent" alike).

**Privacy + untrusted-input guarantees (rules 1, 5; §9/§10):** raw bytes/text live off-chain ONLY;
the row stores a `storageKey` + `contentHash`, and only the hash is ever eligible for on-chain
anchoring — asserted in `storeEvidence.test.ts` (the hash equals `sha256` of the exact bytes and is
never the storage pointer). `contentText` is stored byte-for-byte as opaque data; a stored
injection string produces no verification record and no side effect. Cross-wallet reads return null
and cross-wallet attaches throw `WalletScopeError`.

**Honest deferrals (rules 1 & 6):**

- **No public upload route exists yet.** This pass ships the server-side pipeline only. The HTTP
  upload handler + the wallet-connect/SIWE UI that authenticates the caller are **step 9** — write
  endpoints must not land before SIWE/CSRF are in place (see §4). The pipeline is written so that
  route becomes a thin wrapper over already-tested logic.
- **Only the local-disk driver ships.** An S3/Supabase driver is a new class behind the same
  interface plus a `switch` case in `getEvidenceStorage()` — a config change, not a pipeline change.
- **Content hardening is deferred.** MIME is checked against an allowlist and total size is capped
  (`MAX_EVIDENCE_BYTES`), but deep content-sniffing, virus scanning, and EXIF/metadata scrubbing are
  production follow-ups (step 9 / hardening), noted here rather than silently skipped.

## 14. Step 8 — contract client (viem), chain-tx indexer, and chain-aware tools

**Status:** real and verified offline, and live chain _reads_ already work. `pnpm --filter web
typecheck`, `pnpm --filter web lint`, and `pnpm format:check` are clean; the always-on chain tests
pass; the live-gated integration test performs a REAL `getChainId()` read that returns **968**
(proving the client talks to BOT Chain testnet); the DB-gated and deploy-gated tests skip cleanly
with printed instructions (§8). The testnet **deploy is now done** (§2): with
`COMMITMENT_VAULT_ADDRESS` set to the deployed vault, the contract-read half of the integration
test runs against `0x0076…f8a8` and passes (a value-neutral status read); no hash was invented.

**What exists and is real:**

- **`apps/web/lib/chain/`** — `abi.ts` (the `CommitmentVault` ABI, hand-transcribed from
  `contracts/src/CommitmentVault.sol` and parsed with viem `parseAbi`; the enum
  `COMMITMENT_STATUS` mirrors the Solidity order), `botchain.ts` (the BOT Chain testnet viem chain,
  id 968, plus `explorerTxUrl` / `explorerAddressUrl`), `config.ts` (env parsing with honest
  not-configured semantics), and `contractClient.ts` — the ONLY place backend code talks to the
  chain. It has view-only reads (`readCommitment`, `readGoal`, `readMilestones`, …), the attestor
  client, and the `prepare*` calldata encoders.
- **`apps/web/lib/db/repositories/chainTx.ts`** — the `ChainTransaction` indexer. A row is a
  **receipt**, written by `recordChainTx` only after a real broadcast returned a hash (rule 1);
  it is idempotent on the globally-unique `txHash` (a re-record fills in the block number once
  mined) and strictly wallet-scoped (another wallet can neither see nor rebind a hash).
- **Chain-aware tools** (registered in `registry.ts`): `requestCompletion` and `anchorMilestone`
  make **real, value-neutral** attestor calls when configured (they only transition state /
  anchor a hash — no funds move) and write a `ChainTransaction` receipt after broadcast;
  `createCommitment` and `claimReward` are **prepare-only** (they return unsigned calldata for the
  user's own wallet); `getCommitmentStatus` was extended with a best-effort live on-chain status
  read when configured.

**Money-safety guarantee — architectural, not merely avoided (CLAUDE.md rules 2–3):** the backend
holds only the attestor key, and `getAttestorClient()` returns a **frozen** object exposing
**exactly four** value-neutral methods — `registerMilestone`, `requestCompletion`,
`approveCompletion`, `setAttestor`. There is no `lockFunds` / `fundReward` / `releasePrincipal` /
`claimReward` / `createCommitment` / `cancelCommitment` method anywhere on it, so the backend key
literally cannot move a depositor's funds. Every value-moving action is instead a pure `prepare*`
encoder returning calldata for the DEPOSITOR's own wallet to sign in step 9, with `value` non-zero
only for the depositor's own `lockFunds` / `fundReward`. This shape is asserted in
`contractClient.safety.test.ts` so it cannot silently regress.

**No fakes (rule 1):** with no deployed contract (`COMMITMENT_VAULT_ADDRESS` unset) every write/read
path reports an honest "not configured" instead of a fabricated address or tx; the attestor client
throws "attestor not configured" without a key. No `ChainTransaction` row exists without a real
broadcast hash.

**Honest deferrals (rules 1, 3 & 6):**

- **Live deploy is done (§2) — no longer deferred.** `CommitmentVault` is deployed at
  `0x0076c4269be298429af7827a2a5cc40a65f8f8a8` (deploy tx
  `0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`, recorded in `README.md`).
  With `COMMITMENT_VAULT_ADDRESS` set, the contract-read half of
  `contractClient.integration.test.ts` runs against the deployed vault and passes.
- **`createCommitment` / `claimReward` are prepare-only pending the step-9 wallet.** The contract
  requires the depositor's own `msg.sender`, so these (and `registerGoal` / `lockFunds` /
  `fundReward` / `releasePrincipal` / `cancelCommitment`) are returned as calldata for the user to
  sign — the backend has no signer for them. The step-9 wallet-connect UI is what will broadcast
  them.
- **The ABI is hand-transcribed** (no compiled Foundry artifact ships in the web package). To make
  drift from the Solidity source fail locally rather than on-chain, `abi.test.ts` recomputes every
  checked selector from its canonical signature and round-trips `encode`→`decode`.
- **No historical event backfill / sync loop yet.** `recordChainTx` indexes a transaction at the
  moment the backend broadcasts it; reconstructing state by replaying past chain events is future
  work (it belongs with the step-9 read path), noted here rather than silently omitted.

**How the tests are gated:**

- **Always run, no key / DB / network** — `abi.test.ts`, `botchain.test.ts`, `config.test.ts`, and
  `contractClient.safety.test.ts` (the money-safety proof), plus the schema/params + always-on
  unconfigured cases of the tool tests.
- **Live-gated** — `contractClient.integration.test.ts` dials the RPC; when reachable it asserts the
  real chain id is 968, and the deployed-vault read runs once `COMMITMENT_VAULT_ADDRESS` is set.
- **DB-gated** — the handler tests for `createCommitment` / `claimReward` / `requestCompletion` and
  the `chainTx` indexer tests write real rows and skip cleanly without a Postgres (§8). None of them
  broadcast: the `requestCompletion` DB test proves the honest no-commitment early-out records no
  receipt.

**No write endpoints were added.** The chain client and indexer are internal library code; no
`app/api/*` route handler ships here, so §4's rule (no write endpoints before CSRF/origin defence +
SIWE) is still honoured. The AI holds no key and has no fund-moving path (rule 3).

## 15. Step 9 (phase 1) — wallet auth foundation (SIWE + iron-session + CSRF/origin)

**Status:** real and verified in-sandbox, and the boundary every later route depends on. `pnpm
--filter web typecheck`, `lint`, and `pnpm format:check` are clean; the always-on auth tests pass
(SIWE with real EIP-191 crypto, origin/CSRF, iron-session seal/unseal, HTTP error mapping); `pnpm
--filter web build` compiles all four `/api/auth/*` routes and the middleware (exit 0). This is
**phase 1 of 4** for build step 9; phases 2–4 are outstanding (see the tail of this entry).

**What exists and is real:**

- **Server auth** — `lib/auth/{session,session-core,siwe,origin,errors}.ts`. `session-core.ts` is
  pure (no `next/headers`) so it unit-tests without a request; `session.ts` binds it to Next 16's
  async `cookies()` at a single documented boundary cast. SIWE verification is a real offline
  EIP-191 signature recovery via `siwe@3` (no mock), bound to a server-issued single-use nonce and
  the request domain (anti-replay, anti-domain-swap). Details of the session/CSRF/error surface are
  in §3 and §4.
- **Auth routes** — `app/api/auth/{nonce,verify,session,logout}/route.ts`: issue nonce → verify
  signature + `ensureWallet()` and bind the address → expose the session address → destroy.
  `verify`/`logout` call `assertSameOrigin` and funnel every throw through `toHttpError`.
- **Middleware** — `middleware.ts` runs the same-origin check on `/api/*` (defence-in-depth; each
  handler re-checks). Next 16 prints a "middleware → proxy" deprecation notice; it is a rename
  advisory only and does not affect behaviour.
- **Client wiring** — `app/providers.tsx` nests `WagmiProvider` → `QueryClientProvider` →
  RainbowKit's `AuthenticationProvider` with a `createAuthenticationAdapter` driving the
  `/api/auth/*` endpoints (iron-session, **not** next-auth). wagmi config (`lib/wagmi/config.ts`)
  reuses the prebuilt BOT Chain testnet viem chain from `lib/chain/botchain.ts`.
  `hooks/useSession.ts` exposes the authenticated address that the phase-2 hooks will key on.
- **Env** — `SESSION_PASSWORD` (secret, ≥32 chars), `APP_ORIGIN`, `NEXT_PUBLIC_APP_URL` added to
  `.env`/`.env.example`. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` already present. `SESSION_PASSWORD`
  must be set to a real ≥32-char secret before running; the app refuses to start otherwise (no weak
  fallback — §4).

**Money-safety (rules 2–3):** this phase adds authentication only. No route moves funds and no
signer is instantiated anywhere. The fund flows (prepare-only calldata for the user's own wallet to
sign) are phase 3; the architectural "AI/backend has no fund-moving signer" proof is phase 4
(build step 10, §13).

**Build note — unused Coinbase x402 peer deps stubbed (rule 6, not a silent cut):** RainbowKit's
Base Account connector transitively pulls `@coinbase/cdp-sdk`, which declares
`@x402/{core,evm,extensions,svm}` (Coinbase's x402 payment protocol) as **peer** dependencies.
CommitAI never uses x402 — it uses standard EVM wallets on BOT Chain — so those packages are neither
installed nor reached at runtime. Left unresolved they abort the bundle ("Module not found: Can't
resolve '@x402/evm'"); `next.config.ts` aliases all four to an empty module
(`lib/stubs/x402-peer-stub.ts`) for both the webpack and Turbopack resolvers. Production fix if
x402 is ever actually wanted: install the four packages instead of stubbing them.

**Known-benign build warnings (warnings, not errors — the build exits 0):** the webpack build
prints optional-dependency warnings from the wallet stack — `@metamask/sdk` →
`@react-native-async-storage/async-storage` (a React-Native-only backend), `pino` → `pino-pretty`
(WalletConnect's optional dev log formatter), plus a Next-internal `process.cwd` Edge-Runtime
advisory from `dynamic-rendering.js`. None are our code and none affect functionality. They are
left in place rather than silenced by aliasing them away, because their runtime fallback behaviour
can't be verified in this browserless sandbox and silencing an unverifiable warning in a
money-handling app is the worse trade.

**Outstanding (the approved 4-phase plan):** phase 2 is now done — it wired the GET read routes +
serializers and **deleted `lib/demo-data.ts`**, retiring the placeholder surface of §1 (see §16);
phase 3 adds the write/AI/prepare-sign-record flows; phase 4 is the §13 security-test suite (build
step 10). The step-9 "no mock data left anywhere" grep gate is fully satisfied at the end of phase
3 — after phase 2 the only residual source hits are the labelled `CreateCommitmentFlow` "mock
confirmation" (owned by phase 3) and rule-1 honesty comments in `lib/**` (each a "no fake" / "not
configured" guarantee, not a fake), enumerated in §16.

## 16. Step 9 (phase 2) — read wiring: real backend reads, placeholder surface deleted

**Status:** real and verified in-sandbox. `pnpm --filter web typecheck`, `lint`, and `pnpm
format:check` are clean; the always-on serializer unit tests pass; `pnpm --filter web build`
(`--webpack`, §7) compiles all eight read routes (exit 0). Every read screen now renders the
authenticated wallet's real Prisma data — `lib/demo-data.ts` is deleted (§1). This is **phase 2 of
4** for build step 9; phases 3–4 (write/AI/signing, then the §13 security suite) are outstanding.

**What exists and is real:**

- **View types** — `lib/types/view.ts` holds the 11 UI view types (moved verbatim out of the
  deleted `demo-data.ts`); `hooks/useCommitAI.ts` re-exports them so no component import changed.
- **Serializers** — `lib/api/serializers.ts`: pure, side-effect-free Prisma→view mappers,
  exhaustively unit-tested (`serializers.test.ts`). Full-enum `Record` maps (a new enum member is a
  compile error, not a silent passthrough), wei `Decimal(78,0)`→token-number conversion, the Reward
  view over a commitment's reward leg, the `DecisionLog`+`ChainTransaction` activity merge
  (newest-first), the consecutive-week check-in streak, and the derived achievement list.
- **Loaders** — `lib/api/loaders.ts`: the impure composition that fetches the related rows a full
  view needs, all through the existing wallet-scoped repositories (§9).
- **Read routes** (GET, all `dynamic = "force-dynamic"`, all `requireWallet()`-scoped) —
  `app/api/{goals, goals/[goalId], commitments, commitments/[id], rewards, achievements, activity,
profile}/route.ts`. Each resolves the SIWE wallet, calls a loader, and funnels any throw through
  `toHttpError`. A missing or cross-wallet detail row returns **404** (non-leak — you cannot tell
  "not yours" from "does not exist"); no SIWE session → **401**.
- **Fetch client + hooks** — `lib/api/client.ts` `apiGet<T>` sends the session cookie
  (`credentials:"include"`) and throws a typed `ApiError` carrying the status. The eight React Query
  hooks are keyed on the `useSession()` address with `enabled: Boolean(address)`, so a query only
  runs once a wallet has signed in; detail hooks turn a 404 into `undefined`. `GoalDetail` and
  `ProfilePage` now distinguish signed-out (connect prompt) / loading / not-found instead of an
  infinite "Loading…".

**No fakes — derived, not fabricated (rule 1):**

- **Achievements are derived from real counts**, never stored `earned` flags: `deriveAchievements`
  is a live function of the wallet's check-ins / verified milestones / on-chain commitments /
  completed goals / streak weeks. No `earnedAt` is fabricated — the crossing moment is not
  persisted, so the optional timestamp is simply omitted and the UI shows "Earned" without a date.
- **Rewards are a view over the commitment reward leg** (APPROVED + not-withdrawn ⇒ claimable,
  `rewardWithdrawn` ⇒ claimed), not a balance table (§9). `earnedAt`/`claimedAt` derive from the
  commitment's `updatedAt` — the only real timestamp available without a dedicated column.
- **Explorer links render only for a real broadcast `txHash`.** `toCommitmentView` sets `txHash` to
  `""` until a real hash is indexed; every screen guards on it, so no placeholder `0x…0000` link is
  ever shown.

**Grep-gate state after this phase** (`grep -rn "mock\|fake\|TODO: real\|hardcoded\|demo-data\|
example-botchain" apps/web`, excluding `node_modules`/tests): `demo-data` and `example-botchain` are
**gone** from source. The remaining hits are all justified: the labelled `CreateCommitmentFlow`
"mock confirmation" on `/commitments` (UI-only, owned by phase 3 — §1), and rule-1 honesty comments
in `lib/**` that use the words "fake"/"mock"/"hardcoded" only to state the code does **not** do that
(e.g. "no fake tx", "not a hardcoded switch", "a real cryptographic check (no mock)").

**Honest deferrals (rules 1 & 6 — real interface now, gap recorded here):**

- **The loaders do per-goal follow-up reads (N+1).** `loadGoalViews` fetches milestones /
  verifications / strategy / commitment per goal rather than in one batched query. It is correct and
  wallet-scoped, but not optimised; batching (a single grouped query or a DataLoader) is a
  performance follow-up, noted rather than silently shipped as "fine". At demo scale it is
  immaterial.
- **No dedicated achievements-catalog table.** Thresholds live in `deriveAchievements`; a catalog
  table with per-achievement metadata and a persisted earned-at is deferred (the derivation is
  real).
- **Cross-wallet non-leak is proven at the serializer/repository layer** (§9) and enforced by the
  wallet-scoped repositories the loaders call. End-to-end HTTP-boundary tests (A's session reading
  B's row → 404) are the **phase 4 / step 10** §13 suite; they are DB-gated (§8).
- **Write/AI screens stay UI-only until phase 3** — see §1.
