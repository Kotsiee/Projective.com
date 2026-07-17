import type { BottomNavItem } from "@projective/ui/navigation";
import { NavIcon } from "./nav-icons.tsx";

/**
 * bottom-nav-model — the mobile thumb-nav's exactly-five primaries (DESIGN_SYSTEM.md Part D.3): Home ·
 * Explore · Create · Workspace (Projects/Services) · Dashboard. Provides the app's `NavIcon` VNodes to
 * the icon-agnostic package `BottomNav`. Secondary destinations (Messages, Teams, Wallet, …) live in
 * the header + account menu, not here — the bar stays thumb-simple.
 */
function on(path: string, base: string): boolean {
	return path === base || path.startsWith(`${base}/`);
}

/** The mobile bottom-nav destinations for a given pathname. */
export function bottomNavItems(path: string): BottomNavItem[] {
	return [
		{ href: "/home", label: "Home", icon: <NavIcon name="home" />, active: on(path, "/home") },
		{
			href: "/explore",
			label: "Explore",
			icon: <NavIcon name="explore" />,
			active: on(path, "/explore"),
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
