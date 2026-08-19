# Deploying CommitmentVault — roles, separation of duties, and redeploy runbook

This is the operational runbook for deploying (or **re**deploying) `CommitmentVault` to
BOT Chain testnet with a proper separation-of-duties setup. It covers LIMITATIONS.md
**item 3** (redeploy with the escrow fix) and **item 4** (distinct owner/attestor/deployer +
multisig owner).

> **Broadcasting a deploy needs a funded private key. That is a user action.** Nothing in
> this repo broadcasts a transaction for you, and no key is ever pasted into a chat or
> committed. The commands below are run by an operator on a local checkout with their own
> funded, rotated key. See LIMITATIONS.md §2 and item 1 (secret rotation).

## The three roles and what each can (and cannot) do

The contract is built so that **no role can move a depositor's funds** — every transfer is
depositor-signed and pull-based (money-safety invariants I1–I6 in `CommitmentVault.sol`).
Separation of duties is therefore _defence-in-depth_, not a fund-safety requirement; but it
is still the right production posture.

| Role         | Held by                                   | Power                                                           | Cannot                                                    |
| ------------ | ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| **deployer** | a throwaway funded EOA                    | broadcasts the creation tx; nothing after deploy                | move funds; attest; rotate the attestor (once deployed)   |
| **owner**    | a **Safe multisig** (ideally)             | `setAttestor()` only (rotate a compromised attestor key)        | move funds; attest; change any commitment's terms         |
| **attestor** | the backend service wallet (backend-only) | `registerMilestone` / `requestCompletion` / `approveCompletion` | move funds; name a new attestor; touch another commitment |

Worst case if the **attestor** key is stolen: the thief can approve a completion that was not
real, which lets that _specific depositor_ withdraw their own principal early and claim a
reward their own sponsor funded. It cannot redirect a single wei to the attacker. The owner
then rotates the attestor via `setAttestor` — which cannot block or redirect a withdrawal.

## Separation of duties is enforced at deploy time

`script/Deploy.s.sol` calls a pure `validateRoles(deployer, owner, attestor, allowCollapsed)`
gate **before any broadcast**. Unless you opt out, it requires all three accounts to be
distinct and reverts otherwise:

- `attestor != deployer`
- `attestor != owner`
- `owner != deployer`

The gate is unit-tested in `test/Deploy.t.sol` (6 tests). To deliberately collapse roles for a
throwaway local/testnet spike, set `ALLOW_COLLAPSED_ROLES=true` — never do this for an instance
that will hold real value.

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

## Attestor key handling

- Held **only** in the backend secret store as `ATTESTOR_PRIVATE_KEY` (see
  `apps/web/.env.production.example`) — never on a laptop, never in the repo, never the deployer
  key.
- Rotate it with `setAttestor(newAttestor)` from the owner (the Safe). Rotation cannot block or
  redirect any in-flight withdrawal, so it is always safe to rotate on suspicion.

## Redeploy runbook (item 3 — escrow fix)

The **currently live** instance (`0x0076c4269be298429af7827a2a5cc40a65f8f8a8`) predates the §22.2
escrow fix and is immutable. It is still money-safe (principal refund is depositor-only and
non-confiscatory); the fix closes a narrow reward-funder griefing vector. The current source
carries the fix — the `withdrawEscrow()` function and the `escrowedRefunds` mapping in
`CommitmentVault.sol`, proven by `test_withdrawEscrow_*` in the Foundry suite. To put it
on-chain you **redeploy**:

```bash
cd contracts
cp .env.example .env            # then edit .env:
#   PRIVATE_KEY=<your funded, ROTATED testnet key>   (faucet: https://faucet.botchain.ai/basic)
#   INITIAL_OWNER=<Safe multisig address>            (distinct from deployer)
#   INITIAL_ATTESTOR=<backend attestor address>      (distinct from deployer and owner)

forge test                      # 51 tests must pass first
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast -vvvv
```

The broadcast prints the new address + tx hash. Then:

1. Update `COMMITMENT_VAULT_ADDRESS` in the web app env (and `README.md`).
2. Confirm the new instance carries the fix: `escrowedRefunds(<any address>)` is callable (view
   returns 0) and `withdrawEscrow()` exists — both absent on the pre-fix instance.
3. Re-run the live-gated backend read test against the new address.

## Post-deploy checklist

- [ ] `forge test` green (51 tests) before broadcasting.
- [ ] Deployer, owner, attestor are three distinct, rotated accounts (or `ALLOW_COLLAPSED_ROLES`
      consciously set for a throwaway).
- [ ] Owner is (or is promptly transferred to) a Safe multisig.
- [ ] `INITIAL_ATTESTOR` matches the backend `ATTESTOR_PRIVATE_KEY`'s address.
- [ ] New address + tx hash recorded in `README.md` and the app env.
- [ ] Escrow-fix presence verified on the new instance.
