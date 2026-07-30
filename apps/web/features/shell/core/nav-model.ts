import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { IconName } from "./nav-icons.tsx";
import { getAccountCapabilities, getOfferings, getWorkspacesByKind } from "./nav-fixtures.ts";

/**
 * nav-model — the single source of truth for the global sidebar's destinations, their glyphs, active
 * state, update-dots, and nested disclosures. Shared by the desktop L-shell sidebar and (later) the
 * mobile shells so the wayfinding stays consistent across all four navigation profiles.
 *
 * The roster is **tailored to the hydrated {@link UserContext}** (User Context Hydration) so the
 * correct skeleton ships in the first byte: seller-only destinations appear only for freelancers,
 * Teams is hidden inside an organisation context, and management links are gated to `admin`. This is
 * a read-only visual guide — every destination re-checks access server-side + under RLS on navigation.
 */

// #region Types
/** A nested disclosure row (recent workspace or Dashboard quick-link). */
export interface NavSublink {
	label: string;
	href: string;
	/** Leading glyph (Dashboard quick-links). Omitted when `avatar` is set. */
	icon?: IconName;
	/** Owner profile picture — workspace rows show this circular avatar instead of an icon. */
	avatar?: string;
	/** Owner display name (avatar alt / initials fallback). */
	owner?: string;
	active?: boolean;
	/** Unseen-update indicator — a pulsing dot, never a count. */
	dot?: boolean;
}

/** A top-level global-navigation destination. */
export interface NavModelItem {
	/** Stable key (also the disclosure id when it has children). */
	key: string;
	label: string;
	href: string;
	icon: IconName;
	active?: boolean;
	dot?: boolean;
	/** When present, the item renders an expandable disclosure of these sublinks (expanded rail only). */
	children?: NavSublink[];
}
// #endregion

/** True when `path` is `base` or a descendant of it. */
function isActive(path: string, base: string): boolean {
	return path === base || path.startsWith(`${base}/`);
}

/**
 * The global navigation roster for a given pathname, tailored to the hydrated {@link UserContext} +
 * the account's standing {@link getAccountCapabilities}. Kind-strict disclosures expose the
 * most-recently-active workspaces of exactly one entity kind (Projects → projects, Teams → teams,
 * Businesses → businesses) and the seller's offerings (Products & Services → services/products),
 * pulled from `nav-fixtures`.
 *
 * Role/context tailoring (chrome only — never an access decision; the server re-checks under RLS):
 *  - **Products & Services** → freelancers and teams only (a seller surface).
 *  - **Teams** → freelancers and teams only.
 *  - **Businesses** → only when the account has enabled a business account (independent of seller
 *    capability), or when acting inside a `business` context.
 *  - **Analytics** (replaces the generic Dashboard) → freelancers, teams, businesses, or anyone who
 *    belongs to a team/business.
 *
 * `context` defaults to {@link PERSONAL_MEMBER_CONTEXT} so a caller that hasn't resolved one yet
 * still gets a populated authenticated rail.
 */
export function globalNav(
	path: string,
	context: UserContext = PERSONAL_MEMBER_CONTEXT,
): NavModelItem[] {
	const { isFreelancer, contextType } = context;
	const caps = getAccountCapabilities();

	// #region Capability predicates (chrome only)
	const isTeamCtx = contextType === "team";
	const isBusinessCtx = contextType === "business";
	const belongsToOrg = caps.belongsToTeam || caps.belongsToBusiness || isTeamCtx || isBusinessCtx ||
		contextType === "organisation";
	/** Seller-surface actors: individual freelancers or a team context. */
	const isSeller = isFreelancer || isTeamCtx;
	const showServices = isSeller;
	const showTeams = isSeller;
	const showBusinesses = caps.businessAccountEnabled || isBusinessCtx;
	const showAnalytics = isFreelancer || isTeamCtx || isBusinessCtx || belongsToOrg;
	// #endregion

	/** Map recent workspaces of one kind into kind-strict disclosure sublinks (owner-avatar led). */
	const workspaceSublinks = (kind: "project" | "team" | "business"): NavSublink[] =>
		getWorkspacesByKind(kind).map((w): NavSublink => ({
			label: w.label,
			href: w.href,
			avatar: w.ownerAvatar,
			owner: w.owner,
			active: isActive(path, w.href),
			dot: w.hasUpdate,
		}));

	/** The seller's products & services, as offering-glyph-led sublinks. */
	const offeringSublinks = (): NavSublink[] =>
		getOfferings().map((o): NavSublink => ({
			label: o.label,
			href: o.href,
			icon: o.kind === "product" ? "product" : "services",
			active: isActive(path, o.href),
		}));

	const items: Array<NavModelItem | null> = [
		{ key: "home", label: "Home", href: "/home", icon: "home", active: isActive(path, "/home") },
		{
			key: "explore",
			label: "Explore",
			href: "/explore",
			icon: "explore",
			active: isActive(path, "/explore"),
		},
		{
			key: "messages",
			label: "Messages",
			href: "/messages",
			icon: "messages",
			active: isActive(path, "/messages"),
			dot: true,
		},
		// Projects — a sleek briefcase; the disclosure is STRICTLY projects (never teams/businesses).
		{
			key: "projects",
			label: "Projects",
			href: "/projects",
			icon: "briefcase",
			active: isActive(path, "/projects"),
			children: workspaceSublinks("project"),
		},
		// Catalogue (Products & Services) — freelancers and teams only; the seller-side management
		// surface, repointed from the `/services` placeholder to the `/catalogue` console (Decision #53);
		// disclosure is STRICTLY the seller's offerings.
		showServices
			? {
				key: "catalogue",
				label: "Catalogue",
				href: "/catalogue",
				icon: "services",
				active: isActive(path, "/catalogue"),
				children: offeringSublinks(),
			}
			: null,
		// Teams — freelancers and teams only; disclosure is STRICTLY teams.
		showTeams
			? {
				key: "teams",
				label: "Teams",
				href: "/teams",
				icon: "teams",
				active: isActive(path, "/teams"),
				children: workspaceSublinks("team"),
			}
			: null,
		// Businesses — only when a business account is enabled; disclosure is STRICTLY businesses.
		showBusinesses
			? {
				key: "business",
				label: "Businesses",
				// `/businesses` (plural) is canonical — the singular placeholder is retired.
				href: "/businesses",
				icon: "business",
				active: isActive(path, "/businesses"),
				children: workspaceSublinks("business"),
			}
			: null,
		// Analytics — replaces the generic Dashboard; gated to sellers / entity members.
		showAnalytics
			? {
				key: "analytics",
				label: "Analytics",
				href: "/analytics",
				icon: "analytics",
				active: isActive(path, "/analytics"),
			}
			: null,
		{
			key: "wallet",
			label: "Wallet",
			href: "/wallet",
			icon: "wallet",
			active: isActive(path, "/wallet"),
		},
	];

	return items.filter((item): item is NavModelItem => item !== null);
}
