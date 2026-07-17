import type { JSX } from "preact";
import { NavItem } from "@projective/ui/navigation";
import { globalNav } from "@web/features/shell/core/nav-model.ts";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";

/**
 * MobileNavList — the global destinations rendered inside the mobile pull-out drawer (Part D.3).
 * Phase-1 baseline so the mobile user shell stays navigable; Phase 2 replaces the trigger with the
 * profile avatar + account sheet and adds the persistent bottom nav. Plain NavItems (no collapsed
 * tooltips — the drawer is always expanded).
 */
export function MobileNavList({ path }: { path: string }): JSX.Element {
	return (
		<>
			{globalNav(path).map((item) => (
				<NavItem
					key={item.key}
					href={item.href}
					label={item.label}
					icon={<NavIcon name={item.icon} />}
					active={item.active}
					dot={item.dot}
				/>
			))}
		</>
	);
}
