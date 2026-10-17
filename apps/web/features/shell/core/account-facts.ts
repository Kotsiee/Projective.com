import type { UserContext } from "@projective/types/auth";
import { type AccountCapabilities, getAccountCapabilities } from "./nav-fixtures.ts";

/**
 * account-facts — the account's standing facts the shell gates on, and the Businesses persona rule.
 *
 * The facts come from the session: the access-token hook stamps `belongsToTeam`, `belongsToBusiness`
 * and `businessHeadroom` into the token at every mint (`public.custom_access_token_hook`), and
 * `resolveUserContext` carries them onto the {@link UserContext}. A token that does not carry them —
 * the stub / `dev:mock` session's hand-made token — reads the `dev:mock` fixture instead
 * ({@link getAccountCapabilities}), so a mock session still paints a populated rail.
 *
 * Chrome only: the sidebar and the Create menu read these to decide what is drawn. Every destination
 * re-checks under RLS, and `org.create_workspace` refuses past the plan's allowance on its own.
 */

// #region Facts
/** The context's account facts, or the `dev:mock` fixture when the token did not carry them. */
export function accountFacts(context: UserContext): AccountCapabilities {
	const { belongsToTeam, belongsToBusiness, businessHeadroom } = context;
	if (
		typeof belongsToTeam === "boolean" && typeof belongsToBusiness === "boolean" &&
		typeof businessHeadroom === "boolean"
	) {
		return { belongsToTeam, belongsToBusiness, businessHeadroom };
	}
	return getAccountCapabilities();
}
// #endregion

// #region Businesses persona
/** The facts the Businesses persona rule reads from a context. */
export type BusinessPersonaFacts = Pick<UserContext, "contextType" | "restricted" | "role">;

/**
 * Whether a context's person may create a business (Decision #230 (a), resolving #61 (a)): any adult
 * account — client, freelancer or operator — because a business is buyer-side, "a Client with
 * multiple members". A restricted (13–17) account never may (`org.fn_assert_adult`, Decision #208),
 * nor may a context acting as an enterprise, and a guest has no account to create one with.
 */
export function mayCreateBusiness(context: BusinessPersonaFacts): boolean {
	return context.role !== "guest" && !context.restricted && context.contextType !== "enterprise";
}

/**
 * Whether the shell offers Create Business: the person {@link mayCreateBusiness} AND the plan's
 * `businesses_owned` allowance has room for one more (the figure the `/businesses` roster meters).
 * The one predicate behind the Create menu item and the sidebar's Businesses entry.
 */
export function canCreateBusiness(context: UserContext): boolean {
	return mayCreateBusiness(context) && accountFacts(context).businessHeadroom;
}
// #endregion
