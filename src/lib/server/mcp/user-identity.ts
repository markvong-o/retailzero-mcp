import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { WISHLISTS, PREFERENCES } from "@/lib/server/products";

/**
 * Per-user identity for MCP tools.
 *
 * Auth0 access tokens always carry `sub`, but not `email` (that's an ID
 * token claim) unless a Post-Login Action adds it. So the user key is:
 *   1. an email claim, if the tenant adds one (plain `email` or any
 *      namespaced `.../email` custom claim), otherwise
 *   2. the `sub`, which is stable and unique per user.
 * Never a shared default: an unauthenticated call has no user.
 */

/** The seeded demo persona whose wishlist, preferences and orders new users inherit. */
export const DEMO_PERSONA = "alex@example.com";

export function getUserKey(authInfo: AuthInfo | undefined): string {
  const extra = (authInfo?.extra ?? {}) as Record<string, unknown>;
  const email =
    (typeof extra.email === "string" && extra.email) ||
    (Object.entries(extra).find(([k, v]) => k.endsWith("/email") && typeof v === "string")?.[1] as string | undefined);
  if (email) return email;

  const sub = typeof extra.sub === "string" ? extra.sub : undefined;
  if (sub && sub !== "unknown" && sub !== "anonymous") return sub;

  throw new Error("Cannot identify user: token has no sub or email claim.");
}

const seeded = new Set<string>();

/**
 * Give a first-time user their own copy of the demo persona's wishlist and
 * preferences, so the demo still has something to show. Runs once per user
 * per process; the copies are independent, so users never see each other's
 * changes. Order history is seeded by the tool module that owns the orders.
 */
export function ensurePersonaSeed(userKey: string): void {
  if (seeded.has(userKey)) return;
  seeded.add(userKey);
  if (userKey === DEMO_PERSONA) return;
  if (!WISHLISTS.has(userKey)) WISHLISTS.set(userKey, [...(WISHLISTS.get(DEMO_PERSONA) ?? [])]);
  if (!PREFERENCES.has(userKey)) PREFERENCES.set(userKey, [...(PREFERENCES.get(DEMO_PERSONA) ?? [])]);
}

/** Suffix that makes a seeded order ID unique per user. */
export function userSuffix(userKey: string): string {
  return userKey.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase();
}
