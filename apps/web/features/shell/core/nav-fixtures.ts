/**
 * nav-fixtures — the `dev:mock` stand-in for the account facts the navigation shell gates on
 * (thin-frontend pattern, root CLAUDE.md §10 / Decisions #10–#13). No Supabase / DB access here
 * (islands stay dumb).
 *
 * It no longer carries a recent-projects or an offerings list: those were fixture rows every viewer
 * saw on every signed-in page — two projects that do not exist, four listings that 404, and avatars
 * hot-linked from an image CDN. The sidebar's Projects and Catalogue entries carry no disclosure
 * until the viewer's own recent projects and listings have a read (`nav-model`).
 */

// #region Types
/**
 * The account's standing facts the sidebar and Create menu gate on — memberships and the plan's
 * business allowance, which the acting context alone cannot express. The live values ride the session
 * token (see `account-facts.ts`); this shape is shared by the live read and the `dev:mock` fixture
 * below. Chrome only — every destination re-checks capability server-side + under RLS on navigation.
 */
export interface AccountCapabilities {
	/** The user is an active member of at least one live team (surfaces Analytics for a plain client). */
	belongsToTeam: boolean;
	/** The user is an active member of at least one live business. */
	belongsToBusiness: boolean;
	/** The plan's `businesses_owned` allowance has room for one more business. */
	businessHeadroom: boolean;
}
// #endregion

// #region Fixtures
/**
 * The `dev:mock` account — a member of a team and a business, with room for another business. Read
 * only for a session whose token carries no account facts (`account-facts.ts`); a live session reads
 * its own.
 */
const ACCOUNT_CAPABILITIES: AccountCapabilities = {
	belongsToTeam: true,
	belongsToBusiness: true,
	businessHeadroom: true,
};
// #endregion

/** The `dev:mock` account's standing facts — the fallback for a token that carries none. */
export function getAccountCapabilities(): AccountCapabilities {
	return ACCOUNT_CAPABILITIES;
}
