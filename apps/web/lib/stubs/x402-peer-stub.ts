/**
 * Empty stub for @coinbase/cdp-sdk's unmet x402 peer dependencies — @x402/core,
 * @x402/evm, @x402/extensions, @x402/svm (build step 9). See next.config.ts and
 * LIMITATIONS.md: RainbowKit's Base Account connector transitively pulls
 * Coinbase's cdp-sdk, whose x402 payment-signing peer deps we neither install nor
 * ever invoke — CommitAI uses standard EVM wallets on BOT Chain. Those modules are
 * imported at the top of unused code paths, so aliasing them to this empty module
 * lets the bundle resolve without shipping (or requiring) the x402 payment stack.
 */
export {};
