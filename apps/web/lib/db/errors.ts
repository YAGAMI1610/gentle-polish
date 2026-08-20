/**
 * Errors raised by the data-access layer.
 *
 * `WalletScopeError` is thrown when a caller tries to act on a row that is not
 * owned by the authenticated wallet (e.g. attaching a check-in to someone
 * else's goal). It exists so the API layer (build step 9, once CSRF + SIWE are
 * in place — see LIMITATIONS.md §4) can map a scope violation to an HTTP 403
 * instead of leaking a 404/500 that reveals whether the row exists.
 *
 * Read paths do NOT throw this: a scoped read of another wallet's data returns
 * null / an empty list, so a caller can never distinguish "not yours" from
 * "does not exist".
 */
export class WalletScopeError extends Error {
  readonly code = "WALLET_SCOPE" as const;

  constructor(message = "resource not found for this wallet") {
    super(message);
    this.name = "WalletScopeError";
  }
}

/**
 * Thrown when a caller tries to (re-)write the off-chain terms of a commitment
 * whose goal is already anchored on-chain. On-chain terms are write-once (the
 * contract's I5 "write-once terms" invariant), so the off-chain row must not be
 * replaced either. The API layer maps this to HTTP 409 Conflict — a client-side
 * conflict the caller should not blindly retry — rather than a 500 that would
 * read as a server fault and page an operator.
 */
export class CommitmentTermsLockedError extends Error {
  readonly code = "TERMS_LOCKED" as const;

  constructor(message = "this goal already has an on-chain commitment; its terms are fixed") {
    super(message);
    this.name = "CommitmentTermsLockedError";
  }
}
