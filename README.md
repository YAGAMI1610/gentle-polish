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

The `CommitmentVault` contract (`contracts/src/CommitmentVault.sol`) is built and
tested (`forge test`), and the backend contract client (`apps/web/lib/chain/`) talks
to BOT Chain testnet — a live read of the chain id returns **968** even before a
contract is deployed. What is **not** yet done is the actual testnet deploy: no
transaction has been broadcast, so there is no real tx hash to record. Per
`CLAUDE.md` rule 1, none is invented here — the placeholders below stay empty until a
real `forge script` broadcast fills them in.

**Deploy it yourself (needs a funded testnet key — never paste a key into an agent
transcript).** From a local checkout:

```sh
cd contracts
cp .env.example .env
# then edit contracts/.env:
#   PRIVATE_KEY=<your funded testnet key>     # get tBOT: https://faucet.botchain.ai/basic
#   INITIAL_ATTESTOR=<backend attestor address>
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast -vvvv
```

The broadcast prints the deployed address and the deploy tx hash. Record them here
and wire the address into the web app's environment:

| What                    | Value                                                           |
| ----------------------- | --------------------------------------------------------------- |
| Network                 | BOT Chain testnet (chain id `968`, RPC `https://rpc.bohr.life`) |
| CommitmentVault address | _(paste after deploy)_                                          |
| Deploy tx hash          | _(paste after deploy)_                                          |
| Explorer                | `https://scan.bohr.life/tx/<txHash>`                            |

Then in `apps/web/.env` set `COMMITMENT_VAULT_ADDRESS` to the deployed address (and,
for the backend to attest, `ATTESTOR_PRIVATE_KEY` — a key that per the contract can
**only** attest and can never move funds; see `apps/web/.env.example`). Once
`COMMITMENT_VAULT_ADDRESS` is set, the live-gated contract read in
`apps/web/lib/chain/contractClient.integration.test.ts` exercises the deployed vault
instead of skipping.
