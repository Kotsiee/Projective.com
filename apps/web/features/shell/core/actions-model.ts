import type { UserContext } from "@projective/types/auth";
import type { IconName } from "./nav-icons.tsx";

/**
 * actions-model — the header utility tray's data model: the context-aware **Create** menu and the
 * **profile** menu's destinations. Kept beside {@link nav-model} so the two wayfinding surfaces gate
 * on the hydrated {@link UserContext} with one consistent rule set. Chrome only — every destination
 * re-checks capability server-side + under RLS on navigation (a hidden option is not a security gate).
 */

// #region Create menu
/** A quick-create option in the header Create dropdown. */
export interface CreateOption {
	/** Stable key (menu item id). */
	key: string;
	/** Full menu label, e.g. "Create Project". */
	label: string;
	/** Destination route for the create flow. */
	href: string;
	/** Leading glyph. */
	icon: IconName;
}

/**
 * The quick-create options for the acting {@link UserContext}, mirroring the sidebar's capability
 * gating (see {@link globalNav}) so the two never disagree:
 *  - **Project** and **Article** — available to everyone (clients post projects; anyone can write).
 *  - **Team** — hidden inside an `organisation` context (an org is its own tenant, not a team).
 *  - **Business**, **Service**, **Product** — seller surfaces → shown only when `isFreelancer`, so a
 *    client/buyer-only profile (e.g. an organisation) never sees "Create Product".
 */
export function createMenuOptions(context: UserContext): CreateOption[] {
	const { isFreelancer, contextType } = context;
	const options: Array<CreateOption | null> = [
		// `/projects?create=1` rather than a create ROUTE: project creation is a Quick-Init modal on the
		// feed, and the lane island opens it from this parameter. There is no `/projects/new` — the
		// segment would fall into `[projectId]`, resolve nothing, and render "not found" from the global
		// header of every authenticated route.
		{ key: "project", label: "Create Project", href: "/projects?create=1", icon: "projects" },
		contextType !== "organisation"
			? { key: "team", label: "Create Team", href: "/teams/create", icon: "teams" }
			: null,
		isFreelancer
			? { key: "business", label: "Create Business", href: "/businesses/create", icon: "business" }
			: null,
		isFreelancer
			? { key: "service", label: "Create Service", href: "/services/new", icon: "services" }
			: null,
		isFreelancer
			? { key: "product", label: "Create Product", href: "/products/new", icon: "product" }
			: null,
		{ key: "article", label: "Create Article", href: "/articles/new", icon: "article" },
	];
	return options.filter((o): o is CreateOption => o !== null);
}
// #endregion

// #region Profile menu
/** The resolved profile-menu links for the acting context. */
export interface ProfileLinks {
	/** The acting profile's public page (`/@handle`) — falls back to the account area when unresolved. */
	viewProfile: string;
	/** The settings area. */
	settings: string;
	/** The sign-out route. */
	logout: string;
	/** Display name for the menu header (the handle, or a neutral fallback). */
	displayName: string;
}

/** Resolve the profile-menu destinations from the hydrated context. */
export function profileLinks(context: UserContext): ProfileLinks {
	const handle = context.handle?.trim();
	return {
		viewProfile: handle ? `/${handle}` : "/settings/profile",
		settings: "/settings",
		logout: "/logout",
		displayName: handle ? `@${handle}` : "Your account",
	};
}
// #endregion
