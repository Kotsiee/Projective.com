import type { UserContext } from "@projective/types/auth";
import { consoleHref } from "@projective/types/catalogue";
import type { IconName } from "./nav-icon-names.ts";
import { canUseTeams, isRestrictedHref } from "./restricted-surfaces.ts";
import { canCreateBusiness } from "./account-facts.ts";

/**
 * actions-model — the header utility tray's data model: the context-aware **Create** menu and the
 * **profile** menu's destinations. Kept beside {@link nav-model} so the two wayfinding surfaces gate
 * on the hydrated {@link UserContext} with one consistent rule set. Chrome only — every destination
 * re-checks capability server-side + under RLS on navigation (a hidden option is not a security gate).
 */

// #region Create menu
/**
 * Where "create a project" leads from the chrome: `/projects?create=1`, the project Quick-Init modal
 * on the feed, rather than a create ROUTE. The lane island opens the modal from this parameter and
 * strips it. There is no `/projects/new` — the segment would fall into `[projectSlug]`, resolve
 * nothing, and render "not found". The Create menu's first entry and the BottomNav's Create
 * (`BOTTOM_NAV_CREATE_HREF`) are both this one value.
 */
export const PROJECT_CREATE_HREF = "/projects?create=1";

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
 *  - **Project** — available to everyone (clients post projects).
 *  - **Team** — only where {@link canUseTeams} holds: a freelancer outside operator mode, or a member
 *    acting as a team (Decision #228 (A)), and never inside an `enterprise` context.
 *  - **Business** — a buyer surface (Decision #230 (a)) → {@link canCreateBusiness}: any adult outside
 *    an enterprise context — client, freelancer or operator — while the plan's `businesses_owned`
 *    allowance has room for one more.
 *  - **Service**, **Product** — seller surfaces → shown only when `isFreelancer`, so a buyer-only
 *    context (a business, an enterprise, a client) never sees "Create Product".
 *  - A **restricted** (13–17) account keeps only Project: every other target is a surface it cannot
 *    see (Decision #192). The check reads each target's PATH, so a query-string deep link into a
 *    restricted surface is withheld like any other.
 *
 * Every option leads to a create flow that exists (Decision #295, gate 11). There is no "Create
 * Article": a member post (`catalogue.articles`) has no create flow yet — the profile's "Write post" is
 * a coming-soon dialog — and `/articles/new` is the editorial reader's 404 (Decision #271). Add it back
 * with the flow, never before.
 */
export function createMenuOptions(context: UserContext): CreateOption[] {
	const { isFreelancer, contextType } = context;
	const options: Array<CreateOption | null> = [
		{ key: "project", label: "Create Project", href: PROJECT_CREATE_HREF, icon: "projects" },
		canUseTeams(context) && contextType !== "enterprise"
			? { key: "team", label: "Create Team", href: "/teams/create", icon: "teams" }
			: null,
		canCreateBusiness(context)
			? { key: "business", label: "Create Business", href: "/businesses/create", icon: "business" }
			: null,
		// The seller console with its Quick-Init modal open on the kind — the same deep link the
		// catalogue lane's New listing menu builds. There is no `/services/new` or `/products/new`.
		isFreelancer
			? {
				key: "service",
				label: "Create Service",
				href: consoleHref({ createOpen: true, createKind: "service" }),
				icon: "services",
			}
			: null,
		isFreelancer
			? {
				key: "product",
				label: "Create Product",
				href: consoleHref({ createOpen: true, createKind: "product" }),
				icon: "product",
			}
			: null,
	];
	return options.filter((o): o is CreateOption =>
		o !== null && !(context.restricted && isRestrictedHref(o.href))
	);
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
