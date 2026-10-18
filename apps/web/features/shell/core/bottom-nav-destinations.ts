import type { UserContext } from "@projective/types/auth";
import type { IconName } from "./nav-icon-names.ts";
import { isExploreSurface } from "./explore-surface.ts";

/** One primary of the mobile bottom nav, before the app's glyph is attached. */
export interface BottomNavDestination {
	key: "home" | "explore" | "create" | "workspace" | "calendar";
	href: string;
	label: string;
	icon: IconName;
	active: boolean;
}

/**
 * Where the bottom nav's Create leads: the project Quick-Init modal on `/projects` — the one create
 * flow every account has, and the Create menu's first entry (there is no `/create` page).
 */
export const BOTTOM_NAV_CREATE_HREF = "/projects?create=1";

function on(path: string, base: string): boolean {
	return path === base || path.startsWith(`${base}/`);
}

/**
 * The mobile thumb-nav's exactly-five primaries (DESIGN_SYSTEM.md Part D.3), pure so the contract is
 * unit-tested: Home · Explore · Create · Workspace (Projects/Services) · Calendar. Every one leads to a
 * route that exists (UI gate 11): Create opens the project Quick-Init modal, and the fifth slot is
 * Calendar — the retired `/dashboard` was a 404, and the dashboard IS `/home` (PRODUCT_SPEC sitemap),
 * so the old "Dashboard" primary duplicated Home (Decision #296 (B), flagged for the owner).
 *
 * Explore lights on the same surfaces the desktop rail lights it on — the search, the entity viewer,
 * another entity's profile — so the two bars never disagree about where the reader is. Create never
 * lights: it opens a modal over Workspace, which lights instead.
 */
export function bottomNavDestinations(
	path: string,
	context: Pick<UserContext, "handle"> = { handle: null },
): BottomNavDestination[] {
	return [
		{ key: "home", href: "/home", label: "Home", icon: "home", active: on(path, "/home") },
		{
			key: "explore",
			href: "/explore",
			label: "Explore",
			icon: "explore",
			active: isExploreSurface(path, context),
		},
		{ key: "create", href: BOTTOM_NAV_CREATE_HREF, label: "Create", icon: "create", active: false },
		{
			// Workspace fuses the Projects + Services surfaces under one thumb target.
			key: "workspace",
			href: "/projects",
			label: "Workspace",
			icon: "projects",
			active: on(path, "/projects") || on(path, "/services"),
		},
		{
			key: "calendar",
			href: "/calendar",
			label: "Calendar",
			icon: "calendar",
			active: on(path, "/calendar"),
		},
	];
}
