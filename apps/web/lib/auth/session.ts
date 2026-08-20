/**
 * Request-bound session access (build step 9). Imports `next/headers`, so this
 * module is server-only — importing it from a client component is a build error,
 * which is the guard we want. Pure helpers live in ./session-core.ts.
 */
import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import { evmAddressSchema } from "@/lib/db/schemas";
import { getSessionOptions, requireWalletFromSession, type SessionData } from "./session-core";

export type { SessionData };
export { SESSION_COOKIE_NAME, requireWalletFromSession } from "./session-core";

/**
 * iron-session's `CookieStore` type isn't exported, and Next 16's `cookies()`
 * store differs from it only under `exactOptionalPropertyTypes` (Next widens the
 * optional third arg of `set` to include `undefined`). The shapes are
 * runtime-identical, so we cast at this single boundary rather than relax a
 * strict-mode flag for the whole app. Method syntax keeps the params bivariant,
 * which selects iron-session's cookie-store overload.
 */
interface IronCookieStore {
  get(name: string): { name: string; value: string } | undefined;
  set(...args: unknown[]): void;
}

/** The iron-session for the current request (read + mutate + .save()/.destroy()). */
export async function getSession(): Promise<IronSession<SessionData>> {
  const store = (await cookies()) as unknown as IronCookieStore;
  return getIronSession<SessionData>(store, getSessionOptions());
}

/** The authenticated wallet for the current request, or throw UnauthorizedError (401). */
export async function requireWallet(): Promise<string> {
  const session = await getSession();
  return requireWalletFromSession(session);
}

/** The authenticated wallet, or null — for endpoints that read differently when signed out. */
export async function getWalletOrNull(): Promise<string | null> {
  const session = await getSession();
  return session.address ? evmAddressSchema.parse(session.address) : null;
}
