import type { BottomNavItem } from "@projective/ui/navigation";
import type { UserContext } from "@projective/types/auth";
import { NavIcon } from "./nav-icons.tsx";
import { isExploreSurface } from "./explore-surface.ts";

/**
 * bottom-nav-model — the mobile thumb-nav's exactly-five primaries (DESIGN_SYSTEM.md Part D.3): Home ·
 * Explore · Create · Workspace (Projects/Services) · Dashboard. Provides the app's `NavIcon` VNodes to
 * the icon-agnostic package `BottomNav`. Secondary destinations (Messages, Teams, Wallet, …) live in
 * the header + account menu, not here — the bar stays thumb-simple.
 */
function on(path: string, base: string): boolean {
	return path === base || path.startsWith(`${base}/`);
}

/**
 * The mobile bottom-nav destinations for a given pathname. Explore lights on the same surfaces the
 * desktop rail lights it on — the search, the entity viewer, another entity's profile — so the two
 * bars never disagree about where the reader is (`context` is what tells a stranger's profile from
 * the viewer's own; without it every profile reads as Explore's).
 */
export function bottomNavItems(
	path: string,
	context: Pick<UserContext, "handle"> = { handle: null },
): BottomNavItem[] {
	return [
		{ href: "/home", label: "Home", icon: <NavIcon name="home" />, active: on(path, "/home") },
		{
			href: "/explore",
			label: "Explore",
			icon: <NavIcon name="explore" />,
			active: isExploreSurface(path, context),
		},
		{
			href: "/create",
			label: "Create",
			icon: <NavIcon name="create" />,
			active: on(path, "/create"),
		},
		{
			// Workspace fuses the Projects + Services surfaces under one thumb target.
			href: "/projects",
			label: "Workspace",
			icon: <NavIcon name="projects" />,
			active: on(path, "/projects") || on(path, "/services"),
		},
		{
			href: "/dashboard",
			label: "Dashboard",
			icon: <NavIcon name="dashboard" />,
			active: on(path, "/dashboard"),
		},
	];
}
