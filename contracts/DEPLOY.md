# Deploying CommitmentVault — roles, separation of duties, and redeploy runbook

This is the operational runbook for deploying (or **re**deploying) `CommitmentVault` to
BOT Chain testnet with a proper separation-of-duties setup. It covers LIMITATIONS.md
**item 3** (redeploy with the escrow fix), **item 4** (distinct owner/attestor/deployer +
multisig owner), and **item 11** (the AI-verifier role and its signed approval receipts).

> **Broadcasting a deploy needs a funded private key. That is a user action.** Nothing in
> this repo broadcasts a transaction for you, and no key is ever pasted into a chat or
> committed. The commands below are run by an operator on a local checkout with their own
> funded, rotated key. See LIMITATIONS.md §2 and item 1 (secret rotation).

## The four roles and what each can (and cannot) do

The contract is built so that **no role can move a depositor's funds** — every transfer is
depositor-signed and pull-based (money-safety invariants I1–I6 in `CommitmentVault.sol`).
Separation of duties is therefore _defence-in-depth_, not a fund-safety requirement; but it
is still the right production posture.

| Role           | Held by                                   | Power                                                                                         | Cannot                                                                            |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **deployer**   | a throwaway funded EOA                    | broadcasts the creation tx; nothing after deploy                                              | move funds; attest; rotate the attestor (once deployed)                           |
| **owner**      | a **Safe multisig** (ideally)             | `setAttestor()` only (rotate a compromised attestor key)                                      | move funds; attest; change any commitment's terms                                 |
| **attestor**   | the backend service wallet (backend-only) | `registerMilestone` / `requestCompletion`; `approveCompletion` **only with a signed receipt** | move funds; approve anything alone; name a new attestor; touch another commitment |
| **aiVerifier** | a second backend key, **signing only**    | signs the EIP-712 `VerificationReceipt` every approval must carry                             | move funds; send any transaction (it is never given a wallet client)              |

Approval is **two-of-two** (invariant I7, item 11): the attestor sends the transaction, and it
only lands if the distinct `aiVerifier` signed a receipt over the exact decision — commitment,
goal, milestone, confidence, evidence hash, model version, expiry. The contract requires the two
addresses to differ, and `ALLOW_COLLAPSED_ROLES` cannot waive that one.

Worst case if the **attestor** key alone is stolen: nothing. It can re-anchor decisions the AI
verifier already signed, and nothing else — a fabricated confidence value has no valid receipt.

Worst case if **both** keys are stolen: the thief can approve a completion that was not real,
which lets that _specific depositor_ withdraw their own principal early and claim a reward their
own sponsor funded. It still cannot redirect a single wei to the attacker. The owner then rotates
either key (`setAttestor` / `setAiVerifier`) — which cannot block or redirect a withdrawal.
Rotating `aiVerifier` also retires every receipt the old key signed.

## Separation of duties is enforced at deploy time

`script/Deploy.s.sol` calls a pure
`validateRoles(deployer, owner, attestor, aiVerifier, allowCollapsed)` gate **before any
broadcast**. One check is unconditional, because it is a contract invariant rather than an opsec
preference — the constructor reverts on it too (`RolesMustDiffer`):

- `attestor != aiVerifier` — **not waivable**, `ALLOW_COLLAPSED_ROLES` cannot buy it back

The rest are defence-in-depth, required unless you opt out:

- `attestor != deployer`
- `attestor != owner`
- `owner != deployer`
- `aiVerifier != deployer`
- `aiVerifier != owner`

The gate is unit-tested in `test/Deploy.t.sol` (10 tests). To deliberately collapse the opsec
roles for a throwaway local/testnet spike, set `ALLOW_COLLAPSED_ROLES=true` — never do this for
an instance that will hold real value.

## Owner as a Safe multisig

The constructor sets the owner **directly** (`Ownable(initialOwner)`), so a multisig can be the
owner from block 0 — no acceptance step is needed at creation. Two supported paths:

1. **Deploy straight to the Safe (recommended).** Create the Safe first, then set
   `INITIAL_OWNER=<safe address>` in `.env`. The vault is owned by the Safe immediately; the
   Safe executes `setAttestor` through its own m-of-n flow.
2. **Deploy then hand off (Ownable2Step).** If you must deploy with an EOA owner first, transfer
   ownership afterwards using the two-step flow (prevents handing ownership to a wrong/dead
   address):
   ```bash
   # 1) current owner proposes the transfer
   cast send $VAULT "transferOwnership(address)" $SAFE --rpc-url botchain_testnet --private-key $OWNER_KEY
   # 2) the Safe accepts (executed as a Safe transaction)
   cast send $VAULT "acceptOwnership()" --rpc-url botchain_testnet   # from the Safe
   ```
   Ownership only moves once the Safe calls `acceptOwnership()`.

## Attestor and AI-verifier key handling

Two separate secrets, two separate addresses, neither able to move funds:

- `ATTESTOR_PRIVATE_KEY` — sends attestation transactions. Rotate with `setAttestor(newAttestor)`
  from the owner (the Safe).
- `AI_VERIFIER_PRIVATE_KEY` — **signs only**. `lib/chain/receipt.ts` builds it into a frozen
  object with exactly an address and `signReceipt`: no wallet client, no RPC transport, no
  `writeContract` (asserted in `lib/chain/receipt.safety.test.ts`). Rotate with
  `setAiVerifier(newAiVerifier)` from the owner; rotation immediately invalidates every receipt
  the old key signed, so it is the right first move on suspicion.

Both are held **only** in the backend secret store (see `apps/web/.env.production.example`) —
never on a laptop, never in the repo, never the deployer key. Neither rotation can block or
redirect an in-flight withdrawal, so rotating is always safe.

`INITIAL_AI_VERIFIER` must equal the address of `AI_VERIFIER_PRIVATE_KEY`, or every approval
reverts with `InvalidVerificationReceipt`. A mismatch is fail-closed: it cannot approve anything
wrongly, it simply cannot approve.

For a stronger posture, `aiVerifier` may be a **contract** rather than an EOA — receipts are
checked through OpenZeppelin's `SignatureChecker`, so any ERC-1271 signer (a Safe, or an M-of-N
threshold verifier) works with **no contract change**. Proven by
`test_approveCompletion_acceptsAnErc1271ContractVerifier`.

## Redeploy runbook (items 3 and 11 — escrow fix + signed receipts)

The **currently live** instance (`0x0076c4269be298429af7827a2a5cc40a65f8f8a8`) predates both the
§22.2 escrow fix and the item 11 signed-receipt approval, and is immutable. It is still
money-safe (principal refund is depositor-only and non-confiscatory); the escrow fix closes a
narrow reward-funder griefing vector, and item 11 makes approval two-of-two. The current source
carries both — `withdrawEscrow()` + the `escrowedRefunds` mapping, and the
`approveCompletion(VerificationReceipt, bytes)` signature with `aiVerifier`/`setAiVerifier` —
proven by `test_withdrawEscrow_*` and the receipt tests in the Foundry suite. To put them
on-chain you **redeploy**:

```bash
cd contracts
cp .env.example .env            # then edit .env:
#   PRIVATE_KEY=<your funded, ROTATED testnet key>   (faucet: https://faucet.botchain.ai/basic)
#   INITIAL_OWNER=<Safe multisig address>            (distinct from deployer)
#   INITIAL_ATTESTOR=<backend attestor address>      (distinct from deployer and owner)
#   INITIAL_AI_VERIFIER=<AI verifier address>        (MUST differ from the attestor)

forge test                      # 80 tests must pass first
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast -vvvv
```

The broadcast prints the new address + tx hash. Then:

1. Update `COMMITMENT_VAULT_ADDRESS` in the web app env (and `README.md`).
2. Confirm the new instance carries the fixes: `escrowedRefunds(<any address>)` is callable
   (view returns 0) and `withdrawEscrow()` exists — both absent on the pre-fix instance — and
   `aiVerifier()` returns your `INITIAL_AI_VERIFIER`.
3. Set `AI_VERIFIER_PRIVATE_KEY` in the backend secret store (the key for that address).
4. Re-run the live-gated backend read test against the new address.

## Post-deploy checklist

- [ ] `forge test` green (80 tests) before broadcasting.
- [ ] Deployer, owner, attestor, aiVerifier are four distinct, rotated accounts (or
      `ALLOW_COLLAPSED_ROLES` consciously set for a throwaway — it still cannot collapse
      attestor and aiVerifier).
- [ ] Owner is (or is promptly transferred to) a Safe multisig.
- [ ] `INITIAL_ATTESTOR` matches the backend `ATTESTOR_PRIVATE_KEY`'s address.
- [ ] `INITIAL_AI_VERIFIER` matches the backend `AI_VERIFIER_PRIVATE_KEY`'s address, and
      `aiVerifier()` on the new instance returns it.
- [ ] New address + tx hash recorded in `README.md` and the app env.
- [ ] Escrow-fix presence verified on the new instance.
