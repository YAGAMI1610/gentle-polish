"use client";

/**
 * The single money-moving path in the app (build step 9, phase 3; CLAUDE.md
 * rules 1–3). A `prepare*` route returns unsigned calldata (`PreparedTxDto`); this
 * hook has the USER's own wallet sign and broadcast it, waits for the receipt,
 * then records the REAL hash via `/api/chain/record`. The backend never signs and
 * never broadcasts — it only ever indexes a hash the wallet already produced, so
 * no transaction hash is ever invented (rule 1).
 *
 * Uses wagmi core actions (not hooks) so the send → wait → record sequence is one
 * imperative flow inside a mutation.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { getAccount, sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";

import { apiPost } from "@/lib/api/client";
import { explorerTxUrl } from "@/lib/chain/botchain";
import type { ChainRecordRequest, ChainRecordResult, PreparedTxDto } from "@/lib/api/dto";

export interface SignAndRecordInput {
  /** Unsigned calldata from a `prepare*` route for the user's wallet to sign. */
  transaction: PreparedTxDto;
  /** How to index the resulting broadcast (the real hash is filled in after signing). */
  record: Omit<ChainRecordRequest, "txHash">;
}

export interface SignAndRecordResult {
  txHash: string;
  explorerUrl: string;
}

export function useChainTx() {
  const config = useConfig();
  const queryClient = useQueryClient();

  return useMutation<SignAndRecordResult, Error, SignAndRecordInput>({
    mutationFn: async ({ transaction, record }) => {
      // Make sure the wallet is on the commitment's chain before signing.
      const account = getAccount(config);
      if (account.chainId !== transaction.chainId) {
        await switchChain(config, { chainId: transaction.chainId });
      }

      // The USER signs and broadcasts from their own wallet — never the backend.
      const hash = await sendTransaction(config, {
        to: transaction.to as `0x${string}`,
        data: transaction.data as `0x${string}`,
        value: BigInt(transaction.value),
        chainId: transaction.chainId,
      });

      await waitForTransactionReceipt(config, { hash, chainId: transaction.chainId });

      // Record only the REAL hash the wallet returned (rule 1).
      const body: ChainRecordRequest = { ...record, txHash: hash };
      await apiPost<ChainRecordResult>("/api/chain/record", body);

      return { txHash: hash, explorerUrl: explorerTxUrl(hash) };
    },
    onSuccess: () => {
      // A new on-chain tx changes the commitments / rewards / activity / goals views.
      for (const key of [["commitments"], ["rewards"], ["activity"], ["goals"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
