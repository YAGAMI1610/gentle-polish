# Pixel Perfect Clone

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b4e55b2e-205b-473b-95e5-35d9a663ffbb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## On-chain deployment (BOT Chain testnet)

The `CommitmentVault` contract (`contracts/src/CommitmentVault.sol`) is built,
tested (`forge test`), and **deployed to BOT Chain testnet**. The backend contract
client (`apps/web/lib/chain/`) reads it live — the values below are the real,
on-chain record of that deployment (verified against the block explorer, not
invented per `CLAUDE.md` rule 1):

| What                    | Value                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Network                 | BOT Chain testnet (chain id `968`, RPC `https://rpc.bohr.life`)                              |
| CommitmentVault address | `0x0076c4269be298429af7827a2a5cc40a65f8f8a8`                                                 |
| Deploy tx hash          | `0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4`                         |
| Explorer (tx)           | https://scan.bohr.life/tx/0xde9e4426f467460a5aa592e765b2427d207b9dcc32e8fb2bfb58e94eb879cdd4 |
| Explorer (contract)     | https://scan.bohr.life/address/0x0076c4269be298429af7827a2a5cc40a65f8f8a8                    |

> **Testnet trust setup:** on this deployment the contract `owner`, the `attestor`,
> and the deployer are the **same** address (`0xae5c…7607`). This is money-safe — the
> contract lets neither `owner` nor `attestor` move a depositor's funds (every
> transfer is depositor-signed and pull-based; see `contractClient.safety.test.ts` and
> LIMITATIONS §2/§14) — but for production these roles should be **separated** and the
> attestor key rotated. See LIMITATIONS §2.

**Deploy your own instance (needs a funded testnet key — never paste a key into an
agent transcript).** From a local checkout:

```sh
cd contracts
cp .env.example .env
# then edit contracts/.env:
#   PRIVATE_KEY=<your funded testnet key>     # get tBOT: https://faucet.botchain.ai/basic
#   INITIAL_ATTESTOR=<backend attestor address>
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast -vvvv
```

The broadcast prints the deployed address and the deploy tx hash. Record them in the
table above and wire the address into the web app's environment:

Then in `apps/web/.env` set `COMMITMENT_VAULT_ADDRESS` to the deployed address (and,
for the backend to attest, `ATTESTOR_PRIVATE_KEY` — a key that per the contract can
**only** attest and can never move funds; see `apps/web/.env.example`). Once
`COMMITMENT_VAULT_ADDRESS` is set, the live-gated contract read in
`apps/web/lib/chain/contractClient.integration.test.ts` exercises the deployed vault
instead of skipping.
