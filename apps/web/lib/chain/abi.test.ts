import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, toEventSelector, toFunctionSelector } from "viem";
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
    { sig: "lockFunds(uint256)", functionName: "lockFunds" },
    { sig: "claimReward(uint256)", functionName: "claimReward" },
    { sig: "setAttestor(address)", functionName: "setAttestor" },
    { sig: "setAiVerifier(address)", functionName: "setAiVerifier" },
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

/**
 * The signed-receipt surface (item 11). `approveCompletion` takes an EIP-712 struct, so
 * the tuple's field ORDER is load-bearing twice over: it is the ABI encoding AND the
 * EIP-712 struct-hash preimage the contract recomputes. A silent reorder here would make
 * every signature the backend produces invalid — or, worse, valid for a different
 * decision than the one the AI actually made. These pin it.
 */
describe("approveCompletion receipt tuple", () => {
  const RECEIPT_TUPLE = "(uint256,uint256,bytes32,uint16,bytes32,bytes32,bytes32,uint256)" as const;

  const receipt = {
    commitmentId: 7n,
    goalId: 3n,
    milestoneRef: `0x${"11".repeat(32)}`,
    confidence: 92,
    evidenceHash: `0x${"22".repeat(32)}`,
    verificationHash: `0x${"33".repeat(32)}`,
    modelVersionHash: `0x${"44".repeat(32)}`,
    deadline: 1_800_000_000n,
  } as const;

  it("matches the Solidity selector for the struct + signature form", () => {
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "approveCompletion",
      args: [receipt, "0xdeadbeef"],
    });
    expect(data.slice(0, 10)).toBe(toFunctionSelector(`approveCompletion(${RECEIPT_TUPLE},bytes)`));
  });

  it("declares the tuple fields in exactly the Solidity struct order", () => {
    const fn = commitmentVaultAbi.find(
      (i) => i.type === "function" && i.name === "approveCompletion",
    );
    expect(fn).toBeDefined();
    const first = (fn as { inputs: readonly { type: string; components?: readonly unknown[] }[] })
      .inputs[0];
    expect(first?.type).toBe("tuple");
    const components = (first as { components: readonly { name: string; type: string }[] })
      .components;
    expect(components.map((c) => [c.name, c.type])).toEqual([
      ["commitmentId", "uint256"],
      ["goalId", "uint256"],
      ["milestoneRef", "bytes32"],
      ["confidence", "uint16"],
      ["evidenceHash", "bytes32"],
      ["verificationHash", "bytes32"],
      ["modelVersionHash", "bytes32"],
      ["deadline", "uint256"],
    ]);
  });

  it("round-trips the receipt and signature through encode→decode", () => {
    const signature = `0x${"ab".repeat(65)}` as const;
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "approveCompletion",
      args: [receipt, signature],
    });
    const decoded = decodeFunctionData({ abi: commitmentVaultAbi, data });
    expect(decoded.functionName).toBe("approveCompletion");
    expect(decoded.args).toEqual([receipt, signature]);
  });

  it("matches the Solidity selector for hashVerificationReceipt", () => {
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "hashVerificationReceipt",
      args: [receipt],
    });
    expect(data.slice(0, 10)).toBe(toFunctionSelector(`hashVerificationReceipt(${RECEIPT_TUPLE})`));
  });

  it("recomputes the topic0 of the new receipt events from their Solidity signatures", () => {
    const topics: Array<[string, string]> = [
      ["AiVerifierUpdated", "AiVerifierUpdated(address,address)"],
      [
        "VerificationReceiptAccepted",
        "VerificationReceiptAccepted(uint256,address,bytes32,bytes32,bytes32,bytes32)",
      ],
    ];
    for (const [name, sig] of topics) {
      const item = commitmentVaultAbi.find((i) => i.type === "event" && i.name === name);
      expect(item, name).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(toEventSelector(item as any)).toBe(toEventSelector(sig));
    }
  });

  it("carries every receipt-related custom error so reverts decode", () => {
    for (const name of [
      "EmptyModelVersion",
      "RolesMustDiffer",
      "InvalidVerificationReceipt",
      "ReceiptCommitmentMismatch",
      "ReceiptExpired",
    ]) {
      expect(
        commitmentVaultAbi.some((i) => i.type === "error" && i.name === name),
        name,
      ).toBe(true);
    }
  });

  it("exposes the aiVerifier view and its owner-only setter", () => {
    expect(commitmentVaultAbi.some((i) => i.type === "function" && i.name === "aiVerifier")).toBe(
      true,
    );
    expect(
      commitmentVaultAbi.some((i) => i.type === "function" && i.name === "setAiVerifier"),
    ).toBe(true);
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

/**
 * Drift guard against the Solidity source itself (the gap this catches was real: the
 * §22.2 escrow surface — `withdrawEscrow()`, `escrowedRefunds`, `RefundEscrowed`,
 * `EscrowWithdrawn`, `NothingToWithdraw()` — shipped in `CommitmentVault.sol` but was
 * missing from this hand-transcription, so an event replay would have silently dropped
 * two real events). The cases above prove each *listed* signature is right; these prove
 * nothing the contract declares is *absent*.
 *
 * Direction is one-way on purpose: every declaration in the .sol must appear here. The
 * ABI may be a superset, because `owner()` / `transferOwnership` / `acceptOwnership` /
 * `renounceOwnership` come from OpenZeppelin's `Ownable2Step`, not from this file.
 *
 * Reads the contract from the sibling `contracts/` package. If it is absent (a web-only
 * checkout) the test SKIPS with a reason rather than passing vacuously.
 */
describe("ABI ↔ CommitmentVault.sol (no missing declaration)", () => {
  const sourcePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../contracts/src/CommitmentVault.sol",
  );
  const available = existsSync(sourcePath);
  if (!available) {
    it.skip(`SKIPPED — contract source not found at ${sourcePath}`, () => {});
  }
  const source = available
    ? // Strip comments first: `/// @notice … {withdrawEscrow}` and commented-out code
      // must not be mistaken for declarations.
      readFileSync(sourcePath, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
    : "";

  // Solidity spells enum parameters with the enum's name; on the wire they are `uint8`,
  // which is what the ABI (correctly) declares. Normalize so the comparison is about real
  // drift, not about two languages naming the same wire type differently.
  const WIRE_TYPE: Record<string, string> = { CommitmentStatus: "uint8" };

  /** `uint256 indexed goalId` → `uint256`; keeps only the declared types, in order. */
  const canonical = (name: string, params: string): string => {
    const types = params
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const type = p
          .replace(/\bindexed\b/g, " ")
          .trim()
          .split(/\s+/)[0] as string;
        return WIRE_TYPE[type] ?? type;
      });
    return `${name}(${types.join(",")})`;
  };

  const declared = (keyword: "event" | "error"): string[] => {
    const out: string[] = [];
    const re = new RegExp(
      `\\b${keyword}\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(([^;{]*?)\\)\\s*;`,
      "gs",
    );
    for (const m of source.matchAll(re)) out.push(canonical(m[1] as string, m[2] as string));
    return out;
  };

  it.runIf(available)("declares every event the contract emits, with the same types", () => {
    const inAbi = new Set(
      commitmentVaultAbi
        .filter((i) => i.type === "event")
        .map((i) => canonical(i.name, i.inputs.map((p) => p.type).join(","))),
    );
    const solidityEvents = declared("event");
    // Sanity: the extraction really found the events (a broken regex must not pass).
    expect(solidityEvents.length).toBeGreaterThanOrEqual(13);
    expect(solidityEvents).toContain("EscrowWithdrawn(address,uint256)");
    expect([...solidityEvents].filter((e) => !inAbi.has(e))).toEqual([]);
  });

  it.runIf(available)("declares every custom error the contract can revert with", () => {
    const inAbi = new Set(
      commitmentVaultAbi
        .filter((i) => i.type === "error")
        .map((i) => canonical(i.name, i.inputs.map((p) => p.type).join(","))),
    );
    const solidityErrors = declared("error");
    expect(solidityErrors.length).toBeGreaterThanOrEqual(20);
    expect(solidityErrors).toContain("NothingToWithdraw()");
    expect([...solidityErrors].filter((e) => !inAbi.has(e))).toEqual([]);
  });

  it.runIf(available)("declares every externally callable function and public getter", () => {
    const names = new Set<string>(
      commitmentVaultAbi.filter((i) => i.type === "function").map((i) => i.name),
    );
    const fromFunctions = [...source.matchAll(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)]
      .map((m) => m[1] as string)
      // Internal/private helpers are not part of the ABI (leading underscore by convention).
      .filter((n) => !n.startsWith("_"));
    // Public state variables generate getters too — the `escrowedRefunds` case. Match only
    // declaration statements (one line, ending in `;`, no `function`), so a function
    // header's `public view returns (…)` is not mistaken for a variable name.
    const fromStateVars = source
      .split("\n")
      .filter((line) => !line.includes("function") && line.trimEnd().endsWith(";"))
      .flatMap((line) => [
        ...line.matchAll(/\bpublic\b(?:\s+(?:constant|immutable))?\s+([A-Za-z_][A-Za-z0-9_]*)/g),
      ])
      .map((m) => m[1] as string);
    const expected = [...new Set([...fromFunctions, ...fromStateVars])];
    expect(expected).toContain("withdrawEscrow");
    expect(expected).toContain("escrowedRefunds");
    expect(expected.filter((n) => !names.has(n))).toEqual([]);
  });
});
