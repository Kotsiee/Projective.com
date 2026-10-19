import type { BottomNavItem } from "@projective/ui/navigation";
import type { UserContext } from "@projective/types/auth";
import { NavIcon } from "./nav-icons.tsx";
import { bottomNavDestinations } from "./bottom-nav-destinations.ts";

/**
 * bottom-nav-model — the mobile thumb-nav's exactly-five primaries (DESIGN_SYSTEM.md Part D.3): Home ·
 * Explore · Create · Workspace (Projects/Services) · Calendar, from the pure
 * {@link bottomNavDestinations}. Provides the app's `NavIcon` VNodes to the icon-agnostic package
 * `BottomNav`. Secondary destinations (Messages, Teams, Wallet, …) live in the header + account menu,
 * not here — the bar stays thumb-simple.
 */
export function bottomNavItems(
	path: string,
	context: Pick<UserContext, "handle"> = { handle: null },
): BottomNavItem[] {
	return bottomNavDestinations(path, context).map((d) => ({
		href: d.href,
		label: d.label,
		icon: <NavIcon name={d.icon} />,
		active: d.active,
	}));
}
