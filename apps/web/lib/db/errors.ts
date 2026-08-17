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
