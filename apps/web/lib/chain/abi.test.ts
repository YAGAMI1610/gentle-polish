import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, toFunctionSelector } from "viem";
import {
  COMMITMENT_STATUS,
  commitmentStatusName,
  commitmentVaultAbi,
  commitmentVaultAbiSignatures,
} from "./abi";

/**
 * ABI fidelity (build step 8). The ABI is hand-transcribed from
 * `contracts/src/CommitmentVault.sol` (no compiled artifact in-repo), so a wrong
 * signature would silently mis-encode a REAL transaction. These tests recompute
 * every checked selector from the canonical signature and round-trip encode→decode,
 * so any drift from the Solidity source fails here rather than reaching the chain.
 */

const B32 = `0x${"ab".repeat(32)}` as const;

describe("commitmentVaultAbi", () => {
  it("parses into a non-empty typed ABI", () => {
    expect(Array.isArray(commitmentVaultAbi)).toBe(true);
    // `struct` signatures are type helpers parseAbi resolves but does not emit; every
    // other signature must become exactly one ABI item (none silently dropped).
    const structDefs = commitmentVaultAbiSignatures.filter((s) =>
      s.trimStart().startsWith("struct "),
    ).length;
    expect(structDefs).toBeGreaterThan(0);
    expect(commitmentVaultAbi.length).toBe(commitmentVaultAbiSignatures.length - structDefs);
    expect(commitmentVaultAbi.some((i) => i.type === "function")).toBe(true);
    expect(commitmentVaultAbi.some((i) => i.type === "event")).toBe(true);
    expect(commitmentVaultAbi.some((i) => i.type === "error")).toBe(true);
  });

  // Canonical signature (types only) → 4-byte selector must equal the encoded prefix.
  const selectorCases: Array<{ sig: string; functionName: string }> = [
    { sig: "registerGoal(bytes32)", functionName: "registerGoal" },
    {
      sig: "registerMilestone(uint256,bytes32,bytes32,uint16)",
      functionName: "registerMilestone",
    },
    {
      sig: "createCommitment(uint256,uint256,uint256,uint64,uint64,uint16)",
      functionName: "createCommitment",
    },
    { sig: "requestCompletion(uint256,bytes32)", functionName: "requestCompletion" },
    { sig: "approveCompletion(uint256,bytes32,uint16)", functionName: "approveCompletion" },
    { sig: "lockFunds(uint256)", functionName: "lockFunds" },
    { sig: "claimReward(uint256)", functionName: "claimReward" },
    { sig: "setAttestor(address)", functionName: "setAttestor" },
  ];

  it.each(selectorCases)("selector for $functionName matches the Solidity signature", ({ sig }) => {
    const expected = toFunctionSelector(sig);
    // Build args of the right arity from the signature's parameter list.
    const params = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
    const args = params
      .split(",")
      .filter(Boolean)
      .map((t) => {
        if (t.startsWith("uint")) return 1n;
        if (t === "address") return "0x1111111111111111111111111111111111111111";
        if (t === "bytes32") return B32;
        throw new Error(`unhandled abi type in test: ${t}`);
      });
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      functionName: sig.slice(0, sig.indexOf("(")) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: args as any,
    });
    expect(data.slice(0, 10)).toBe(expected);
  });

  it("round-trips createCommitment args through encode→decode", () => {
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "createCommitment",
      args: [7n, 1000n, 500n, 0n, 3600n, 70],
    });
    const decoded = decodeFunctionData({ abi: commitmentVaultAbi, data });
    expect(decoded.functionName).toBe("createCommitment");
    expect(decoded.args).toEqual([7n, 1000n, 500n, 0n, 3600n, 70]);
  });

  it("round-trips requestCompletion args through encode→decode", () => {
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "requestCompletion",
      args: [42n, B32],
    });
    const decoded = decodeFunctionData({ abi: commitmentVaultAbi, data });
    expect(decoded.functionName).toBe("requestCompletion");
    expect(decoded.args).toEqual([42n, B32]);
  });
});

describe("commitmentStatusName", () => {
  it("mirrors the Solidity enum declaration order", () => {
    expect(COMMITMENT_STATUS).toEqual([
      "None",
      "Created",
      "Active",
      "CompletionRequested",
      "Approved",
      "Cancelled",
      "Closed",
    ]);
    expect(commitmentStatusName(0)).toBe("None");
    expect(commitmentStatusName(2)).toBe("Active");
    expect(commitmentStatusName(6n)).toBe("Closed");
  });

  it("returns Unknown for an out-of-range status byte", () => {
    expect(commitmentStatusName(7)).toBe("Unknown");
    expect(commitmentStatusName(255)).toBe("Unknown");
  });
});
