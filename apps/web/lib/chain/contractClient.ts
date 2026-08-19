import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { commitmentVaultAbi } from "./abi";
import { buildBotchainTestnet } from "./botchain";
import { readAttestorKey, readChainConfig, type ChainConfig } from "./config";

/**
 * `CommitmentVault` client (build sequence §14.8) — the ONLY place backend code talks
 * to the chain. Its shape is the money-safety guarantee in code form (CLAUDE.md rules
 * 2–3), and `contractClient.safety.test.ts` asserts that shape so it cannot regress:
 *
 *  - Reads (`get*`, `read*`) are unauthenticated view calls — they move nothing.
 *  - The attestor client (`getAttestorClient`) exposes EXACTLY the four functions the
 *    contract lets the attestor call — registerMilestone, requestCompletion,
 *    approveCompletion, setAttestor — none of which transfer value. There is no
 *    `lockFunds`/`claimReward`/`releasePrincipal`/`fundReward`/`createCommitment`/
 *    `cancelCommitment` method on it, so the backend key literally cannot call them.
 *  - Every value-moving action is a pure `prepare*` encoder returning calldata for the
 *    DEPOSITOR's own wallet to sign (step 9). The backend never broadcasts these and
 *    never holds a key that could.
 *
 * Nothing here fabricates a result: with no deployed contract or no key, the relevant
 * function throws an honest "not configured" error (rule 1) rather than returning a
 * placeholder.
 */

function chainFor(config: ChainConfig) {
  return buildBotchainTestnet({
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    explorerUrl: config.explorerUrl,
  });
}

function requireVault(config: ChainConfig): Address {
  if (!config.vaultAddress) {
    throw new Error(
      "chain not configured: COMMITMENT_VAULT_ADDRESS is unset (no deployed contract). " +
        "Deploy the vault and set the address — see README.md / LIMITATIONS.md step 8.",
    );
  }
  return config.vaultAddress;
}

/**
 * A 32-byte sha256 hex digest (64 hex chars, with or without `0x`) as a bytes32 `Hex`.
 * The DB stores content/verification hashes as bare 64-hex; the contract wants bytes32.
 */
export function hashToBytes32(hash: string): Hex {
  const hex = hash.startsWith("0x") ? hash.slice(2) : hash;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("expected a 32-byte (64 hex char) hash for bytes32");
  }
  return `0x${hex.toLowerCase()}` as Hex;
}

/**
 * A stable bytes32 on-chain reference for a milestone, derived deterministically
 * from its off-chain DB id via keccak256. `registerMilestone`'s `milestoneRef` is
 * an opaque tag chosen by the caller; deriving it from the id keeps the on-chain
 * anchor and the DB row linked without publishing the id itself.
 */
export function milestoneRefFromId(milestoneId: string): Hex {
  return keccak256(toHex(milestoneId));
}

// ---------------------------------------------------------------------------
// Reads — view calls, no funds, no key
// ---------------------------------------------------------------------------

export function getPublicClient(config: ChainConfig = readChainConfig()) {
  return createPublicClient({ chain: chainFor(config), transport: http(config.rpcUrl) });
}

/** Live chain id from the RPC. Proves the client really talks to BOT Chain testnet. */
export async function getChainId(config: ChainConfig = readChainConfig()): Promise<number> {
  return getPublicClient(config).getChainId();
}

export async function readCommitment(
  commitmentId: bigint,
  config: ChainConfig = readChainConfig(),
) {
  return getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "getCommitment",
    args: [commitmentId],
  });
}

export async function readCommitmentStatus(
  commitmentId: bigint,
  config: ChainConfig = readChainConfig(),
): Promise<number> {
  const raw = await getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "getCommitmentStatus",
    args: [commitmentId],
  });
  return Number(raw);
}

export async function readGoal(goalId: bigint, config: ChainConfig = readChainConfig()) {
  return getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "getGoal",
    args: [goalId],
  });
}

export async function readWalletGoals(wallet: Address, config: ChainConfig = readChainConfig()) {
  return getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "getWalletGoals",
    args: [wallet],
  });
}

export async function readWalletCommitments(
  wallet: Address,
  config: ChainConfig = readChainConfig(),
) {
  return getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "getWalletCommitments",
    args: [wallet],
  });
}

export async function readMilestones(goalId: bigint, config: ChainConfig = readChainConfig()) {
  return getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "getMilestones",
    args: [goalId],
  });
}

export async function readCancellationOpensAt(
  commitmentId: bigint,
  config: ChainConfig = readChainConfig(),
): Promise<bigint> {
  return getPublicClient(config).readContract({
    address: requireVault(config),
    abi: commitmentVaultAbi,
    functionName: "cancellationOpensAt",
    args: [commitmentId],
  });
}

/**
 * Fetch a mined transaction's receipt (build-prompt §14.8 back-fill seam). Used by the
 * on-chain-id back-fill to recover the emitted `goalId` / `commitmentId` from the receipt
 * logs after the DEPOSITOR's own wallet broadcasts `registerGoal` / `createCommitment`.
 * A pure read — moves nothing, needs no key. Throws viem's own error if the hash is
 * unknown / not yet mined (the caller decides whether that is fatal or just "try later").
 */
export async function readTransactionReceipt(txHash: Hex, config: ChainConfig = readChainConfig()) {
  return getPublicClient(config).getTransactionReceipt({ hash: txHash });
}

// ---------------------------------------------------------------------------
// Event-log parsers — pure, no network. Recover the id the contract emitted so
// `prepare*` can stop returning {prepared:false} once a goal/commitment is on-chain.
// ---------------------------------------------------------------------------

export interface GoalRegisteredInfo {
  readonly goalId: bigint;
  readonly owner: Address;
}

export interface CommitmentCreatedInfo {
  readonly commitmentId: bigint;
  readonly goalId: bigint;
  readonly depositor: Address;
}

/**
 * Decode the `GoalRegistered(goalId, owner, goalHash)` event OUR vault emitted from a
 * receipt's logs, returning the on-chain `goalId` and `owner`. Only a log emitted by
 * `config.vaultAddress` counts — a same-signature event from any other contract in the
 * same transaction is ignored, so a spoofed log can never inject a foreign id. Returns
 * null when no such log is present (honest: nothing to back-fill).
 */
export function parseGoalRegistered(
  logs: readonly Log[],
  config: ChainConfig = readChainConfig(),
): GoalRegisteredInfo | null {
  const vault = requireVault(config);
  const decoded = parseEventLogs({
    abi: commitmentVaultAbi,
    eventName: "GoalRegistered",
    logs: logs as Log[],
  });
  const fromVault = decoded.find((l) => l.address.toLowerCase() === vault.toLowerCase());
  if (!fromVault) return null;
  return { goalId: fromVault.args.goalId, owner: fromVault.args.owner };
}

/**
 * Decode the `CommitmentCreated(commitmentId, goalId, depositor, …)` event OUR vault
 * emitted from a receipt's logs, returning the on-chain `commitmentId`, its `goalId`,
 * and the `depositor`. Same vault-address filter as `parseGoalRegistered`. Returns null
 * when no such log is present.
 */
export function parseCommitmentCreated(
  logs: readonly Log[],
  config: ChainConfig = readChainConfig(),
): CommitmentCreatedInfo | null {
  const vault = requireVault(config);
  const decoded = parseEventLogs({
    abi: commitmentVaultAbi,
    eventName: "CommitmentCreated",
    logs: logs as Log[],
  });
  const fromVault = decoded.find((l) => l.address.toLowerCase() === vault.toLowerCase());
  if (!fromVault) return null;
  return {
    commitmentId: fromVault.args.commitmentId,
    goalId: fromVault.args.goalId,
    depositor: fromVault.args.depositor,
  };
}

// ---------------------------------------------------------------------------
// Attestor client — the ONLY writes the backend can make. None move funds.
// ---------------------------------------------------------------------------

export interface RegisterMilestoneArgs {
  readonly goalId: bigint;
  readonly milestoneRef: Hex;
  readonly verificationHash: Hex;
  readonly confidence: number;
}

export interface RequestCompletionArgs {
  readonly commitmentId: bigint;
  readonly verificationHash: Hex;
}

export interface ApproveCompletionArgs {
  readonly commitmentId: bigint;
  readonly verificationHash: Hex;
  readonly confidence: number;
}

/**
 * The attestor's capability set. Intentionally the exact four attestor-permitted,
 * value-neutral contract functions and nothing else — see the module doc and the
 * safety test. Returns a real broadcast tx hash for each.
 */
export interface AttestorClient {
  registerMilestone(args: RegisterMilestoneArgs): Promise<Hex>;
  requestCompletion(args: RequestCompletionArgs): Promise<Hex>;
  approveCompletion(args: ApproveCompletionArgs): Promise<Hex>;
  setAttestor(newAttestor: Address): Promise<Hex>;
}

/**
 * Build the attestor wallet client. Throws an honest error when the key or the deployed
 * contract is missing (never a fake). The returned object is frozen and carries only the
 * four safe methods — there is no code path on it that can move a depositor's funds.
 */
export function getAttestorClient(
  config: ChainConfig = readChainConfig(),
  key: `0x${string}` | null = readAttestorKey(),
): AttestorClient {
  if (!key) {
    throw new Error(
      "attestor not configured: ATTESTOR_PRIVATE_KEY is unset. The backend cannot attest " +
        "until it is set (this key can only attest — it can never move funds). See LIMITATIONS.md.",
    );
  }
  const vault = requireVault(config);
  const chain = chainFor(config);
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  return Object.freeze<AttestorClient>({
    registerMilestone: ({ goalId, milestoneRef, verificationHash, confidence }) =>
      wallet.writeContract({
        address: vault,
        abi: commitmentVaultAbi,
        functionName: "registerMilestone",
        args: [goalId, milestoneRef, verificationHash, confidence],
      }),
    requestCompletion: ({ commitmentId, verificationHash }) =>
      wallet.writeContract({
        address: vault,
        abi: commitmentVaultAbi,
        functionName: "requestCompletion",
        args: [commitmentId, verificationHash],
      }),
    approveCompletion: ({ commitmentId, verificationHash, confidence }) =>
      wallet.writeContract({
        address: vault,
        abi: commitmentVaultAbi,
        functionName: "approveCompletion",
        args: [commitmentId, verificationHash, confidence],
      }),
    setAttestor: (newAttestor) =>
      wallet.writeContract({
        address: vault,
        abi: commitmentVaultAbi,
        functionName: "setAttestor",
        args: [newAttestor],
      }),
  });
}

// ---------------------------------------------------------------------------
// prepare* — pure calldata for the DEPOSITOR's wallet to sign. No broadcast.
// ---------------------------------------------------------------------------

/** An unsigned transaction request for a user's wallet (step 9). Backend never sends it. */
export interface PreparedTx {
  readonly chainId: number;
  readonly to: Address;
  readonly data: Hex;
  /** Wei to attach. Non-zero only for the payable deposits the depositor themselves signs. */
  readonly value: bigint;
}

export interface CreateCommitmentTerms {
  readonly goalId: bigint;
  readonly principalWei: bigint;
  readonly rewardWei: bigint;
  readonly deadline: bigint; // unix seconds; 0 = open-ended
  readonly gracePeriodSeconds: bigint;
  readonly confidenceThreshold: number; // 1..100
}

export function prepareRegisterGoal(
  goalHash: Hex,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "registerGoal",
      args: [goalHash],
    }),
    value: 0n,
  };
}

export function prepareCreateCommitment(
  terms: CreateCommitmentTerms,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "createCommitment",
      args: [
        terms.goalId,
        terms.principalWei,
        terms.rewardWei,
        terms.deadline,
        terms.gracePeriodSeconds,
        terms.confidenceThreshold,
      ],
    }),
    value: 0n, // createCommitment fixes terms only; principal is attached later in lockFunds.
  };
}

export function prepareLockFunds(
  commitmentId: bigint,
  principalWei: bigint,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "lockFunds",
      args: [commitmentId],
    }),
    value: principalWei, // the depositor's own signed deposit
  };
}

export function prepareFundReward(
  commitmentId: bigint,
  rewardWei: bigint,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "fundReward",
      args: [commitmentId],
    }),
    value: rewardWei,
  };
}

export function prepareReleasePrincipal(
  commitmentId: bigint,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "releasePrincipal",
      args: [commitmentId],
    }),
    value: 0n,
  };
}

export function prepareClaimReward(
  commitmentId: bigint,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "claimReward",
      args: [commitmentId],
    }),
    value: 0n,
  };
}

export function prepareCancelCommitment(
  commitmentId: bigint,
  config: ChainConfig = readChainConfig(),
): PreparedTx {
  return {
    chainId: config.chainId,
    to: requireVault(config),
    data: encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "cancelCommitment",
      args: [commitmentId],
    }),
    value: 0n,
  };
}
