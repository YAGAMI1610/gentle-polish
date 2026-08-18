# DEMO.md — CommitAI end-to-end demo script (build sequence §14 step 12)

The judge-facing walkthrough for `CommitAI-Build-Prompt.md` **§15**, run against the **real deployed app**:
real wallet (SIWE), real Postgres, real Gemini conversations, and real BOT Chain testnet transactions the
**depositor's own wallet signs**. Nothing on this path is mocked — where a capability is not wired, the app
returns an honest `503`/"not configured", never a fake (see [`LIMITATIONS.md`](./LIMITATIONS.md)).

Two beats (**3** and **5**) require a **real wallet signature**. Per money-safety rule 3 the backend holds
no fund-moving key, so those signatures happen in a browser wallet — this demo is therefore **human-driven,
not headless**. A fully-automated Playwright run of the _signed_ path is deliberately not shipped (it would
require a fund-moving key in the harness); see [Limitations touched by this demo](#limitations-touched-by-this-demo).

---

## The money-safety spine (read this before the beats)

Every fund-moving action follows the same three-step path, so a judge can verify the backend never moves a
depositor's money:

1. **Prepare** — the backend returns calldata only: `{ chainId, to, data, value }` (`PreparedTx`). It
   encodes the call; it does **not** broadcast and holds no signer for it.
2. **Sign** — the **depositor's own wagmi wallet** signs and broadcasts (`hooks/useChainTx.ts`).
3. **Record** — after the wallet returns a **real** tx hash, the client `POST`s it to `/api/chain/record`,
   which stores the `ChainTransaction` row. A row is written only for a hash a wallet actually produced.

The backend's **only** on-chain key is the **attestor** (`getAttestorClient()` — a frozen 4-method surface:
`approveCompletion`, `registerMilestone`, `requestCompletion`, `setAttestor`). **None of the four moves
value.** Approval flips a status; principal and reward leave the vault only via depositor-signed,
pull-based `releasePrincipal` / `claimReward`. The full trust model is in `LIMITATIONS.md` §19.1.

---

## Prerequisites (one-time setup)

Base setup lives in [`README.md`](./README.md) → **Development** and **On-chain deployment**. This section
adds only what the live demo needs.

### 1. Rotate secrets, then put them in `apps/web/.env` (gitignored — never commit, never paste in chat)

The three secrets exposed during this build **must be rotated/revoked before the demo**: the GitHub PAT
(revoke), the deployer/attestor private key (generate a fresh one), and the Gemini API key (regenerate).
Set the fresh values in `apps/web/.env` (copy `apps/web/.env.example` for the full key list):

| Key                                    | Purpose                              | Notes                                                                |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`                         | Postgres connection                  | e.g. the `docker compose` db below                                   |
| `GEMINI_API_KEY`                       | real AI conversations & verification | unset ⇒ AI routes return honest `503`                                |
| `SESSION_PASSWORD`                     | iron-session cookie encryption       | **≥ 32 chars**, no fallback — app refuses to start without it        |
| `ATTESTOR_PRIVATE_KEY`                 | backend attestor (value-neutral)     | the fresh key's **only** destination; moves no funds                 |
| `COMMITMENT_VAULT_ADDRESS`             | deployed vault                       | `0x0076c4269be298429af7827a2a5cc40a65f8f8a8` (already deployed)      |
| `APP_ORIGIN` / `NEXT_PUBLIC_APP_URL`   | CSRF origin allowlist / base URL     | e.g. `http://localhost:3000`                                         |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect relay (public)         | optional for a browser-extension wallet; needed for WalletConnect QR |

`BOTCHAIN_TESTNET_RPC_URL` / `_CHAIN_ID` / `_EXPLORER_URL` fall back to the live-verified testnet defaults
(`https://rpc.bohr.life`, `968`, `https://scan.bohr.life`) — only set them to override.

### 2. Database

```bash
docker compose up -d db
pnpm --filter web db:generate    # prisma client
pnpm --filter web db:migrate     # prisma migrate deploy
```

### 3. A funded wallet on BOT Chain testnet

Use a browser-extension wallet (e.g. MetaMask). Add **BOT Chain Testnet** — chain id **968**, RPC
`https://rpc.bohr.life`, symbol **BOT** (18 decimals), explorer `https://scan.bohr.life`. Fund it from the
faucet `https://faucet.botchain.ai/basic` with enough **tBOT** to cover the demo commitment — **20 BOT**
principal plus a **2 BOT** reward, plus gas. This is a **different** wallet from the backend attestor.

### 4. Start the app

```bash
pnpm --filter web dev            # http://localhost:3000  (webpack; see LIMITATIONS §7)
```

---

## Preflight — prove the deployed contract is live (no key, moves nothing)

Before demoing, confirm the real testnet contract is reachable. This reuses the shipped live-read test —
it dials the configured RPC, asserts the chain id is **968**, and reads a numeric commitment **status** from
the deployed vault (a pure view call that transfers no value). If the RPC is unreachable it **skips with a
printed reason** rather than faking a result:

```bash
pnpm --filter web test contractClient.integration
```

- Deployed `CommitmentVault`: `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`
  → https://scan.bohr.life/address/0x0076c4269be298429af7827a2a5cc40a65f8f8a8
- Recorded deploy tx: `0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`
  → https://scan.bohr.life/tx/0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4

Optional integrity check before you present: `pnpm --filter web typecheck && pnpm --filter web lint &&
pnpm format:check && pnpm --filter web test && pnpm --filter web build` — all green (DB-/key-/network-gated
suites skip cleanly in an offline sandbox).

---

## Connect (SIWE) — the identity every beat is scoped to

Open `http://localhost:3000`, click **Connect wallet**, and **sign the SIWE message**. The signature proves
wallet ownership; the server issues a single-use nonce and stores an encrypted `commitai_session` cookie.
Every route below resolves the caller from that session — reads for another wallet return `404` (non-leak),
writes return `403`.

---

## The six demo beats (§15)

### Beat 1 — Create a goal via conversational AI

- **Do:** Go to **/create**. Type _"I want to read 10 books this year."_ Answer the AI's slot-filling
  questions (cadence, how you'll prove it, milestones).
- **Real:** `/api/ai/turn` runs the bounded agentic runner against **real Gemini**; the `createGoal` tool
  writes a **goal + milestones + verification strategy** to Postgres. (No Gemini key ⇒ honest `503`.)
- **See:** The new goal on **/goals** with its milestones and chosen verification strategy — read back from
  the DB, not a script.

### Beat 2 — Check in, get scored, watch a milestone verify

- **Do:** Go to **/check-in**. Say _"I finished Atomic Habits."_ Answer the AI's dynamic **content
  questions**.
- **Real:** The `RealityCheckEngine` scores a **confidence %** from your answers; on a passing score the
  milestone is marked **VERIFIED**. The confidence shown is the real `VerificationRecord` value — the old
  hardcoded meter is gone.
- **See:** The milestone flips to VERIFIED with a **visible confidence %** on the goal detail page.

### Beat 3 — Create a self-commitment, sign a real testnet tx 🔑 _(wallet signature)_

- **Do:** Start a commitment on **/commitments** (e.g. **20 BOT** principal, **2 BOT** reward). **Before**
  any signature, the flow shows the **explicit terms**: the **release condition**, the **failure path**, and
  the **cancel path** (`cancelCommitment` returns 100% of principal — invariant I6). Approve, then **sign in
  your wallet**.
- **Real:** The backend returns **prepare-only calldata** (`prepareCreateCommitment`, then `prepareLockFunds`
  with `value` = principal in wei). **Your wallet** signs and broadcasts each; the returned **real hash** is
  posted to `/api/chain/record`. The backend broadcasts nothing.
- **See:** A receipt with the **real tx hash** linked to `https://scan.bohr.life/tx/<hash>` — not a
  `0x…0000` placeholder.
- **Note:** locking targets the on-chain commitment id. If the goal/commitment isn't registered on-chain yet,
  `prepare*` honestly returns `{ prepared: false, reason }` rather than inventing an id (the id-backfill seam,
  `LIMITATIONS.md` §17) — register on-chain first, then lock.

### Beat 4 — Submit further evidence, get verified again

- **Do:** On **/verify** (or a second **/check-in**), submit a written note or upload a file as evidence for
  the goal.
- **Real:** `/api/evidence` runs the real storage pipeline — MIME allowlist + 15 MB cap (`415`/`413` on
  violation), wallet-namespaced content-addressed key, evidence text wrapped as
  `<untrusted-user-evidence>` so it can never trigger a tool call (rule 5). A fresh `RealityCheckEngine`
  pass produces a new real confidence.
- **See:** The evidence recorded (content fingerprint shown) and an updated confidence on the next
  assessment. _(The "Connect data" tab — GitHub/fitness/reading — is a disabled preview; written note + file
  upload are fully real. `LIMITATIONS.md` §17.)_

### Beat 5 — Complete milestones → approve on-chain → withdraw 🔑 _(wallet signature)_

- **Do:** Complete the remaining milestones. The AI, on its **verified** decision meeting the
  confidence threshold, drives `requestCompletion` then `approveCompletion`. Then **you** withdraw: sign
  `releasePrincipal`, and (if the reward is funded) `claimReward`.
- **Real / who signs what — the money-safety crux:**
  - `requestCompletion` + `approveCompletion` are **attestor** calls (backend key). They are **value-neutral**
    — `approveCompletion` is `onlyAttestor`, requires the depositor's write-once `confidenceThreshold` be met
    (`ConfidenceBelowThreshold` reverts otherwise), and **transfers nothing**; it flips status to `Approved`.
  - `releasePrincipal` and `claimReward` are **depositor-signed**, pull-based, one-shot — same
    prepare → **sign in your wallet** → record path as beat 3.
  - (§15 lists "approveCompletion/releasePrincipal" together; the real contract deliberately **separates**
    attestor-approval from depositor-withdrawal so the attestor can never move funds. This is faithful to
    the money-safety model, not a scope cut.)
- **See:** Real tx hashes for approval and for each withdrawal, each linked to `https://scan.bohr.life/tx/<hash>`;
  the reward becomes claimable only after `Approved`.

### Beat 6 — The accountability profile, entirely from real data

- **Do:** Open **/profile**.
- **Real:** Goals completed, streaks, verification history, commitments, rewards, and the **on-chain tx
  list** are all serialized from **real Postgres rows + indexed chain txs** (`lib/api/serializers.ts`).
  Achievements are **derived from real counts** (`deriveAchievements`), not fake `earned` flags.
- **See:** Every number traces to a real row; each on-chain tx links to `https://scan.bohr.life/tx/<hash>`.

---

## Limitations touched by this demo

Cross-referenced in [`LIMITATIONS.md`](./LIMITATIONS.md) (§19.2 is the consolidated index):

- **Human-driven signing.** Beats 3 & 5 need a real wallet signature; no headless/automated key signs on
  this path (money-safety rule 3). Full Playwright automation of the signed flow is deferred. → §8, §19.2
- **Testnet key hygiene.** On this deployment `owner` = `attestor` = deployer (`0xae5c…7607`); money-safe but
  the key appeared in-transcript and **must be rotated** before a real demo. → §2, §19.1
- **On-chain id backfill seam.** `prepare*` returns `{ prepared:false, reason }` for a not-yet-registered
  goal/commitment rather than inventing an id. → §17
- **`/verify` "Connect data" connectors** are a disabled preview; note + file upload are real. → §17
- **Gemini free-tier privacy** — raw evidence is never sent to the model (only hashes anchored). → §10

---

## Honest failure modes (what you'll see if something isn't configured)

- **No `GEMINI_API_KEY`** → AI routes (`/api/ai/turn`) return `503` "AI not configured" — beats 1, 2, 5
  can't run; no fabricated conversation.
- **DB down / not migrated** → reads surface an honest error, not empty fake data.
- **RPC unreachable** → the preflight test **skips with a printed reason**; live reads report unreachable.
- **Wallet on the wrong network** → the app prompts to switch to BOT Chain testnet (968) before signing.
- **Missing/short `SESSION_PASSWORD`** → the app refuses to start (no weak fallback). → `LIMITATIONS.md` §4
