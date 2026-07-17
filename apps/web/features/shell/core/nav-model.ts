import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { IconName } from "./nav-icons.tsx";
import { getDashboardSublinks, getRecentWorkspaces } from "./nav-fixtures.ts";

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

/** Seller-earnings-flavoured Dashboard sublinks only a freelancer/seller should see. */
const SELLER_SUBLINKS = new Set(["/dashboard/earnings", "/dashboard/reviews"]);

/**
 * The global navigation roster for a given pathname, tailored to the hydrated {@link UserContext}.
 * Projects exposes the most-recently-active workspaces (YouTube-style, each shown by its owner's
 * circular avatar); Dashboard exposes compact quick-links. Both pull from `nav-fixtures`.
 *
 * Context tailoring (chrome only — never an access decision):
 *  - **Services & Products** and **Businesses** are seller surfaces → shown only when
 *    `isFreelancer` (organisations, being buyer-only, never see them).
 *  - **Teams** is hidden inside an `organisation` context (an org is its own tenant, not a team).
 *  - Dashboard **Earnings/Reviews** sublinks are dropped for non-sellers.
 *
 * `context` defaults to {@link PERSONAL_MEMBER_CONTEXT} so a caller that hasn't resolved one yet
 * still gets a populated authenticated rail.
 */
export function globalNav(path: string, context: UserContext = PERSONAL_MEMBER_CONTEXT): NavModelItem[] {
	const { isFreelancer, contextType } = context;

	const recent = getRecentWorkspaces().map((w): NavSublink => ({
		label: w.label,
		href: w.href,
		avatar: w.ownerAvatar,
		owner: w.owner,
		active: isActive(path, w.href),
		dot: w.hasUpdate,
	}));
	const dashboardLinks = getDashboardSublinks()
		.filter((l) => isFreelancer || !SELLER_SUBLINKS.has(l.href))
		.map((l): NavSublink => ({
			label: l.label,
			href: l.href,
			active: path === l.href,
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
		{
			key: "projects",
			label: "Projects",
			href: "/projects",
			icon: "projects",
			active: isActive(path, "/projects"),
			children: recent,
		},
		// Seller surface — freelancers/sellers only.
		isFreelancer
			? {
				key: "services",
				label: "Services & Products",
				href: "/services",
				icon: "services",
				active: isActive(path, "/services"),
			}
			: null,
		// Teams — everyone except an organisation context (an org is its own tenant, not a team).
		contextType !== "organisation"
			? {
				key: "teams",
				label: "Teams",
				href: "/teams",
				icon: "teams",
				active: isActive(path, "/teams"),
			}
			: null,
		// Businesses — seller-side entity; buyers/organisations don't manage one.
		isFreelancer
			? {
				key: "business",
				label: "Businesses",
				href: "/business",
				icon: "business",
				active: isActive(path, "/business"),
			}
			: null,
		{
			key: "dashboard",
			label: "Dashboard",
			href: "/dashboard",
			icon: "dashboard",
			active: isActive(path, "/dashboard"),
			children: dashboardLinks,
		},
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
