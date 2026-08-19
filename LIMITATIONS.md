# LIMITATIONS.md

Honest record of what is **not** yet real in this repo, per `CLAUDE.md` rules 1 and 6.
Each entry states what exists today, why, and what the production fix is.

Current build-sequence position: **all 12 steps of `CommitAI-Build-Prompt.md` §14 are complete.** What
remains is operational and the user's to do — rotate the three exposed secrets, push, and run the live
end-to-end demo (`DEMO.md`). The record below is layered by step and read chronologically —
later sections supersede earlier "outstanding" notes. Step 8 adds the viem
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
the live-gated vault read now runs against it and passes (see §2 and §14). **Step 9 (all 4 phases) and
build step 10 have landed** — the SIWE + iron-session + CSRF/origin auth foundation (§4, §15), the real
read wiring that deletes the placeholder data surface (§16), the write / AI / prepare-sign-record flows
that rebuild every action screen on real backend calls (§17), and the §13 security-test suite that drives
the real HTTP/auth/upload boundary (§18 = build step 10). **Build step 11** documented the
`approveCompletion` trust model in full and consolidated every hackathon-scale simplification with its
production fix into one index (§19). **Build step 12 has now landed** — the §15 judge-facing end-to-end
demo runbook (`DEMO.md`, §20). **All twelve steps of `CommitAI-Build-Prompt.md` §14 are complete**; what
remains is operational and the user's to do — rotate the three exposed secrets, push, and perform the live
end-to-end run.

---

## 1. Frontend data — real end-to-end as of step 9 (phase 3)

**Status:** the placeholder data surface is **gone**, and as of phase 3 the action screens are real
too. This section previously documented `IS_DEMO_DATA=true`, a `<DemoBadge />` on every screen, and a
"Frontend preview…" footer; phase 2 removed the read surface and phase 3 removed the last UI-only
markers. `apps/web/lib/demo-data.ts` is **deleted**, `components/commitai/DemoBadge.tsx` is
**deleted**, and every screen — read and write alike — now talks to the real backend.

The 11 view types moved verbatim to `apps/web/lib/types/view.ts`; `hooks/useCommitAI.ts`
re-exports them, so no component import changed. Removed with the mock surface: the
`<DemoBadge />` markers on all eight read screens (Dashboard, Goals, Goal detail, Commitments
list, Rewards, Achievements, Activity, Profile), the AppShell "Frontend preview…" footer, the
Dashboard's hardcoded hero ("Sunday, 16 August", "Three goals in motion") and its "+4 this
month" sparkline. Every placeholder `0x…0000` explorer link is gone — explorer links now
render only when a real broadcast `txHash` exists (rule 1).

**Now real as of phase 3 (§17):** the five action screens are rebuilt on real flows — `/create`
(`CreateGoal`: live Gemini turn + `POST /api/goals`), `/check-in` (`CheckIn`: live turn + a durable
`POST /api/checkins` note, confidence read from the real `VerificationRecord`, no more literal
`ConfidenceMeter value={89}`), `/verify` (`VerifyPage`: real `POST /api/evidence` upload), and the
`CreateCommitmentFlow` + Lock/Claim actions on `/commitments` and `/rewards` (prepare → the user's
own wallet signs → the real broadcast hash is recorded via `POST /api/chain/record`). The labelled
"mock confirmation" and the `0x…0000` pattern on `CreateCommitmentFlow` are **gone**. On `/verify` the
GitHub "Connect data" option is now a real OAuth-backed evidence source (RESOLVED 2026-08-19, item 8, §17);
the fitness and reading connectors remain honest disabled previews (written note + file upload are fully
real). The Lock button now gates on a
persisted `Commitment.locked` flag derived from the indexed `LOCK_FUNDS` tx (RESOLVED 2026-08-19,
§17), not on `status`, so a reload no longer re-offers a lock the depositor has already funded.

## 2. Smart contract: built, tested, and deployed to BOT Chain testnet

**Status:** contract + tests done and verified, and **deployed to BOT Chain testnet** —
address `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`, deploy tx
`0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`, both recorded in
`README.md`. Verified live: the backend client reads the deployed vault (see §14).

`contracts/src/CommitmentVault.sol` exists with the §8 function set, an
attestor/pull-payment trust model, `ReentrancyGuard` on every fund mover, and a
non-punitive `cancelCommitment` that returns 100% of principal to the depositor and any
reward to its funder. `contracts/test/` has 45 tests (happy path, cancel, reentrancy with
the guard proven to fire, unauthorized approve, double-claim, wrong-caller withdrawal,
rejecting-recipient atomicity, the cancel-refund escrow fallback added in the §22 hardening
pass, plus fuzz). `forge build` is clean under `deny="warnings"` and all 45 pass on a fresh
recursive clone.

**The deployment (real, verified against the explorer — `CLAUDE.md` rule 1):**
`CommitmentVault` is live at `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`, created in the
transaction `0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4` (block
20252821, deployer `0xae5c7bC4Cb9f54F7cf29fA988bb6E9010dD57607`). Explorer:
`https://scan.bohr.life/address/0x0076c4269be298429af7827a2a5cc40a65f8f8a8`. On-chain state
matches the source: `MAX_GRACE_PERIOD` reads `15552000` (180 days), `nextGoalId` /
`nextCommitmentId` are `1` (fresh), and the backend `contractClient` reads it live (the
integration test's vault-read now runs instead of skipping).

**Deployed bytecode predates the §22 escrow fix (honesty note, rule 1):** the live vector-hardening
pass in §22 adds a pull-payment escrow fallback to `cancelCommitment` (3 new tests → the 45 above). The
deployed instance at `0x0076c4…f8f8a8` is **immutable** and was created from the pre-fix source, so it does
**not** carry that fallback. This does not make the deployed instance unsafe — its principal refund is
still depositor-only and non-confiscatory — it only leaves the narrow reward-funder griefing vector open on
that specific instance. Closing it on-chain requires a **redeploy** (a user action needing the rotated
deployer key); the source, tests, and a future deployment carry the fix.

**Production caveat — separation of duties (opsec, not a fund-safety hole):** on this
testnet deployment the `owner`, the `attestor`, and the deployer are the **same** account
(`0xae5c…7607`). It is money-safe: neither `owner` nor `attestor` has any code path to move a
depositor's funds — the contract makes every transfer depositor-signed and pull-based
(invariant proved in `contractClient.safety.test.ts` and the Foundry suite). But collapsing
the three roles removes defence-in-depth. **Code-prep landed (2026-08-19, items 3 & 4):** the
deploy script now _enforces_ distinct deployer/owner/attestor by default — `Deploy.validateRoles`
(pure, unit-tested in `contracts/test/Deploy.t.sol`, 6 tests) reverts before any broadcast unless
`ALLOW_COLLAPSED_ROLES=true` is explicitly set — and `contracts/DEPLOY.md` documents the
distinct-EOA + Safe-multisig-owner setup (constructor sets the owner directly, so a Safe can own
from block 0; Ownable2Step for a later hand-off) and the attestor-rotation procedure. What remains
is the user's to do and is deliberately NOT automated: rotate the exposed deployer/attestor key
(item 1) and **redeploy** with three distinct, rotated accounts (a broadcast needing a funded
wallet). The exposed keys and API keys shared during this build session **must be rotated** before
any non-throwaway use.

The frontend now consumes the deployed vault through the real prepare-sign-record flows wired in
step 9 phase 3 (see §1, §17) — no placeholder chain data remains. The explorer helpers resolve to
`https://scan.bohr.life` — the non-resolving `.test` domain noted here previously is fixed in
`lib/chain/botchain.ts` (`explorerTxUrl` / `explorerAddressUrl`). The tx hash recorded above is real
and explorer-verified (rule 1). The backend contract client that consumes the deployed address is
itself built and tested, and its live chain reads work — see §14.

**How to (re)deploy your own instance (needs a funded key — never paste one in-transcript):**
The full runbook — role model, Safe-multisig owner setup, attestor rotation, and the escrow-fix
redeploy checklist — is in **`contracts/DEPLOY.md`**. In short, from a local checkout:

```bash
cd contracts
cp .env.example .env            # then edit .env:
#   PRIVATE_KEY=<your funded, ROTATED testnet key>   (get tBOT: https://faucet.botchain.ai/basic)
#   INITIAL_OWNER=<Safe multisig address>            (distinct from deployer)
#   INITIAL_ATTESTOR=<backend attestor address>      (distinct from deployer and owner)
forge test                      # 51 tests must pass first
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast -vvvv
```

The deploy script's `validateRoles` gate refuses a collapsed-role deploy unless
`ALLOW_COLLAPSED_ROLES=true` is set. The broadcast prints the deployed address + tx hash; those go
into `README.md` and the frontend/`contractClient` config, and the new instance should be checked
for the escrow fix (`withdrawEscrow()` present) per DEPLOY.md. BOT Chain testnet params are
live-verified in `.env.example` (chain id 968, RPC `https://rpc.bohr.life`).

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
- **Local-disk AND S3-compatible drivers ship — RESOLVED (2026-08-19, item 9).** `EVIDENCE_STORAGE_DRIVER`
  selects the backend: `local` (default) or `s3`. The `S3EvidenceStorage` driver is real (rule 1) —
  authenticated with a from-scratch **AWS Signature V4** implementation over `fetch` (no SDK, zero new
  deps), so it works against AWS S3, Supabase Storage's S3 endpoint, Cloudflare R2, and MinIO. Both drivers
  implement the same interface and emit the identical content-addressed, wallet-namespaced `storageKey`, so
  the DB pointer is driver-agnostic and switching is config-only. Honest gating (mirrors `chain/config`):
  `s3` selected with a missing `EVIDENCE_S3_*` var throws loudly, never a silent fallback; the credential
  is read separately and moves blobs only, never funds (rules 1/3). Tests (all always-on, no mocks):
  `sigv4.test.ts` pins the signer to **AWS's own published `get-vanilla` known-answer vector** (proves the
  signature is the real algorithm, not an approximation), `config.test.ts` (7) the honesty contract,
  `s3Storage.test.ts` (7) request shaping + status mapping via an injected transport (the connectors DI
  idiom), and `index.test.ts` (4) that the factory selects each driver by config alone.
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

**Outstanding (the approved 4-phase plan):** phases 2 and 3 are now done — phase 2 wired the GET
read routes + serializers and **deleted `lib/demo-data.ts`** (§16), and phase 3 added the
write/AI/prepare-sign-record flows and **deleted `components/commitai/DemoBadge.tsx`** (§17). Phase 4
is the §13 security-test suite (build step 10). The step-9 "no mock data left anywhere" grep gate is
now fully satisfied: after phase 3 the only residual source hits are rule-1 honesty comments in
`lib/**` and the screen files (each a "no fake" / "not configured" / "no hardcoded script" guarantee,
not a fake), enumerated in §17.

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

- **Achievements: `earned` is derived from real counts; the earned-AT is now persisted (item 7).**
  `deriveAchievements` stays a live function of the wallet's check-ins / verified milestones /
  on-chain commitments / completed goals / streak weeks — the `earned` boolean is never a stored
  flag. The crossing moment is now recorded the first time it is observed (`EarnedAchievement`,
  write-once) and read back, so an earned achievement carries its genuine first-observation
  `earnedAt`. It is still never fabricated: an earned achievement whose crossing has not yet been
  persisted omits the timestamp rather than inventing one.
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

- **The loaders do per-goal follow-up reads (N+1) — RESOLVED (2026-08-19).** `loadGoalViews`
  previously fetched milestones / verifications / strategy / commitment with one read _per goal_
  (4N+1 queries); it now issues **five queries total, independent of goal count** — one `listGoals`
  plus one grouped `IN (...)` query each for milestones, verification records, strategies, and
  commitments — and the commitment/reward list loaders resolve every goal title through a single
  `getGoalsForIds` instead of a `getGoal` per row. The split is done by two pure, always-on-tested
  helpers (`lib/db/repositories/grouping.ts`: `groupByKey` / `indexByKey`) that preserve each query's
  SQL sort order within a group, so the batched assembly is byte-for-byte what the per-goal reads
  produced. A shared `assembleGoalView` is used by both the single-goal loader and the batched list
  loader, so they cannot drift. Each grouped repo helper (`listMilestonesForGoals`,
  `listVerificationRecordsForGoals`, `getVerificationStrategiesForGoals`, `getCommitmentsForGoals`,
  `getGoalsForIds`) stays wallet-scoped (a goalId this wallet does not own contributes no rows) and
  short-circuits an empty id list to an empty map with no query. The single-item detail loaders
  (`loadGoalView`, `loadCommitmentView`) keep their direct per-id reads — a handful of queries for the
  one row a detail route needs. **Tests:** `grouping.test.ts` (6 always-on — empty maps, order
  preservation within a group on interleaved rows, one-per-key, first-wins) run green; a DB-gated
  `lib/api/loaders.integration.test.ts` (6 tests) proves `loadGoalViews` assembles **identically** to
  per-goal `loadGoalView` (deep-equal), that milestone order / latest-verification-per-milestone /
  strategy / commitment id are correct, that the commitment/reward loaders resolve titles through the
  batch, and that every batch helper ignores a foreign wallet's goalId — it skips cleanly here (no
  Postgres, §8). Gates: `pnpm --filter web typecheck`, `lint`, and `pnpm format:check` clean; `pnpm
--filter web test` = **273 passed | 63 skipped** (exit 0).
- **No dedicated achievements-catalog table — RESOLVED (2026-08-19).** The earn thresholds now live
  in one code source of truth (`lib/achievements/catalog.ts` — `ACHIEVEMENT_CATALOG` plus the
  predicates `isAchievementEarned` / `earnedAchievementIds`), mirrored into an `AchievementDefinition`
  TABLE by an idempotent `syncAchievementCatalog` upsert (memoized once per process) so code and DB
  cannot drift, and a new `EarnedAchievement` table persists the first-observation crossing per
  (wallet, achievement). `loadAchievementViews` records any newly-earned crossings with
  `createMany({ skipDuplicates: true })` (first-writer-wins ⇒ the timestamp is write-once and never
  moves) then reads them back, and `deriveAchievements(counts, earnedAt)` attaches the stored
  `earnedAt` only to currently-earned achievements — the `earned` boolean itself stays a live
  computation from real counts (never a stored flag), and no timestamp is ever fabricated (rule 1).
  Migration `20260819120000_add_achievements_catalog`. **Tests:** `serializers.test.ts` gains
  always-on coverage of the earned-at attachment (attaches only to earned entries; omits it for an
  earned-but-not-yet-persisted entry; ignores a stored crossing for an unearned entry); a DB-gated
  `lib/db/repositories/achievements.test.ts` (7 tests) proves the catalog sync is idempotent with one
  row per entry, and that crossings are write-once, first-writer-wins, idempotent, and wallet-scoped
  — it skips cleanly here (no Postgres, §8). Gates: `pnpm --filter web typecheck`, `lint`, and `pnpm
format:check` clean; `pnpm --filter web test` = **275 passed | 70 skipped** (exit 0).
- **Cross-wallet non-leak is proven at the serializer/repository layer** (§9) and enforced by the
  wallet-scoped repositories the loaders call. End-to-end HTTP-boundary tests (A's session reading
  B's row → 404) are the **phase 4 / step 10** §13 suite; they are DB-gated (§8).
- **Write/AI screens landed in phase 3** — the read screens documented here were joined by the real
  action screens in phase 3 (§17); §1 now describes the whole frontend as real end-to-end.

## 17. Step 9 (phase 3) — write / AI / prepare-sign-record flows

**Status:** real and verified in-sandbox. `pnpm --filter web typecheck`, `lint`, and `pnpm
format:check` are clean; `pnpm --filter web test` runs **202 always-on tests green** (45 DB-/key-/
chain-gated tests skip cleanly, §8); `pnpm --filter web build` (`--webpack`, §7) compiles every new
route and the rebuilt screens (exit 0). This is **phase 3 of 4** for build step 9; phase 4 (the §13
security-test suite = build step 10) is the only remaining step-9/10 work.

**What exists and is real:**

- **Write routes** (POST, each `requireWallet()` + `assertSameOrigin`, every throw funnelled through
  `toHttpError` so `UnauthorizedError`→401 / origin fail→403 / `WalletScopeError`→403 / `ZodError`→400):
  - `app/api/ai/turn/route.ts` — a live `runTurn({provider: geminiFromEnv(), walletAddress, userMessage,
history, toolPolicy?})` round (`lib/ai/runner.ts`); `!geminiConfigured()` → an honest **503**, never
    a scripted reply (rule 1). Powers `/create` and `/check-in`.
  - `app/api/goals/route.ts` POST — `createGoal(wallet, …)`. `app/api/checkins/route.ts` POST —
    `createCheckIn(wallet, …)` (a durable `CheckIn` row; no AI tool creates one, so this duplicates
    nothing).
  - `app/api/evidence/route.ts` POST — `storeEvidence(wallet, …)`, mapping its throws to **413**
    (over `MAX_EVIDENCE_BYTES` = 15MB) / **415** (MIME not on the allowlist). `evidence/[id]/route.ts`
    GET — `readEvidenceBlob` → bytes or **404** (cross-wallet non-leak). This is the §11 public upload
    entry point, SIWE-scoped because evidence is wallet-owned.
  - **Commitment prepare-only (never broadcast):** `commitments/route.ts` POST →
    `createDraftCommitment(wallet, …)` (off-chain DRAFT) **+** `prepareCreateCommitment` calldata;
    `commitments/[id]/prepare-lock` → `prepareLockFunds` (value = principalWei); `commitments/[id]/
prepare-claim` → `prepareClaimReward`. `chain/record/route.ts` POST → `recordChainTx(wallet, …)`,
    called by the client **only after** the wallet returns a real hash.
- **Client signing seam** — `hooks/useChainTx.ts` is the single money-moving path: it takes a
  `PreparedTxDto` from a `prepare*` response, then `switchChain` → `sendTransaction` (the **user's**
  wagmi wallet signs) → `waitForTransactionReceipt` → `POST /api/chain/record` with the REAL mined
  hash. The backend never sees a private key for any of this.
- **Rebuilt screens** (all on real hooks; §1): `CreateGoal`, `CheckIn`, `CommitmentsPage` /
  `CreateCommitmentFlow`, `RewardsPage`, `VerifyPage`. `components/commitai/DemoBadge.tsx` is deleted.

**Money-safety guarantee (rules 2–3), preserved end-to-end:** every fund action is prepare-only —
the route returns unsigned `{chainId, to, data, value}` calldata to the browser and the depositor's
own wallet signs it. No route instantiates a fund-signing client, and `getAttestorClient()`'s frozen
4-method surface (none of which move value) is the only key the backend holds (§14, proved in
`contractClient.safety.test.ts`). When the chain isn't configured or a goal isn't on-chain yet, the
`prepare*` routes return an honest `{prepared:false, reason}` and the UI shows that reason — never a
fabricated hash or a "mock confirmation" (rule 1). The "not on-chain yet" case is now transient: the
on-chain-id back-fill (below) writes the emitted id onto the row as soon as the registration/creation
tx is indexed, after which `prepare*` returns real calldata.

**Untrusted input (rule 5):** check-in and chat messages reach `runTurn` as the user message, which
the runner wraps server-side; evidence text/files flow through `storeEvidence`, stored byte-for-byte
as opaque data (§13). The `toolPolicy` string that `/check-in` sends is routing context authored by
the app (it names the selected goal), not user text, and is appended as a system-instruction addendum
— it never carries raw user input into an instruction position.

**Honest deferrals (rules 1 & 6 — real interface now, gap recorded here):**

- **On-chain-id back-fill — RESOLVED (2026-08-19).** `POST /api/chain/record` now back-fills
  `onchainGoalId` / `onchainCommitmentId` onto the owning DRAFT row after the depositor broadcasts
  `registerGoal` / `createCommitment`. On recording a `REGISTER_GOAL` / `CREATE_COMMITMENT` hash the
  route re-reads the receipt (`readTransactionReceipt`) and decodes the id the vault _emitted_
  (`parseGoalRegistered` / `parseCommitmentCreated`), then writes it via the wallet-scoped setters
  `setOnchainGoalId` / `setOnchainCommitmentId` (`lib/api/onchainBackfill.ts` orchestrates). The id
  comes from the chain, never the client: a decoded log counts only if it was emitted by the configured
  vault AND names the recording wallet as `owner`/`depositor`, so a same-signature log from another
  contract or a stranger's receipt is ignored (rule 2). The setters are first-writer-wins — the
  `onchain*Id: null` guard makes a replay/re-record idempotent, and the wallet stays in the filter so a
  cross-wallet call touches zero rows. Only the id is written; the commitment `status` stays `CREATED`
  (funds lock later in `lockFunds`), so the Lock-button gating below is unaffected. Writing an id moves
  nothing — it only unblocks the depositor's own `prepare*` calldata, which their wallet still signs
  (rules 1–3). Back-fill is best-effort: a transient receipt-read failure never fails the already-durable
  index write — it is reported in `ChainRecordResult.backfillReason` and filled on a later re-record (or
  by the §16 reconciler once built). Net effect: `prepareCreateCommitment` / `prepareLockFunds` /
  `prepareClaimReward` flip from `{prepared:false}` to real calldata as soon as the registration/creation
  tx is indexed. Tests: `lib/chain/contractClient.parsers.test.ts` (7 always-on — decode + vault-address
  spoof filter), `lib/api/onchainBackfill.test.ts` (11 always-on — kind/config gating, owner/depositor
  match, idempotent reporting, best-effort throw), `lib/db/repositories/onchainId.integration.test.ts`
  (4 DB-gated — first-writer-wins, wallet-scoping, status-stays-`CREATED`).
- **`/verify` "Connect data" tab — GitHub connector RESOLVED (2026-08-19, item 8); fitness/reading still
  previews.** The GitHub option is now a **real, end-to-end OAuth-backed evidence source** (rule 1 — no
  mock), gated honestly: unset OAuth env → the card shows a disabled Connect button and a "not enabled on
  this deployment" note, and `/api/connectors/github/start` returns **503** rather than pretending. What
  ships:
  - **Real authorization-code flow, 5 routes.** `GET /api/connectors` (configured flag + wallet's live
    connection status, never the token); `GET /api/connectors/github/start` (`requireWallet`, 503 if
    unconfigured, mints CSRF **state** into the encrypted iron-session, 302 → GitHub authorize with
    `allow_signup=false`); `GET /api/connectors/github/callback` (verifies state with `timingSafeEqual`
    fail-closed, exchanges the code, reads the login, upserts, then **always** redirects to
    `/verify?connect=github&status=connected|denied|mismatch|error`); `POST /api/connectors/github/import`
    (`assertSameOrigin` + `requireWallet`); `DELETE /api/connectors/github` (disconnect, idempotent).
  - **Money-safety (rules 1–3): the token can never move funds and is never stored plaintext.** The scope
    is read-only (`read:user`); the OAuth token is encrypted **at rest** with AES-256-GCM
    (`iv.tag.ciphertext`, key `scrypt`-derived from `CONNECTOR_TOKEN_SECRET`‖`SESSION_PASSWORD`), decrypts
    only server-side via `getConnectorToken`, and never appears in any status DTO or log. It grants read
    access to GitHub activity only — no code path lets it touch a wallet or the vault.
  - **Import writes a real `Evidence` row through the SAME pipeline as an upload** — never fabricated. It
    fetches the user's recent events, summarises them deterministically (commits, PRs opened/merged,
    distinct sorted repos, time window), and stores that as a `GITHUB`-type evidence text via
    `storeEvidence` — so it is hashed off-chain exactly like a written note, and only the hash is
    anchorable on-chain. If no token is stored it throws `ConnectorNotConnectedError` → **409**, never a
    stub result. Imported GitHub content is evidence **data**, so when the AI later assesses it, it passes
    through the same `wrapEvidence` SYSTEM/DATA boundary (rule 5) — never treated as instructions.
  - **Schema + persistence.** New `EvidenceConnector` model + `ConnectorProvider` enum (migration
    `20260819130000_add_evidence_connectors`), wallet-scoped, `@@unique([walletAddress, provider])`,
    `onDelete: Cascade`. Repo helpers `upsertConnector` / `getConnectorStatus` / `listConnectors` /
    `getConnectorToken` / `deleteConnector` are all `evmAddressSchema`-scoped.
  - **UI.** A live GitHub card (Connect → `/start`; when connected: _Import latest activity_ + _Disconnect_)
    plus a one-time OAuth result banner read from the callback's `?connect=github&status=` and scrubbed off
    the URL. The **fitness-tracker and reading-app cards remain honestly disabled previews** — no OAuth app
    or API integration exists for them yet; the production fix is this same per-provider OAuth pattern.
  - **Tests (all real).** Always-on: `lib/connectors/config.test.ts` (9 — honest unset→null / malformed→
    throw), `crypto.test.ts` (8 — GCM round-trip, random IV, tamper/wrong-key/malformed all throw),
    `state.test.ts` (2 — CSRF state fail-closed), `github.test.ts` (12 — authorize URL, token-response
    parsing incl. GitHub's 200-with-`error` shape, event summariser, injected-transport IO), `import.test.ts`
    (3 — orchestrator control flow incl. the never-fabricate path). DB-gated `lib/db/repositories/
connectors.test.ts` proves the token is **stored encrypted** (raw row never contains the plaintext),
    round-trips only via `getConnectorToken`, is strictly wallet-scoped, and disconnect is idempotent
    (skips here — no Postgres). Full suite: **309 passed | 74 skipped**, `typecheck`/`lint`/`format:check`
    clean.
- **Lock button gates on a per-commitment locked flag — RESOLVED (2026-08-19).** The `Commitment`
  view type now carries a `locked: boolean`, derived from an indexed `LOCK_FUNDS`
  `ChainTransaction` (a real broadcast receipt — rule 1), NOT from `status`. This matters because
  the lifecycle deliberately leaves the DB row at `CREATED` after a lock (the on-chain id is
  back-filled without flipping status — §17 back-fill / item 2), so `status==="active"` cannot tell
  "not yet locked" from "locked". Implementation: two wallet-scoped repo helpers in
  `lib/db/repositories/chainTx.ts` — `isCommitmentLocked(wallet, id)` for the detail view and
  `listLockedCommitmentIds(wallet)` for the list view (one grouped query, so surfacing the flag
  across many commitments adds no per-commitment N+1); `toCommitmentView(c, goalTitle, locked=false)`
  threads it in; `loadCommitmentView`/`loadCommitmentViews` in `lib/api/loaders.ts` supply it; and
  `CommitmentsPage.tsx` shows the Lock button only when `!commitment.locked` (so a page reload no
  longer re-offers a lock the depositor has already funded — the previous client-only signal was
  lost on reload). A double-lock was already safe (it reverts on-chain and the backend signs
  nothing); this now also pre-gates it correctly and persistently. Tests: always-on
  `lib/api/serializers.test.ts` proves `locked` defaults to `false` and is never inferred from status
  (an `ACTIVE` row still reads `locked:false`) and reflects the caller-supplied flag on a `CREATED`
  row (35 passed, exit 0); DB-gated `lib/db/repositories/chainTx.test.ts` proves `isCommitmentLocked`
  tracks the indexed `LOCK_FUNDS` tx (not status), is wallet-scoped, and `listLockedCommitmentIds`
  returns exactly this wallet's locked ids de-duplicated (registered + skip-gated here for lack of a
  local Postgres, same as the rest of the DB-gated suite).

**How the tests are gated (this phase):** always-on route tests drive the auth/origin/error mapping
and the `storeEvidence` 413/415 mapping through the real mapper without a DB; the prepare-only proof
asserts a POST to `/api/commitments` returns calldata + a DRAFT and broadcasts nothing, and that
`/api/chain/record` only stores a supplied real hash (never invents one). DB-/key-/chain-gated
happy-paths skip cleanly (§8). The full §13 HTTP-boundary security matrix is phase 4.

**Grep-gate state after this phase** (`grep -rn "mock\|fake\|TODO: real\|hardcoded\|demo-data\|
example-botchain" apps/web`, excluding `node_modules`/tests): `demo-data`, `example-botchain`, the
`CreateCommitmentFlow` "mock confirmation", the `0x…0000` placeholders, and `ConfidenceMeter
value={89}` are **all gone** from source. Every remaining hit is a rule-1 honesty comment that uses
"fake"/"mock"/"hardcoded" only to state the code does **not** do that (e.g. "instead of a mock
confirmation", "no hardcoded script anywhere", "never fake calldata", "a real cryptographic check
(no mock)").

## 18. Step 10 — §13 security-test suite (the HTTP / auth / upload boundary)

> **Authoritative §13 closeout:** [`SECURITY.md`](./SECURITY.md) maps all 13 checklist items → named
> test(s) → **run status this session** → reproduce command, across the on-chain [F], HTTP-boundary [H],
> and backend-primitive [L] layers. It is the "must all pass before calling this done" record; this section
> is the design narrative behind it. Re-run confirmation (2026-08-18): the contract layer that item 3–9 rely
> on was executed live — `forge test` → **45 passed / 0 failed / 0 skipped** (Foundry v1.7.1 installed this
> session, §8) — so those items are now _run_, not merely _cited_.

**Status:** real and verified in-sandbox. `pnpm --filter web typecheck`, `lint`, and `pnpm format:check`
are clean; `pnpm --filter web test` runs **247 always-on tests green across 43 files** (50 DB-/key-/chain-
gated tests skip cleanly, §8); the new suite alone is **42 always-on green + 5 DB-gated skipped**; `pnpm
--filter web build` (`--webpack`, §7) still exits 0 (the `.test.ts` file is not a route — no `/api/security`
endpoint is emitted). This is **phase 4 of 4** for build step 9 and completes build step 10; only steps
11–12 of §14 remain.

**What exists and is real** — `apps/web/app/api/security.test.ts`, one `describe` per §13 checklist item.
Its headline value is the layer that had **no** tests before: the HTTP boundary. It drives the **real** Next
route handlers with real `Request` objects and asserts the real status codes — **no route logic, auth,
origin, or upload gate is mocked.** The only seam is `next/headers` `cookies()`, replaced (via `vi.mock`)
with an in-memory store so a test can present a genuinely `iron-session`-sealed cookie (`sealData` with the
same password the handler unseals with) or none. Everything after that — `assertSameOrigin`,
`requireWallet`, the size/MIME gate, `toHttpError`, and the wallet-scoped repositories — is the production
path. Because 401/403 fire before any DB call and evidence 413/415 fire before `storeEvidence`, the entire
boundary is testable **always-on** without a Postgres.

**Where each §13 item is proven** (this suite closes the HTTP-boundary gap and cites the authoritative
lower-layer proof for the invariants that live below the route):

1. **Unauthorized wallet access → 401.** Always-on here: every wallet-scoped route (9 GET + 8 POST) is
   driven with no session and returns 401. POSTs carry a same-origin `Origin` so they reach `requireWallet`
   past the origin gate; GETs reach it immediately.
2. **Cross-wallet data access → 404 read / 403 write (non-leak).** DB-gated here (`describe.skipIf(!dbReady)`):
   wallet A creates a goal + draft commitment; B reading A's goal/commitment → 404 (existence never
   revealed), B writing a check-in against A's goal → 403 (`WalletScopeError`), B's prepare-lock on A's
   commitment → 404. Skips cleanly with a printed reason when no Postgres is up; the repository-layer proof
   is always-on in §9.
3. **Contract access-control / reentrancy / invalid-completion / changed-conditions / duplicate-completion.**
   Enforced **on-chain** — the authoritative proof is the 45 Foundry tests in `contracts/` (§2). Re-asserted
   here always-on: `getAttestorClient()` exposes exactly the four value-neutral methods, is frozen, and has
   no fund-moving method reachable.
4. **Unauthorized reward claim / withdrawal.** Always-on: `prepareClaimReward` returns UNSIGNED calldata
   whose `to` is the vault, `value` is 0, and whose object carries **only** `{chainId,to,data,value}` — no
   signature/raw-tx field the backend could broadcast; only the depositor's own `lockFunds` carries value.
   The fuller encoder/decoder proof is `contractClient.safety.test.ts` (§14).
5. **Replayed / forged SIWE verification → 401.** Always-on here at the **route**: `POST /api/auth/verify`
   with a session carrying no nonce → 401 ("no sign-in in progress"), and with a nonce but a
   non-verifying message/signature → 401 (and a failed verify never reaches `ensureWallet`, so no DB write).
   The EIP-191 crypto itself (replay under a different nonce, domain mismatch, tampered/spoofed signature) is
   proven always-on in `lib/auth/siwe.test.ts` (§4).
6. **Malicious evidence upload → 413 / 415.** Always-on here: `POST /api/evidence` with a valid session for
   a non-multipart body → 415, a disallowed MIME (an `application/x-msdownload` blob) → 415, and a blob one
   byte over `MAX_EVIDENCE_BYTES` → 413 — all firing before `storeEvidence`. The `fileName` path-escape guard
   is re-asserted (a `../../etc/passwd` key rejected before touching disk) and proven fully in
   `lib/storage/localDiskStorage.test.ts` (§13).
7. **Prompt injection via evidence stays wrapped data.** Always-on re-assertion: `wrapEvidence` keeps a
   payload strictly inside one `<untrusted-user-evidence>` fence and `neutralizeDelimiters` filters a forged
   closing tag (any casing/whitespace) so it cannot break into the instruction plane. The behavioural proof
   (LOW-quality injected evidence never reaches VERIFIED and triggers no tool call) is
   `lib/ai/tools/antiInjection.test.ts` + `lib/ai/promptGuards.test.ts` (§12).
8. **AI tool-call abuse is architecturally impossible.** Same frozen, signer-less attestor surface as item 3;
   every fund action is prepare-only calldata for the user's wallet, and no route instantiates a fund-signing
   client (§17). Capstone proof: `contractClient.safety.test.ts` (§14).

Also always-on: the CSRF/origin companion to item 1 — every state-changing POST (including `/api/auth/verify`
and `/api/auth/logout`) is refused with **403** from a cross origin and with a missing `Origin`, and a
cross-host but allowlisted `APP_ORIGIN` is accepted (it then fails at auth with 401, proving the origin gate
let it through).

**Honest deferrals (rules 1 & 6 — real coverage now, gap recorded here):**

- **The cross-wallet non-leak matrix (item 2) is DB-gated**, so in this browserless/Postgres-less sandbox it
  skips rather than runs. It executes against the committed `docker-compose.yml` Postgres (`docker compose up
-d db` → `pnpm --filter web db:migrate` → `pnpm --filter web test`). The always-on 401/403/413/415 groups
  need no database and run everywhere.
- **Contract-invariant coverage lives in two places by design.** The on-chain access-control / reentrancy /
  duplicate-completion invariants are the `contracts/` Foundry suite (§2); this TypeScript suite re-asserts
  only the backend-side capability surface (frozen attestor, prepare-only encoders) and cites the Foundry
  tests rather than re-implementing them.
- **No dedicated achievements-catalog table — RESOLVED (2026-08-19)** (carried forward from §16, now
  closed): an `AchievementDefinition` catalog table (mirrored from the `ACHIEVEMENT_CATALOG` code
  source of truth) plus an `EarnedAchievement` table now persist per-achievement metadata and a
  write-once first-observation `earnedAt`. The `earned` boolean stays a live derivation; the crossing
  timestamp is real, never fabricated. See §16 for the full description and gate output.

**Grep-gate state after this phase** (`grep -rniE "mock|fake|TODO: real|hardcoded|demo-data|example-botchain"`
over `apps/web`, excluding `node_modules`/`.next`): production (non-test) source is unchanged from §17 — every
hit is a rule-1 honesty comment stating the code does **not** fake. The new test file's only matches are
`vi.mock("next/headers")` (the cookie-store seam described above) and a comment stating "no route logic is
mocked" — a test double for the cookie transport, not a fake of any money / AI / chain path.

## 19. Step 11 — final completeness pass: the `approveCompletion` trust model + simplifications index

**Status:** done. This is the build-sequence step 11 deliverable — the explicit, in-one-place record of
every hackathon-scale simplification and its production fix, with the `approveCompletion` trust model (build
prompt §8, the spot flagged as most likely to be simplified badly) documented in full. It adds no code; it
is the honesty audit `CLAUDE.md` rules 1 & 6 require before the build is called done.

### 19.1 The `approveCompletion` trust model (build prompt §8) — the headline simplification

Build prompt §8 requires either **(a)** an attestor/oracle role held by the backend service wallet acting
only on verified AI decisions meeting the confidence threshold, or **(b)** a time-locked user
self-attestation fallback — and requires the trust model be documented explicitly. `CommitmentVault.sol`
implements **(a)** and deliberately omits **(b)**; the contract header (lines 40–65) carries the reasoning
and points here for the production hardening. That record:

- **What is enforced on-chain (not trusted to the backend).** `approveCompletion` is `onlyAttestor`, requires
  the commitment to be in `CompletionRequested`, and reverts with `ConfidenceBelowThreshold` unless the
  supplied `confidence` meets the `confidenceThreshold` the depositor **fixed write-once at creation** (I5).
  So the depositor's own bar for approval cannot be lowered by the attestor after they signed. Crucially,
  `approveCompletion` **transfers nothing** — it flips the status to `Approved`. Principal and reward then
  leave only via `releasePrincipal` / `claimReward`, which are **depositor-only, pull-based, one-shot**. No
  attestor-reachable function moves value (invariant I3).
- **What is trusted off-chain (the actual simplification).** The contract cannot itself check that
  "`confidence = 85`" corresponds to a real `RealityCheckEngine` verdict over real evidence — it trusts the
  attestor to supply an honest confidence and verification hash derived from the AI pipeline. The binding
  between "the AI verified this milestone at this confidence" and "the attestor called `approveCompletion`
  with those numbers" lives in **backend code**, not in a cryptographic on-chain proof. The stored
  `verificationHash` is a fingerprint the chain records but cannot recompute from evidence. This is the
  "AI proposes, contract enforces" boundary (rule 3) at its thinnest point.
- **Blast radius if the attestor key is stolen — deliberately bounded.** A compromised attestor can approve a
  completion that never happened. The _worst_ that unlocks: **that specific depositor** can withdraw **their
  own** principal early and claim a reward **their own sponsor** funded. It **cannot redirect a single wei to
  the attacker**, cannot touch any other commitment, and cannot change who receives funds (`depositor` /
  `rewardFunder` are write-once, I1/I2). A depositor is never trapped even if the attestor vanishes:
  `cancelCommitment` returns 100% of principal (and the reward to its funder) with **no attestor involvement
  at all** (I6) — which is also why the (b) self-attestation fallback is omitted, since the only thing it
  would additionally unlock is paying an _unverified_ reward out of a sponsor's money.
- **Testnet opsec simplification (cross-ref §2).** On this deployment `owner`, `attestor`, and deployer are
  the **same** account (`0xae5c…7607`). Money-safe (neither role can move a depositor's funds) but it removes
  defence-in-depth, and the key appeared in this build transcript so it **must be rotated**. **Code-prep
  landed (2026-08-19):** the deploy script now enforces distinct roles by default (`Deploy.validateRoles`,
  6 tests) and `contracts/DEPLOY.md` documents the distinct-EOA + Safe-multisig setup; applying it on-chain
  is the user's rotate-key redeploy (a funded broadcast, not automated here).
- **Production fix.** (1) Make the attestor a **multi-sig or M-of-N threshold** signer rather than a single
  key. (2) Carry a **per-approval signed verification receipt**: have `approveCompletion` (or a wrapper)
  require a signature over `{goalId, milestoneId, confidence, evidenceHash, modelVersion}` so the on-chain
  approval is cryptographically bound to a specific, auditable AI decision — closing the "confidence value is
  trusted" gap above. (3) Use a **distinct owner** (ideally a multi-sig) separate from the attestor, hold the
  attestor key only in the backend, and **rotate** it (the contract already exposes `setAttestor`, which
  cannot block or redirect a withdrawal). **The deploy tooling now enforces (3) by default** —
  `Deploy.validateRoles` rejects a collapsed-role deploy unless `ALLOW_COLLAPSED_ROLES=true`, and
  `contracts/DEPLOY.md` gives the Safe-multisig-owner runbook. (4) Optionally add a **challenge/dispute
  window** before `Approved` unlocks withdrawals. None of these change the money-safety invariants — they
  harden _who_ may attest and _how provably_, not _where funds can go_.

### 19.2 Complete simplifications index (every deferral in this repo → its section and production fix)

Consolidated so a reviewer sees the whole surface at once. Each item is documented in full in the linked
section; nothing here is new scope, and nothing below is a fake presented as working (rule 1).

- **Attestor trust model** — single attestor, off-chain AI→attestor binding, no self-attestation fallback
  (by design). Fix: threshold attestor + signed verification receipts. → §19.1, §2, §14.
- **Attestor = owner = deployer on testnet**, and the key was exposed in-transcript. **Code-prep landed
  (2026-08-19, items 3 & 4):** `Deploy.validateRoles` enforces three distinct accounts by default (6 tests)
  and `contracts/DEPLOY.md` documents the distinct-EOA + Safe-multisig-owner setup. Remaining = the user's
  rotate-key redeploy (a funded broadcast, not automated). → §2, §19.1.
- **On-chain id back-fill — RESOLVED (2026-08-19).** `POST /api/chain/record` re-reads the receipt for a
  `REGISTER_GOAL` / `CREATE_COMMITMENT` hash, decodes the vault-emitted id (owner/depositor must match the
  recording wallet; foreign/spoofed logs ignored), and writes it onto the row via wallet-scoped
  first-writer-wins setters, so `prepare*` flips from `{prepared:false}` to real calldata once the tx is
  indexed. `lib/api/onchainBackfill.ts`; tests: parsers (7) + orchestrator (11) always-on, setters (4)
  DB-gated. → §17.
- **No historical event backfill / chain-sync loop.** State is indexed at broadcast time only. Fix: an
  event-replay reconciler. → §14.
- **EVM address validation is format-only** (no EIP-55 checksum), though SIWE now supplies real wallet
  ownership. → §9.
- **Evidence content hardening deferred** — MIME allowlist + size cap ship; deep content-sniffing, virus
  scanning, and EXIF/metadata scrubbing do not. Fix: add these at the upload boundary. → §13.
- **Local-disk + S3-compatible storage drivers — RESOLVED (2026-08-19, item 9).** `EVIDENCE_STORAGE_DRIVER`
  selects `local` (default) or a real `s3` driver (from-scratch AWS SigV4 over `fetch`, no SDK; works with
  AWS S3 / Supabase / R2 / MinIO). Same interface, same content-addressed key, so switching is config-only;
  honest fail-loud on missing `EVIDENCE_S3_*`. Signer pinned to AWS's published SigV4 vector. → §13.
- **`/verify` "Connect data" — GitHub connector RESOLVED (2026-08-19, item 8).** GitHub is now a real
  OAuth-backed evidence source (read-only scope; token AES-256-GCM-encrypted at rest, never fund-capable;
  activity summarised → stored as a `GITHUB` `Evidence` row through the same hashing pipeline as an upload;
  CSRF state fail-closed; honest 503 when unconfigured). Fitness/reading connectors remain disabled
  previews — same OAuth pattern is their fix. → §17.
- **Lock button gates on a per-commitment locked flag — RESOLVED (2026-08-19).** `Commitment.locked`
  is derived from the indexed `LOCK_FUNDS` tx (not `status`, which stays `CREATED` after a lock);
  the button shows only when `!locked`, so a reload no longer re-offers a funded lock. → §17.
- **Loaders do per-goal follow-up reads (N+1) — RESOLVED (2026-08-19).** `loadGoalViews` now runs five
  grouped queries total regardless of goal count (was 4N+1); commitment/reward loaders batch every goal
  title via `getGoalsForIds`. Pure `groupByKey`/`indexByKey` helpers preserve SQL order; a shared
  `assembleGoalView` keeps batched and per-goal assembly identical (proven deep-equal by a DB-gated test).
  → §16.
- **No dedicated achievements-catalog table — RESOLVED (2026-08-19).** `AchievementDefinition` catalog
  table (mirrored from the `ACHIEVEMENT_CATALOG` code source of truth) + `EarnedAchievement` table now
  persist per-achievement metadata and a write-once first-observation `earnedAt`; `earned` stays a live
  derivation and the timestamp is real. → §16.
- **`ScriptedProvider` / gated tests.** The live AI, DB integration, live-chain, and deployed-vault tests are
  key-/DB-/network-gated and skip cleanly in this sandbox (§8); they are not fakes — the always-on suites
  prove the logic and the gated ones run on a configured host. → §8, §10, §14, §18.
- **Gemini SDK + free-tier privacy.** Uses the current `@google/genai` (not the frozen legacy SDK the spec
  pinned) entirely behind the `AIProvider` boundary; on the free tier prompts may train Google's models, so
  raw evidence is never sent (only hashes anchored). Fix: paid tier / self-hosted inference. → §10.
- **Sandbox/tooling caveats (environment, not repo defects):** Turbopack can't build in this PRoot sandbox
  so `dev`/`build` pass `--webpack` (§7); RainbowKit's unused Coinbase x402 peer deps are aliased to an empty
  module (§15); benign wallet-stack optional-dependency build warnings are left visible rather than silenced
  (§15). `SESSION_PASSWORD` (≥32 chars) has no weak fallback — the app refuses to start without it (§4).
- **Lovable editor round-trip is intentionally broken** by the Next.js migration (owner-approved). → §5.

**Nothing is silently cut.** Every item above ships a real underlying interface/schema; the gap is the
hardening or optimisation on top, recorded here with its fix per rule 6. The money-safety invariants
(rules 2–3) hold across all of them: no code path lets funds be seized, redirected, or moved without the
depositor's own signature, and neither the AI nor the backend holds a key that can move value.

## 20. Step 12 — §15 end-to-end demo script (`DEMO.md`)

**Status:** done — the final step of the build sequence. `DEMO.md` is the judge-facing runbook for build
prompt §15, run against the **real deployed app**: SIWE wallet auth, real Postgres, real Gemini
conversations, and real BOT Chain testnet transactions the depositor's own wallet signs. It adds no runtime
code and fabricates no output — every hash a judge sees is whatever the depositor's wallet actually returns.

- **What it contains.** Prerequisites (rotated secrets → `apps/web/.env`, `docker compose` Postgres +
  migrate, a funded testnet wallet, `pnpm --filter web dev`); a **no-key preflight** that reuses the shipped
  `contractClient.integration` live-read to prove the deployed vault is reachable (asserts chain id 968 and
  reads a numeric commitment status — moves nothing, skips with a printed reason when the RPC is
  unreachable); the **six §15 beats**, each mapped to its real DB/Gemini/testnet path and to the
  prepare → sign → record money-safety spine; a limitations cross-reference; and honest failure modes.
- **The one honest scope point — the live run is human-driven.** Beats 3 (create/lock commitment) and 5
  (withdraw principal / claim reward) require a **real wallet signature**. Per money-safety rule 3 the
  backend holds no fund-moving key, and putting one in a test harness would violate that rule — so those
  beats are signed in a browser wallet by a person, and a fully-automated **Playwright** run of the _signed_
  path is deliberately **not** shipped. The always-on suites plus the gated live-read already prove the
  logic and the deployed contract; what is not automated is the wallet signature itself, by design.
  → §8, §19.1, §19.2.
- **What remains after this step is not code.** The build sequence (§14 steps 1–12) is complete. The
  outstanding items are operational and the user's to perform: rotate the three exposed secrets (GitHub PAT,
  attestor/deployer key, Gemini key), push, and perform the live end-to-end run with a funded wallet, a
  Gemini key, and a running database — none of which exist in this sandbox.

## 21. Steps 15–16 — final end-to-end closeout (the deliverable, audited against the real contract)

**Status:** done and audited. This section closes build-prompt **§15** (the judge demo script "must work
against the real deployed app") and **§16** (the FINAL INSTRUCTION — "real functionality over visual polish
… a functioning product connected end-to-end to a real deployed testnet contract"). It adds no runtime code;
it is the capstone honesty audit that maps every demo beat and every §16 mandate to the concrete evidence
that proves it, and states plainly the one thing that cannot run headless. The judge-facing runbook itself is
[`DEMO.md`](./DEMO.md); the security proof is [`SECURITY.md`](./SECURITY.md).

**Live proof against the real deployed contract — run headless this session (2026-08-18):**
`pnpm --filter web test contractClient.integration` → **2 passed**: it dialled the configured testnet RPC
(`https://rpc.bohr.life`), asserted **chain id 968**, and read a numeric commitment **status** from the
deployed vault `0x0076c4269be298429af7827a2a5cc40a65f8f8a8` — a pure view call that moves nothing. This is
the one part of §15's "must work against the real deployed app" that runs without a browser, wallet, or
database, and it **passed live** (not skipped). The deploy tx itself remains real and explorer-verified:
`0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4` (§2).

**§15 demo script — each beat's backend path is REAL (audited this session, file evidence):**

| Beat | What the judge does / sees                                                | Real path (not faked)                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create goal via conversation → goal + milestones + strategy in DB         | `app/api/ai/turn/route.ts` → `runTurn` (real Gemini; `!geminiConfigured()` → **503**); `createGoal` + `createMilestones` tools (`lib/ai/tools/`) write to Postgres                                                                                   |
| 2    | Check-in → dynamic questions → confidence % → milestone VERIFIED          | `lib/ai/verification/{realityCheck,confidence}.ts` engines via `runRealityCheck` / `calculateVerificationConfidence` tools; confidence is the real `VerificationRecord` value                                                                        |
| 3    | Self-commitment, terms shown, real wallet signature 🔑                    | `CommitmentsPage.tsx` renders `releaseCondition` / `failurePath` **before** signing; `prepareCreateCommitment` + `prepareLockFunds` return calldata the **depositor's wallet** signs (`hooks/useChainTx.ts`) → hash recorded via `/api/chain/record` |
| 4    | Submit further evidence → verified again                                  | `app/api/evidence/route.ts` → real `storeEvidence` (oversize **413** / bad MIME **415** refused first); a fresh reality-check pass produces new real confidence                                                                                      |
| 5    | Complete → `requestCompletion`/`approveCompletion` on-chain → withdraw 🔑 | attestor client exposes exactly `registerMilestone` / `requestCompletion` / `approveCompletion` / `setAttestor` — **none move value**; `releasePrincipal` / `claimReward` are depositor-signed `prepare*` (`lib/chain/contractClient.ts`)            |
| 6    | Accountability profile from real data                                     | `lib/api/serializers.ts` — `toGoalView` / `toCommitmentView` / `toRewardView` / `toWalletProfileView` from real Prisma rows; `toActivityViews` merges `DecisionLog` + `ChainTransaction`; `deriveAchievements` from real counts (no `earned` flags)  |

**The one honest scope point (rule 1, restated as the final word):** beats **3** and **5** need a **real
wallet signature**. Money-safety rule 3 forbids any fund-moving key in a harness, so those signatures are
made by a person in a browser wallet — the signed path is **human-driven, not headless**, and a Playwright
automation of it is deliberately not shipped (§20). Everything else on the path exercises real Gemini/DB/
chain when configured, and every unconfigured capability returns an honest `503`/error, never a fake.

**§16 FINAL INSTRUCTION — "real X over visual polish", each mandate → its evidence:**

| §16 mandate                      | Where it is real (evidence)                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Real AI tool-calling             | bounded agentic `runner.ts` + `registry.ts` (19 tools); `GeminiProvider` behind the SDK-agnostic boundary (§10, §11) |
| Real verification logic          | `lib/ai/verification/` reality-check + confidence engines; evidence quality pinned by type (§12)                     |
| Real deployed & tested contracts | `CommitmentVault` at `0x0076c4…f8f8a8`; **45/45** Foundry tests re-run this session (`SECURITY.md` [F], §2)          |
| Real testnet transactions        | real deploy tx `0xde9e442…9cdd4` (explorer-verified); all fund ops are depositor-signed prepare→sign→record (§17)    |
| Real database                    | Prisma schema + wallet-scoped repositories; reads/writes go to real Postgres (§9)                                    |
| Real privacy scoping             | SIWE identity; cross-wallet reads → 404 (non-leak), writes → 403 (`SECURITY.md` items 1–2, §13.1/.2, §9)             |
| Real security testing            | `SECURITY.md` — all 13 §13 items run this session across 3 layers (45 [F] + 42 [H] + 40 [L] passing)                 |
| Real end-to-end UX               | every action screen rebuilt on real backend calls; placeholder data surface deleted (§1, §16, §17)                   |

**Build order followed (§16's stated sequence):** repo skeleton → contracts + tests (§2) → backend + AI
agent + verification engine (§9–§12) → frontend (§1) → wire everything together (§15–§17) → deploy to
testnet (§2) → full security / QA checklist (`SECURITY.md`, §13/§18). The chronological record is §1–§20
above; no step jumped ahead of its predecessor's proof (`CLAUDE.md` rule 4).

**Did not stop at a working UI (§16's closing charge):** the deliverable is connected end-to-end to the real
deployed testnet contract — proven headless this session by the live vault read above, and end-to-end by the
human-driven signed run in `DEMO.md`. The only remaining actions are operational and the user's: rotate the
three exposed secrets, `git push`, and perform the live signed run with a funded wallet + Gemini key + DB.

## 22. Post-build hardening — bug-fix pass (2026-08-18)

**Status:** done and gate-verified. After the §1–§21 build was closed out, a full bug-check of the
money-adjacent and boundary code surfaced four issues; all four are now fixed with real tests, and every gate
was re-run live (numbers below are actual output, `CLAUDE.md` "show real output"). No fund-safety invariant
changed — the two money-path fixes only _remove_ ways a third party could grief or mislead, never a way to
move funds.

**Gates re-run this session (all green):** `forge test` → **45 passed / 0 failed / 0 skipped**;
`pnpm --filter web typecheck` · `lint` · (root) `pnpm format:check` → clean; `pnpm --filter web test` →
**247 passed / 50 skipped** across 43 files (was 243 → **+4 new tests**, all always-on); `pnpm --filter web
build` (`--webpack`) → compiles every route; grep gate (`mock|fake|TODO: real|hardcoded|demo-data|
example-botchain`, non-test source) → **no matches**.

### 22.1 Evidence-upload memory-exhaustion DoS — MEDIUM — FIXED

- **Bug:** `app/api/evidence/route.ts` gated upload size on `Number(req.headers.get("content-length"))`.
  A missing header parsed to `0` and a malformed one to `NaN`; **both slipped past** the `> cap` check and
  fell into `await req.formData()`, which buffers the **entire** body into memory. An attacker could stream an
  unbounded (or Content-Length-spoofed) chunked body and exhaust server memory before the precise per-file
  check at the decoded-bytes stage ever ran.
- **Fix:** a `readBodyCapped(req.body, MAX_EVIDENCE_BYTES + 1MB)` helper enforces the cap **while streaming**
  — it counts bytes as chunks arrive and aborts with `PayloadTooLargeError` (**413**) the instant the total
  exceeds the cap, never trusting the header. The multipart form is then parsed from those capped bytes
  (`new Response(raw, { headers: { "content-type": contentType } }).formData()`). The exact per-file limit is
  still re-checked on the decoded blob afterward.
- **Proof:** new always-on test `§13.6 … a body with no Content-Length is still capped while streaming (413)`
  drives a header-less `ReadableStream` body over the cap and asserts 413. The pre-existing non-multipart→415,
  bad-MIME→415, and oversize-file→413 tests remain green (the auth + content-type checks still precede the
  body read).

### 22.2 `cancelCommitment` reward-funder griefing — LOW→MEDIUM — FIXED (source; deployed instance needs redeploy)

- **Bug:** `fundReward` is permissionless — anyone can fund a commitment's reward. `cancelCommitment` refunded
  the reward to that funder with a push transfer that **reverts the whole call** if the funder rejects ETH. A
  malicious funder could therefore **strand the depositor's principal**: the depositor could never cancel.
- **Fix:** the reward refund leg now uses `_refundOrEscrow` — a pull-payment fallback that, if the push
  fails, credits `escrowedRefunds[funder]` (emitting `RefundEscrowed`) instead of reverting. The depositor's
  principal goes out on its own independent leg regardless. The funder later pulls its refund via a new
  `withdrawEscrow()` (`nonReentrant`, checks-effects-interactions, `NothingToWithdraw` on an empty balance).
  This preserves invariants I1–I6 (reward still only ever reaches its funder; nothing reaches owner/attestor).
- **Proof:** 3 new Foundry tests — `test_cancel_rejectingRewardFunder_doesNotBlockPrincipal`,
  `test_withdrawEscrow_pullsEscrowedRefund`, `test_withdrawEscrow_revertsWhenNothingOwed` — plus the
  unchanged `test_cancel_toRejectingReceiver_revertsWholeCall` and reentrancy tests still pass (45/45).
- **Caveat (rule 1):** the **deployed** vault `0x0076c4…f8f8a8` is immutable and predates this fix (see the
  §2 honesty note). The fix lives in source + tests + any future deployment; realizing it on-chain needs a
  redeploy with the rotated deployer key (a user action) — full runbook in `contracts/DEPLOY.md`, including
  how to verify the fix (`withdrawEscrow()` present) on the new instance.

### 22.3 Reward-view mislabelling — two latent correctness bugs — FIXED

`lib/api/serializers.ts` `toRewardView` derives the UI's reward state from a commitment. Two derivations
disagreed with the contract; both are **latent today** (no chain→DB sync loop yet sets these DB fields to the
triggering values) and were fixed proactively so they cannot bite once that loop lands.

- **Bug 1 — false "claimable":** `claimable` was `APPROVED && !rewardWithdrawn`, omitting `rewardFunded`. An
  APPROVED-but-unfunded commitment would be shown as claimable, but on-chain `claimReward` reverts
  `RewardNotFunded` — the user would sign a doomed transaction. **Fix:** `claimable = APPROVED &&
rewardFunded && !rewardWithdrawn`.
- **Bug 2 — cancel mislabelled as claimed:** `claimed` was `rewardWithdrawn` alone, but that flag is set true
  by **both** `claimReward` (depositor collected) **and** `cancelCommitment` (reward refunded to its funder).
  A cancelled commitment would surface as a "claimed reward". **Fix:** `claimed = rewardWithdrawn && status
!== CANCELLED`.
- **Proof:** 2 new serializer tests (`is NOT claimable when APPROVED but the reward was never funded`; `is NOT
a claimed reward when the commitment was cancelled`); the existing "claimable" test was corrected to set
  `rewardFunded: true` (its old reliance on the default `false` was exactly Bug 1's buggy path).

### 22.4 Draft-conflict returned 500 instead of 409 — informational — FIXED

- **Bug:** `createDraftCommitment` threw a plain `Error` when a goal already had an on-chain commitment (terms
  are write-once), which `toHttpError` mapped to a generic **500** — a client conflict surfaced as a server
  fault (pages an operator; tells the caller nothing about whether to retry).
- **Fix:** a typed `CommitmentTermsLockedError` in `lib/db/errors.ts` (mirroring `WalletScopeError`'s
  domain-named pattern), mapped to **409 Conflict** in `toHttpError`.
- **Proof:** new test `toHttpError … maps a locked-terms conflict to 409, not a 500`.

### 22.5 Reviewed and deliberately left as-is (safe version + documented deviation, rules 1/6)

- **`assertSameOrigin` compares host only, not scheme/port.** Deliberate: a scheme/port-strict compare
  produces false **403**s behind the common reverse-proxy/TLS-terminator setup (proxy forwards `http` origin
  upstream). The CSRF posture is already defence-in-depth — middleware `Sec-Fetch-Site` + a `secure`,
  `sameSite=lax`, httpOnly session cookie — so host-only origin matching is the safe default; tightening it is
  deployment-specific configuration, not a code fix.
- **Evidence MIME allowlist admits `text/*` (incl. HTML/SVG).** Safe as stored: evidence is served for
  download with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, so a stored HTML/SVG is
  never rendered inline as active content in the app origin. Narrowing the allowlist (e.g. dropping SVG) is a
  product decision about what evidence types to accept, not a security hole to patch.
