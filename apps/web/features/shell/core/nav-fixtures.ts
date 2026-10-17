/**
 * nav-fixtures — local, swappable stand-ins for the data-backed portions of the navigation shell
 * (thin-frontend pattern, root CLAUDE.md §10 / Decisions #10–#13). These are dumb fixtures the shell
 * islands read directly; a later pass swaps each `getX()` for a `fetch("/api/…")` call returning the
 * same shape, with zero component churn. No Supabase / DB access here (islands stay dumb).
 */

import { mockAvatar } from "@web/utils/mock-assets.ts";

// #region Types
/**
 * A recently-active project surfaced under the sidebar's Projects disclosure (YouTube-style). Teams and
 * businesses are NOT listed here: their sidebar entries come from the session's real acting context
 * (`nav-model`), and the account popover reads the viewer's real memberships through the live roster —
 * a fixture team would be a link to an entity nobody belongs to.
 */
export interface RecentWorkspace {
	/** Stable id (route slug). */
	id: string;
	/** Display name. */
	label: string;
	/** Which entity kind this is — drives the leading glyph/tint. */
	kind: "project";
	/** Destination route. */
	href: string;
	/** Owner display name (avatar alt / initials fallback). */
	owner: string;
	/** Owner profile picture — the nested link shows this circular avatar instead of a generic icon. */
	ownerAvatar: string;
	/** Whether this workspace has an unseen update (drives a pulsing dot, never a count). */
	hasUpdate?: boolean;
}

/**
 * A products-&-services offering surfaced under the sidebar's "Products & Services" disclosure
 * (freelancers/teams only). Kept distinct from {@link RecentWorkspace} — an offering shows its own
 * cover thumbnail, not an owner avatar.
 */
export interface OfferingSublink {
	/** Stable id (route slug). */
	id: string;
	/** Display name. */
	label: string;
	/** Whether this is a sellable service or a digital product — drives the leading glyph. */
	kind: "service" | "product";
	/** Destination route. */
	href: string;
}

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
/** Unsplash portrait crops (open registry, per DESIGN_SYSTEM.md §C.4) used as owner avatars. */
const FACE = (id: string) => mockAvatar(id);

const RECENT_WORKSPACES: readonly RecentWorkspace[] = [
	{
		id: "prj-ghnkqoopo4",
		label: "Aurora Rebrand",
		kind: "project",
		href: "/projects/prj-ghnkqoopo4",
		owner: "Mara Ellison",
		ownerAvatar: FACE("photo-1494790108377-be9c29b29330"),
		hasUpdate: true,
	},
	{
		id: "prj-xmvjo9wga8",
		label: "Helio App",
		kind: "project",
		href: "/projects/prj-xmvjo9wga8",
		owner: "Theo Marsh",
		ownerAvatar: FACE("photo-1507003211169-0a1dd7228f2d"),
	},
];

/** Products & services the acting seller offers — the "Products & Services" disclosure list. */
const OFFERINGS: readonly OfferingSublink[] = [
	{
		id: "brand-identity-sprint",
		label: "Brand identity sprint",
		kind: "service",
		href: "/services/brand-identity-sprint",
	},
	{
		id: "landing-in-a-week",
		label: "Landing page in a week",
		kind: "service",
		href: "/services/landing-in-a-week",
	},
	{
		id: "aurora-ui-kit",
		label: "Aurora UI Kit — Pro",
		kind: "product",
		href: "/products/aurora-ui-kit",
	},
	{
		id: "icon-line-set",
		label: "640-icon line set",
		kind: "product",
		href: "/products/icon-line-set",
	},
];

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

/** Most-recently-active projects for the Projects disclosure. Swap for `/api/workspaces/recent`. */
export function getRecentWorkspaces(): readonly RecentWorkspace[] {
	return RECENT_WORKSPACES;
}

/** Products & services the seller offers, for the "Products & Services" disclosure. Swap for `/api/offerings/recent`. */
export function getOfferings(): readonly OfferingSublink[] {
	return OFFERINGS;
}

/** The `dev:mock` account's standing facts — the fallback for a token that carries none. */
export function getAccountCapabilities(): AccountCapabilities {
	return ACCOUNT_CAPABILITIES;
}
