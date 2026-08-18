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
missing code. The one thing still gated on a **funded key** is the **live testnet deploy and
its real tx hash** — the deploy is run locally by the user (see §2 and §14); per rule 1 no hash
is invented. Steps 9–12 of `CommitAI-Build-Prompt.md` §14 are outstanding.

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

The frontend still therefore shows placeholder chain data (see §1); wiring the deployed
address into the app UI is part of step 9. The explorer helpers now resolve to
`https://scan.bohr.life` — the non-resolving `.test` domain noted here previously is fixed in
`lib/chain/botchain.ts` (`explorerTxUrl` / `explorerAddressUrl`). No real hash is claimed
anywhere. The backend contract client that will consume the deployed address is itself built
and tested now, and its live chain reads already work — see §14.

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
with printed instructions (§8). The one piece needing a funded key — the testnet **deploy + its real
tx hash** — is the user's local step (see §2); per rule 1 no hash is invented.

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

- **Live deploy + real tx hash is the user's local, funded step.** Live _reads_ work now; the
  contract-read half of `contractClient.integration.test.ts` stays skipped (with a printed
  instruction) until `COMMITMENT_VAULT_ADDRESS` points at a deployed vault. Deploy commands and the
  empty address/hash placeholders are in `README.md` → "On-chain deployment" and §2.
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
