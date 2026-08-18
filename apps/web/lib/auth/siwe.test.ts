import { describe, expect, it } from "vitest";
import { SiweMessage, generateNonce } from "siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { UnauthorizedError } from "./errors";
import { verifySiwe } from "./siwe";

const DOMAIN = "localhost:3000";
const URI = "http://localhost:3000";
const CHAIN_ID = 968;

async function signInWith(nonce: string, opts?: { claimedAddress?: `0x${string}` }) {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = new SiweMessage({
    domain: DOMAIN,
    address: opts?.claimedAddress ?? account.address,
    statement: "Sign in to CommitAI.",
    uri: URI,
    version: "1",
    chainId: CHAIN_ID,
    nonce,
  }).prepareMessage();
  const signature = await account.signMessage({ message });
  return { account, message, signature };
}

describe("verifySiwe (real EIP-191 crypto, no mock)", () => {
  it("accepts a valid signature bound to the issued nonce + domain", async () => {
    const nonce = generateNonce();
    const { account, message, signature } = await signInWith(nonce);
    const result = await verifySiwe({ message, signature, nonce, domain: DOMAIN });
    expect(result.address).toBe(account.address.toLowerCase());
    expect(result.chainId).toBe(CHAIN_ID);
  });

  it("rejects a replay under a different nonce (anti-replay binding)", async () => {
    const nonce = generateNonce();
    const { message, signature } = await signInWith(nonce);
    await expect(
      verifySiwe({ message, signature, nonce: generateNonce(), domain: DOMAIN }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a domain mismatch (anti-phishing binding)", async () => {
    const nonce = generateNonce();
    const { message, signature } = await signInWith(nonce);
    await expect(
      verifySiwe({ message, signature, nonce, domain: "evil.example" }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a tampered signature", async () => {
    const nonce = generateNonce();
    const { message } = await signInWith(nonce);
    const forged = `0x${"11".repeat(65)}`;
    await expect(
      verifySiwe({ message, signature: forged, nonce, domain: DOMAIN }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a message that claims an address it was not signed by (spoof)", async () => {
    const nonce = generateNonce();
    const victim = privateKeyToAccount(generatePrivateKey());
    // Attacker signs a message that names the victim as the address.
    const { message, signature } = await signInWith(nonce, { claimedAddress: victim.address });
    await expect(verifySiwe({ message, signature, nonce, domain: DOMAIN })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("rejects a malformed message", async () => {
    await expect(
      verifySiwe({
        message: "not a siwe message",
        signature: "0xdead",
        nonce: "x",
        domain: DOMAIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
