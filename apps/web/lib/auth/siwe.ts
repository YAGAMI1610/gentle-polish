/**
 * Server-side Sign-In With Ethereum verification (EIP-4361, build step 9).
 *
 * `verifySiwe` is the single trust boundary that turns a (message, signature)
 * pair into an authenticated wallet address. It binds the signature to:
 *   - the one-time `nonce` we issued (anti-replay), and
 *   - the expected `domain` (anti-phishing).
 * Any failure throws UnauthorizedError — the caller maps that to 401. This is a
 * real cryptographic check (no mock): siwe recovers the signer via EIP-191 and
 * compares it to the address the message claims.
 */
import { SiweMessage } from "siwe";
import { evmAddressSchema } from "@/lib/db/schemas";
import { UnauthorizedError } from "./errors";

export interface VerifiedSiwe {
  /** Lowercased, validated EVM address of the verified signer. */
  address: string;
  chainId: number;
}

export interface VerifySiweArgs {
  message: string;
  signature: string;
  /** The nonce we issued and stored in the session; must match the message. */
  nonce: string;
  /** Expected domain (host). Omit only in tests that don't assert domain binding. */
  domain?: string;
}

export async function verifySiwe(args: VerifySiweArgs): Promise<VerifiedSiwe> {
  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(args.message);
  } catch {
    throw new UnauthorizedError("malformed sign-in message");
  }

  let result;
  try {
    result = await parsed.verify(
      {
        signature: args.signature,
        nonce: args.nonce,
        ...(args.domain ? { domain: args.domain } : {}),
      },
      { suppressExceptions: true },
    );
  } catch {
    throw new UnauthorizedError("sign-in verification failed");
  }

  if (!result.success) {
    throw new UnauthorizedError("sign-in verification failed");
  }

  return {
    address: evmAddressSchema.parse(result.data.address),
    chainId: result.data.chainId,
  };
}
