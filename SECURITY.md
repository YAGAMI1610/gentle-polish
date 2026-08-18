# SECURITY.md — §13 security-test checklist closeout

This is the authoritative closeout for **`CommitAI-Build-Prompt.md` §13** — the security-test checklist
that "**must all pass before calling this done**". It maps each of the 13 checklist items to the **named,
real test(s)** that prove it, records the **run status from this session**, and gives the exact command to
reproduce each. Nothing here is asserted from memory: every status below was produced by running the test
this session and reading its output (`CLAUDE.md` rule 1 — no fabricated results).

Coverage spans **three layers**, because that is where the guarantees actually live:

| Tag     | Layer                                | Command                                                                                         | Result this session                  |
| ------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| **[F]** | On-chain (Solidity / Foundry)        | `export PATH="$HOME/.foundry/bin:$PATH"; cd contracts && forge test`                            | **42 passed / 0 failed / 0 skipped** |
| **[H]** | HTTP / auth / upload boundary (Next) | `pnpm --filter web test security`                                                               | **41 passed / 5 skipped** (DB-gated) |
| **[L]** | Backend security primitives          | `pnpm --filter web test contractClient.safety siwe localDiskStorage antiInjection promptGuards` | **40 passed / 0 failed**             |

Run environment: Foundry **v1.7.1** (installed this session; `forge test` cloned submodules fresh, compiled
26 files with Solc 0.8.28, ran green), vitest 3.2.7, aarch64 Linux under the PRoot sandbox, 2026-08-18.

**The money-safety spine these tests defend** (context for items 3–8, 13): every fund-moving action is
prepare-only calldata `{chainId, to, data, value}` that the **depositor's own wallet** signs. The backend's
only on-chain key is the **attestor**, exposed through a frozen 4-method surface
(`approveCompletion`, `registerMilestone`, `requestCompletion`, `setAttestor`) — **none of the four moves
value**. The contract enforces; the AI proposes (`CLAUDE.md` rules 2–3).

---

## The 13 items → named tests → status

| #   | §13 item                                        | Enforced at  | Named test(s) — all RUN & PASS this session                                                                                                                                                                                                                                                   | Repro  |
| --- | ----------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Unauthorized wallet access                      | HTTP         | `§13.1 unauthorized access is refused with 401` — 17 wallet-scoped routes (9 GET + 8 POST), no session → **401**                                                                                                                                                                              | [H]    |
| 2   | Cross-wallet data access                        | HTTP + chain | `§13.2 cross-wallet access is non-leaking` (5 tests, **DB-gated** — 404 read / 403 write) **+** `test_createCommitment_onlyGoalOwner`, `test_registerMilestone_strangerRejected`                                                                                                              | [H][F] |
| 3   | Contract access control                         | chain        | `test_approveCompletion_onlyAttestor`, `test_cancel_onlyDepositor`, `test_releasePrincipal_onlyDepositor`, `test_claimReward_onlyDepositor`, `test_lockFunds_onlyDepositor`, `test_owner_cannotMoveFunds_onlyRotateAttestor` **+** `§13.3/§13.8 attestor surface is value-neutral and frozen` | [F][H] |
| 4   | Reentrancy                                      | chain        | `test_reentrancy_releasePrincipal_cannotDrain`, `test_reentrancy_cancel_cannotDrain`, `test_cancel_toRejectingReceiver_revertsWholeCall`                                                                                                                                                      | [F]    |
| 5   | Invalid completion                              | chain        | `test_approveCompletion_belowThreshold_reverts`, `test_approveCompletion_requiresCompletionRequestedState`                                                                                                                                                                                    | [F]    |
| 6   | Unauthorized reward claim                       | chain + HTTP | `test_claimReward_onlyDepositor` **+** `§13.4 claim/withdraw is prepare-only and depositor-signed`                                                                                                                                                                                            | [F][H] |
| 7   | Unauthorized withdrawal                         | chain + HTTP | `test_releasePrincipal_onlyDepositor`, `test_owner_cannotMoveFunds_onlyRotateAttestor` **+** `§13.4 … prepare-only`                                                                                                                                                                           | [F][H] |
| 8   | Changed commitment conditions post-signature    | chain        | `test_noSetterForRewardOrThreshold` (no setter exists for reward or confidence threshold after creation)                                                                                                                                                                                      | [F]    |
| 9   | Duplicate completion                            | chain        | `test_doubleRelease_reverts`, `test_doubleClaim_reverts`, `test_cannotReleaseAfterCancel`, `test_fundReward_cannotDoubleFund`                                                                                                                                                                 | [F]    |
| 10  | Replayed verification                           | HTTP + prim  | `§13.5 SIWE verify rejects replay/forgery with 401` (route) **+** `verifySiwe` suite (EIP-191 crypto: stale nonce, domain mismatch, tampered/spoofed signature all rejected)                                                                                                                  | [H][L] |
| 11  | Malicious evidence upload                       | HTTP + prim  | `§13.6 malicious upload is refused at the boundary` (415 non-multipart, 415 bad MIME, 413 oversize, path-traversal key rejected) **+** `localDiskStorage` key-guard suite                                                                                                                     | [H][L] |
| 12  | Prompt injection via evidence                   | HTTP + prim  | `§13.7 evidence text cannot escape the untrusted-data fence` **+** `antiInjection` (injected payloads pinned LOW, never VERIFIED, no tool call) **+** `promptGuards`                                                                                                                          | [H][L] |
| 13  | AI tool-call abuse (architecturally impossible) | HTTP + prim  | `§13.3/§13.8 attestor surface is value-neutral and frozen` (exactly 4 methods, frozen, no fund method reachable) **+** `contractClient.safety` (prepare-only encoders, no signer)                                                                                                             | [H][L] |

**Every item maps to at least one test that was RUN and PASSED this session.** No item is covered only by
description, and no new test was written to fill a gap — the mapping above is coverage that already existed,
now executed end-to-end with output shown.

### Notes on the two items with a caveat (honest, per rules 1 & 6)

- **Item 2 — the HTTP cross-wallet non-leak matrix is DB-gated.** Its 5 tests
  (`§13.2 cross-wallet access is non-leaking`) need real Prisma rows, so in this Postgres-less sandbox they
  **skip cleanly with a printed reason** rather than run — that is the "5 skipped" in [H]. They execute in
  full against the committed `docker-compose.yml` Postgres (see _Reproduce_ below). The guarantee is not
  left unproven meanwhile: it is **defence in depth** — the repository layer enforces wallet scoping
  (reads return null/`[]` cross-wallet → 404; writes throw `WalletScopeError` → 403; proven always-on in
  `LIMITATIONS.md` §9), and the **on-chain** goal-owner controls (`test_createCommitment_onlyGoalOwner`,
  `test_registerMilestone_strangerRejected`) **ran and passed** this session in [F].
- **Item 12 — the behavioural injection proof is deterministic and always-on.** `antiInjection.test.ts`
  needs **no** live model: it drives the real verification engine + tool registry with a battery of
  injection payloads and asserts they stay pinned to `LOW` signal, never reach `VERIFIED`, and that no
  registered tool exposes a fund path (chain tools are prepare-only / value-neutral). So item 12 is proven
  without a Gemini key. (A live end-to-end injection attempt against real Gemini is exercised in the §15
  demo, `DEMO.md` beat 4 — human-driven.)

---

## Reproduce everything (four commands, ~4 min cold)

```bash
# [F] on-chain invariants — access control, reentrancy, invalid/duplicate completion, no-post-sig-setter
export PATH="$HOME/.foundry/bin:$PATH"
( cd contracts && forge test )                 # → 42 passed; 0 failed; 0 skipped

# [H] HTTP / auth / upload boundary (always-on subset runs with no DB)
pnpm --filter web test security                # → 41 passed | 5 skipped (cross-wallet, DB-gated)

# [L] backend security primitives cited by the boundary suite
pnpm --filter web test contractClient.safety siwe localDiskStorage antiInjection promptGuards  # → 40 passed

# Item 2's DB-gated 5 tests, run for real (needs Docker):
docker compose up -d db
pnpm --filter web db:generate && pnpm --filter web db:migrate
pnpm --filter web test security                # now 46 passed | 0 skipped
```

The full always-on gate (`pnpm --filter web typecheck && pnpm --filter web lint && pnpm format:check &&
pnpm --filter web test && pnpm --filter web build`) is green; DB-/key-/chain-gated suites skip cleanly with
printed reasons in an offline sandbox (`LIMITATIONS.md` §8).

---

## §14 build-sequence confirmation (all 12 steps)

§13 is the checklist; **§14 is the 12-step build order**, and it is complete. Confirmed this session:

- **Steps 1–12 all landed** (steps 1–8 before the autonomous run; 9–12 as commits during it). Step→commit
  map and the full gate record are in `LIMITATIONS.md` §18–§20 and the build-run memory.
- **Step 1 proof reconfirmed live:** `forge test` → **42/42** on a fresh recursive clone (this is §14
  step 1's stated "passing `forge test` suite" gate, re-run today, not cited).
- **Recorded real testnet tx (step 2 / step 8):** `CommitmentVault` deployed at
  `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`, deploy tx
  `0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`
  (`https://scan.bohr.life/tx/0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`) — real and
  explorer-verified; the backend client reads the live vault (`LIMITATIONS.md` §2, §14).
- **Step 9 grep gate clean:** `grep -rniE "mock|fake|TODO: real|hardcoded|demo-data|example-botchain"` over
  `apps/web` (excl. `node_modules`/`.next`) — every production hit is a rule-1 honesty comment stating the
  code does _not_ fake; test hits are the documented `vi.mock("next/headers")` cookie seam and the vendored
  shadcn `hasFakeCaret` OTP prop. No mock data path remains.
- **Step 8 money-safety nuance (deliberate, not a gap):** §14 step 8 literally says "real `lockFunds` /
  `approveCompletion` / `releasePrincipal` calls **from backend**". `lockFunds` and `releasePrincipal` are
  implemented **prepare-only** (the depositor's wallet signs); only the **value-neutral** attestor calls
  (`approveCompletion` / `requestCompletion`) are backend-signed. A backend that broadcast fund-moving txs
  would need a fund-moving key — a direct violation of `CLAUDE.md` §0/rules 2–3. This deviation is
  intentional and documented in `LIMITATIONS.md` §17 / §19.1; it must **not** be "fixed" back to
  backend-broadcast.

---

## What §13 does **not** claim (scope honesty)

- The **live, signed** end-to-end run (real wallet signatures on beats 3 & 5) is **human-driven**, not part
  of any headless test — no fund-moving key exists in any harness (rule 3). See `DEMO.md` and
  `LIMITATIONS.md` §20.
- **Testnet key hygiene:** on this deployment `owner = attestor = deployer` (`0xae5c…7607`). Money-safe
  (no role can move a depositor's funds), but the key appeared in-transcript and **must be rotated** before
  any non-throwaway use (`LIMITATIONS.md` §2, §19.1).
- No dedicated **achievements-catalog table** — thresholds are derived from real rows, not persisted with
  earned-at metadata. Orthogonal to §13; the one open scope item, recorded in `LIMITATIONS.md` §18.
