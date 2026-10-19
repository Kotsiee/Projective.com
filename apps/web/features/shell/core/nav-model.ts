import type { UserContext } from "@projective/types/auth";
import { PERSONAL_MEMBER_CONTEXT } from "@projective/types/auth";
import type { IconName } from "./nav-icon-names.ts";
import { consoleHref } from "@projective/types/catalogue";
import { accountFacts, canCreateBusiness } from "./account-facts.ts";
import { isExploreSurface } from "./explore-surface.ts";
import { canUseTeams, isRestrictedPath } from "./restricted-surfaces.ts";

/**
 * nav-model — the single source of truth for the global sidebar's destinations, their glyphs, active
 * state, update-dots, and nested disclosures. Shared by the desktop L-shell sidebar and (later) the
 * mobile shells so the wayfinding stays consistent across all four navigation profiles.
 *
 * The roster is **tailored to the hydrated {@link UserContext}** (User Context Hydration) so the
 * correct skeleton ships in the first byte: seller-only destinations appear only for freelancers,
 * Teams is hidden inside an enterprise context, and management links are gated to `admin`. This is
 * a read-only visual guide — every destination re-checks access server-side + under RLS on navigation.
 */

// #region Types
/** A nested disclosure row (the acting team or business). */
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

/** The path of an in-app href, without its query or fragment. */
function pathOf(href: string): string {
	return href.split(/[?#]/, 1)[0];
}

/**
 * The global navigation roster for a given pathname, tailored to the hydrated {@link UserContext} +
 * the account's standing {@link accountFacts}. Kind-strict disclosures expose the
 * entity the session is acting as (Teams → the acting team, Businesses → the acting business). The
 * Projects and Catalogue entries carry no disclosure until the viewer's own recent projects and
 * listings have a read — never fixture rows that are not the viewer's and do not resolve.
 *
 * Role/context tailoring (chrome only — never an access decision; the server re-checks under RLS):
 *  - **Files** → everyone, ungated. An asset hub is not a side of the market.
 *  - **Products & Services** → freelancers and teams only (a seller surface).
 *  - **Teams** → {@link canUseTeams}: a freelancer outside operator mode, or a team context
 *    (Decision #228 (A)).
 *  - **Businesses** → a buyer surface (Decision #230 (a)): shown when the person belongs to a business,
 *    may create one ({@link canCreateBusiness}: an adult outside an enterprise context with
 *    `businesses_owned` headroom), or is acting as a business. Independent of seller capability.
 *  - **Analytics** (replaces the generic Dashboard) → freelancers, teams, businesses, or anyone who
 *    belongs to a team/business.
 *  - A **restricted** (13–17) account loses every entry {@link isRestrictedPath} names — Wallet,
 *    Businesses, Catalogue, Teams, Analytics — whatever else it holds (Decision #192).
 *
 * `context` defaults to {@link PERSONAL_MEMBER_CONTEXT} so a caller that hasn't resolved one yet
 * still gets a populated authenticated rail.
 */
export function globalNav(
	path: string,
	context: UserContext = PERSONAL_MEMBER_CONTEXT,
): NavModelItem[] {
	const { isFreelancer, contextType, role } = context;
	const caps = accountFacts(context);

	// #region Capability predicates (chrome only)
	// Chrome-only auth test. `asAuthenticatedContext` collapses a guest to `PERSONAL_MEMBER_CONTEXT`
	// before `UserShell` ever reaches here, so on every shipping path this is true — it guards this
	// function's own contract (`context` is optional and defaults in), never an access decision.
	const isAuthed = role !== "guest";
	const isTeamCtx = contextType === "team";
	const isBusinessCtx = contextType === "business";
	const belongsToOrg = caps.belongsToTeam || caps.belongsToBusiness || isTeamCtx || isBusinessCtx ||
		contextType === "enterprise";
	/** Seller-surface actors: individual freelancers or a team context. */
	const isSeller = isFreelancer || isTeamCtx;
	const showServices = isSeller;
	const showTeams = canUseTeams(context);
	const showBusinesses = caps.belongsToBusiness || canCreateBusiness(context) || isBusinessCtx;
	const showAnalytics = isFreelancer || isTeamCtx || isBusinessCtx || belongsToOrg;
	// #endregion

	/**
	 * The Teams / Businesses disclosure: the entity the session is ACTING as, when it is one of this kind —
	 * the one membership the chrome knows for certain without a read. The full list lives one click away
	 * on the roster (and in the account popover, which reads it live).
	 */
	const actingSublinks = (kind: "team" | "business"): NavSublink[] => {
		if (contextType !== kind || !context.handle) return [];
		const href = `${kind === "team" ? "/teams" : "/businesses"}/${context.handle}`;
		return [{
			label: `@${context.handle}`,
			href,
			icon: kind === "team" ? "teams" : "business",
			active: isActive(path, href),
		}];
	};

	/**
	 * Where Analytics leads for the acting context — only ever a route that exists: the acting team's
	 * or business's own Analytics module, or a personal seller's catalogue analytics view. `null` for a
	 * context with neither (a client who only belongs to an organisation reads that organisation's
	 * analytics from its console), so the entry is withheld rather than left dead (UI gate 11).
	 */
	const analyticsHref = (): string | null => {
		if ((isTeamCtx || isBusinessCtx) && context.handle) {
			return `${isTeamCtx ? "/teams" : "/businesses"}/${context.handle}/analytics`;
		}
		if (isFreelancer && !isBusinessCtx) return consoleHref({ view: "analytics" });
		return null;
	};
	const analytics = showAnalytics ? analyticsHref() : null;

	const items: Array<NavModelItem | null> = [
		{ key: "home", label: "Home", href: "/home", icon: "home", active: isActive(path, "/home") },
		// Explore — and the two surfaces it opens into. `/view/[id]` is Explore's DETAIL surface, not
		// a destination of its own: every card on `/explore` links there and it carries no rail entry,
		// so without this the rail goes wholly unhighlighted the moment a reader opens a result. And
		// ANOTHER entity's profile (`/@juno`) is the other thing a card opens — every profile-shaped
		// card links there — so it lights Explore too; the viewer's OWN profile is not a discovery
		// destination and lights nothing (`isForeignProfilePath`).
		//
		// Gated on authentication because the rail is not the only navigation carrying an Explore link:
		// the guest `SiteHeader` resolves its own, and that one must keep answering for the public
		// marketing surface. No route reaches this function with a guest context today (`GuestShell`
		// renders no global sidebar at all), so the test states the contract rather than describing a
		// live branch — but it is real at the signature level, since `context` is optional both here
		// and in `ShellSidebar`, and a caller may pass `GUEST_CONTEXT`.
		{
			key: "explore",
			label: "Explore",
			href: "/explore",
			icon: "explore",
			active: isActive(path, "/explore") || (isAuthed && isExploreSurface(path, context)),
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
			// No disclosure until the viewer's own recent projects have a read: a fixture list here
			// showed every user the same two projects that do not exist.
		},
		// Calendar — the acting account's own agenda. UNGATED for the same reason Files is:
		// everyone has a week, whichever side of the market they are on, so this destination carries no
		// capability predicate — which also keeps it clear of the unresolved `is_operator` ⁄
		// `isFreelancer` gate inconsistency still flagged against the seller surfaces (Decisions #17 /
		// #18 / #61).
		{
			key: "calendar",
			label: "Calendar",
			href: "/calendar",
			icon: "calendar",
			active: isActive(path, "/calendar"),
		},
		// Files — the personal/entity asset hub. Deliberately UNGATED: everyone has files, whichever
		// side of the market they are on, so this destination carries no capability predicate at all —
		// which also keeps it clear of the unresolved `is_operator` ⁄ `isFreelancer` gate inconsistency
		// still flagged against the seller surfaces (Decisions #17 / #18 / #61).
		{
			key: "files",
			label: "Files",
			href: "/files",
			icon: "files",
			active: isActive(path, "/files"),
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
				// No disclosure until the seller's own listings have a read (see Projects above).
			}
			: null,
		// Teams — the freelancer persona outside operator mode, or a team context; disclosure is STRICTLY
		// teams.
		showTeams
			? {
				key: "teams",
				label: "Teams",
				href: "/teams",
				icon: "teams",
				active: isActive(path, "/teams"),
				children: actingSublinks("team"),
			}
			: null,
		// Businesses — a member, a person who may create one, or a business context; disclosure is
		// STRICTLY businesses.
		showBusinesses
			? {
				key: "business",
				label: "Businesses",
				// `/businesses` (plural) is canonical — the singular placeholder is retired.
				href: "/businesses",
				icon: "business",
				active: isActive(path, "/businesses"),
				children: actingSublinks("business"),
			}
			: null,
		// Analytics — replaces the generic Dashboard; gated to sellers / entity members, and led to the
		// acting context's real analytics view (there is no `/analytics` page).
		analytics
			? {
				key: "analytics",
				label: "Analytics",
				href: analytics,
				icon: "analytics",
				active: isActive(path, pathOf(analytics)) && pathOf(analytics) !== "/catalogue",
			}
			: null,
		// NO Basket entry. The basket has exactly ONE control on the chrome and it is the header's,
		// which already owns the drawer, the line count and — on a checkout route — the active state
		// (see `UserActions`). A rail twin is a second answer to "where is my basket": the two would
		// sit within a hand's width of each other carrying different affordances and different state,
		// and the checkout flow would light two controls for one surface.
		{
			key: "wallet",
			label: "Wallet",
			href: "/wallet",
			icon: "wallet",
			active: isActive(path, "/wallet"),
		},
	];

	// A restricted (13–17) account sees no money, selling or workspace surface (Decision #192). The
	// check reads each entry's PATH, so a query-string deep link into a restricted surface is withheld.
	return items.filter((item): item is NavModelItem =>
		item !== null && !(context.restricted && isRestrictedPath(pathOf(item.href)))
	);
}
