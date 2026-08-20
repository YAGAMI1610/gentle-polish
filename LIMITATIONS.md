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
the three roles removes defence-in-depth. **Code-prep landed (2026-08-19, items 3 & 4; extended
2026-08-20, item 11):** the deploy script now _enforces_ distinct deployer/owner/attestor/aiVerifier
by default — `Deploy.validateRoles` (pure, unit-tested in `contracts/test/Deploy.t.sol`, 10 tests)
reverts before any broadcast unless `ALLOW_COLLAPSED_ROLES=true` is explicitly set, and one check
(`attestor != aiVerifier`) is a contract invariant that flag cannot waive — and
`contracts/DEPLOY.md` documents the distinct-EOA + Safe-multisig-owner setup (constructor sets the
owner directly, so a Safe can own from block 0; Ownable2Step for a later hand-off) and both
key-rotation procedures (`setAttestor` / `setAiVerifier`). Note the live instance has **no
`aiVerifier` at all** — it predates item 11, so on it approval is still one-of-one. What remains
is the user's to do and is deliberately NOT automated: rotate the exposed deployer/attestor key
(item 1) and **redeploy** with four distinct, rotated accounts (a broadcast needing a funded
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
- no raw evidence bytes or `contentText` are ever sent to the model — see the note below, which
  is now enforced by an always-on test suite rather than only documented.

### 10.1 Free-tier Gemini is a deliberate choice, and here is the mitigation (item 13)

**For judges and reviewers, stated plainly: staying on Gemini's free tier is a deliberate,
documented tradeoff — not an oversight, and not a gap we forgot to close.** Google's free tier may
use prompts and responses to improve their products. A hackathon build has no paid billing account,
and pretending otherwise (or shipping a paid-tier code path nobody can run) would violate
`CLAUDE.md` rule 1. So instead of changing tiers, the privacy boundary is drawn so that **what the
free tier could learn contains no user evidence at all**.

**What the model does receive:** the app-authored trust-boundary SYSTEM prompt, the user's own chat
turns (what they typed into `/create` or `/check-in`), the app-authored `toolPolicy` routing line,
the advertised tool schemas, and tool _results_ — which are goal/verification metadata: ids,
enum signal levels, a 0–100 confidence, a `sha256` hash, and the engine's own reasoning string.

**What it never receives:** any uploaded evidence bytes, any stored `Evidence.contentText`, any
blob `storageKey`, and anything read back out of the evidence store. `analyzeEvidence` is the only
AI-layer code that touches an `Evidence` row at all, and it reads exactly four fields off it —
`type`, `id`, `goalId`, `contentHash` — because the verification outcome is computed by the
deterministic reality-check engine from the evidence **type** and history, never from its text
(§12). The `evidenceSummary` parameter flows model → app (it is stored for display), and its own
schema description tells the model to write its own words rather than paste content.

**Why this is verified rather than asserted.** One `evidence.contentText` spliced into a prompt
would silently break the whole claim, and nothing would fail at runtime — so
`lib/ai/privacyBoundary.test.ts` (**11 always-on tests**, no key, no network, no DB) makes it fail
in CI instead, in three independent layers:

1. **Reachability (source guard).** No file under `lib/ai/` may so much as _name_ `contentText`,
   `storageKey`, `readEvidenceBlob`, `evidenceBytes` or `readBlob`. If raw evidence is not
   reachable from the AI layer, no prompt can carry it. The scan asserts it found a real,
   non-empty file set first, so it cannot pass vacuously. (Verified to bite: temporarily adding
   `evidence.contentText` to `lib/ai/runner.ts` fails this test.)
2. **Egress (source guard).** Exactly one file in `apps/web` carries a real
   `from "@google/genai"` specifier — `lib/ai/gemini.ts` — so there is a single place anything can
   leave for the model, and it is a pure 1:1 mapping of the `AIProvider` request.
3. **Payload (behavioural).** A recording provider driven through the real `runTurn` captures
   exactly what crosses the `AIProvider` boundary: the request carries only
   `{system, messages, tools}` — no field an upload could ride in — the transcript is exactly the
   user's own chat turns, the system instruction contains no evidence, no advertised tool
   parameter accepts evidence content, and `analyzeEvidence` takes its evidence by **id**.

The audit-log half is covered in the same suite: `createDecisionInput` accepts an id or a 64-char
`sha256` and **rejects** anything over 256 chars (an `Evidence.contentText` may be 20,000), and a
source guard asserts the repo has exactly **one** `evidenceRef:` writer —
`lib/ai/tools/analyzeEvidence.ts`, passing `evidence.id`.

**What would still change on a paid tier:** nothing about this boundary — it would only remove the
training-use caveat on the user's own chat text, which is the one thing a chat product cannot avoid
sending. Self-hosted inference behind the same `AIProvider` interface is the other option and needs
no change above `gemini.ts`. Both remain the documented production fix; neither is required for the
evidence-privacy guarantee above, which holds on the free tier today.

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
- **Content hardening ships — RESOLVED (2026-08-19, item 10).** `lib/evidence/hardening/` is a
  choke point inside `storeEvidence`, entered BEFORE anything is hashed or written, so every write path
  (the `/api/evidence` upload route and the GitHub connector import alike) gets the same treatment and
  none can bypass it. Three layers, in this order:
  1. **Deep content sniffing** (`sniff.ts`) — magic-byte identification for PNG/JPEG/GIF/WebP/BMP/TIFF/
     ISO-BMFF (AVIF/HEIC)/PDF/ZIP/GZIP/BZ2/XZ/7z/RAR/TAR/ELF/MZ/Mach-O/OLE/shebang plus strict-UTF-8 text
     detection. The declared MIME must AGREE with the bytes (an ELF called `proof.png` is refused, 415);
     an unlabelled upload adopts its sniffed type; **executables, archives, and active/scriptable content
     (HTML/SVG/XML/PHP) are refused outright**, so the allowlist is no longer the only gate. TIFF/HEIC/AVIF
     are refused too — honestly, because their metadata cannot be stripped here (message asks for JPEG/PNG).
  2. **Malware scan hook** (`scanner.ts`, `clamd.ts`) — the `MalwareScanner` seam, with a real ClamAV
     driver speaking clamd's own `zINSTREAM` TCP protocol (no SDK, no shell-out — the same "implement the
     real protocol" approach as the SigV4 signer). Selected by `EVIDENCE_MALWARE_SCAN`; **OFF by default**,
     in which case the report says `scanned: false` rather than claiming a scan that never ran (rule 1).
     Once configured it is **FAIL-CLOSED**: a signature match refuses the upload (422) and an unreachable /
     timing-out / protocol-erroring daemon also refuses it (503) instead of storing bytes unscanned.
     The scan runs on the **original** bytes, before scrubbing, so a signature hidden in an EXIF blob gets
     the upload refused rather than silently sanitised into looking clean.
  3. **EXIF/metadata scrubbing** (`metadata.ts`) — byte-level container rewrites, always on, no library:
     JPEG drops every APPn/COM except JFIF/ICC/Adobe (so EXIF **GPS**, XMP, and Photoshop/IPTC go), PNG
     keeps only a critical/rendering chunk allowlist (tEXt/iTXt/zTXt/eXIf/tIME dropped, CRCs preserved),
     WebP removes EXIF/XMP chunks **and** clears the matching VP8X feature bits and rewrites the RIFF size,
     GIF drops comment and metadata application extensions while keeping the NETSCAPE loop block. Data
     appended after EOI/IEND is dropped, and a malformed container is refused rather than stored.

  The **scrubbed** bytes are what `storeEvidence` hashes and stores, so the anchorable `contentHash`
  always describes exactly what sits in the blob store. Errors map through `toHttpError`
  (415 / 422 / 503). Tests — 75 new, all always-on, no mocked scanners and no fabricated images:
  `sniff.test.ts` (17) uses the repo's real PNG/JPEG assets and spec magic bytes for every refused class,
  `metadata.test.ts` (16) scrubs the **real** `hero-topo.jpg` (which really carries an XMP APP1) and
  `agent-mark.png` (a real iTXt chunk), then re-inserts real EXIF/GPS + comment blocks with real framing
  and real CRC32s and requires the scrubber to land byte-for-byte on the metadata-free file,
  `clamd.test.ts` (10) drives the client against a **real loopback TCP server** that decodes `zINSTREAM`
  and asserts the command, frame lengths and reassembled payload, `scanner.test.ts` (10) the config
  honesty contract, `harden.test.ts` (12) the ordering guarantee, plus 7 in `storeEvidence.test.ts`
  (a throwing storage proves nothing is written on any refusal path) and 3 in `app/api/security.test.ts`
  §13.6 at the HTTP boundary.

  Remaining honest limits: sniffing is header-based, so a **polyglot** file whose header is a valid image
  is accepted as that image (the scrub then rewrites the container, which breaks most such payloads, and
  the download route already forces `attachment` + `nosniff`); PDFs are accepted whole — no JavaScript or
  embedded-file stripping, so PDF sanitising is a real follow-up; and an unlabelled binary that matches no
  signature is still stored as `application/octet-stream`.

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
  checked selector from its canonical signature and round-trips `encode`→`decode`. **Extended
  2026-08-20 (item 12) with a real drift guard, and it caught a real gap.** The per-signature cases
  above only prove each _listed_ entry is right; they cannot notice something _missing_. A new
  `describe("ABI ↔ CommitmentVault.sol (no missing declaration)")` block parses the sibling
  `contracts/src/CommitmentVault.sol` and asserts every external/public function, event and error it
  declares appears in this transcription. That test failed on first run: the §22.2 refund-escrow
  surface — `withdrawEscrow()`, `escrowedRefunds(address)`, `RefundEscrowed`, `EscrowWithdrawn`,
  `NothingToWithdraw()` — had shipped in the contract but was never transcribed here, so the new
  event replay (item 12) would have silently dropped two real on-chain events. All five are now in
  `abi.ts`, and the two events are declared in `UNMAPPED_VAULT_EVENTS` (they carry no
  `ChainTxKind`, so a replay reports them under `unmapped` rather than inventing a kind). The check is
  deliberately one-way — the ABI may be a superset, because `owner()` / `transferOwnership` /
  `acceptOwnership` / `renounceOwnership` come from OpenZeppelin's `Ownable2Step`, not from this file —
  and it skips with a printed reason on a web-only checkout rather than passing vacuously.
- **Historical event backfill / chain-sync loop — RESOLVED (2026-08-20, item 12).** `recordChainTx`
  still indexes at broadcast time, but that is no longer the _only_ way a transaction can enter the
  index: `lib/chain/events.ts` replays mined vault logs into `ChainTransaction` shape and
  `lib/api/chainReconciler.ts` reconciles a wallet's history from them, exposed as `POST
/api/chain/reconcile`. Pure reads — no key, no broadcast. → §17.

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
    (over `MAX_EVIDENCE_BYTES` = 15MB) / **415** (MIME not on the allowlist, or the bytes contradict the
    declared type / are executable, archived or scriptable) / **422** (malware signature matched) / **503**
    (a configured scanner returned no verdict — fail-closed). `evidence/[id]/route.ts`
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
  by the chain-sync reconciler below, item 12). Net effect: `prepareCreateCommitment` / `prepareLockFunds` /
  `prepareClaimReward` flip from `{prepared:false}` to real calldata as soon as the registration/creation
  tx is indexed. Tests: `lib/chain/contractClient.parsers.test.ts` (7 always-on — decode + vault-address
  spoof filter), `lib/api/onchainBackfill.test.ts` (11 always-on — kind/config gating, owner/depositor
  match, idempotent reporting, best-effort throw), `lib/db/repositories/onchainId.integration.test.ts`
  (6 DB-gated — first-writer-wins, wallet-scoping, status-stays-`CREATED`, plus the item-12 reverse
  lookups `getGoalByOnchainId` / `getCommitmentByOnchainId`).
- **Historical event backfill / chain-sync reconciler — RESOLVED (2026-08-20, item 12).** Until now a
  transaction only entered the index if the browser was there to call `POST /api/chain/record` right after
  the wallet returned a hash. Anything sent while the app was down, from a different browser, or straight
  from a wallet / `cast` was invisible forever. `POST /api/chain/reconcile` closes that: it replays the
  vault's past logs and reconstructs this wallet's `ChainTransaction` rows.
  - **Two layers, both real.** `lib/chain/events.ts` is pure and network-free: `replayVaultEvents(logs,
config)` runs viem's `parseEventLogs` over the production ABI, drops any log not emitted by the configured
    vault, drops pending logs (no block/hash/index yet), and maps each decoded event to
    `{kind, onchainGoalId, onchainCommitmentId, actor, title, detail}` — oldest-first by `(blockNumber,
logIndex)`. `primaryEventPerTransaction` then collapses a multi-event transaction to the ONE row the
    schema's `@@unique([txHash])` allows, ranked so `approveCompletion`'s pair keeps `CompletionApproved`
    (the event carrying the confidence the threshold used) over `VerificationReceiptAccepted`, and
    `CommitmentCreated` outranks `GoalRegistered`. `blockRangeChunks` tiles the scan so one `getLogs` never
    asks for an unbounded span. `lib/api/chainReconciler.ts` is the orchestrator behind a
    `ChainReconcilerDeps` seam (same pattern as `OnchainBackfillDeps`), so the whole control flow is
    always-on testable with no RPC and no Postgres.
  - **Attribution comes from the chain, not the caller (rule 2).** An event is this wallet's only if its
    commitment id is in `getWalletCommitments(wallet)`, its goal id is in `getWalletGoals(wallet)`, or the
    event's own actor field IS the wallet. Those two vault views are populated from `msg.sender` inside
    `registerGoal` / `createCommitment`, so they are the contract's own ownership index — there is no
    client-supplied hint anywhere in the path, and a replay therefore cannot pull a stranger's transaction
    into a wallet's feed. `RewardFunded` is attributed to the **funder**, so a sponsor's transaction stays
    the sponsor's.
  - **It never overwrites what the app already wrote.** `recordChainTx` is an upsert whose update replaces
    every column, so a naive re-record would clobber the app's richer `title`/`detail`/FKs with a generic
    replayed one. Instead: a row that already has a `blockNumber` is reported `already-indexed` and left
    untouched; a row missing only its `blockNumber` is re-recorded carrying **its own** existing fields
    forward plus the block number (`block-number-filled`); only a hash with no row at all gets the replayed
    title/detail (`recorded`). A single failing hash is reported as `skipped` with the real error message
    rather than voiding the scan — but a genuine RPC failure propagates, so an empty report is never a lie.
  - **Money safety (rules 2–3).** Every chain call it makes is a read (`getLogs`, `getBlockNumber`, two
    view calls). It holds no key, signs nothing, broadcasts nothing, and writes nothing except
    `ChainTransaction` rows derived from logs the configured vault itself emitted. It is a POST because it
    writes to the DB, so it sits behind the same `assertSameOrigin` + `requireWallet` boundary as every
    other write (§13.1/§13 coverage extended to it). Idempotent by construction — safe to call repeatedly.
  - **Honest reporting, no silent caps (rule 1).** The response is a `ChainReconcileResult` of what actually
    happened: block range, chunk count, events seen vs. events for this wallet, and per-transaction outcomes.
    Chain unconfigured → `configured:false` with the reason spelled out, not an empty success. Events the
    ABI has but the tx-kind enum does not (`AttestorUpdated`, `AiVerifierUpdated`, `RefundEscrowed`,
    `EscrowWithdrawn`) are listed under `unmapped` rather than dropped, capped at 20 with the cap visible in
    the count. `COMMITMENT_VAULT_DEPLOYMENT_BLOCK` (new, optional, `readVaultDeploymentBlock`) is where a
    full replay starts; unset means block 0 — slower but correct — and set-but-malformed throws rather than
    silently skipping real history.
  - **Known limits, by design.** It is operator-triggered, not a background daemon (a cron/worker loop is
    the production shape). It links a replayed event to a DB goal/commitment only through an **already
    back-filled** on-chain id: there is no verifiable link from a bare log to an unlinked draft, so rather
    than guess, such a transaction is recorded with an honest `"no DB commitment linked to on-chain
commitment #N — recorded without that link"` reason. Reorg handling is limited to what re-running gives
    you (a replay re-derives from current logs; it does not delete rows for logs that vanished).
  - **Tests (all real, no mocks).** Always-on: `lib/chain/events.test.ts` (**15**) builds genuinely
    ABI-encoded logs — topics via `encodeEventTopics`, data via `encodeAbiParameters` over the real
    non-indexed inputs — so `parseEventLogs` actually decodes them and a wrong indexed/non-indexed split
    fails here; it asserts all 9 lifecycle mappings, exact wei on a 30-digit amount, the foreign-contract
    filter, pending-log skipping, ordering, the not-configured throw, exact `blockRangeChunks` tiling, and —
    the drift guard — that **every** event in the ABI is either mapped or explicitly in
    `UNMAPPED_VAULT_EVENTS`, so adding an event to the ABI without handling it fails the suite.
    `lib/api/chainReconciler.test.ts` (**26**) covers gating/range resolution, on-chain attribution
    (including a stranger's events excluded and the case-insensitive actor match), and the write outcomes —
    with an explicit test that a block-number fill carries the app's own title/detail/FKs forward rather
    than the replayed ones, and a run-twice idempotence test. `lib/chain/config.test.ts` (+**3**) pins
    `readVaultDeploymentBlock`'s unset/parse/throw behaviour. `app/api/security.test.ts` (+**2**) adds the
    new route to the 401 and cross-origin-403 matrices. DB-gated: `onchainId.integration.test.ts` (+**2**)
    proves the reverse lookups are wallet-scoped in the read direction, which is what stops a replayed event
    from attaching to a stranger's row (skips here — no Postgres).
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

1. **Unauthorized wallet access → 401.** Always-on here: every wallet-scoped route (9 GET + 9 POST) is
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
6. **Malicious evidence upload → 413 / 415 / 422 / 503.** Always-on here: `POST /api/evidence` with a valid
   session for a non-multipart body → 415, a disallowed MIME (an `application/x-msdownload` blob) → 415, a
   scriptable MIME (`text/html`, `image/svg+xml`) → 415, and a blob one byte over `MAX_EVIDENCE_BYTES` → 413,
   all firing before `storeEvidence`. **Content hardening (item 10)** then rejects payloads whose bytes
   contradict their label — an ELF renamed `proof.png` → 415, HTML smuggled under a `text/plain` label → 415 —
   inside `storeEvidence`, before anything is hashed or written; a configured malware scanner adds 422
   (signature matched) and 503 (no verdict — fail-closed). The `fileName` path-escape guard is re-asserted (a
   `../../etc/passwd` key rejected before touching disk) and proven fully in
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
  the commitment to be in `CompletionRequested`, requires a **valid EIP-712 verification receipt signed by the
  distinct `aiVerifier`** (I7, item 11 — see below), and reverts with `ConfidenceBelowThreshold` unless the
  supplied `confidence` meets the `confidenceThreshold` the depositor **fixed write-once at creation** (I5).
  So the depositor's own bar for approval cannot be lowered by the attestor after they signed. Crucially,
  `approveCompletion` **transfers nothing** — it flips the status to `Approved`. Principal and reward then
  leave only via `releasePrincipal` / `claimReward`, which are **depositor-only, pull-based, one-shot**. No
  attestor-reachable function moves value (invariant I3).
- **What is trusted off-chain — NARROWED (2026-08-20, item 11).** Originally the contract could not check that
  "`confidence = 85`" corresponded to a real `RealityCheckEngine` verdict: the binding between "the AI verified
  this at this confidence" and "the attestor called `approveCompletion` with those numbers" lived only in
  backend code. That binding is now **cryptographic**. `approveCompletion(VerificationReceipt, bytes)` takes an
  EIP-712 receipt over `{commitmentId, goalId, milestoneRef, confidence, evidenceHash, verificationHash,
modelVersionHash, deadline}` and reverts `InvalidVerificationReceipt` unless the recovered signer is exactly
  the on-chain `aiVerifier` — a **second, distinct** key from the attestor (`RolesMustDiffer`, not waivable).
  Approval is therefore **two-of-two**: the attestor can no longer invent a confidence value, and the AI
  verifier can sign but cannot send a transaction (`getReceiptSigner()` is a frozen `{address, signReceipt}`
  with no wallet client — `lib/chain/receipt.safety.test.ts`). The emitted
  `VerificationReceiptAccepted(commitmentId, verifier, milestoneRef, evidenceHash, modelVersionHash,
receiptDigest)` lets an auditor re-derive the digest off-chain and re-verify the signature. Replay is closed
  by the domain (chainId + verifyingContract), the in-receipt `commitmentId`/`goalId`, the one-way
  `CompletionRequested → Approved` transition, and the `deadline`.
  **What is still trusted off-chain, honestly:** the `aiVerifier` key is a single key signing what the backend
  pipeline hands it, and neither `evidenceHash` nor `modelVersionHash` is recomputable by the chain. So the
  contract now proves _which AI decision_ an approval refers to, and that a distinct verifier endorsed it — not
  that the decision itself was correct. Remaining fix: make `aiVerifier` an M-of-N/ERC-1271 signer (works with
  **no contract change** — receipts go through `SignatureChecker`, proven by
  `test_approveCompletion_acceptsAnErc1271ContractVerifier`). This is the "AI proposes, contract enforces"
  boundary (rule 3) at its thinnest remaining point.
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
  landed (2026-08-19, extended 2026-08-20):** the deploy script now enforces distinct roles by default
  (`Deploy.validateRoles(deployer, owner, attestor, aiVerifier, allowCollapsed)`, 10 tests) across **four**
  roles, with `attestor != aiVerifier` unconditional, and `contracts/DEPLOY.md` documents the distinct-EOA +
  Safe-multisig setup; applying it on-chain is the user's rotate-key redeploy (a funded broadcast, not
  automated here).
- **Production fix.** (1) Make the attestor a **multi-sig or M-of-N threshold** signer rather than a single
  key. (2) **DONE in source (2026-08-20, item 11)** — the per-approval signed verification receipt described
  here is implemented: `approveCompletion` requires an EIP-712 signature over
  `{commitmentId, goalId, milestoneRef, confidence, evidenceHash, verificationHash, modelVersionHash,
deadline}` from a distinct `aiVerifier`, closing the "confidence value is trusted" gap. Contract +
  ABI + `lib/chain/receipt.ts` + tests are green (80 forge tests; cross-language digest fixture asserted from
  both Solidity and viem). **Not yet on-chain**: the live instance predates it, so this needs the user's
  redeploy — a funded broadcast, deliberately not automated (`contracts/DEPLOY.md`). Because
  `SignatureChecker` accepts ERC-1271, (1) can later be satisfied by pointing `aiVerifier` at a Safe or
  threshold verifier with **no further contract change**. (3) Use a **distinct owner** (ideally a multi-sig) separate from the attestor, hold the
  attestor key only in the backend, and **rotate** it (the contract already exposes `setAttestor`, which
  cannot block or redirect a withdrawal). **The deploy tooling now enforces (3) by default** —
  `Deploy.validateRoles` rejects a collapsed-role deploy unless `ALLOW_COLLAPSED_ROLES=true`, and
  `contracts/DEPLOY.md` gives the Safe-multisig-owner runbook. (4) Optionally add a **challenge/dispute
  window** before `Approved` unlocks withdrawals. None of these change the money-safety invariants — they
  harden _who_ may attest and _how provably_, not _where funds can go_.

### 19.2 Complete simplifications index (every deferral in this repo → its section and production fix)

Consolidated so a reviewer sees the whole surface at once. Each item is documented in full in the linked
section; nothing here is new scope, and nothing below is a fake presented as working (rule 1).

- **Attestor trust model — signed receipt landed in source (2026-08-20, item 11).** Approval is now
  **two-of-two**: `approveCompletion(VerificationReceipt, bytes)` requires an EIP-712 signature from a
  distinct `aiVerifier` over `{commitmentId, goalId, milestoneRef, confidence, evidenceHash,
verificationHash, modelVersionHash, deadline}`, so the on-chain approval is cryptographically bound to one
  auditable AI decision (`VerificationReceiptAccepted` carries the digest). `attestor != aiVerifier` is a
  contract invariant `ALLOW_COLLAPSED_ROLES` cannot waive; the verifier key can sign but not transact.
  `contracts/src/CommitmentVault.sol`, `lib/chain/receipt.ts`; tests: 80 forge + 52 always-on web
  (receipt 21, receipt-safety 11, abi 20) with one digest fixture asserted from **both** Solidity and viem.
  Still open by design: single verifier key (an M-of-N ERC-1271 signer needs no contract change), and no
  self-attestation fallback. **Needs the user's redeploy to be live.** → §19.1, §2, §14.
- **Attestor = owner = deployer on testnet**, and the key was exposed in-transcript. **Code-prep landed
  (2026-08-19, items 3 & 4; extended 2026-08-20, item 11):** `Deploy.validateRoles` enforces **four** distinct
  accounts by default (10 tests) and `contracts/DEPLOY.md` documents the distinct-EOA + Safe-multisig-owner
  setup. Remaining = the user's rotate-key redeploy (a funded broadcast, not automated). → §2, §19.1.
- **On-chain id back-fill — RESOLVED (2026-08-19).** `POST /api/chain/record` re-reads the receipt for a
  `REGISTER_GOAL` / `CREATE_COMMITMENT` hash, decodes the vault-emitted id (owner/depositor must match the
  recording wallet; foreign/spoofed logs ignored), and writes it onto the row via wallet-scoped
  first-writer-wins setters, so `prepare*` flips from `{prepared:false}` to real calldata once the tx is
  indexed. `lib/api/onchainBackfill.ts`; tests: parsers (7) + orchestrator (11) always-on, setters (4)
  DB-gated. → §17.
- **Historical event backfill / chain-sync reconciler — RESOLVED (2026-08-20, item 12).** State is no
  longer indexed at broadcast time only: `POST /api/chain/reconcile` replays the vault's past logs
  (`getLogs`, chunked) and reconstructs this wallet's `ChainTransaction` rows, attributing each one by the
  vault's OWN per-wallet index (`getWalletGoals`/`getWalletCommitments`) rather than any client hint, so a
  replay can never pull in a stranger's transaction. Pure reads — no key, no broadcast, no fund movement
  (rules 2–3); app-written rows are never overwritten (only a missing `blockNumber` is filled). Recovers
  transactions sent while the app was down, from another browser, or straight from a wallet / `cast`.
  `lib/chain/events.ts`, `lib/api/chainReconciler.ts`, `app/api/chain/reconcile/route.ts`; tests: 41
  always-on (replay 15, reconciler 26) + 3 config + 2 security-boundary, 2 DB-gated. Still open by design:
  it is operator-triggered, not a background daemon, and it cannot back-fill an on-chain id onto a DB row
  that has none (there is no verifiable link from a bare log to an unlinked draft) — such a transaction is
  recorded with an honest "no DB row linked" reason. → §17, §14.
- **EVM address validation is format-only** (no EIP-55 checksum), though SIWE now supplies real wallet
  ownership. → §9.
- **Evidence content hardening — RESOLVED (2026-08-19, item 10).** Deep magic-byte sniffing (declared type
  held to the real bytes; executables/archives/active content refused), a fail-closed malware-scan hook with a
  real clamd `zINSTREAM` driver (`EVIDENCE_MALWARE_SCAN`, off by default and honestly reported as unscanned),
  and always-on EXIF/GPS/XMP/comment scrubbing for JPEG/PNG/WebP/GIF — all inside `storeEvidence`, so no write
  path can bypass them, and the anchored hash covers the scrubbed bytes. Still open, documented: PDF internals
  are not sanitised, and header-based sniffing accepts image polyglots. → §13.
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
- **Gemini SDK + free-tier privacy — REVIEWED AND KEPT, mitigation now TESTED (2026-08-20, item 13).** Uses
  the current `@google/genai` (not the frozen legacy SDK the spec pinned) entirely behind the `AIProvider`
  boundary. Free tier is a **deliberate** choice, not an oversight: on it Google may use prompts/responses
  for product improvement, which is acceptable here only because **no raw evidence ever reaches the model**
  — uploaded bytes, `Evidence.contentText` and blob storage keys are unreachable from `lib/ai/` (the AI layer
  may not even name them), there is exactly one SDK egress point, and the `AIProvider` request carries only
  `{system, messages, tools}`. The decision log stores an evidence id/hash only. Previously documented;
  now **enforced by 11 always-on tests** (`lib/ai/privacyBoundary.test.ts`) so a future prompt edit that
  splices in evidence text fails in CI instead of silently leaking. Paid tier / self-hosted inference stays
  the recommended upgrade (it removes the training caveat on the user's own chat text) but is **not** required
  for the evidence guarantee. → §10.1.
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
- ~~**Evidence MIME allowlist admits `text/*` (incl. HTML/SVG).**~~ **CLOSED (2026-08-19, item 10)** — no
  longer left as-is. The allowlist now denies the scriptable types explicitly (`text/html`, `text/xml`,
  `text/javascript`, `image/svg+xml`, `application/xml`, `application/xhtml+xml`, `application/javascript`,
  `application/ecmascript`, `application/x-httpd-php`, `text/x-shellscript` → **415**), and content sniffing
  independently refuses active content even when it is smuggled in under a `text/plain` label. The download
  route still forces `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, so this is now
  defence in depth rather than the only mitigation. Asserted always-on in `app/api/security.test.ts` §13.6
  and `lib/evidence/storeEvidence.test.ts`. → §13.

## 23. Post-build remediation — LIMITATIONS/SECURITY index items 11–13 (2026-08-20)

The ordered walk through §19.2's simplifications index. Items 2–10 closed earlier (recorded in place in
§13/§16/§17/§22); this section covers the last three. Every gate below is **real output from this session**,
not a description of what would happen (`CLAUDE.md` "Before claiming any phase done").

### 23.1 Item 11 — per-approval signed verification receipt

Recorded in full in **§19.1** and **§2**. Landed **in source**: `approveCompletion(VerificationReceipt,
bytes)` now requires an EIP-712 signature from a distinct `aiVerifier` over `{commitmentId, goalId,
milestoneRef, confidence, evidenceHash, verificationHash, modelVersionHash, deadline}`. This is a **contract
ABI change**, so the deployed instance at `0x0076c4269be298429af7827a2a5cc40a65f8f8a8` still has the
one-of-one attestor path — **the redeploy is deliberately left to the user**, because broadcasting it needs a
funded wallet and the AI holds no fund-moving key (rule 3). Gates at closeout: `forge test` **80 passed**,
web receipt suites **52 always-on**.

### 23.2 Item 12 — historical event backfill / chain-sync reconciler — DONE

Full description in **§17** (behaviour, attribution, no-overwrite rule, known limits) and **§14** (the ABI
drift guard the work uncovered). In one line: `POST /api/chain/reconcile` replays the vault's past logs and
reconstructs this wallet's `ChainTransaction` rows, attributed by the contract's own per-wallet index, using
reads only — no key, no broadcast, nothing overwritten.

**New/changed source:** `lib/chain/events.ts` (replay + per-tx collapse + block chunking),
`lib/api/chainReconciler.ts` (orchestrator behind a deps seam), `app/api/chain/reconcile/route.ts`,
`lib/chain/config.ts` (`readVaultDeploymentBlock`), `lib/chain/contractClient.ts`
(`readLatestBlockNumber`, `readVaultLogs` — both pure reads), `lib/chain/abi.ts` (the five missing
refund-escrow declarations), `lib/db/repositories/{goals,commitments}.ts` (wallet-scoped reverse lookups),
`lib/api/dto.ts` (`ChainReconcileResult`), plus `.env.example` / `.env.production.example`
(`COMMITMENT_VAULT_DEPLOYMENT_BLOCK`).

**Tests added:** 46 always-on (`events.test.ts` 15, `chainReconciler.test.ts` 26, `config.test.ts` +3,
`security.test.ts` +2) and 2 DB-gated (`onchainId.integration.test.ts`).

**Gates re-run this session — real output:**

```
$ pnpm --filter web typecheck
> tsc --noEmit                                    (no output = clean)

$ pnpm --filter web lint
> eslint .                                        (no output = clean)

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!

$ pnpm --filter web test
 Test Files  61 passed | 7 skipped (68)
      Tests  506 passed | 76 skipped (582)
```

The 76 skips are the documented DB-/key-/chain-gated suites (§8) — no Postgres, no `GEMINI_API_KEY` and no
funded wallet exist in this sandbox; each prints its own reason and its reproduce command. **No contract
change in this item, so `forge test` was not re-run for it** (item 11's 80-test run is the standing
contract proof).

**Grep gate** (`mock|fake|TODO: real|hardcoded` over the 17 files this item touched): every hit is either a
rule-1 honesty comment that says the code does _not_ do that ("never a fake", "never fake calldata", "no
mocks") or the pre-existing `vi.mock("next/headers")` cookie-store stub in `security.test.ts`. The new files
— `events.ts`, `chainReconciler.ts`, `reconcile/route.ts` and both new suites — contain **zero** hits.

### 23.3 Item 13 — free-tier Gemini kept, privacy boundary made airtight — DONE

Full write-up in **§10.1**. The item explicitly asked to **keep** the free tier (no paid-tier migration) and
instead prove the privacy boundary holds, so this closes as "reviewed, kept, and now enforced" rather than as
a migration.

**What was confirmed (by reading the real code, then pinning it with tests):**

- **No raw evidence bytes or text ever reach the model.** `wrapEvidence` — the fence helper for evidence text
  — has **no production call site** at all (only its own unit test and the `commitai guard` CLI demo).
  `analyzeEvidence` is the only file in `lib/ai/` that touches an `Evidence` row, and it takes exactly
  `type`, `id`, `goalId` and `contentHash` off it, because the verdict comes from the deterministic
  reality-check engine keyed on evidence **type** and history (§12), never from the text. `contentText` /
  `storageKey` appear **nowhere** under `lib/ai/`. Nothing loads stored evidence into a chat transcript: the
  only `userMessage` builders (`app/create/CreateGoal.tsx`, `app/check-in/CheckIn.tsx`) send exactly what the
  user typed.
- **The decision log stores an id only.** `createDecisionInput` bounds `evidenceRef` to 256 chars against an
  `Evidence.contentText` ceiling of 20,000, and the repo's single writer passes `evidence.id`.

**What was added** — `lib/ai/privacyBoundary.test.ts`, **11 always-on tests** (no key, no network, no DB) in
three independent layers (reachability source guard / single-egress source guard / behavioural payload capture
through the real `runTurn`), plus the `createDecisionInput` bound and the one-writer source guard. The
reachability guard was **verified to bite**: appending `evidence.contentText` to `lib/ai/runner.ts` makes it
fail, and reverting makes it pass again. Documentation: new **§10.1** (judge-facing statement that the free
tier is a deliberate tradeoff with the mitigation, not an oversight), the §19.2 index entry, and both env
examples reworded — `.env.production.example` previously said "Use a PAID tier", which contradicted this
item's decision.

**Gates re-run this session — real output:**

```
$ pnpm --filter web typecheck
> tsc --noEmit                                    (no output = clean)

$ pnpm --filter web lint
> eslint .                                        (no output = clean)

$ pnpm format:check
> prettier --check .
Checking formatting...
All matched files use Prettier code style!

$ pnpm --filter web test
 Test Files  62 passed | 7 skipped (69)
      Tests  517 passed | 76 skipped (593)
```

**No contract change**, so `forge test` was not re-run for this item (item 11's 80-test run stands as the
contract proof). **Grep gate** over the files this item touched
(`lib/ai/privacyBoundary.test.ts`, `.env.example`, `.env.production.example`):
`grep -E "mock|fake|TODO: real|hardcoded"` returns **zero hits**.

**Items 11–13 are now complete.** What remains is operational and the user's, unchanged: rotate the three
exposed secrets, refresh the git credential and push, set production secrets, apply migrations, and redeploy
the vault so item 11's signed-receipt ABI is live.
